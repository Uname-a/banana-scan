// SPDX-License-Identifier: AGPL-3.0-only
// What unroll and flatten (Mesh Tools' core/unroll, flatten.ts here) share: the patch of
// the mesh a region holds, cut down to one connected piece; the flat
// pattern a laid-out patch gives — its outline and the holes in it, as
// loops of points in millimetres — with its figures; and how far the
// laying-out stretched each triangle, which says how true the pattern is.
//
// A pattern is seen from the side the mesh's normals face — from outside
// the part, for a scan — so it is never mirrored: a cut-out drawn from it
// comes out the right way round.

import { boundaryLoops } from './boundary'

/** A region of the mesh, cut out as a mesh of its own. */
export interface Patch {
  /** Its vertices, x,y,z, in the mesh's frame. */
  positions: Float64Array
  indices: Uint32Array
  vertexCount: number
  /** Each of its vertices' number on the mesh. */
  source: Uint32Array
  /** What of the region was left out: its triangles in pieces apart from
   *  the largest, and how many such pieces. */
  leftOut: { triangles: number; pieces: number }
}

/**
 * The triangles of the mesh with all three corners in `region`, as a patch
 * of their own — the largest connected piece of them, the rest counted:
 * specks the marking caught off the surface would otherwise be laid out
 * beside it, or tear a flattening apart.
 */
export function regionPatch(positions: ArrayLike<number>, indices: Uint32Array, vertexCount: number, region: ArrayLike<number>): Patch {
  const inRegion = new Uint8Array(vertexCount)
  for (let i = 0; i < region.length; i++) {
    const v = region[i]
    if (v >= 0 && v < vertexCount) inRegion[v] = 1
  }
  const triangleCount = indices.length / 3
  const tris: number[] = []
  for (let t = 0; t < triangleCount; t++) {
    if (inRegion[indices[t * 3]] && inRegion[indices[t * 3 + 1]] && inRegion[indices[t * 3 + 2]]) tris.push(t)
  }
  // Pieces by shared corners: union–find over the vertices.
  const parent = new Int32Array(vertexCount).fill(-1)
  const find = (v: number): number => {
    let r = v
    while (parent[r] !== r) r = parent[r]
    while (parent[v] !== r) {
      const next = parent[v]
      parent[v] = r
      v = next
    }
    return r
  }
  for (const t of tris) for (let k = 0; k < 3; k++) parent[indices[t * 3 + k]] = indices[t * 3 + k]
  for (const t of tris) {
    const a = find(indices[t * 3])
    const b = find(indices[t * 3 + 1])
    const c = find(indices[t * 3 + 2])
    parent[b] = a
    parent[find(c)] = a
  }
  const count = new Map<number, number>()
  for (const t of tris) {
    const r = find(indices[t * 3])
    count.set(r, (count.get(r) ?? 0) + 1)
  }
  let best = -1
  let bestCount = 0
  for (const [r, c] of count) {
    if (c > bestCount) {
      best = r
      bestCount = c
    }
  }
  const local = new Int32Array(vertexCount).fill(-1)
  const source: number[] = []
  const out: number[] = []
  for (const t of tris) {
    if (find(indices[t * 3]) !== best) continue
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]
      if (local[v] < 0) {
        local[v] = source.length
        source.push(v)
      }
      out.push(local[v])
    }
  }
  const pos = new Float64Array(source.length * 3)
  source.forEach((v, i) => {
    pos[i * 3] = positions[v * 3]
    pos[i * 3 + 1] = positions[v * 3 + 1]
    pos[i * 3 + 2] = positions[v * 3 + 2]
  })
  return {
    positions: pos,
    indices: Uint32Array.from(out),
    vertexCount: source.length,
    source: Uint32Array.from(source),
    leftOut: { triangles: tris.length - bestCount, pieces: Math.max(0, count.size - 1) },
  }
}

/** A flat pattern: its outline and the holes in it, in millimetres, x to
 *  the right and y up, the bounding box's low corner at the origin. Loop k
 *  is points [offsets[k], offsets[k + 1]) of `points` (x,y pairs), not
 *  closed — the last point joins the first. Loop 0 is the outline, turning
 *  counter-clockwise; the rest are holes, turning clockwise. */
export interface FlatPattern {
  points: Float64Array
  offsets: Uint32Array
}

/** A region laid flat, vertex by vertex: where each was on the mesh (x, y,
 *  z) and where it lies on the pattern (u, v), in the pattern's own frame. */
export interface PatternLayout {
  positions: Float64Array
  uv: Float64Array
}

/** A point of the sheet on its pattern: where it lies there, and how far it
 *  stood off the region (the nearest vertex's distance), mm. */
export interface PatternPoint {
  uv: [number, number] | null
  off: number
}

/**
 * Points of the sheet placed on its pattern (layout): each by the vertices
 * of the region nearest it, weighted by how near they are (the inverse
 * square of the distance) — within a millimetre on a scan's mesh, far
 * closer than a bend line needs. A point further than `reach` mm from every
 * vertex stood off the sheet and is placed nowhere.
 */
export function patternPointsOf(layout: PatternLayout, points: readonly (readonly number[])[], { near = 4, reach = 2 } = {}): PatternPoint[] {
  const count = layout.uv.length / 2
  const P = layout.positions
  return points.map((p) => {
    // The nearest few, kept in order of distance.
    const best: { v: number; d: number }[] = []
    for (let v = 0; v < count; v++) {
      const d = (P[v * 3] - p[0]) ** 2 + (P[v * 3 + 1] - p[1]) ** 2 + (P[v * 3 + 2] - p[2]) ** 2
      if (best.length < near || d < best[best.length - 1].d) {
        best.push({ v, d })
        best.sort((a, b) => a.d - b.d)
        if (best.length > near) best.pop()
      }
    }
    const off = best.length ? Math.sqrt(best[0].d) : Infinity
    if (!(off <= reach)) return { uv: null, off }
    if (best[0].d === 0) return { uv: [layout.uv[best[0].v * 2], layout.uv[best[0].v * 2 + 1]], off: 0 }
    let w = 0
    let u = 0
    let t = 0
    for (const b of best) {
      const k = 1 / b.d
      w += k
      u += k * layout.uv[b.v * 2]
      t += k * layout.uv[b.v * 2 + 1]
    }
    return { uv: [u / w, t / w], off }
  })
}

export interface PatternHole {
  /** The middle of its bounding box, mm. */
  center: [number, number]
  width: number
  height: number
  area: number
  perimeter: number
}

export interface PatternFigures {
  /** The bounding box, mm. */
  width: number
  height: number
  /** The outline's area less the holes', mm². */
  area: number
  /** Round the outline, mm. */
  perimeter: number
  holes: PatternHole[]
  /** Open edges that close no loop — a tangle of triangles turned the wrong
   *  way — left out of the pattern. */
  stray: number
}

function loopArea(p: ArrayLike<number>, from: number, to: number): number {
  let a = 0
  for (let i = from; i < to; i++) {
    const j = i + 1 < to ? i + 1 : from
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]
  }
  return a / 2
}

function loopPerimeter(p: ArrayLike<number>, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) {
    const j = i + 1 < to ? i + 1 : from
    s += Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1])
  }
  return s
}

/**
 * The pattern a patch laid out at `uv` (u,v per vertex, mm) makes: its rims
 * as loops, the longest-reaching one the outline and every other a hole,
 * each turned the way FlatPattern says, and the whole moved so its bounding
 * box starts at the origin. `shift` is how far it was moved, to carry any
 * other point of the layout (a cone's apex) along.
 */
export function patternOf(uv: Float64Array, indices: Uint32Array, vertexCount: number): { pattern: FlatPattern; figures: PatternFigures; shift: [number, number] } {
  const { loops, stray } = boundaryLoops(indices, vertexCount)
  if (loops.length === 0) throw new Error('The region has no rim to draw — it is a closed surface. Cut it open first, or name a smaller region.')
  const raw = loops.map((l) => {
    const pts = new Float64Array(l.vertices.length * 2)
    l.vertices.forEach((v, i) => {
      pts[i * 2] = uv[v * 2]
      pts[i * 2 + 1] = uv[v * 2 + 1]
    })
    return { pts, area: loopArea(pts, 0, l.vertices.length) }
  })
  let outer = 0
  raw.forEach((r, i) => {
    if (Math.abs(r.area) > Math.abs(raw[outer].area)) outer = i
  })
  const ordered = [raw[outer], ...raw.filter((_, i) => i !== outer)]
  let minX = Infinity
  let minY = Infinity
  for (const r of ordered) {
    for (let i = 0; i < r.pts.length; i += 2) {
      if (r.pts[i] < minX) minX = r.pts[i]
      if (r.pts[i + 1] < minY) minY = r.pts[i + 1]
    }
  }
  const total = ordered.reduce((s, r) => s + r.pts.length / 2, 0)
  const points = new Float64Array(total * 2)
  const offsets = new Uint32Array(ordered.length + 1)
  let at = 0
  ordered.forEach((r, k) => {
    offsets[k] = at
    const n = r.pts.length / 2
    // The outline counter-clockwise, the holes clockwise.
    const reverse = k === 0 ? r.area < 0 : r.area > 0
    for (let i = 0; i < n; i++) {
      const s = reverse ? n - 1 - i : i
      points[(at + i) * 2] = r.pts[s * 2] - minX
      points[(at + i) * 2 + 1] = r.pts[s * 2 + 1] - minY
    }
    at += n
  })
  offsets[ordered.length] = at
  const pattern = { points, offsets }
  return { pattern, figures: figuresOf(pattern, stray), shift: [-minX, -minY] }
}

function boxOf(p: ArrayLike<number>, from: number, to: number) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = from; i < to; i++) {
    x0 = Math.min(x0, p[i * 2])
    x1 = Math.max(x1, p[i * 2])
    y0 = Math.min(y0, p[i * 2 + 1])
    y1 = Math.max(y1, p[i * 2 + 1])
  }
  return { x0, y0, x1, y1 }
}

/** A pattern's sizes. */
export function figuresOf(pattern: FlatPattern, stray = 0): PatternFigures {
  const { points: p, offsets: o } = pattern
  const outer = boxOf(p, o[0], o[1])
  const holes: PatternHole[] = []
  let area = Math.abs(loopArea(p, o[0], o[1]))
  for (let k = 1; k + 1 < o.length; k++) {
    const b = boxOf(p, o[k], o[k + 1])
    const a = Math.abs(loopArea(p, o[k], o[k + 1]))
    area -= a
    holes.push({
      center: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2],
      width: b.x1 - b.x0,
      height: b.y1 - b.y0,
      area: a,
      perimeter: loopPerimeter(p, o[k], o[k + 1]),
    })
  }
  return { width: outer.x1 - outer.x0, height: outer.y1 - outer.y0, area, perimeter: loopPerimeter(p, o[0], o[1]), holes, stray }
}

/** How far a layout stretched the surface, in per cent: a length on the
 *  pattern against the same length on the mesh, in the direction each
 *  triangle was stretched or shrunk most, and an area against its own. */
export interface Distortion {
  /** Per cent: the largest of any triangle's, the mean and the 95th
   *  percentile over the surface, each triangle weighed by its area. */
  length: { max: number; mean: number; p95: number }
  area: { max: number; mean: number; p95: number }
  /** The pattern's area against the mesh's, per cent off. */
  totalArea: number
  /** Triangles the layout turned over — a pattern that overlaps itself. */
  flipped: number
}

/** The stretch of each triangle of a layout, and the figures over them. */
export function distortionOf(positions: Float64Array, uv: Float64Array, indices: Uint32Array): Distortion {
  const n = indices.length / 3
  const len = new Float64Array(n)
  const ar = new Float64Array(n)
  const w = new Float64Array(n)
  let area3 = 0
  let area2 = 0
  let flipped = 0
  for (let t = 0; t < n; t++) {
    const i0 = indices[t * 3]
    const i1 = indices[t * 3 + 1]
    const i2 = indices[t * 3 + 2]
    // The triangle in a frame of its own plane: x along its first edge.
    const ax = positions[i1 * 3] - positions[i0 * 3]
    const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1]
    const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2]
    const bx = positions[i2 * 3] - positions[i0 * 3]
    const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1]
    const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2]
    const la = Math.hypot(ax, ay, az)
    const cx = ay * bz - az * by
    const cy = az * bx - ax * bz
    const cz = ax * by - ay * bx
    const twice = Math.hypot(cx, cy, cz)
    if (!(la > 0) || !(twice > 1e-14)) continue
    const x1 = la
    const x2 = (ax * bx + ay * by + az * bz) / la
    const y2 = twice / la
    // Its edges on the pattern.
    const u1 = uv[i1 * 2] - uv[i0 * 2]
    const v1 = uv[i1 * 2 + 1] - uv[i0 * 2 + 1]
    const u2 = uv[i2 * 2] - uv[i0 * 2]
    const v2 = uv[i2 * 2 + 1] - uv[i0 * 2 + 1]
    // J maps the triangle's own frame onto the pattern: J·X = U, X =
    // [[x1, x2], [0, y2]].
    const a = u1 / x1
    const c = v1 / x1
    const b = (u2 - a * x2) / y2
    const d = (v2 - c * x2) / y2
    // Singular values of a 2×2 in closed form.
    const e = (a + d) / 2
    const f = (a - d) / 2
    const g = (c + b) / 2
    const h = (c - b) / 2
    const q = Math.hypot(e, h)
    const r = Math.hypot(f, g)
    const s1 = q + r
    const s2 = Math.abs(q - r)
    const det = a * d - b * c
    if (det <= 0) flipped++
    len[t] = Math.max(s1 - 1, 1 - s2) * 100
    ar[t] = Math.abs(Math.abs(det) - 1) * 100
    w[t] = twice / 2
    area3 += twice / 2
    area2 += (Math.abs(det) * twice) / 2
  }
  return {
    length: spread(len, w),
    area: spread(ar, w),
    totalArea: area3 > 0 ? ((area2 - area3) / area3) * 100 : 0,
    flipped,
  }
}

/** The largest, the area-weighted mean and 95th percentile of `values`. */
function spread(values: Float64Array, weights: Float64Array): { max: number; mean: number; p95: number } {
  let max = 0
  let sum = 0
  let total = 0
  const order: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (!(weights[i] > 0)) continue
    max = Math.max(max, values[i])
    sum += values[i] * weights[i]
    total += weights[i]
    order.push(i)
  }
  if (total === 0) return { max: 0, mean: 0, p95: 0 }
  order.sort((x, y) => values[x] - values[y])
  let acc = 0
  let p95 = max
  for (const i of order) {
    acc += weights[i]
    if (acc >= 0.95 * total) {
      p95 = values[i]
      break
    }
  }
  return { max, mean: sum / total, p95 }
}
