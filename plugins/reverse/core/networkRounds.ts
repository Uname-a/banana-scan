// SPDX-License-Identifier: AGPL-3.0-only
// The middles of a region's rounds, for Auto layout (networkAuto.ts): where
// a part's edges are rounds rather than creases, Suggest creases finds no
// curve along them, and a region of the scan runs on round edge after edge
// with nothing to lay it out from. A person draws the network's curves down
// the middles of those rounds; this finds them.
//
// The region's faces are read off its principal curvatures (PR 24's fitter,
// over its default radius): a vertex is on a face where the scan bends less
// than FACE_RADIUS_MM's curvature either way, and more than its own bumps
// read (bumpCurvature) — on a round it bends one way well past that. The
// face vertices joined by the region's edges make the faces; one of fewer
// than FACE_SHARE of the region's vertices (and FACE_MIN) is a speck on a
// round, not a face. Then every vertex of the region — the rounds, the
// specks — goes to the face nearest it along the scan, all faces grown at
// once (a Voronoi partition by the scan's edges): two faces grown into a
// round between them meet down its middle, three at a corner blend meet at
// a point in it.
//
// Where two faces meet is read off the triangles: a triangle whose corners
// went to two faces is crossed between the middles of its two edges that
// join them, one whose corners went to three is a junction. The crossings
// chained run junction to junction, to the region's own boundary, or round
// a loop; each chain comes back as its points along the scan.

import { computeVertexNormals } from '../../../src/core/geometry/normals'
import { bumpCurvature, CurvatureFitter, type CurvatureMesh, defaultCurvatureRadius } from '../../../src/core/geometry/principalCurvature'
import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'

/** A face bends less than this radius's curvature either way, mm. */
export const FACE_RADIUS_MM = 25
/** A face holds this share of the region's vertices at least, and
 *  FACE_MIN. */
const FACE_SHARE = 0.0002
const FACE_MIN = 40
/** A face's curvature bar is this many times the scan's bumps, at least. */
const BUMPS_OVER = 2

/** An end of a chain: a junction, by index, or a point on the region's own
 *  boundary. */
export type RoundEnd = { junction: number } | { border: Vec3 }

/** The middles of a region's rounds (see above). */
export interface RoundMiddles {
  /** The faces found, and the vertices on rounds. */
  faces: number
  roundVertices: number
  vertices: number
  /** Where three faces or more meet. */
  junctions: Vec3[]
  /** Each line where two faces meet: its ends (none for a loop) and its
   *  points, end to end. */
  chains: { from: RoundEnd | null; to: RoundEnd | null; points: Vec3[] }[]
  /** The curvature bar a face kept under, 1/mm. */
  bar: number
  ms: number
}

const fitters = new WeakMap<ScanPaths, { fitter: CurvatureFitter; bumps: number }>()

/** The fitter over the whole scan, made once. */
function fitterOf(scan: ScanPaths): { fitter: CurvatureFitter; bumps: number } {
  let f = fitters.get(scan)
  if (f) return f
  const pos = scan.positions
  const idx = scan.indices
  const mesh: CurvatureMesh = { positions: pos, normals: computeVertexNormals(pos, idx), indices: idx, vertexCount: pos.length / 3 }
  const radius = defaultCurvatureRadius(scan.edge)
  f = { fitter: new CurvatureFitter(mesh, radius, scan.edge), bumps: bumpCurvature(mesh, scan.edge, radius) }
  fitters.set(scan, f)
  return f
}

/** The middles of the rounds of the region made of `triangles`. */
export function roundMiddles(scan: ScanPaths, triangles: ArrayLike<number>): RoundMiddles {
  const t0 = performance.now()
  const idx = scan.indices
  const pos = scan.positions
  const vertexCount = pos.length / 3
  // The region's vertices, by local index.
  const local = new Int32Array(vertexCount).fill(-1)
  const verts: number[] = []
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]
      if (local[v] < 0) {
        local[v] = verts.length
        verts.push(v)
      }
    }
  }
  const n = verts.length
  // Its edges: each with the region's triangles beside it.
  const edgeTris = new Map<number, number[]>()
  const key = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a)
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]
    for (let e = 0; e < 3; e++) {
      const k = key(idx[t * 3 + e], idx[t * 3 + ((e + 1) % 3)])
      const list = edgeTris.get(k)
      if (list) list.push(t)
      else edgeTris.set(k, [t])
    }
  }
  const nbrs: number[][] = Array.from({ length: n }, () => [])
  for (const k of edgeTris.keys()) {
    const a = Math.floor(k / vertexCount)
    const b = k - a * vertexCount
    nbrs[local[a]].push(local[b])
    nbrs[local[b]].push(local[a])
  }
  // Each vertex's curvature, the larger either way.
  const { fitter, bumps } = fitterOf(scan)
  const bar = Math.max(1 / FACE_RADIUS_MM, BUMPS_OVER * bumps)
  const pair = new Float64Array(2)
  const flat = new Uint8Array(n)
  let round = 0
  for (let i = 0; i < n; i++) {
    const bend = fitter.pairAt(verts[i], pair) ? Math.max(Math.abs(pair[0]), Math.abs(pair[1])) : Number.NaN
    if (Number.isFinite(bend) && bend < bar) flat[i] = 1
    else round++
  }
  // The faces: the flat vertices the region's edges join.
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let i = 0; i < n; i++) {
    if (!flat[i]) continue
    for (const j of nbrs[i]) if (flat[j] && j > i) parent[find(i)] = find(j)
  }
  const size = new Map<number, number>()
  for (let i = 0; i < n; i++) if (flat[i]) size.set(find(i), (size.get(find(i)) ?? 0) + 1)
  const least = Math.max(FACE_MIN, Math.ceil(FACE_SHARE * n))
  const faceOf = new Map<number, number>()
  for (const [r, s] of size) if (s >= least) faceOf.set(r, faceOf.size)
  const label = new Int32Array(n).fill(-1)
  const dist = new Float64Array(n).fill(Infinity)
  // Every vertex to the nearest face along the edges, all grown at once.
  const heap = new MinHeap()
  for (let i = 0; i < n; i++) {
    if (!flat[i]) continue
    const f = faceOf.get(find(i))
    if (f === undefined) continue
    label[i] = f
    dist[i] = 0
    heap.push(i, 0)
  }
  while (heap.size > 0) {
    const [i, d] = heap.pop()
    if (d > dist[i]) continue
    const vi = verts[i]
    for (const j of nbrs[i]) {
      const vj = verts[j]
      const nd = d + Math.hypot(pos[vi * 3] - pos[vj * 3], pos[vi * 3 + 1] - pos[vj * 3 + 1], pos[vi * 3 + 2] - pos[vj * 3 + 2])
      if (nd < dist[j]) {
        dist[j] = nd
        label[j] = label[i]
        heap.push(j, nd)
      }
    }
  }
  const out: RoundMiddles = { faces: faceOf.size, roundVertices: round, vertices: n, junctions: [], chains: [], bar, ms: 0 }
  if (faceOf.size < 2) {
    out.ms = performance.now() - t0
    return out
  }
  // The crossings: each edge whose ends went to two faces, at its middle;
  // linked through the triangles either side, a triangle of three faces a
  // junction.
  const mid = (k: number): Vec3 => {
    const a = Math.floor(k / vertexCount)
    const b = k - a * vertexCount
    return [(pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2]
  }
  const lab = (v: number) => label[local[v]]
  const crossing = (k: number) => {
    const a = Math.floor(k / vertexCount)
    const b = k - a * vertexCount
    return lab(a) !== lab(b)
  }
  // Each crossing's links: another crossing's key, or a junction as −1 − j.
  const links = new Map<number, number[]>()
  const link = (k: number, to: number) => {
    const list = links.get(k)
    if (list) list.push(to)
    else links.set(k, [to])
  }
  const junctionOf = new Map<number, number>()
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]
    const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]
    const ls = new Set(v.map(lab))
    if (ls.size < 2) continue
    const ks = [key(v[0], v[1]), key(v[1], v[2]), key(v[2], v[0])].filter(crossing)
    if (ls.size === 2 && ks.length === 2) {
      link(ks[0], ks[1])
      link(ks[1], ks[0])
    } else if (ls.size === 3) {
      const j = out.junctions.length
      junctionOf.set(t, j)
      out.junctions.push([(pos[v[0] * 3] + pos[v[1] * 3] + pos[v[2] * 3]) / 3, (pos[v[0] * 3 + 1] + pos[v[1] * 3 + 1] + pos[v[2] * 3 + 1]) / 3, (pos[v[0] * 3 + 2] + pos[v[1] * 3 + 2] + pos[v[2] * 3 + 2]) / 3])
      for (const k of ks) link(k, -1 - j)
    }
  }
  // A crossing on the region's boundary — one triangle of the region beside
  // its edge — ends a chain there.
  const onBorder = (k: number) => (edgeTris.get(k)?.length ?? 0) < 2
  const used = new Set<number>()
  const walk = (start: number, from: RoundEnd | null, first: number): { to: RoundEnd | null; points: Vec3[] } => {
    const points: Vec3[] = []
    let prev = first
    let k = start
    for (;;) {
      used.add(k)
      points.push(mid(k))
      if (onBorder(k) && points.length > 1) return { to: { border: mid(k) }, points }
      const next = (links.get(k) ?? []).find((x) => x !== prev && !(x >= 0 && used.has(x) && x !== start))
      if (next === undefined) return { to: onBorder(k) ? { border: mid(k) } : null, points }
      if (next < 0) {
        const j = -1 - next
        points.push(out.junctions[j])
        return { to: { junction: j }, points }
      }
      if (next === start) return { to: from, points: [...points, mid(start)] }
      prev = k
      k = next
    }
  }
  // From each junction's crossings, then from each border crossing, then
  // the loops left.
  for (const [k, list] of links) {
    for (const x of list) {
      if (x >= 0 || used.has(k)) continue
      const j = -1 - x
      const w = walk(k, { junction: j }, x)
      out.chains.push({ from: { junction: j }, to: w.to, points: [out.junctions[j], ...w.points] })
    }
  }
  for (const k of links.keys()) {
    if (used.has(k) || !onBorder(k)) continue
    const w = walk(k, { border: mid(k) }, Number.NaN)
    out.chains.push({ from: { border: mid(k) }, to: w.to, points: w.points })
  }
  for (const k of links.keys()) {
    if (used.has(k)) continue
    const w = walk(k, null, Number.NaN)
    out.chains.push({ from: null, to: null, points: w.points })
  }
  out.ms = performance.now() - t0
  return out
}

/** The shortest way along the scan's edges from `from` to `to` inside the
 *  region made of `triangles`, kept `keepOff` mm off the region's
 *  boundary where it can be — a step within it costs OFF_BOUNDARY times
 *  its length, but near either end — as the points of its vertices; null
 *  where the region does not join them. A cut that cannot leave the
 *  region, where a straight section across a bent one does. */
export function regionPath(scan: ScanPaths, triangles: ArrayLike<number>, from: Vec3, to: Vec3, keepOff: number): Vec3[] | null {
  const idx = scan.indices
  const pos = scan.positions
  const vertexCount = pos.length / 3
  const local = new Int32Array(vertexCount).fill(-1)
  const verts: number[] = []
  const edgeCount = new Map<number, number>()
  const key = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a)
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]
      if (local[v] < 0) {
        local[v] = verts.length
        verts.push(v)
      }
      const e = key(v, idx[t * 3 + ((k + 1) % 3)])
      edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1)
    }
  }
  const n = verts.length
  const nbrs: number[][] = Array.from({ length: n }, () => [])
  const border = new Uint8Array(n)
  for (const [e, count] of edgeCount) {
    const a = local[Math.floor(e / vertexCount)]
    const b = local[e % vertexCount]
    nbrs[a].push(b)
    nbrs[b].push(a)
    if (count < 2) border[a] = border[b] = 1
  }
  const at = (i: number): Vec3 => [pos[verts[i] * 3], pos[verts[i] * 3 + 1], pos[verts[i] * 3 + 2]]
  const nearest = (p: Vec3) => {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const v = verts[i]
      const d = (pos[v * 3] - p[0]) ** 2 + (pos[v * 3 + 1] - p[1]) ** 2 + (pos[v * 3 + 2] - p[2]) ** 2
      if (d < bestD) [bestD, best] = [d, i]
    }
    return best
  }
  const s = nearest(from)
  const g = nearest(to)
  if (s < 0 || g < 0 || s === g) return null
  // How near the boundary each vertex is, in hops, up to `hops`.
  const hops = Math.max(1, Math.ceil(keepOff / Math.max(scan.edge, 1e-9)))
  const near = new Int32Array(n).fill(hops + 1)
  let ring: number[] = []
  for (let i = 0; i < n; i++) if (border[i]) (near[i] = 0, ring.push(i))
  for (let h = 1; h <= hops && ring.length > 0; h++) {
    const next: number[] = []
    for (const i of ring) for (const j of nbrs[i]) if (near[j] > h) (near[j] = h, next.push(j))
    ring = next
  }
  const ps = at(s)
  const pg = at(g)
  const dist = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const heap = new MinHeap()
  dist[s] = 0
  heap.push(s, 0)
  while (heap.size > 0) {
    const [i, d] = heap.pop()
    if (i === g) break
    if (d > dist[i]) continue
    const pi = at(i)
    for (const j of nbrs[i]) {
      const pj = at(j)
      const l = Math.hypot(pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2])
      const endNear = Math.min(Math.hypot(pj[0] - ps[0], pj[1] - ps[1], pj[2] - ps[2]), Math.hypot(pj[0] - pg[0], pj[1] - pg[1], pj[2] - pg[2])) < 2 * keepOff
      const nd = d + l * (near[j] <= hops && !endNear ? OFF_BOUNDARY : 1)
      if (nd < dist[j]) {
        dist[j] = nd
        prev[j] = i
        heap.push(j, nd)
      }
    }
  }
  if (!Number.isFinite(dist[g])) return null
  const path: Vec3[] = []
  for (let i = g; i >= 0; i = prev[i]) path.push(at(i))
  return path.reverse()
}

/** A step of a region path near its boundary costs this times its length. */
const OFF_BOUNDARY = 6

/** A binary min-heap of (index, key). */
class MinHeap {
  private ids: number[] = []
  private keys: number[] = []
  get size() {
    return this.ids.length
  }
  push(id: number, k: number) {
    const ids = this.ids
    const keys = this.keys
    let i = ids.length
    ids.push(id)
    keys.push(k)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= k) break
      ids[i] = ids[p]
      keys[i] = keys[p]
      i = p
    }
    ids[i] = id
    keys[i] = k
  }
  pop(): [number, number] {
    const ids = this.ids
    const keys = this.keys
    const top: [number, number] = [ids[0], keys[0]]
    const lastId = ids.pop()!
    const lastK = keys.pop()!
    if (ids.length > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= ids.length) break
        const r = l + 1
        const c = r < ids.length && keys[r] < keys[l] ? r : l
        if (keys[c] >= lastK) break
        ids[i] = ids[c]
        keys[i] = keys[c]
        i = c
      }
      ids[i] = lastId
      keys[i] = lastK
    }
    return top
  }
}
