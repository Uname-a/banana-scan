// SPDX-License-Identifier: AGPL-3.0-only
// A piece of a mesh between two ends — loops, or a loop and a point — mapped
// onto a cylinder, one to one: what a region's layout is drawn on
// (regionLayout.ts).
//
// A harmonic function h on it, 0 along the one end and 1 along the other, has
// no peak, no pit and no saddle between: its level lines are single loops
// from end to end, whatever bumps the piece has. With its conjugate θ round
// it maps the piece onto a cylinder, conformally. Discretely: cotangent
// weights on the edges, held above nothing so that the solution has no peak
// inside; the conjugate summed from triangle to triangle, the flux of h
// through each edge crossed, which all the way round comes to the period.

import type { Vec3 } from '../../../src/core/types'

/** The piece between its two ends on the cylinder: H from 0 at the base to
 *  `top`, a unit of H as long on the surface as one of θ. */
export interface Tube {
  positions: Float32Array
  triangles: Uint32Array
  /** H by vertex. */
  h: Float64Array
  /** Per triangle corner, θ (unwrapped across the triangle); it grows to the
   *  right of H, seen from outside. */
  theta: Float64Array
  top: number
  /** The mean edge, mm. */
  edge: number
}

export const at3 = (p: ArrayLike<number>, i: number): Vec3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
export const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The middle of the far end: where a load spread over the piece and let off
 *  along `from` stands highest. */
export function peakFrom(p: Float32Array, triangles: ArrayLike<number>, from: readonly number[]): number {
  const n = p.length / 3
  const areas = new Float64Array(n)
  for (let i = 0; i < triangles.length; i += 3) {
    const a = area(p, triangles[i], triangles[i + 1], triangles[i + 2]) / 3
    for (let k = 0; k < 3; k++) areas[triangles[i + k]] += a
  }
  const fixed = new Uint8Array(n)
  for (const v of from) fixed[v] = 1
  const u = solve(n, edgeWeights(p, triangles), fixed, new Float64Array(n), areas, 1e-3)
  let best = from[0]
  for (let v = 0; v < n; v++) if (u[v] > u[best]) best = v
  return best
}

/** The triangles without those round a vertex, those, and the ring left. */
export function without(triangles: ArrayLike<number>, pole: number): { rest: number[]; cut: number[]; ring: number[] } {
  const ring = new Set<number>()
  const rest: number[] = []
  const cut: number[] = []
  for (let i = 0; i < triangles.length; i += 3) {
    if (triangles[i] === pole || triangles[i + 1] === pole || triangles[i + 2] === pole) {
      for (let k = 0; k < 3; k++) ring.add(triangles[i + k])
      cut.push(triangles[i], triangles[i + 1], triangles[i + 2])
    } else rest.push(triangles[i], triangles[i + 1], triangles[i + 2])
  }
  ring.delete(pole)
  return { rest, cut, ring: [...ring] }
}

/** The map of the triangles between the ends `low` and `high`, or why not. */
export function tubeBetween(p: Float32Array, triangles: readonly number[], low: readonly number[], high: readonly number[]): Tube | string {
  const n = p.length / 3
  const ends = new Set(low)
  if (high.some((v) => ends.has(v))) return 'The region is too small for its points: its two ends touch. Give it more of the scan.'
  const w = edgeWeights(p, triangles)
  const fixed = new Uint8Array(n)
  const held = new Float64Array(n)
  for (const v of low) fixed[v] = 1
  for (const v of high) {
    fixed[v] = 1
    held[v] = 1
  }
  const h = solve(n, w, fixed, held, null, 1e-8)
  const triCount = triangles.length / 3
  const across = new Map<number, number[]>()
  for (let t = 0; t < triCount; t++) for (let k = 0; k < 3; k++) {
    const e = edgeKey(triangles[t * 3 + k], triangles[t * 3 + ((k + 1) % 3)])
    const list = across.get(e)
    if (list) list.push(t * 3 + k)
    else across.set(e, [t * 3 + k])
  }
  const isLow = (v: number) => fixed[v] === 1 && held[v] === 0
  let flux = 0
  for (const [e, weight] of w) {
    const a = Math.floor(e / 0x4000000)
    const b = e % 0x4000000
    if (isLow(a) !== isLow(b)) flux += weight * (h[a] + h[b])
  }
  if (!(flux > 1e-12)) return 'The region does not run from one end to the other: it is in two pieces.'
  const psi = new Float64Array(triCount)
  const seen = new Uint8Array(triCount)
  const order: number[] = [0]
  seen[0] = 1
  for (let q = 0; q < order.length; q++) {
    const t = order[q]
    for (let k = 0; k < 3; k++) {
      const a = triangles[t * 3 + k]
      const b = triangles[t * 3 + ((k + 1) % 3)]
      const pair = across.get(edgeKey(a, b))!
      if (pair.length !== 2) continue
      const o = Math.floor((pair[0] === t * 3 + k ? pair[1] : pair[0]) / 3)
      if (seen[o]) continue
      // Crossing a → b from its left to its right, h climbing along it: θ
      // grows to the right of H, seen from outside.
      seen[o] = 1
      psi[o] = psi[t] + (w.get(edgeKey(a, b)) ?? 0) * (h[b] - h[a])
      order.push(o)
    }
  }
  if (order.length < triCount) return 'The region is in two pieces.'
  const turn = (2 * Math.PI) / flux
  // Each corner's θ: the mean over the triangles round its vertex, each
  // taken to the turn nearest this triangle's own.
  const first = new Float64Array(n).fill(NaN)
  const sum = new Float64Array(n)
  const count = new Int32Array(n)
  for (let i = 0; i < triangles.length; i++) {
    const v = triangles[i]
    const x = psi[Math.floor(i / 3)] * turn
    if (Number.isNaN(first[v])) first[v] = x
    sum[v] += nearTurn(x, first[v])
    count[v]++
  }
  const theta = new Float64Array(triangles.length)
  for (let i = 0; i < triangles.length; i++) theta[i] = nearTurn(sum[triangles[i]] / count[triangles[i]], psi[Math.floor(i / 3)] * turn)
  for (let v = 0; v < n; v++) h[v] *= turn
  let edge = 0
  for (let i = 0; i < triangles.length; i += 3) edge += dist(at3(p, triangles[i]), at3(p, triangles[i + 1]))
  return { positions: p, triangles: Uint32Array.from(triangles), h, theta, top: turn, edge: edge / Math.max(1, triCount) }
}

/** The number x + 2πk nearest another. */
export const nearTurn = (x: number, to: number) => x + 2 * Math.PI * Math.round((to - x) / (2 * Math.PI))
export const edgeKey = (a: number, b: number) => (a < b ? a * 0x4000000 + b : b * 0x4000000 + a)

export function area(p: ArrayLike<number>, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
}

/** The edges' weights: half the cotangents across them, never below a
 *  hundredth, so that the solution has no peak inside. */
function edgeWeights(p: ArrayLike<number>, t: ArrayLike<number>): Map<number, number> {
  const w = new Map<number, number>()
  for (let i = 0; i < t.length; i += 3) {
    const a2 = 2 * Math.max(area(p, t[i], t[i + 1], t[i + 2]), 1e-14)
    for (let k = 0; k < 3; k++) {
      const o = t[i + k]
      const a = t[i + ((k + 1) % 3)]
      const b = t[i + ((k + 2) % 3)]
      const d = (p[a * 3] - p[o * 3]) * (p[b * 3] - p[o * 3]) + (p[a * 3 + 1] - p[o * 3 + 1]) * (p[b * 3 + 1] - p[o * 3 + 1]) + (p[a * 3 + 2] - p[o * 3 + 2]) * (p[b * 3 + 2] - p[o * 3 + 2])
      const e = edgeKey(a, b)
      w.set(e, (w.get(e) ?? 0) + Math.max(-20, Math.min(20, d / a2)) / 2)
    }
  }
  for (const [e, x] of w) if (x < 0.01) w.set(e, 0.01)
  return w
}

/** Σ w (u_i − u_j) = load, u held where fixed. */
function solve(n: number, w: ReadonlyMap<number, number>, fixed: Uint8Array, held: Float64Array, load: Float64Array | null, tolerance: number): Float64Array {
  const of = new Int32Array(n).fill(-1)
  const touched = new Uint8Array(n)
  for (const e of w.keys()) {
    touched[Math.floor(e / 0x4000000)] = 1
    touched[e % 0x4000000] = 1
  }
  const free: number[] = []
  for (let v = 0; v < n; v++) if (touched[v] && !fixed[v]) {
    of[v] = free.length
    free.push(v)
  }
  const count = free.length
  // Compressed rows.
  const degree = new Int32Array(count + 1)
  const diagonal = new Float64Array(count)
  const rhs = new Float64Array(count)
  for (const [e, x] of w) {
    const a = of[Math.floor(e / 0x4000000)]
    const b = of[e % 0x4000000]
    if (a >= 0) diagonal[a] += x
    if (b >= 0) diagonal[b] += x
    if (a >= 0 && b >= 0) {
      degree[a + 1]++
      degree[b + 1]++
    } else if (a >= 0) rhs[a] += x * held[e % 0x4000000]
    else if (b >= 0) rhs[b] += x * held[Math.floor(e / 0x4000000)]
  }
  for (let i = 0; i < count; i++) degree[i + 1] += degree[i]
  const cols = new Int32Array(degree[count])
  const vals = new Float64Array(degree[count])
  const fill = degree.slice(0, count)
  for (const [e, x] of w) {
    const a = of[Math.floor(e / 0x4000000)]
    const b = of[e % 0x4000000]
    if (a < 0 || b < 0) continue
    cols[fill[a]] = b
    vals[fill[a]++] = x
    cols[fill[b]] = a
    vals[fill[b]++] = x
  }
  if (load) for (let i = 0; i < count; i++) rhs[i] += load[free[i]]
  const x = multigrid({ n: count, row: degree, cols, vals, diagonal }, rhs, tolerance)
  const out = Float64Array.from(held)
  free.forEach((v, i) => (out[v] = x[i]))
  return out
}

/** A Laplacian in rows: the weights off its diagonal, as they are (the matrix
 *  has them negative), and its diagonal. */
interface Rows {
  n: number
  row: Int32Array
  cols: Int32Array
  vals: Float64Array
  diagonal: Float64Array
}

/** The levels stop at so few unknowns, and a level that hardly thins ends
 *  them too. */
const COARSEST = 60
const THINS = 0.8
/** Jacobi's damping, and how much further than it says a coarse level's
 *  correction is taken: aggregates carry a smooth error short. */
const DAMPING = 0.65
const FURTHER = 1.6

/** A level's unknowns gathered into groups, each with those it is tied to
 *  most, and the Laplacian between the groups. */
function thinned(a: Rows): { group: Int32Array; coarse: Rows } {
  const pair = (m: Rows): { group: Int32Array; count: number } => {
    const group = new Int32Array(m.n).fill(-1)
    let count = 0
    for (let i = 0; i < m.n; i++) {
      if (group[i] >= 0) continue
      let best = -1
      let most = 0
      for (let k = m.row[i]; k < m.row[i + 1]; k++) if (group[m.cols[k]] < 0 && m.cols[k] !== i && m.vals[k] > most) {
        most = m.vals[k]
        best = m.cols[k]
      }
      group[i] = count
      if (best >= 0) group[best] = count
      count++
    }
    return { group, count }
  }
  const gather = (m: Rows, group: Int32Array, count: number): Rows => {
    const diagonal = new Float64Array(count)
    const members: number[][] = Array.from({ length: count }, () => [])
    for (let i = 0; i < m.n; i++) {
      diagonal[group[i]] += m.diagonal[i]
      members[group[i]].push(i)
    }
    const row = new Int32Array(count + 1)
    const cols: number[] = []
    const vals: number[] = []
    const place = new Int32Array(count).fill(-1)
    for (let g = 0; g < count; g++) {
      const from = cols.length
      for (const i of members[g]) for (let k = m.row[i]; k < m.row[i + 1]; k++) {
        const o = group[m.cols[k]]
        // A tie inside the group is off the diagonal of it.
        if (o === g) diagonal[g] -= m.vals[k]
        else if (place[o] >= from) vals[place[o]] += m.vals[k]
        else {
          place[o] = cols.length
          cols.push(o)
          vals.push(m.vals[k])
        }
      }
      row[g + 1] = cols.length
    }
    return { n: count, row, cols: Int32Array.from(cols), vals: Float64Array.from(vals), diagonal }
  }
  const one = pair(a)
  const half = gather(a, one.group, one.count)
  const two = pair(half)
  return { group: one.group.map((g) => two.group[g]), coarse: gather(half, two.group, two.count) }
}

function times(a: Rows, x: Float64Array, y: Float64Array): void {
  for (let i = 0; i < a.n; i++) {
    let s = a.diagonal[i] * x[i]
    for (let k = a.row[i]; k < a.row[i + 1]; k++) s -= a.vals[k] * x[a.cols[k]]
    y[i] = s
  }
}

/** The system solved by conjugate gradient, preconditioned by a V-cycle over
 *  its aggregates: some forty steps where the diagonal's take a thousand. */
function multigrid(a: Rows, rhs: Float64Array, tolerance: number): Float64Array {
  const levels: { a: Rows; group: Int32Array | null; x: Float64Array; b: Float64Array; r: Float64Array }[] = []
  const level = (m: Rows, group: Int32Array | null) => levels.push({ a: m, group, x: new Float64Array(m.n), b: new Float64Array(m.n), r: new Float64Array(m.n) })
  let m = a
  while (m.n > COARSEST) {
    const t = thinned(m)
    if (t.coarse.n > THINS * m.n) break
    level(m, t.group)
    m = t.coarse
  }
  level(m, null)
  const smooth = (l: (typeof levels)[number], rounds: number) => {
    for (let k = 0; k < rounds; k++) {
      times(l.a, l.x, l.r)
      for (let i = 0; i < l.a.n; i++) l.x[i] += (DAMPING * (l.b[i] - l.r[i])) / l.a.diagonal[i]
    }
  }
  const cycle = (k: number): void => {
    const l = levels[k]
    l.x.fill(0)
    if (!l.group) {
      smooth(l, 30)
      return
    }
    smooth(l, 2)
    times(l.a, l.x, l.r)
    const next = levels[k + 1]
    next.b.fill(0)
    for (let i = 0; i < l.a.n; i++) next.b[l.group[i]] += l.b[i] - l.r[i]
    cycle(k + 1)
    for (let i = 0; i < l.a.n; i++) l.x[i] += FURTHER * next.x[l.group[i]]
    smooth(l, 2)
  }
  const n = a.n
  const x = new Float64Array(n)
  const r = Float64Array.from(rhs)
  const q = new Float64Array(n)
  const dotOf = (u: Float64Array, v: Float64Array) => {
    let s = 0
    for (let i = 0; i < n; i++) s += u[i] * v[i]
    return s
  }
  const goal = tolerance * Math.sqrt(dotOf(rhs, rhs))
  if (!(goal > 0)) return x
  const precondition = () => {
    levels[0].b.set(r)
    cycle(0)
    return levels[0].x
  }
  const d = Float64Array.from(precondition())
  let rz = dotOf(r, d)
  for (let it = 0; it < 1000; it++) {
    times(a, d, q)
    const step = rz / dotOf(d, q)
    if (!Number.isFinite(step)) break
    for (let i = 0; i < n; i++) {
      x[i] += step * d[i]
      r[i] -= step * q[i]
    }
    if (Math.sqrt(dotOf(r, r)) < goal) break
    const z = precondition()
    const next = dotOf(r, z)
    const beta = next / rz
    rz = next
    for (let i = 0; i < n; i++) d[i] = z[i] + beta * d[i]
  }
  return x
}

/** Points of the surface by their (θ, H). */
export class Places {
  private cells = new Map<number, number[]>()
  private readonly cols: number
  private readonly rows: number

  constructor(
    private readonly t: Tube,
  ) {
    const count = t.triangles.length / 3
    const side = Math.max(1, Math.sqrt(count / 2 / Math.max(t.top, 0.1) / (2 * Math.PI)))
    this.cols = Math.max(4, Math.min(2000, Math.round(2 * Math.PI * side)))
    this.rows = Math.max(1, Math.min(4000, Math.round(t.top * side)))
    for (let i = 0; i < count; i++) {
      const th = [t.theta[i * 3], t.theta[i * 3 + 1], t.theta[i * 3 + 2]]
      const hh = [t.h[t.triangles[i * 3]], t.h[t.triangles[i * 3 + 1]], t.h[t.triangles[i * 3 + 2]]]
      const c0 = Math.floor((Math.min(...th) / (2 * Math.PI)) * this.cols)
      const c1 = Math.floor((Math.max(...th) / (2 * Math.PI)) * this.cols)
      const r0 = this.row(Math.min(...hh))
      const r1 = this.row(Math.max(...hh))
      for (let c = c0; c <= Math.min(c1, c0 + this.cols - 1); c++) for (let r = r0; r <= r1; r++) {
        const k = (((c % this.cols) + this.cols) % this.cols) * this.rows + r
        const list = this.cells.get(k)
        if (list) list.push(i)
        else this.cells.set(k, [i])
      }
    }
  }

  private row(h: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((h / this.t.top) * this.rows)))
  }

  /** The point at (θ, H) — the nearest the triangles there come to it. */
  at(theta: number, h: number): Vec3 | null {
    const { t } = this
    const hh = Math.max(1e-9, Math.min(t.top - 1e-9, h))
    const c = (((Math.floor((theta / (2 * Math.PI)) * this.cols) % this.cols) + this.cols) % this.cols)
    let best: { tri: number; l: [number, number, number]; out: number } | null = null
    for (let reach = 0; reach < 3 && !(best && best.out < 1e-6); reach++) {
      for (let dc = -reach; dc <= reach; dc++) for (let dr = -reach; dr <= reach; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== reach) continue
        const r = this.row(hh) + dr
        if (r < 0 || r >= this.rows) continue
        for (const i of this.cells.get(((c + dc + this.cols) % this.cols) * this.rows + r) ?? []) {
          const x = nearTurn(theta, t.theta[i * 3])
          const [x0, x1, x2] = [t.theta[i * 3], t.theta[i * 3 + 1], t.theta[i * 3 + 2]]
          const [y0, y1, y2] = [t.h[t.triangles[i * 3]], t.h[t.triangles[i * 3 + 1]], t.h[t.triangles[i * 3 + 2]]]
          const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
          if (Math.abs(det) < 1e-18) continue
          const l1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (hh - y0)) / det
          const l2 = ((x1 - x0) * (hh - y0) - (x - x0) * (y1 - y0)) / det
          const l0 = 1 - l1 - l2
          const out = Math.max(0, -l0, -l1, -l2)
          if (!best || out < best.out) best = { tri: i, l: [l0, l1, l2], out }
        }
      }
    }
    if (!best) return null
    const l = best.l.map((x) => Math.max(0, x))
    const sum = l[0] + l[1] + l[2]
    const q: Vec3 = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const v = t.triangles[best.tri * 3 + k]
      for (let x = 0; x < 3; x++) q[x] += (l[k] / sum) * t.positions[v * 3 + x]
    }
    return q
  }
}
