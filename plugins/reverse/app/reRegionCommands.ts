// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.body: a closed solid over a region of the scan that
// profiles do not make — a bent bar, a moulded arm, a tooth, a blob — for a
// boolean to join to the body that profiles do make, or cut from it. The
// region is the piece of the scan between planes that holds a point
// (core/regionMesh.ts); it is laid out by its shape (core/regionLayout.ts)
// and fitted as a patch network's patches are, in the kernel's worker, as a
// preview: the closed one that follows the scan best is made the feature.

import { invalid } from '../../../src/commands/core/common'
import { arr, enumOf, int, num, obj, str, vec3 } from '../../../src/commands/schema'
import { errorMessage } from '../../../src/commands/types'
import type { Vec3 } from '../../../src/core/types'
import { normalize } from '../../../src/core/vec'
import { type Command, CommandError } from '../../../src/plugins/api'
import type { NetworkReport } from '../core/networkBody'
import { type RegionDeviation, regionDeviation } from '../core/regionCheck'
import { boxPlanes, type NetworkRegion, type RegionMesh, regionMesh, type RegionPlane } from '../core/regionMesh'
import { DEFAULT_NETWORK_FIT, emptyNetworkDraft } from '../state/reNetworkDraft'
import { bodiesChanged, bodyRows, failures } from './reCommandAnswers'
import { re, ready } from './reCommandCore'
import { requireFreeName } from './reFeatureCommands'
import { commitNetwork, scanPaths } from './reNetworkCommands'
import { featureBrief, resultOut } from './reReadout'

/** A seed this far off the scan is said, mm. */
const OFF_SCAN_MM = 1
/** The layouts tried, the simplest first: cells along for each the shape
 *  asks for, and lines along. */
const TRIES: { density: number; lines: 4 | 8 }[] = [
  { density: 1, lines: 4 },
  { density: 2, lines: 4 },
  { density: 2, lines: 8 },
  { density: 6, lines: 8 },
]
const TRIES_USUAL = 3
/** A finer layout is taken where it brings this much more of the scan
 *  within the tolerance… */
const FINER_GAIN = 0.005
/** …and none is tried once this much of it is, or this long after the
 *  first was asked for. */
const ENOUGH = 0.98
const LONG_MS = 180_000
/** A region of more triangles than this takes minutes a layout: said. */
const LARGE = 150_000
/** Always read, beside the tolerance asked: the bands a part is judged by,
 *  mm. */
const BANDS = [0.1, 0.25]

interface FreeformIn {
  at: Vec3
  planes?: { point: Vec3; normal: Vec3 }[]
  box?: { min: Vec3; max: Vec3 }
  sink?: number
  tolerance?: number
  tries?: number
  smoothness?: number
  name?: string
  detail?: 'none' | 'brief'
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const pct = (v: number) => Math.round(v * 1e4) / 1e2
const at4 = (p: ArrayLike<number>): Vec3 => [r4(p[0]), r4(p[1]), r4(p[2])]

interface Tried {
  density: number
  lines: 4 | 8
  closed: boolean
  ms: number
  why?: string
  deviation?: RegionDeviation
  report?: NetworkReport
}

/** The share of the scan within the tolerance, as the tries are judged. */
const held = (t: Tried) => t.deviation?.within[0].share ?? 0

function deviationOut(d: RegionDeviation) {
  return {
    points: d.points,
    rms: r4(d.rms),
    p95: r4(d.p95),
    max: r4(d.max),
    within: d.within.filter((w, i) => d.within.findIndex((x) => x.mm === w.mm) === i).map((w) => ({ mm: w.mm, pct: pct(w.share) })),
    worst: d.worst.map((w) => ({ at: at4(w.at), off: r4(w.off) })),
    bodyToScan: { points: d.back.points, rms: r4(d.back.rms), p95: r4(d.back.p95), max: r4(d.back.max) },
  }
}

const regionOut = (m: RegionMesh) => ({
  triangles: m.of.reduce((n, x) => n + (x === 0 ? 1 : 0), 0),
  area: r4(m.area),
  edge: r4(m.edge),
  box: { min: at4(m.min), max: at4(m.max) },
  rims: m.rims.length,
  ...(m.filled > 0 ? { holesFilled: m.filled } : {}),
  ...(m.opened > 0 ? { oddTrianglesLeftOut: m.opened } : {}),
})

export const freeformBody: Command<FreeformIn> = {
  name: 'body',
  title: 'Make a freeform solid over a region of the scan',
  description:
    'A closed solid fitted to a region of the scan, where profiles stop: a bent bar, a moulded arm, a gear’s tooth, a blob on a plate, or (with no planes) a whole closed scan. The region is the piece of the scan that holds at, between planes (each a point and the normal pointing INTO the region; a box is six of them): put one where the region meets a body made another way, a little outside that body’s face (0.1–0.5 mm, past the scan’s noise and any fillet at its foot), facing away from it. Each plane’s cut is closed with a flat cap, carried sink mm straight past the plane (1 by default), so the solid stands that far into the other body: sink has to take in how far outside the face the plane was put. Join them with reverse.feature.add { kind: "boolean", body, tool, op: "join" } (or cut). The region’s own shape lays it out, from one end to the other — its rim to the middle of its far end, or rim to rim — in four-sided patches, branches laid out on their own, fitted together and sewn: every curve is between two patches, so it closes; patches meet tangent except at folds. Holes of the scan inside it are closed flat. Refused: a region with a hole or a ring through it (cut it by planes into pieces without), one a plane cuts in loops one inside another, a scan open where a plane cuts it. Tried simplest first, finer while under 98 % of the scan is within tolerance (tries at most, 3 by default), and the one that follows best is made: one undo step, a Patch network feature drawn on the region, which the build makes again from the scan. Nothing is changed where none closes. Returns feature, result, closed, valid (the kernel’s check), volume, faces, region (triangles, area, edge, box, rims, holesFilled), deviation (the region’s scan surface against the body, evenly by area: rms, p95, max, the per cent within tolerance and within 0.1 and 0.25 mm, the worst places; bodyToScan the other way), smooth (worst angle across a curve not a fold, deg; worstGap, mm), tried and the bodies changed. Seconds to a minute; a whole scan of 300,000 triangles some minutes — bananascan_wait collects it.',
  input: obj(
    {
      at: vec3('A point on the scan inside the region, mm: aim at its middle or its far end.'),
      planes: arr(obj({ point: vec3('A point of the plane, mm.'), normal: vec3('Into the region, any length.') }, ['point', 'normal']), 'Where the region ends.', { maxItems: 16 }),
      box: obj({ min: vec3('mm'), max: vec3('mm') }, ['min', 'max'], 'The region lies inside it: its six sides as planes, beside planes.'),
      sink: num('mm a cap is carried past its plane (1); 0 leaves it on it.', { minimum: 0 }),
      tolerance: num('mm: what the tries are judged by (0.1).', { exclusiveMinimum: 0 }),
      tries: int('Layouts tried at most (3); 4 tries one with six times the cells along, for teeth or ribs across the region.', { minimum: 1, maximum: TRIES.length }),
      smoothness: num('Fairing weight (0.001): 0.01 fairs a noisy scan more.', { minimum: 0 }),
      name: str('The feature’s name. Unique across sketches and features.', { minLength: 1 }),
      detail: enumOf(['none', 'brief'], 'none: id, status, closed, valid, the per cent within tolerance; brief (the default): all of it.'),
    },
    ['at'],
  ),
  label: ({ name }) => `freeform body${typeof name === 'string' ? ` “${name}”` : ''}`,
  run: async (input) => {
    const { at, planes = [], box, sink = 1, tolerance = 0.1, tries = TRIES_USUAL, smoothness, name, detail = 'brief' } = input
    requireFreeName(name)
    if (box && box.min.some((x, k) => !(x < box.max[k]))) invalid('box: each of min is to be under max.')
    const bounds: RegionPlane[] = [
      ...planes.map((q, i) => {
        const n = normalize(q.normal)
        if (!n) invalid(`planes[${i}]: the normal has no length.`)
        return { origin: q.point, normal: n as Vec3 }
      }),
      ...(box ? boxPlanes(box.min, box.max) : []),
    ]
    const s = await ready()
    const scan = scanPaths(s)
    const near = scan.closest(at)
    if (!near) throw new CommandError('no_scan', 'The scan has no triangles.')
    const seed = at4(near.point)
    const region: NetworkRegion = { seed, planes: bounds, sink }
    const mesh = regionMesh(scan, region)
    if (typeof mesh === 'string') invalid(`${mesh} Nothing was changed.`)
    const m = mesh as RegionMesh
    if (m.genus !== 0) invalid(`The region has ${m.genus} hole${m.genus === 1 ? '' : 's'} through it: a freeform body is made over a piece without. Cut it by planes into such pieces. Nothing was changed.`)
    const fit = { ...DEFAULT_NETWORK_FIT, ...(smoothness !== undefined ? { smoothness } : {}) }
    await s.syncScan()
    const client = s.client()
    if (!client) throw new CommandError('unavailable', 'The CAD kernel is not up.')
    const began = performance.now()
    const tried: Tried[] = []
    let best: Tried | null = null
    for (const t of TRIES.slice(0, tries)) {
      if (tried.length > 0 && performance.now() - began > LONG_MS) break
      const from = performance.now()
      const row: Tried = { ...t, closed: false, ms: 0 }
      tried.push(row)
      try {
        const made = await client.preview({ kind: 'network', id: -1, name: name ?? 'Freeform body', nodes: [], curves: [], cells: [], spans: {}, fit, region: { ...region, laid: { ...t } } }, undefined)
        if (!made) throw new Error('the workspace asked the kernel for something else meanwhile')
        if (made.failure) throw new Error(made.failure.message)
        row.closed = made.closed
        row.report = made.network
        row.deviation = regionDeviation(m, bounds, made.mesh, [tolerance, ...BANDS])
        if (!made.closed) row.why = 'its patches do not close'
      } catch (e) {
        row.why = errorMessage(e)
      }
      row.ms = Math.round(performance.now() - from)
      if (row.closed && (!best || held(row) > held(best) + FINER_GAIN)) best = row
      if (best && held(best) >= ENOUGH) break
      // A region that is not laid out at all is not by another count.
      if (!row.closed && !row.deviation && tried.length > 1) break
    }
    const triedOut = tried.map((t) => ({ density: t.density, lines: t.lines, closed: t.closed, ...(t.report ? { patches: t.report.patches.length } : {}), ...(t.deviation ? { pctWithin: pct(held(t)), p95: r4(t.deviation.p95) } : {}), ms: t.ms, ...(t.why ? { why: t.why } : {}) }))
    if (!best) throw new CommandError('failed', `No layout of the region closes into a solid: ${triedOut.map((t) => t.why ?? 'open').join('; ')}. Nothing was changed.`)
    const before = bodyRows(s)
    const id = await commitNetwork(s, { ...emptyNetworkDraft(), fit, region: { ...region, laid: { density: best.density, lines: best.lines } } }, { ...(name !== undefined ? { name } : {}) })
    const f = re().features.find((x) => x.id === id)
    const report = re().results[id]?.network
    const body = re().bodies.find((b) => b.id === id)
    const check = body ? await s.checkBody(id, 0.01).catch(() => null) : null
    const closed = Boolean(report?.closed && check?.closed)
    const failed = failures()
    const head = { id, status: f ? featureBrief(f, false).status : 'removed', closed, valid: check?.valid ?? false }
    if (detail === 'none') return { ...head, pctWithin: pct(held(best)), ...(failed.length > 0 ? { failed } : {}) }
    const warnings = [
      ...(near.distance > OFF_SCAN_MM ? [`at lies ${r4(near.distance)} mm off the scan; the region is the piece at ${JSON.stringify(seed)}.`] : []),
      ...(!closed ? ['The kernel did not sew the body closed: fit a smaller region, or cut it into two.'] : []),
      ...(m.rims.length === 0 && bounds.length > 0 ? ['No plane cuts the region: it is the whole piece of the scan at the seed.'] : []),
      ...(m.of.length > LARGE ? ['A region this dense takes long to build at every change before it: reduce the scan, or suppress the feature meanwhile.'] : []),
    ]
    return {
      ...head,
      feature: f ? featureBrief(f, false) : null,
      result: resultOut(re().results[id]),
      ...(check ? { volume: r4(check.volume), faces: check.faces } : {}),
      region: regionOut(m),
      deviation: deviationOut(best.deviation!),
      ...(report ? { smooth: { worstAngle: r4(report.worstAngle), worstGap: r4(report.worstGap) } } : {}),
      tried: triedOut,
      bodies: bodiesChanged(s, before),
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(failed.length > 0 ? { failed } : {}),
    }
  },
}
