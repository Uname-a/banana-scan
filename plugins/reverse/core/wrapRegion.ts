// SPDX-License-Identifier: AGPL-3.0-only
// Wrapping a sketch onto a free-form region of the scan: the region laid
// out flat by the flattening Mesh Tools' flatten makes (conformal, then as
// rigid as possible — src/core/develop/flatten), the sketch placed in that
// flat layout and carried back onto the scan through it, triangle by
// triangle. A developable region — a sheet bent without stretching — lays
// out exactly and the sketch keeps its lengths on it; a dished one does
// not, and how far the layout stretched the triangles under the sketch is
// what the wrap's truth rests on: read, and refused past a limit.
//
// The sketch is placed as on a cylinder (core/wrap.ts): at the point of the
// region nearest the drawing's middle, the sketch laid rigidly onto the
// plane touching the region there and read into the layout by that
// triangle's own turn — so a sketch drawn on a plane tangent to the region
// lands where it is drawn, the way it is drawn.

import type { Vec2 } from '../../../src/core/flat/types'
import type { Vec3 } from '../../../src/core/types'
import { add, addScaled, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import { flattenPatch } from '../../../src/core/develop/flatten'
import { regionPatch, type Patch } from '../../../src/core/develop/flatPattern'
import { polygonOf, type Development, type WrappedProfile, type WrapSurface } from './wrap'

/** A region of the scan laid out flat. */
export interface RegionLayout {
  patch: Patch
  /** u, v per vertex of the patch, mm — seen from the side the scan's
   *  normals face, never mirrored. */
  uv: Float64Array
  /** Each vertex's normal: its triangles' by area, the way they wind. */
  normals: Float64Array
  /** How far laying each triangle out stretched it: the most a length in
   *  it changed, per cent. */
  stretch: Float64Array
  /** Each triangle's turn from its own plane into the layout: cos, sin of
   *  the rotation part of the map, and its in-plane axes in the part. */
  turn: Float64Array
  frames: Float64Array
  /** The mean edge, mm: what an outline is sampled at. */
  edge: number
  locate: (u: number, v: number) => { t: number; b: [number, number, number] } | null
  iterations: number
  converged: boolean
}

/** Past this, per cent of a length, the layout under a sketch is refused:
 *  the sketch would not keep its lengths on the scan to better than that. */
export const WRAP_REGION_MAX_STRETCH_PCT = 2
/** Past this the wrap goes on, with a warning. */
export const WRAP_REGION_WARN_STRETCH_PCT = 0.5

/**
 * The region of the scan — vertices by number — laid out flat: its largest
 * connected piece, flattened. A sentence why not where it cannot be.
 */
export function layOutRegion(positions: ArrayLike<number>, triangles: Uint32Array, vertexCount: number, region: ArrayLike<number>, iterations?: number): RegionLayout | string {
  const patch = regionPatch(positions, triangles, vertexCount, region)
  if (patch.indices.length < 3 * 8) return 'The region holds too few whole triangles to lay out — mark more of the surface.'
  let laid: ReturnType<typeof flattenPatch>
  try {
    laid = flattenPatch(patch, iterations !== undefined ? { iterations } : {})
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  const { indices } = patch
  const n = patch.vertexCount
  const T = indices.length / 3
  const uv = Float64Array.from(laid.uv)
  const P = patch.positions
  const pt = (i: number): Vec3 => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
  // Seen from the normals' side: the layout's triangles wound as the
  // scan's. Mirrored, u is turned over.
  let signed = 0
  for (let t = 0; t < T; t++) {
    const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]
    signed += (uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]) - (uv[c * 2] - uv[a * 2]) * (uv[b * 2 + 1] - uv[a * 2 + 1])
  }
  if (signed < 0) for (let v = 0; v < n; v++) uv[v * 2] = -uv[v * 2]
  const normals = new Float64Array(n * 3)
  const stretch = new Float64Array(T)
  const turn = new Float64Array(T * 2)
  const frames = new Float64Array(T * 6)
  let edges = 0
  for (let t = 0; t < T; t++) {
    const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]
    const p0 = pt(a)
    const d1 = sub(pt(b), p0)
    const d2 = sub(pt(c), p0)
    const nn = cross(d1, d2)
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[v * 3 + k] += nn[k]
    edges += len(d1) + len(d2) + len(sub(pt(c), pt(b)))
    const e1 = normalize(d1)
    const nt = normalize(nn)
    if (!e1 || !nt) continue
    const e2 = cross(nt, e1)
    frames.set([...e1, ...e2], t * 6)
    // The map from the triangle's own plane (e1, e2) to the layout.
    const q1: Vec2 = [dot(d1, e1), 0]
    const q2: Vec2 = [dot(d2, e1), dot(d2, e2)]
    const u1: Vec2 = [uv[b * 2] - uv[a * 2], uv[b * 2 + 1] - uv[a * 2 + 1]]
    const u2: Vec2 = [uv[c * 2] - uv[a * 2], uv[c * 2 + 1] - uv[a * 2 + 1]]
    const det = q1[0] * q2[1] - q2[0] * q1[1]
    if (!(Math.abs(det) > 1e-18)) continue
    // J = U · Q⁻¹.
    const j00 = (u1[0] * q2[1] - u2[0] * q1[1]) / det
    const j01 = (u2[0] * q1[0] - u1[0] * q2[0]) / det
    const j10 = (u1[1] * q2[1] - u2[1] * q1[1]) / det
    const j11 = (u2[1] * q1[0] - u1[1] * q2[0]) / det
    const [s1, s2] = singular(j00, j01, j10, j11)
    stretch[t] = Math.max(Math.abs(s1 - 1), Math.abs(s2 - 1)) * 100
    const ang = Math.atan2(j10 - j01, j00 + j11)
    turn[t * 2] = Math.cos(ang)
    turn[t * 2 + 1] = Math.sin(ang)
  }
  for (let v = 0; v < n; v++) {
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1
    for (let k = 0; k < 3; k++) normals[v * 3 + k] /= l
  }
  return { patch, uv, normals, stretch, turn, frames, edge: edges / (3 * T), locate: locator(uv, indices), iterations: laid.iterations, converged: laid.converged }
}

/** The singular values of a 2 × 2 matrix. */
function singular(a: number, b: number, c: number, d: number): [number, number] {
  const e = (a + d) / 2
  const f = (a - d) / 2
  const g = (c + b) / 2
  const h = (c - b) / 2
  const q = Math.hypot(e, h)
  const r = Math.hypot(f, g)
  return [q + r, Math.abs(q - r)]
}

/** The triangle of the layout a point falls in, and its barycentric
 *  coordinates there: triangles bucketed on a grid over the layout. */
function locator(uv: Float64Array, indices: Uint32Array): RegionLayout['locate'] {
  const T = indices.length / 3
  let u0 = Infinity
  let v0 = Infinity
  let u1 = -Infinity
  let v1 = -Infinity
  for (let i = 0; i < uv.length; i += 2) {
    u0 = Math.min(u0, uv[i])
    u1 = Math.max(u1, uv[i])
    v0 = Math.min(v0, uv[i + 1])
    v1 = Math.max(v1, uv[i + 1])
  }
  const side = Math.max(1, Math.ceil(Math.sqrt(T / 2)))
  const cw = (u1 - u0) / side || 1
  const ch = (v1 - v0) / side || 1
  const cells: number[][] = Array.from({ length: side * side }, () => [])
  const cellOf = (u: number, v: number): [number, number] => [Math.min(side - 1, Math.max(0, Math.floor((u - u0) / cw))), Math.min(side - 1, Math.max(0, Math.floor((v - v0) / ch)))]
  for (let t = 0; t < T; t++) {
    let a = Infinity
    let b = Infinity
    let c = -Infinity
    let d = -Infinity
    for (let k = 0; k < 3; k++) {
      const i = indices[t * 3 + k]
      a = Math.min(a, uv[i * 2])
      c = Math.max(c, uv[i * 2])
      b = Math.min(b, uv[i * 2 + 1])
      d = Math.max(d, uv[i * 2 + 1])
    }
    const [i0, j0] = cellOf(a, b)
    const [i1, j1] = cellOf(c, d)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * side + i].push(t)
  }
  return (u, v) => {
    if (u < u0 - 1e-9 || u > u1 + 1e-9 || v < v0 - 1e-9 || v > v1 + 1e-9) return null
    const [i, j] = cellOf(u, v)
    let best: { t: number; b: [number, number, number]; out: number } | null = null
    for (const t of cells[j * side + i]) {
      const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]
      const ax = uv[a * 2]
      const ay = uv[a * 2 + 1]
      const bx = uv[b * 2] - ax
      const by = uv[b * 2 + 1] - ay
      const cx = uv[c * 2] - ax
      const cy = uv[c * 2 + 1] - ay
      const det = bx * cy - cx * by
      if (!(Math.abs(det) > 1e-18)) continue
      const px = u - ax
      const py = v - ay
      const l1 = (px * cy - cx * py) / det
      const l2 = (bx * py - px * by) / det
      const l0 = 1 - l1 - l2
      const out = Math.max(0, -l0, -l1, -l2)
      if (out === 0) return { t, b: [l0, l1, l2] }
      if (out < 1e-9 && (!best || out < best.out)) best = { t, b: [l0, l1, l2], out }
    }
    return best ? { t: best.t, b: best.b } : null
  }
}

/** The point of a triangle nearest p, with its barycentric coordinates. */
function nearestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): { at: Vec3; b: [number, number, number] } {
  // Ericson, Real-Time Collision Detection 5.1.5.
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = sub(p, a)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return { at: a, b: [1, 0, 0] }
  const bp = sub(p, b)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return { at: b, b: [0, 1, 0] }
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return { at: addScaled(a, ab, v), b: [1 - v, v, 0] }
  }
  const cp = sub(p, c)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return { at: c, b: [0, 0, 1] }
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return { at: addScaled(a, ac, w), b: [1 - w, 0, w] }
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return { at: addScaled(b, sub(c, b), w), b: [0, 1 - w, w] }
  }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom
  const w = vc * denom
  return { at: add(a, add(scale(ab, v), scale(ac, w))), b: [1 - v - w, v, w] }
}

/** The point of the region nearest p: its triangle and where in it. */
export function nearestOnRegion(layout: RegionLayout, p: Vec3): { t: number; at: Vec3; b: [number, number, number] } {
  const { indices, positions: P } = layout.patch
  const pt = (i: number): Vec3 => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
  let best = { t: 0, at: pt(indices[0]), b: [1, 0, 0] as [number, number, number], d: Infinity }
  for (let t = 0; t < indices.length / 3; t++) {
    const near = nearestOnTriangle(p, pt(indices[t * 3]), pt(indices[t * 3 + 1]), pt(indices[t * 3 + 2]))
    const d = len(sub(near.at, p))
    if (d < best.d) best = { t, at: near.at, b: near.b, d }
  }
  return { t: best.t, at: best.at, b: best.b }
}

/** A point of the layout's triangle t at barycentric b: on the scan, its
 *  normal there, and in the layout. */
function onTriangle(layout: RegionLayout, t: number, b: readonly number[]): { point: Vec3; normal: Vec3; uv: Vec2 } {
  const { indices, positions: P } = layout.patch
  const point: Vec3 = [0, 0, 0]
  const normal: Vec3 = [0, 0, 0]
  const uv: Vec2 = [0, 0]
  for (let k = 0; k < 3; k++) {
    const v = indices[t * 3 + k]
    for (let i = 0; i < 3; i++) {
      point[i] += b[k] * P[v * 3 + i]
      normal[i] += b[k] * layout.normals[v * 3 + i]
    }
    uv[0] += b[k] * layout.uv[v * 2]
    uv[1] += b[k] * layout.uv[v * 2 + 1]
  }
  return { point, normal: normalize(normal) ?? [0, 0, 1], uv }
}

/**
 * The development of a laid-out region for a sketch on the plane of normal
 * `sketchNormal` whose drawing has its middle at `middle` — the same reading
 * a cylinder's gives (core/wrap.ts Development), x and y the layout's.
 */
export function regionDevelopment(layout: RegionLayout, surface: Extract<WrapSurface, { kind: 'region' }>, sketchNormal: Vec3, middle: Vec3): Development | string {
  const N = normalize(sketchNormal)
  if (!N) return 'The sketch’s plane has no normal.'
  const near = nearestOnRegion(layout, middle)
  const at = onTriangle(layout, near.t, near.b)
  const n0 = at.normal
  const from = dot(N, n0) < 0 ? scale(N, -1) : N
  const tiltDeg = (Math.acos(Math.min(1, Math.abs(dot(N, n0)))) * 180) / Math.PI
  if (tiltDeg > 75) return 'The sketch’s plane stands across the region where it is nearest — sketch on a plane along the region there: tangent to it, or parallel to such a plane.'
  const turnOnto = rotationBetween(from, n0)
  const pivot = addScaled(middle, n0, -dot(sub(middle, at.point), n0))
  // The anchor triangle's axes laid on the touching plane, and its turn
  // into the layout.
  const f = layout.frames
  const t6 = near.t * 6
  const e1 = normalize(sub([f[t6], f[t6 + 1], f[t6 + 2]], scale(n0, dot([f[t6], f[t6 + 1], f[t6 + 2]], n0)))) ?? [1, 0, 0]
  const e2 = cross(n0, e1)
  const c = layout.turn[near.t * 2]
  const s = layout.turn[near.t * 2 + 1]
  const flat = (p: Vec3): Vec2 => {
    const onto = add(pivot, turnOnto(sub(p, middle)))
    const d = sub(onto, at.point)
    const x = dot(d, e1)
    const y = dot(d, e2)
    return [at.uv[0] + c * x - s * y, at.uv[1] + s * x + c * y]
  }
  // The layout's +u and +v at the anchor, in the part.
  const across = add(scale(e1, c), scale(e2, -s))
  const along = add(scale(e1, s), scale(e2, c))
  const place = (x: number, y: number, w = 0) => {
    const hit = layout.locate(x, y)
    if (!hit) return null
    const o = onTriangle(layout, hit.t, hit.b)
    return { point: addScaled(o.point, o.normal, w), normal: o.normal }
  }
  const develop = (p: Vec3): Vec2 => {
    const q = nearestOnRegion(layout, p)
    return onTriangle(layout, q.t, q.b).uv
  }
  return { surface, touch: { point: at.point, normal: n0, across, along }, tiltDeg, flat, place, develop, step: Math.max(0.05, Math.min(1, layout.edge / 2)) }
}

function rotationBetween(from: Vec3, to: Vec3): (v: Vec3) => Vec3 {
  const cth = dot(from, to)
  const axis = cross(from, to)
  const sth = len(axis)
  if (sth < 1e-12) return (v) => v
  const k = scale(axis, 1 / sth)
  return (v) => add(add(scale(v, cth), scale(cross(k, v), sth)), scale(k, dot(k, v) * (1 - cth)))
}

/** How far the layout stretched the scan under the wrapped profiles: the
 *  triangles their outlines cross and their insides cover, the most any
 *  stretched a length and the mean over their area, per cent. */
export function stretchUnder(layout: RegionLayout, wrapped: readonly WrappedProfile[]): { maxPct: number; meanPct: number; triangles: number; at: Vec3 | null } {
  const hit = new Set<number>()
  const mark = (u: number, v: number) => {
    const h = layout.locate(u, v)
    if (h) hit.add(h.t)
  }
  for (const p of wrapped) {
    const outer = polygonOf(p.outer)
    const holes = p.holes.map(polygonOf)
    for (const poly of [outer, ...holes]) for (const q of poly) mark(q[0], q[1])
    // The inside, on a grid at the mesh's own spacing.
    let u0 = Infinity
    let v0 = Infinity
    let u1 = -Infinity
    let v1 = -Infinity
    for (const q of outer) {
      u0 = Math.min(u0, q[0])
      u1 = Math.max(u1, q[0])
      v0 = Math.min(v0, q[1])
      v1 = Math.max(v1, q[1])
    }
    const step = Math.max(layout.edge, Math.sqrt(((u1 - u0) * (v1 - v0)) / 40000))
    for (let v = v0 + step / 2; v < v1; v += step)
      for (let u = u0 + step / 2; u < u1; u += step) if (inside(outer, u, v) && !holes.some((h) => inside(h, u, v))) mark(u, v)
  }
  let max = 0
  let at: Vec3 | null = null
  let sum = 0
  let area = 0
  const { indices, positions: P } = layout.patch
  for (const t of hit) {
    const pt = (k: number): Vec3 => {
      const i = indices[t * 3 + k]
      return [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
    }
    const a = len(cross(sub(pt(1), pt(0)), sub(pt(2), pt(0)))) / 2
    sum += layout.stretch[t] * a
    area += a
    if (layout.stretch[t] > max) {
      max = layout.stretch[t]
      at = scale(add(add(pt(0), pt(1)), pt(2)), 1 / 3)
    }
  }
  return { maxPct: max, meanPct: area > 0 ? sum / area : 0, triangles: hit.size, at }
}

function inside(poly: readonly Vec2[], x: number, y: number): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}

/** Why the stretch under a sketch refuses the wrap, or null; `limit` per
 *  cent. */
export function stretchProblem(s: { maxPct: number; at: Vec3 | null }, limit = WRAP_REGION_MAX_STRETCH_PCT): string | null {
  if (!(s.maxPct > limit)) return null
  const where = s.at ? ` at (${s.at.map((x) => Math.round(x * 100) / 100).join(', ')})` : ''
  return `The region does not lay out flat under the sketch: laying it out stretches a length by ${Math.round(s.maxPct * 100) / 100} %${where}, past ${limit} % — the sketch would not keep its lengths on it. Mark a region that bends without stretching (a sheet, not a dome), a smaller one round the sketch, or raise maxStretchPct.`
}
