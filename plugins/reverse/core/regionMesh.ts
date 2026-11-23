// SPDX-License-Identifier: AGPL-3.0-only
// A region of the scan as a closed mesh of its own, for a patch network laid
// out over it to close into a solid (regionLayout.ts): the piece of the scan
// that holds a seed, between planes, with a flat cap where each plane cuts it.
//
// The planes are where a body made another way goes on: a plate's face under
// a boss, the face a bent bar stands on. A scan's own surface there is the
// plate's, so the region is cut a little above it and carried on straight
// down — a skirt, `sink` long, square to the plane — and capped at its end,
// so that the solid made of it stands into the other body and joins it. Two
// caps that meet (a region cut by two planes that cross inside it) have no
// skirt: each would stand in the other's way.
//
// A cut leaves slivers where it passes close by a vertex. So a vertex near
// the plane is first moved along one of its own edges onto it: the scan's
// surface is the same to within a share of an edge, and the rim's points are
// about as far apart as the scan's. Edges longer than the region's own scale
// are halved, as a CAD tessellation's are: the curves are traced, and the
// cells mapped, on the mesh. Holes the scan has in the region are closed
// with a flat fill, and edges with more than two triangles opened and closed
// again; what cannot be is said. Pure geometry: the page lays a network out
// on it and the kernel's worker builds it on the same.

import { ShapeUtils, Vector2 } from 'three'
import { sketchFrameOn } from '../../../src/core/section/frame'
import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import { dot, normalize, sub } from '../../../src/core/vec'

/** A plane a region ends at: the region lies on its normal's side. */
export interface RegionPlane {
  origin: Vec3
  normal: Vec3
}

/** What of the scan a patch network is drawn on, in place of all of it. */
export interface NetworkRegion {
  /** A point of the scan inside the region. */
  seed: Vec3
  planes: RegionPlane[]
  /** How far a cap stands past its plane, mm: 0 for on it. */
  sink: number
  /** Laid out by the region's shape (regionLayout.ts), and how: the build
   *  lays it out again from the scan, and the feature's nodes, curves and
   *  cells show it. Absent once the network was edited by hand: they are
   *  then what is built. */
  laid?: { density: number; lines: 4 | 8 }
}

/** What a region's triangle is of. */
export const OF_SCAN = 0
export const OF_SKIRT = 1
export const OF_CAP = 2
export const OF_FILL = 3

/** Where a plane cuts the region: one closed loop of it. */
export interface RegionRim {
  plane: number
  /** The rim's vertices in order, wound as the scan's triangles walk it. */
  loop: number[]
  /** The cap's edge below each — the same vertices with no skirt. */
  foot: number[]
  /** The skirt's rows between them, 0 with none. */
  rows: number
  /** The cap whose edge it is: rims of one cap (a tube cut across has two)
   *  carry one number. */
  cap: number
}

export interface RegionMesh {
  positions: Float32Array
  indices: Uint32Array
  /** Per triangle, OF_SCAN … OF_FILL. */
  of: Uint8Array
  /** Per triangle, the cap it or its skirt belongs to, or -1. */
  cap: Int32Array
  rims: RegionRim[]
  /** Handles: 0 for a ball, 1 for a ring. */
  genus: number
  /** Holes of the scan closed, and edges of more than two triangles opened. */
  filled: number
  opened: number
  /** The mean edge of the region's scan triangles, mm. */
  edge: number
  /** The scan's area in it, mm². */
  area: number
  min: Vec3
  max: Vec3
}

/** A vertex nearer the plane than this share of an edge that crosses it is
 *  moved along the edge onto it. */
const SNAP_SHARE = 0.25
/** The region's edges are halved until none is longer than its size (the
 *  bounding diagonal) over this… */
const EDGES_ACROSS = 60
/** …unless that takes more triangles than this. */
const MAX_REFINED = 120_000
/** A skirt's rows at the most, and the sides its triangles are made as long
 *  as the rim's own edges with. */
const SKIRT_ROWS = 6
/** Rounds of opening and closing a region's odd edges. */
const MEND_ROUNDS = 4

const key = (a: number, b: number) => (a < b ? a * 0x4000000 + b : b * 0x4000000 + a)

/** A mesh being cut: growing lists of vertices, triangles and what each
 *  triangle is of — 0 the scan, and of a cap its plane + CAP. */
interface Work {
  p: number[]
  t: number[]
  of: number[]
}
const CAP = 100

/**
 * The region of the scan `r` names as a closed mesh, or why there is none.
 */
export function regionMesh(scan: ScanPaths, r: NetworkRegion): RegionMesh | string {
  const planes = r.planes.map((q) => ({ origin: q.origin, normal: normalize(q.normal) }))
  if (planes.some((q) => !q.normal)) return 'A plane of the region has no normal.'
  const cuts = planes as RegionPlane[]
  for (const [i, q] of cuts.entries()) if (dot(sub(r.seed, q.origin), q.normal) <= 0) return `The seed lies outside plane ${i}: the region is on the side its normal points to.`
  const w = gathered(scan, cuts)
  if (w.t.length === 0) return 'The scan has nothing between the planes.'
  for (const [i, q] of cuts.entries()) {
    const said = cutAndCap(w, q, i)
    if (said) return said
  }
  // The piece the seed is on, the caps joining what they close.
  const piece = pieceAt(w, r.seed)
  if (!piece) return 'The scan has nothing at the seed.'
  const mended = mend(piece)
  if (typeof mended === 'string') return mended
  return finish(refine(mended.mesh), cuts, Math.max(0, r.sink), mended.filled, mended.opened)
}

/** The scan's triangles with a corner inside every plane, or that cross
 *  into the region, with their own vertices. */
function gathered(scan: ScanPaths, planes: readonly RegionPlane[]): Work {
  const { positions, indices } = scan
  const n = positions.length / 3
  // Per vertex, the planes it lies outside of.
  const out = new Uint32Array(n)
  for (const [k, q] of planes.entries()) {
    if (k >= 32) break
    const c = dot(q.origin, q.normal)
    for (let v = 0; v < n; v++) if (positions[v * 3] * q.normal[0] + positions[v * 3 + 1] * q.normal[1] + positions[v * 3 + 2] * q.normal[2] < c) out[v] |= 1 << k
  }
  const at = new Int32Array(n).fill(-1)
  const w: Work = { p: [], t: [], of: [] }
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]]
    if (out[tri[0]] & out[tri[1]] & out[tri[2]]) continue
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[2] === tri[0]) continue
    for (const v of tri) {
      if (at[v] < 0) {
        at[v] = w.p.length / 3
        w.p.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
      }
      w.t.push(at[v])
    }
    w.of.push(OF_SCAN)
  }
  return w
}

/** The mesh cut at a plane, its normal's side kept and the cut closed with
 *  flat faces; or why not. */
function cutAndCap(w: Work, q: RegionPlane, plane: number): string | null {
  const c = dot(q.origin, q.normal)
  const n = q.normal
  const count = w.p.length / 3
  const d = new Float64Array(count)
  for (let v = 0; v < count; v++) d[v] = w.p[v * 3] * n[0] + w.p[v * 3 + 1] * n[1] + w.p[v * 3 + 2] * n[2] - c
  // Vertices close by the plane, moved along the edge that crosses it
  // nearest them.
  const nearest = new Float64Array(count).fill(SNAP_SHARE)
  const toward = new Int32Array(count).fill(-1)
  const consider = (a: number, b: number) => {
    if (d[a] * d[b] >= 0) return
    const s = d[a] / (d[a] - d[b])
    if (s < nearest[a]) {
      nearest[a] = s
      toward[a] = b
    }
    if (1 - s < nearest[b]) {
      nearest[b] = 1 - s
      toward[b] = a
    }
  }
  for (let i = 0; i < w.t.length; i += 3) for (let k = 0; k < 3; k++) consider(w.t[i + k], w.t[i + ((k + 1) % 3)])
  const before = w.p.slice()
  for (let v = 0; v < count; v++) {
    const u = toward[v]
    if (u < 0) continue
    for (let k = 0; k < 3; k++) w.p[v * 3 + k] = before[v * 3 + k] + nearest[v] * (before[u * 3 + k] - before[v * 3 + k])
    d[v] = 0
  }
  const size = Math.max(1e-9, ...[0, 1, 2].map((k) => spread(before, k))) * 1e-7
  for (let v = 0; v < count; v++) if (Math.abs(d[v]) < size) d[v] = 0
  // The triangles above, the crossed ones cut.
  const t: number[] = []
  const of: number[] = []
  const cutAt = new Map<number, number>()
  const onCut = (a: number, b: number): number => {
    const k = key(a, b)
    let v = cutAt.get(k)
    if (v === undefined) {
      const s = d[a] / (d[a] - d[b])
      v = w.p.length / 3
      for (let x = 0; x < 3; x++) w.p.push(w.p[a * 3 + x] + s * (w.p[b * 3 + x] - w.p[a * 3 + x]))
      cutAt.set(k, v)
    }
    return v
  }
  for (let i = 0; i < w.t.length; i += 3) {
    const tri = [w.t[i], w.t[i + 1], w.t[i + 2]]
    const up = tri.filter((v) => d[v] > 0).length
    if (up === 0) continue
    const kind = w.of[i / 3]
    if (tri.every((v) => d[v] >= 0)) {
      t.push(...tri)
      of.push(kind)
      continue
    }
    const poly: number[] = []
    for (let k = 0; k < 3; k++) {
      const a = tri[k]
      const b = tri[(k + 1) % 3]
      if (d[a] >= 0) poly.push(a)
      if (d[a] * d[b] < 0) poly.push(onCut(a, b))
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      t.push(poly[0], poly[k], poly[k + 1])
      of.push(kind)
    }
  }
  w.t = t
  w.of = of
  // The rims: the open half-edges whose ends both lie on the plane, run the
  // way a cap's triangles walk them — against the surface's own.
  const on = (v: number) => (v < count ? d[v] === 0 : true)
  const half = new Map<number, number>()
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) half.set(t[i + k] * 0x4000000 + t[i + ((k + 1) % 3)], 1)
  const next = new Map<number, number[]>()
  for (const h of half.keys()) {
    const a = Math.floor(h / 0x4000000)
    const b = h % 0x4000000
    if (half.has(b * 0x4000000 + a) || !on(a) || !on(b)) continue
    const list = next.get(b)
    if (list) list.push(a)
    else next.set(b, [a])
  }
  if (next.size === 0) return null
  const loops: number[][] = []
  while (next.size > 0) {
    const start = next.keys().next().value as number
    const loop = [start]
    let at = start
    for (;;) {
      const list = next.get(at)
      if (!list || list.length === 0) return `The scan is open where plane ${plane} cuts it: the cut does not close.`
      const to = list.pop()!
      if (list.length === 0) next.delete(at)
      if (to === start) break
      // A loop that touches itself is two.
      const again = loop.indexOf(to)
      if (again >= 0) {
        const own = loop.splice(again + 1)
        loops.push([to, ...own])
        at = to
        continue
      }
      loop.push(to)
      at = to
    }
    if (loop.length >= 3) loops.push(loop)
  }
  const frame = sketchFrameOn({ origin: q.origin, normal: n })!
  for (const cap of planarCaps(w.p, loops, frame.basisU, frame.basisV))
    for (let i = 0; i < cap.length; i += 3) {
      w.t.push(cap[i], cap[i + 1], cap[i + 2])
      w.of.push(CAP + plane)
    }
  return null
}

const spread = (p: readonly number[], k: number) => {
  let lo = Infinity
  let hi = -Infinity
  for (let i = k; i < p.length; i += 3) {
    if (p[i] < lo) lo = p[i]
    if (p[i] > hi) hi = p[i]
  }
  return hi - lo
}

function areaOf(pts: readonly Vector2[]): number {
  let s = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y
  return s / 2
}

function contains(poly: readonly Vector2[], p: Vector2): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

/** The flat faces loops on a plane bound, each a list of triangles wound the
 *  way its loop runs: an outer loop, and the holes one deep inside it. */
function planarCaps(p: readonly number[], loops: readonly number[][], u: Vec3, v: Vec3): number[][] {
  const flat = loops.map((l) => l.map((i) => new Vector2(p[i * 3] * u[0] + p[i * 3 + 1] * u[1] + p[i * 3 + 2] * u[2], p[i * 3] * v[0] + p[i * 3 + 1] * v[1] + p[i * 3 + 2] * v[2])))
  const areas = flat.map(areaOf)
  const depth = flat.map((f, i) => flat.reduce((n, g, j) => n + (j !== i && Math.abs(areas[j]) > Math.abs(areas[i]) && contains(g, f[0]) ? 1 : 0), 0))
  const out: number[][] = []
  for (let i = 0; i < loops.length; i++) {
    if (depth[i] % 2 !== 0 || areas[i] === 0) continue
    const holes: number[] = []
    for (let j = 0; j < loops.length; j++) if (depth[j] === depth[i] + 1 && contains(flat[i], flat[j][0])) holes.push(j)
    const ids = [i, ...holes].flatMap((k) => loops[k])
    const at = [i, ...holes].flatMap((k) => flat[k])
    const made: number[] = []
    for (const [a, b, c] of ShapeUtils.triangulateShape(flat[i].slice(), holes.map((j) => flat[j].slice()))) {
      const turned = (at[b].x - at[a].x) * (at[c].y - at[a].y) - (at[c].x - at[a].x) * (at[b].y - at[a].y)
      // Wound as the outer loop runs.
      if (turned * areas[i] >= 0) made.push(ids[a], ids[b], ids[c])
      else made.push(ids[a], ids[c], ids[b])
    }
    out.push(made)
  }
  return out
}

/** The connected piece of the mesh the point lies on, its vertices its own. */
function pieceAt(w: Work, seed: Vec3): Work | null {
  const count = w.p.length / 3
  const parent = new Int32Array(count).map((_, i) => i)
  const root = (i: number) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  for (let i = 0; i < w.t.length; i += 3) {
    const a = root(w.t[i])
    parent[root(w.t[i + 1])] = a
    parent[root(w.t[i + 2])] = a
  }
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < w.t.length; i += 3) {
    if (w.of[i / 3] !== OF_SCAN) continue
    for (let k = 0; k < 3; k++) {
      const v = w.t[i + k]
      const dd = (w.p[v * 3] - seed[0]) ** 2 + (w.p[v * 3 + 1] - seed[1]) ** 2 + (w.p[v * 3 + 2] - seed[2]) ** 2
      if (dd < bestD) [bestD, best] = [dd, v]
    }
  }
  if (best < 0) return null
  const own = root(best)
  return compact(w, (i) => root(w.t[i * 3]) === own)
}

/** The triangles kept, with the vertices they use. */
function compact(w: Work, keep: (triangle: number) => boolean): Work {
  const at = new Map<number, number>()
  const out: Work = { p: [], t: [], of: [] }
  for (let i = 0; i < w.t.length / 3; i++) {
    if (!keep(i)) continue
    const tri = [w.t[i * 3], w.t[i * 3 + 1], w.t[i * 3 + 2]]
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue
    for (const v of tri) {
      let to = at.get(v)
      if (to === undefined) {
        to = out.p.length / 3
        at.set(v, to)
        out.p.push(w.p[v * 3], w.p[v * 3 + 1], w.p[v * 3 + 2])
      }
      out.t.push(to)
    }
    out.of.push(w.of[i])
  }
  return out
}

/** The mesh with its holes closed and its edges of more than two triangles
 *  opened and closed again — every edge between two triangles, each walking
 *  it its own way — or why not. */
function mend(w: Work): { mesh: Work; filled: number; opened: number } | string {
  let mesh = w
  let filled = 0
  let opened = 0
  for (let round = 0; round < MEND_ROUNDS; round++) {
    // Half-edges two triangles walk the same way, and edges with more than
    // two: the triangles on them go.
    const uses = new Map<number, number>()
    for (let i = 0; i < mesh.t.length; i += 3) for (let k = 0; k < 3; k++) {
      const h = mesh.t[i + k] * 0x4000000 + mesh.t[i + ((k + 1) % 3)]
      uses.set(h, (uses.get(h) ?? 0) + 1)
    }
    const odd = new Set<number>()
    for (let i = 0; i < mesh.t.length; i += 3) for (let k = 0; k < 3; k++) if ((uses.get(mesh.t[i + k] * 0x4000000 + mesh.t[i + ((k + 1) % 3)]) ?? 0) > 1) odd.add(i / 3)
    if (odd.size > 0) {
      opened += odd.size
      mesh = compact(mesh, (i) => !odd.has(i))
    }
    mesh = splitPinches(mesh)
    const half = new Set<number>()
    for (let i = 0; i < mesh.t.length; i += 3) for (let k = 0; k < 3; k++) half.add(mesh.t[i + k] * 0x4000000 + mesh.t[i + ((k + 1) % 3)])
    const next = new Map<number, number>()
    for (const h of half) {
      const a = Math.floor(h / 0x4000000)
      const b = h % 0x4000000
      if (!half.has(b * 0x4000000 + a)) next.set(b, a)
    }
    if (next.size === 0) return { mesh, filled, opened }
    while (next.size > 0) {
      const start = next.keys().next().value as number
      const loop: number[] = []
      let at = start
      while (next.has(at)) {
        loop.push(at)
        const to = next.get(at)!
        next.delete(at)
        at = to
      }
      if (at !== start || loop.length < 3) continue
      filled++
      fillLoop(mesh, loop)
    }
  }
  return 'The scan has edges in the region that could not be closed — repair it (mesh tools) first.'
}

/** A vertex two fans of triangles meet at (and nothing else) made two. */
function splitPinches(w: Work): Work {
  const around = new Map<number, number[]>()
  for (let i = 0; i < w.t.length; i++) {
    const list = around.get(w.t[i])
    if (list) list.push(Math.floor(i / 3))
    else around.set(w.t[i], [Math.floor(i / 3)])
  }
  const t = w.t.slice()
  const p = w.p.slice()
  for (const [v, tris] of around) {
    // The fans: triangles joined by an edge at v.
    const left = new Set(tris)
    let first = true
    while (left.size > 0) {
      const fan = [left.values().next().value as number]
      left.delete(fan[0])
      for (let k = 0; k < fan.length; k++) {
        const mine = [0, 1, 2].map((x) => w.t[fan[k] * 3 + x]).filter((x) => x !== v)
        for (const o of left) {
          const theirs = [0, 1, 2].map((x) => w.t[o * 3 + x])
          if (theirs.includes(mine[0]) || theirs.includes(mine[1])) {
            left.delete(o)
            fan.push(o)
          }
        }
      }
      if (!first) {
        const copy = p.length / 3
        p.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2])
        for (const tri of fan) for (let x = 0; x < 3; x++) if (w.t[tri * 3 + x] === v) t[tri * 3 + x] = copy
      }
      first = false
    }
  }
  return { p, t, of: w.of }
}

/** A hole's rim closed: flat, seen square to the rim's own mean plane —
 *  or, where that does not triangulate it, a fan from its middle. */
function fillLoop(w: Work, loop: readonly number[]): void {
  const n: Vec3 = [0, 0, 0]
  const mid: Vec3 = [0, 0, 0]
  const at = (i: number): Vec3 => [w.p[i * 3], w.p[i * 3 + 1], w.p[i * 3 + 2]]
  for (let i = 0; i < loop.length; i++) {
    const a = at(loop[i])
    const b = at(loop[(i + 1) % loop.length])
    n[0] += (a[1] - b[1]) * (a[2] + b[2])
    n[1] += (a[2] - b[2]) * (a[0] + b[0])
    n[2] += (a[0] - b[0]) * (a[1] + b[1])
    for (let k = 0; k < 3; k++) mid[k] += a[k] / loop.length
  }
  const way = normalize(n)
  if (way && loop.length > 3) {
    const frame = sketchFrameOn({ origin: mid, normal: way })!
    const [cap] = planarCaps(w.p, [loop as number[]], frame.basisU, frame.basisV)
    if (cap && cap.length === (loop.length - 2) * 3) {
      w.t.push(...cap)
      for (let i = 0; i < cap.length; i += 3) w.of.push(OF_FILL)
      return
    }
  }
  if (loop.length === 3) {
    w.t.push(loop[0], loop[1], loop[2])
    w.of.push(OF_FILL)
    return
  }
  const c = w.p.length / 3
  w.p.push(...mid)
  for (let i = 0; i < loop.length; i++) {
    w.t.push(loop[i], loop[(i + 1) % loop.length], c)
    w.of.push(OF_FILL)
  }
}

/** The scan's part of the mesh with no edge longer than the region's scale:
 *  each longer one halved, longest first, the caps' edges on the rim too. */
function refine(w: Work): Work {
  const size = Math.hypot(spread(w.p, 0), spread(w.p, 1), spread(w.p, 2))
  let limit = size / EDGES_ACROSS
  // So many triangles of that edge as the area takes: no more than allowed.
  let area = 0
  for (let i = 0; i < w.t.length; i += 3) area += triangleArea(w.p, w.t[i], w.t[i + 1], w.t[i + 2])
  limit = Math.max(limit, Math.sqrt((area * 4) / MAX_REFINED))
  const out: Work = { p: w.p.slice(), t: w.t.slice(), of: w.of.slice() }
  for (let round = 0; round < 30; round++) {
    // The edges to halve this round: those that are the longest of both
    // their triangles, or of one with the other's longest longer still left
    // for the next round.
    const l2 = (a: number, b: number) => (out.p[a * 3] - out.p[b * 3]) ** 2 + (out.p[a * 3 + 1] - out.p[b * 3 + 1]) ** 2 + (out.p[a * 3 + 2] - out.p[b * 3 + 2]) ** 2
    const marked = new Map<number, number>()
    for (let i = 0; i < out.t.length; i += 3) {
      let best = -1
      let bestL = limit * limit
      for (let k = 0; k < 3; k++) {
        const l = l2(out.t[i + k], out.t[i + ((k + 1) % 3)])
        if (l > bestL) [bestL, best] = [l, k]
      }
      if (best >= 0) marked.set(key(out.t[i + best], out.t[i + ((best + 1) % 3)]), -1)
    }
    if (marked.size === 0) break
    for (const k of marked.keys()) {
      const a = Math.floor(k / 0x4000000)
      const b = k % 0x4000000
      marked.set(k, out.p.length / 3)
      for (let x = 0; x < 3; x++) out.p.push((out.p[a * 3 + x] + out.p[b * 3 + x]) / 2)
    }
    const t: number[] = []
    const of: number[] = []
    for (let i = 0; i < out.t.length; i += 3) {
      const v = [out.t[i], out.t[i + 1], out.t[i + 2]]
      const m = [0, 1, 2].map((k) => marked.get(key(v[k], v[(k + 1) % 3])) ?? -1)
      const tris = halved(v, m, l2)
      for (const tri of tris) {
        t.push(...tri)
        of.push(out.of[i / 3])
      }
    }
    out.t = t
    out.of = of
  }
  return out
}

/** A triangle with its edges' middles (or -1), as two, three or four. */
function halved(v: readonly number[], m: readonly number[], l2: (a: number, b: number) => number): number[][] {
  const n = m.filter((x) => x >= 0).length
  if (n === 0) return [[...v]]
  if (n === 3) return [[v[0], m[0], m[2]], [m[0], v[1], m[1]], [m[2], m[1], v[2]], [m[0], m[1], m[2]]]
  if (n === 1) {
    const k = m.findIndex((x) => x >= 0)
    const [a, b, c] = [v[k], v[(k + 1) % 3], v[(k + 2) % 3]]
    return [[a, m[k], c], [m[k], b, c]]
  }
  // Two: the corner between them, and the rest cut along its shorter
  // diagonal.
  const k = m.findIndex((x) => x < 0)
  const [a, b, c] = [v[k], v[(k + 1) % 3], v[(k + 2) % 3]]
  const bc = m[(k + 1) % 3]
  const ca = m[(k + 2) % 3]
  return l2(a, bc) < l2(b, ca) ? [[bc, c, ca], [a, b, bc], [a, bc, ca]] : [[bc, c, ca], [a, b, ca], [b, bc, ca]]
}

function triangleArea(p: ArrayLike<number>, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
}

/** The caps taken off and made again, even, at the end of their skirts; the
 *  rims found; the mesh counted. */
function finish(w: Work, planes: readonly RegionPlane[], sink: number, filled: number, opened: number): RegionMesh | string {
  const p = w.p.slice()
  // Each cap: its triangles by plane, joined by the edges they share.
  const byEdge = new Map<number, number[]>()
  for (let i = 0; i < w.t.length; i += 3) for (let k = 0; k < 3; k++) {
    const e = key(w.t[i + k], w.t[i + ((k + 1) % 3)])
    const list = byEdge.get(e)
    if (list) list.push(i / 3)
    else byEdge.set(e, [i / 3])
  }
  const capOf = new Int32Array(w.of.length).fill(-1)
  const capPlane: number[] = []
  for (let i = 0; i < w.of.length; i++) {
    if (w.of[i] < CAP || capOf[i] >= 0) continue
    const id = capPlane.length
    capPlane.push(w.of[i] - CAP)
    const stack = [i]
    capOf[i] = id
    while (stack.length > 0) {
      const tri = stack.pop()!
      for (let k = 0; k < 3; k++) for (const o of byEdge.get(key(w.t[tri * 3 + k], w.t[tri * 3 + ((k + 1) % 3)]))!) {
        if (capOf[o] >= 0 || w.of[o] !== w.of[i]) continue
        capOf[o] = id
        stack.push(o)
      }
    }
  }
  const t: number[] = []
  const of: number[] = []
  const cap: number[] = []
  let area = 0
  let edge = 0
  let edges = 0
  for (let i = 0; i < w.of.length; i++) {
    if (w.of[i] >= CAP) continue
    const tri = [w.t[i * 3], w.t[i * 3 + 1], w.t[i * 3 + 2]]
    t.push(...tri)
    of.push(w.of[i])
    cap.push(-1)
    if (w.of[i] !== OF_SCAN) continue
    area += triangleArea(p, tri[0], tri[1], tri[2])
    for (let k = 0; k < 3; k++) edge += Math.hypot(...[0, 1, 2].map((x) => p[tri[k] * 3 + x] - p[tri[(k + 1) % 3] * 3 + x]))
    edges += 3
  }
  edge = edges > 0 ? edge / edges : 1
  const rims: RegionRim[] = []
  for (let c = 0; c < capPlane.length; c++) {
    const q = planes[capPlane[c]]
    // The cap's rim loops, and whether another cap lies across any of them.
    const mine: number[] = []
    for (let i = 0; i < w.of.length; i++) if (capOf[i] === c) mine.push(i)
    const next = new Map<number, number>()
    let meets = false
    for (const i of mine) for (let k = 0; k < 3; k++) {
      const a = w.t[i * 3 + k]
      const b = w.t[i * 3 + ((k + 1) % 3)]
      const other = byEdge.get(key(a, b))!.find((o) => o !== i)
      if (other !== undefined && capOf[other] === c) continue
      if (other !== undefined && capOf[other] >= 0) meets = true
      next.set(a, b)
    }
    const loops: number[][] = []
    while (next.size > 0) {
      const start = next.keys().next().value as number
      const loop: number[] = []
      let at = start
      while (next.has(at)) {
        loop.push(at)
        const to = next.get(at)!
        next.delete(at)
        at = to
      }
      if (loop.length >= 3) loops.push(loop)
    }
    // The skirt: rows of the loops' own vertices, carried down the plane's
    // normal; the cap is made on the last.
    const depth = meets ? 0 : sink
    let feet = loops
    let rows = 0
    if (depth > 1e-6) {
      const step = loops.flat().length > 0 ? loops.reduce((sum, l) => sum + perimeter(p, l), 0) / loops.flat().length : edge
      rows = Math.max(2, Math.min(SKIRT_ROWS, Math.round(depth / Math.max(step, 1e-6))))
      for (let k = 1; k <= rows; k++) {
        const down = feet.map((l) =>
          l.map((v) => {
            const id = p.length / 3
            for (let x = 0; x < 3; x++) p.push(p[v * 3 + x] - (q.normal[x] * depth) / rows)
            return id
          }),
        )
        // The cap's loop a → b is its triangles' own way, so the skirt's
        // walk it as the cap did, and its foot the other way.
        feet.forEach((l, li) => {
          for (let i = 0; i < l.length; i++) {
            const j = (i + 1) % l.length
            t.push(l[i], l[j], down[li][j], l[i], down[li][j], down[li][i])
            of.push(OF_SKIRT, OF_SKIRT)
            cap.push(c, c)
          }
        })
        feet = down
      }
    }
    const frame = sketchFrameOn({ origin: q.origin, normal: q.normal })!
    for (const face of planarCaps(p, feet, frame.basisU, frame.basisV)) {
      const even = evened(p, face, frame.basisU, frame.basisV)
      for (let i = 0; i < even.length; i += 3) {
        t.push(even[i], even[i + 1], even[i + 2])
        of.push(OF_CAP)
        cap.push(c)
      }
    }
    // The rim as the scan's triangles walk it: against the cap's.
    loops.forEach((l, i) => rims.push({ plane: capPlane[c], loop: [...l].reverse(), foot: [...feet[i]].reverse(), rows, cap: c }))
  }
  const positions = Float32Array.from(p)
  const indices = Uint32Array.from(t)
  // Closed, and how many handles: V − E + F = 2 − 2g.
  const used = new Uint8Array(p.length / 3)
  const half = new Set<number>()
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) {
    used[t[i + k]] = 1
    const h = t[i + k] * 0x4000000 + t[i + ((k + 1) % 3)]
    if (half.has(h)) return 'The region’s caps do not close: a plane cuts it along a fold, or touches it. Move the plane a little.'
    half.add(h)
  }
  for (const h of half) if (!half.has((h % 0x4000000) * 0x4000000 + Math.floor(h / 0x4000000))) return 'The region’s caps do not close: a plane cuts it along a fold, or touches it. Move the plane a little.'
  const V = used.reduce((a, b) => a + b, 0)
  const genus = (2 - (V - half.size / 2 + t.length / 3)) / 2
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < of.length; i++) if (of[i] === OF_SCAN) for (let k = 0; k < 3; k++) for (let x = 0; x < 3; x++) {
    const val = p[t[i * 3 + k] * 3 + x]
    if (val < min[x]) min[x] = val
    if (val > max[x]) max[x] = val
  }
  return { positions, indices, of: Uint8Array.from(of), cap: Int32Array.from(cap), rims, genus, filled, opened, edge, area, min, max }
}

function perimeter(p: ArrayLike<number>, loop: readonly number[]): number {
  let s = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] * 3
    const b = loop[(i + 1) % loop.length] * 3
    s += Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2])
  }
  return s
}

/** A flat face's triangles made even inside its rim: its inner edges halved
 *  while they are longer than the rim's own, and flipped to the Delaunay
 *  ones. The new points are pushed onto `p`. */
function evened(p: number[], triangles: readonly number[], u: Vec3, v: Vec3): number[] {
  let t = [...triangles]
  const at = new Map<number, [number, number]>()
  const xy = (i: number): [number, number] => {
    let q = at.get(i)
    if (!q) {
      q = [p[i * 3] * u[0] + p[i * 3 + 1] * u[1] + p[i * 3 + 2] * u[2], p[i * 3] * v[0] + p[i * 3 + 1] * v[1] + p[i * 3 + 2] * v[2]]
      at.set(i, q)
    }
    return q
  }
  const l2 = (a: number, b: number) => (xy(a)[0] - xy(b)[0]) ** 2 + (xy(a)[1] - xy(b)[1]) ** 2
  const edgesOf = () => {
    const m = new Map<number, number[]>()
    for (let i = 0; i < t.length; i++) {
      const tri = i - (i % 3)
      const e = key(t[i], t[tri + ((i + 1) % 3)])
      const list = m.get(e)
      if (list) list.push(tri / 3)
      else m.set(e, [tri / 3])
    }
    return m
  }
  // The rim's mean edge is the length aimed at, and a sixteenth of the
  // face's own size the least.
  let rim = 0
  let rims = 0
  let area = 0
  for (const [e, list] of edgesOf()) if (list.length === 1) {
    rim += Math.sqrt(l2(Math.floor(e / 0x4000000), e % 0x4000000))
    rims++
  }
  for (let i = 0; i < t.length; i += 3) area += Math.abs(turn(xy(t[i]), xy(t[i + 1]), xy(t[i + 2]))) / 2
  const limit = Math.max(1.4 * (rims > 0 ? rim / rims : 1), Math.sqrt(area) / 40)
  const flip = () => {
    for (let pass = 0; pass < 12; pass++) {
      let flips = 0
      const touched = new Set<number>()
      for (const [e, list] of edgesOf()) {
        if (list.length !== 2 || touched.has(list[0]) || touched.has(list[1])) continue
        const a = Math.floor(e / 0x4000000)
        const b = e % 0x4000000
        const one = [t[list[0] * 3], t[list[0] * 3 + 1], t[list[0] * 3 + 2]]
        const two = [t[list[1] * 3], t[list[1] * 3 + 1], t[list[1] * 3 + 2]]
        const c = one.find((x) => x !== a && x !== b)!
        const d = two.find((x) => x !== a && x !== b)!
        if (c === d || !delaunayFlip(xy(a), xy(b), xy(c), xy(d))) continue
        // The same way round as before: c and d across it.
        const i = one.indexOf(a)
        const forward = one[(i + 1) % 3] === b
        t.splice(list[0] * 3, 3, ...(forward ? [a, d, c] : [a, c, d]))
        t.splice(list[1] * 3, 3, ...(forward ? [b, c, d] : [b, d, c]))
        touched.add(list[0])
        touched.add(list[1])
        flips++
      }
      if (flips === 0) break
    }
  }
  flip()
  for (let round = 0; round < 14; round++) {
    const mid = new Map<number, number>()
    const edges = edgesOf()
    const taken = new Set<number>()
    const long = [...edges].filter(([e, list]) => list.length === 2 && l2(Math.floor(e / 0x4000000), e % 0x4000000) > limit * limit).sort((x, y) => l2(Math.floor(y[0] / 0x4000000), y[0] % 0x4000000) - l2(Math.floor(x[0] / 0x4000000), x[0] % 0x4000000))
    for (const [e, list] of long) {
      if (taken.has(list[0]) || taken.has(list[1])) continue
      taken.add(list[0])
      taken.add(list[1])
      const a = Math.floor(e / 0x4000000)
      const b = e % 0x4000000
      mid.set(e, p.length / 3)
      for (let x = 0; x < 3; x++) p.push((p[a * 3 + x] + p[b * 3 + x]) / 2)
    }
    if (mid.size === 0) break
    const next: number[] = []
    for (let i = 0; i < t.length; i += 3) {
      const tri = [t[i], t[i + 1], t[i + 2]]
      for (const x of halved(tri, [0, 1, 2].map((k) => mid.get(key(tri[k], tri[(k + 1) % 3])) ?? -1), l2)) next.push(...x)
    }
    t = next
    flip()
  }
  return t
}

const turn = (a: readonly number[], b: readonly number[], c: readonly number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])

/** Whether the edge a–b between triangles with apexes c and d is better as
 *  c–d: the angles at c and d together over a half turn, the four convex. */
function delaunayFlip(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean {
  const s1 = turn(c, d, a)
  const s2 = turn(c, d, b)
  if (!(s1 * s2 < 0)) return false
  const t1 = turn(a, b, c)
  const t2 = turn(a, b, d)
  if (!(t1 * t2 < 0)) return false
  const angle = (o: readonly number[]) => Math.atan2(Math.abs(turn(o, a, b)), (a[0] - o[0]) * (b[0] - o[0]) + (a[1] - o[1]) * (b[1] - o[1]))
  return angle(c) + angle(d) > Math.PI + 1e-9
}

/** A box's six sides as planes the region lies inside of. */
export function boxPlanes(min: Vec3, max: Vec3): RegionPlane[] {
  const out: RegionPlane[] = []
  for (let k = 0; k < 3; k++) {
    const n: Vec3 = [0, 0, 0]
    n[k] = 1
    out.push({ origin: [...min], normal: [...n] as Vec3 }, { origin: [...max], normal: n.map((x) => -x || 0) as Vec3 })
  }
  return out
}
