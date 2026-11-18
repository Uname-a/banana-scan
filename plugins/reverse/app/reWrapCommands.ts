// SPDX-License-Identifier: AGPL-3.0-only
// The commands for wrapping a sketch onto a surface and for planes along a
// path (Revo Design's roll-on and its datum planes along a curve):
// reverse.sketch.wrap_read reads where a wrap would land, changing nothing
// — the feature itself is reverse.feature.add { kind: "wrap" };
// reverse.plane.along_path makes plane elements square to a curve at
// stations along it, for sections and sweeps.

import { invalid } from '../../../src/commands/core/common'
import { createPlaneElement } from '../../../src/commands/core/element'
import { findElement } from '../../../src/commands/refs'
import { arr, bool, enumOf, int, num, obj, oneOf, str, vec3 } from '../../../src/commands/schema'
import { roundTo } from '../../../src/core/round'
import { worldAxisDir } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { cross, normalize } from '../../../src/core/vec'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import { wrapOffsets } from '../core/features'
import { pickedProfiles, sweepPath } from '../core/profiles'
import { curveLength, curveOfCircle, curveOfPieces, curveOfPoints, PATH_PLANES_MAX, type PathCurve, type PathPlane, planesAlong, stationLengths, type StationsAsk } from '../core/pathPlanes'
import { wrapSurfaceOf } from '../core/resolve'
import { routePieces, type SweepRoute } from '../core/sweepRoute'
import { placeFlat, polygonOf, profilesMiddle, wrapDepthProblem, wrapFacts, wrapOfGeometry, type WrapSurface, wrapStep } from '../core/wrap'
import { layOutRegion, regionDevelopment, type RegionLayout, stretchProblem, stretchUnder, WRAP_REGION_MAX_STRETCH_PCT } from '../core/wrapRegion'
import { regionOf } from './reSurfaceRegion'
import { commandHost } from '../../../src/commands/host'
import { ready, type Ref, regionKeys, regionPickOf, sketchNamed } from './reCommandCore'
import { featureRef, regionsIn } from './reSchemas'

const r3 = (v: number) => roundTo(v, 3)
const r4 = (v: number) => roundTo(v, 4)
const p3 = (v: readonly number[]) => v.map(r3)
const p6 = (v: readonly number[]) => v.map((x) => roundTo(x, 6))

const elementRefIn = oneOf([int('The element’s id.'), str('The element’s name, whole, case aside.', { minLength: 1 })])

/** The most points of a loop an answer lists, unless asked otherwise. */
const WRAP_READ_POINTS = 120

/** The scan's vertices and triangles as the mesh worker holds them — what a
 *  region of it is laid out by here. */
async function scanMesh(): Promise<{ positions: Float32Array; triangles: Uint32Array; count: number }> {
  const s = useStore.getState()
  if (!s.fileName) throw new CommandError('no_scan', 'A wrap onto a region is laid out on the scan, and none is open.')
  const worker = commandHost().session.clientRef.current
  if (!worker) throw new CommandError('unavailable', 'The mesh worker is not running.')
  const all = await worker.query({ min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity], limit: Math.max(1, s.vertexCount) })
  const tri = await worker.scanIndices()
  if (all.step !== 1 || tri.vertexCount !== all.vertices.length) throw new CommandError('failed', 'The scan’s vertices and triangles did not come back whole.')
  return { positions: all.positions, triangles: tri.indices, count: tri.vertexCount }
}

export const wrapRead: Command<{ sketchId: Ref; regions?: unknown; surface?: Ref; region?: unknown; maxStretchPct?: number; depth?: number; op?: 'new' | 'join' | 'cut'; flip?: boolean; maxPoints?: number }> = {
  name: 'wrap_read',
  title: 'Read where a wrapped sketch lands',
  description:
    'Where a sketch wrapped onto a measured cylinder, cone or plane lands, before any wrap feature is made — the same reading reverse.feature.add { kind: "wrap" } builds from. touch: the line it is rolled on from — a point on it, the surface’s outward normal there, across (x on the development, round the surface) and along (y: up the axis, or up a cone’s slant from its apex); tiltDeg: how far the sketch’s plane is turned from the plane touching there (0 for a sketch drawn tangent or parallel to it; the sketch is laid onto it rigidly about its middle). per profile: across and along, the box it takes on the development, mm; arcDeg, the arc round the axis it covers; perimeter, its outer loop’s length along the surface — the sketch’s own, lengths being kept; outline, its outer loop lifted onto the surface, [x, y, z] mm, thinned to maxPoints; inside, a point inside it on the surface. With depth (op, flip as the feature takes them), offsets says the offsets of the surface the solid lies between and problem why it would not build. With region in place of surface — a free-form region of the scan, as the feature takes it — the region is laid out flat and stretch says how far that stretched the scan under the sketch: maxPct (and at, where), meanPct over its area, triangles under it, limitPct and, past it, problem; the sketch’s lengths on the scan are true to maxPct. Changes nothing.',
  input: obj(
    {
      sketchId: { ...featureRef('sketch'), description: 'The sketch, by id or name.' },
      regions: { ...regionsIn, description: 'As reverse.feature.add takes them: "all" (the default), "largest", keys or points inside them.' },
      surface: { ...elementRefIn, description: 'The cylinder, cone or plane element, by id or name. Or region.' },
      region: { description: 'In place of surface: a region of the scan — its vertices by number, { marked: true }, or { box, normal?, exclude? } — as reverse.feature.add { kind: "wrap" } takes it.' },
      maxStretchPct: num('With region: the stretch past which the wrap is refused, per cent (2 by default).', { exclusiveMinimum: 0 }),
      depth: num('mm — to have the offsets and whether it builds.', { exclusiveMinimum: 0 }),
      op: enumOf(['new', 'join', 'cut']),
      flip: bool('As the feature’s flip.'),
      maxPoints: int(`Points per outline at most (${WRAP_READ_POINTS} by default).`, { minimum: 4, maximum: 2000 }),
    },
    ['sketchId'],
  ),
  readOnly: true,
  long: true,
  run: async ({ sketchId, regions, surface, region, maxStretchPct = WRAP_REGION_MAX_STRETCH_PCT, depth, op = 'join', flip, maxPoints = WRAP_READ_POINTS }) => {
    const s = await ready()
    const sketch = sketchNamed(sketchId)
    if ((surface === undefined) === (region === undefined || region === null)) invalid('Give surface — a measured cylinder, cone or plane — or region, a region of the scan; one of them.')
    const e = surface !== undefined ? findElement(surface) : null
    let layout: RegionLayout | null = null
    let wrapOn: WrapSurface | string
    if (e) wrapOn = wrapSurfaceOf(e.id, s.resolveContext())
    else {
      const vertices = Array.isArray(region) ? (region as number[]) : await regionOf({ ...(region as object), limit: Number.MAX_SAFE_INTEGER })
      const mesh = await scanMesh()
      const off = vertices.find((v) => !(v >= 0 && v < mesh.count))
      if (off !== undefined) invalid(`region: the scan has ${mesh.count} vertices; ${off} is not one of them.`)
      const laid = layOutRegion(mesh.positions, mesh.triangles, mesh.count, vertices)
      if (typeof laid === 'string') invalid(`region: ${laid}`)
      layout = laid as RegionLayout
      wrapOn = { kind: 'region', region: Uint32Array.from(vertices) }
    }
    if (typeof wrapOn === 'string') invalid(`surface: ${wrapOn}`)
    const pick = regions ?? 'all'
    const keys = regionKeys(s, sketch, pick)
    const profiles = pickedProfiles({ regions: keys, regionPick: regionPickOf(pick, keys) }, sketch, s.regionsOf)
    if (typeof profiles === 'string') invalid(profiles)
    const surfaceOn = wrapOn as WrapSurface
    const laidOut = layout
    const made = wrapOfGeometry({ surface: surfaceOn, profiles: profiles as Exclude<typeof profiles, string>, normal: sketch.frame.normal, middle: profilesMiddle(profiles as Exclude<typeof profiles, string>) }, laidOut ? (sf, n, m) => regionDevelopment(laidOut, sf, n, m) : undefined)
    if (typeof made === 'string') throw new CommandError('invalid_input', made)
    const { dev, wrapped } = made
    const stretch = laidOut ? stretchUnder(laidOut, wrapped) : null
    const stretchSaid = stretch ? stretchProblem(stretch, maxStretchPct) : null
    const offsets = depth !== undefined ? wrapOffsets({ depth, op, flip }) : null
    const problem = offsets ? wrapDepthProblem({ surface: surfaceOn, ...offsets }, wrapped, dev) : null
    const per = wrapped.map((p) => {
      const facts = wrapFacts([p], dev)
      const poly = polygonOf(p.outer)
      const step = Math.max(1, Math.ceil(poly.length / maxPoints))
      return {
        across: p3(facts.across),
        along: p3(facts.along),
        ...(facts.arcDeg !== undefined ? { arcDeg: r3(facts.arcDeg) } : {}),
        perimeter: r3(facts.perimeters[0]),
        holes: p.holes.length,
        inside: p3(placeFlat(dev, p.inside, 0)),
        outline: poly.filter((_, i) => i % step === 0).map((f) => p3(placeFlat(dev, f, 0))),
      }
    })
    const all = wrapFacts(wrapped, dev)
    return {
      sketch: { id: sketch.id, name: sketch.name },
      ...(e ? { surface: { id: e.id, name: e.name, ...surfaceOn, ...('center' in surfaceOn ? { center: p3(surfaceOn.center) } : {}) } } : {}),
      ...(laidOut && stretch
        ? {
            region: { points: (surfaceOn as Extract<WrapSurface, { kind: 'region' }>).region.length, triangles: laidOut.patch.indices.length / 3, leftOut: laidOut.patch.leftOut, layout: { iterations: laidOut.iterations, converged: laidOut.converged } },
            stretch: { maxPct: r4(stretch.maxPct), meanPct: r4(stretch.meanPct), ...(stretch.at ? { at: p3(stretch.at) } : {}), triangles: stretch.triangles, limitPct: maxStretchPct, ...(stretchSaid ? { problem: stretchSaid } : {}) },
          }
        : {}),
      touch: { point: p3(dev.touch.point), normal: p6(dev.touch.normal), across: p6(dev.touch.across), along: p6(dev.touch.along) },
      tiltDeg: r3(dev.tiltDeg),
      across: p3(all.across),
      along: p3(all.along),
      ...(all.arcDeg !== undefined ? { arcDeg: r3(all.arcDeg) } : {}),
      sampledEveryMm: dev.step !== undefined ? r4(dev.step) : Number.isFinite(wrapStep(surfaceOn, Infinity)) ? r4(wrapStep(surfaceOn, Infinity)) : null,
      profiles: per,
      ...(offsets ? { offsets, ...(problem ? { problem } : {}) } : {}),
    }
  },
}

// ---- planes along a path ---------------------------------------------------------------

export type PathIn =
  | { route: SweepRoute }
  | { points: Vec3[] }
  | { sketch: Ref; from?: Vec3 }
  | { element: Ref; fromDeg?: number; toDeg?: number }

const pathIn = oneOf(
  [
    obj({ route: obj({ points: arr(vec3('[x, y, z] mm.'), 'The corners, ends first and last.', { minItems: 2 }), bendRadius: num('mm.', { exclusiveMinimum: 0 }), radii: arr({ description: 'A bend’s own radius, mm, or null.' }) }, ['points', 'bendRadius'], 'A route of straights and tangent bends, as reverse.scan.tube_trace gives it and a sweep takes it.') }, ['route'], 'A route in 3D.'),
    obj({ points: arr(vec3('[x, y, z] mm.'), 'In order along the curve; closed where the last is the first.', { minItems: 2 }) }, ['points'], 'A run of points — a traced centreline’s stations, a section’s outline from section.get { space: "world" }: its tangent read over a reach either side, so scatter does not tip the planes.'),
    obj({ sketch: featureRef('sketch'), from: vec3('Start from the end nearest this point (the end nearest the sketch’s origin by default).') }, ['sketch'], 'A sketch’s one chain of lines, arcs and splines end to end.'),
    obj({ element: elementRefIn, fromDeg: num('A circle: where the arc starts, degrees about its normal from the first direction the answer gives (0 by default).'), toDeg: num('Where it ends (fromDeg + 360 by default: the whole circle).') }, ['element'], 'A measured line (its drawn length), circle (or an arc of it), or a cylinder’s or cone’s axis over its length.'),
  ],
  'The curve the planes stand square to.',
)

const stationsIn = oneOf(
  [
    obj({ spacing: num('mm along the curve between planes, from its start.', { exclusiveMinimum: 0 }), ends: bool('A plane at the far end too, where the spacing does not land on it.') }, ['spacing']),
    obj({ count: int('Planes spread evenly, end to end — round a closed curve, evenly with none twice.', { minimum: 1, maximum: PATH_PLANES_MAX }) }, ['count']),
    obj({ at: arr(num('mm along the curve from its start.'), 'Lengths along the curve.', { minItems: 1, maxItems: PATH_PLANES_MAX }) }, ['at']),
  ],
  'Where along the curve.',
)

/** The curve a path input names, with a word for it. */
export async function curveOf(path: PathIn): Promise<{ curve: PathCurve; what: string; zero?: Vec3 }> {
  const fail = (why: string): never => invalid(`path: ${why}`) as never
  const sure = (c: PathCurve | string): PathCurve => (typeof c === 'string' ? fail(c) : c)
  if ('route' in path) {
    const made = routePieces(path.route, path.route.points[0])
    if (typeof made === 'string') fail(made)
    return { curve: sure(curveOfPieces((made as Exclude<typeof made, string>).pieces)), what: `the route of ${path.route.points.length} points` }
  }
  if ('points' in path) return { curve: sure(curveOfPoints(path.points)), what: `the run of ${path.points.length} points` }
  if ('sketch' in path) {
    await ready()
    const sketch = sketchNamed(path.sketch)
    const made = sweepPath(sketch, path.from ?? sketch.frame.origin)
    if (typeof made === 'string') fail(made)
    return { curve: sure(curveOfPieces((made as Exclude<typeof made, string>).pieces)), what: sketch.name }
  }
  const e = findElement(path.element)
  const f = e.fit
  if (!f) return fail(`${e.name} has no geometry.`)
  if (f.kind === 'line' || f.kind === 'cylinder' || f.kind === 'cone') {
    const dir = normalize(f.kind === 'line' ? f.dir : f.axis)
    if (!dir) return fail(`${e.name} has no direction.`)
    const half = f.length / 2
    const a: Vec3 = [f.center[0] - dir[0] * half, f.center[1] - dir[1] * half, f.center[2] - dir[2] * half]
    const b: Vec3 = [f.center[0] + dir[0] * half, f.center[1] + dir[1] * half, f.center[2] + dir[2] * half]
    return { curve: sure(curveOfPieces([{ kind: 'line', a, b }])), what: f.kind === 'line' ? e.name : `${e.name}’s axis` }
  }
  if (f.kind === 'circle') {
    const n = normalize(f.normal)!
    // The first direction: the coordinate axis furthest from the normal,
    // square to it.
    const pick = [0, 1, 2].reduce((m, i) => (Math.abs(n[i]) < Math.abs(n[m]) ? i : m), 0)
    const seed = worldAxisDir((['x', 'y', 'z'] as const)[pick])
    const zero = normalize(cross(cross(n, seed), n))!
    const from = path.fromDeg ?? 0
    return { curve: sure(curveOfCircle(f.center, n, f.radius, zero, from, path.toDeg ?? from + 360)), what: e.name, zero }
  }
  return fail(`${e.name} is a ${f.kind} — a path is a line, a circle, or a cylinder’s or cone’s axis.`)
}

/** The planes a path and its stations come to — refused with why not. */
export async function pathPlanesOf(path: PathIn, stations: StationsAsk, up?: Vec3) {
  const { curve, what, zero } = await curveOf(path)
  const lengths = stationLengths(curve, stations)
  if (typeof lengths === 'string') invalid(`stations: ${lengths}`)
  return { curve, what, zero, planes: planesAlong(curve, lengths as number[], up ? { up } : {}) }
}

/** The planes made plane elements, named `name` 1, 2, … — inside the
 *  caller's step. */
export function makePlaneElements(planes: readonly PathPlane[], name: string): { id: number; name: string }[] {
  return planes.map((p, i) => {
    const id = createPlaneElement(p.origin, p.normal, `${name} ${i + 1}`)
    return { id, name: useStore.getState().elements.find((x) => x.id === id)?.name ?? `${name} ${i + 1}` }
  })
}

export const planesAlongPath: Command<{ path: PathIn; stations: StationsAsk; up?: Vec3; create?: boolean; name?: string }> = {
  name: 'along_path',
  title: 'Planes along a path',
  description:
    'Datum planes square to a curve at stations along it — to cut sections across a bent tube, a rail or a swept rim (section.cut across the plane), sketch a sweep’s profile on (reverse.feature.add { kind: "sketch", plane: { kind: "plane", id } }), or slice it (reverse.section.stack). path: a route in 3D (reverse.scan.tube_trace’s route), a run of points (a traced centreline, a section outline in world from section.get), a sketch’s one chain, or a measured line, circle (an arc of it with fromDeg, toDeg) or axis. stations: every spacing mm from the start (ends: true puts one at the far end too), count spread evenly, or at, lengths along it. Each plane’s normal is the curve’s tangent there, and its sheet (basisU, basisV) is carried along the curve turning as little as it can — sections across a bend keep the same way up; up sets the first sheet’s v (the coordinate axis furthest from the tangent by default). With create (the default) each is made a plane element of 3D Measure, named “<name> 1” on (name: “Station” by default), in one undo step; create: false only reads them. Returns the curve’s length and per plane s (mm along), origin, normal, basisU, basisV, the element made, plane — { kind: "oriented", point, normal } as a sketch or a stack takes it — and construct, for element.construct.',
  input: obj(
    {
      path: pathIn,
      stations: stationsIn,
      up: vec3('The first plane’s v as near this as it lets it.'),
      create: bool('Make the planes elements of 3D Measure (true, the default) or only read them.'),
      name: str('The planes’ name, numbered: “Station” by default.', { minLength: 1 }),
    },
    ['path', 'stations'],
  ),
  label: (input) => `planes along a path${input.create === false ? ' (read)' : ''}`,
  run: async ({ path, stations, up, create = true, name = 'Station' }) => {
    const { curve, what, zero, planes } = await pathPlanesOf(path, stations, up)
    const made = create ? makePlaneElements(planes, name) : []
    return {
      path: what,
      length: r3(curveLength(curve)),
      closed: curve.closed,
      ...(zero ? { zero: p6(zero) } : {}),
      planes: planes.map((p, i) => ({
        s: r3(p.s),
        origin: p3(p.origin),
        normal: p6(p.normal),
        basisU: p6(p.basisU),
        basisV: p6(p.basisV),
        ...(made[i] ? { element: made[i] } : {}),
        plane: { kind: 'oriented', point: p3(p.origin), normal: p6(p.normal) },
        construct: { kind: 'plane', method: 'plane-coords', params: { nx: roundTo(p.normal[0], 6), ny: roundTo(p.normal[1], 6), nz: roundTo(p.normal[2], 6), px: r3(p.origin[0]), py: r3(p.origin[1]), pz: r3(p.origin[2]) } },
      })),
    }
  },
}

