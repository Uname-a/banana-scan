// SPDX-License-Identifier: AGPL-3.0-only
// The synthetic scans the patch network's tests draw on: a grid of (u, v)
// mapped into space — a sheet, a strip of a cylinder, a saddle — with noise
// along the normal and holes left out, and a noisy sphere. And a network
// written out as nodes and curves through grips.

import { icosphere } from '../../../tests/helpers'
import type { Vec3 } from '../../../src/core/types'
import type { NetworkCurve, NetworkFeature, NetworkNode } from '../core/features'

/** A small deterministic generator, and normal noise from it. */
export function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** A grid of nu × nv cells over [0, 1]² mapped by `at`, wound so its
 *  normals point the way `at`'s du × dv does; `wrap` closes u round;
 *  `hole` leaves out the cells it says; `noise` moves each vertex along
 *  the grid's own normal there. */
export function gridScan(nu: number, nv: number, at: (u: number, v: number) => Vec3, opts: { wrap?: boolean; hole?: (u: number, v: number) => boolean; noise?: number; seed?: number } = {}) {
  const cols = opts.wrap ? nu : nu + 1
  const rand = random(opts.seed ?? 5)
  const positions: number[] = []
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / nu
      const v = j / nv
      const p = at(u, v)
      if (opts.noise) {
        const e = 1e-4
        const pu = at(u + e, v)
        const pv = at(u, v + e)
        const du = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]]
        const dv = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]]
        const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]]
        const l = Math.hypot(n[0], n[1], n[2]) || 1
        const g = gaussian(rand) * opts.noise
        p[0] += (n[0] / l) * g
        p[1] += (n[1] / l) * g
        p[2] += (n[2] / l) * g
      }
      positions.push(...p)
    }
  }
  const indices: number[] = []
  const id = (i: number, j: number) => j * cols + (opts.wrap ? i % nu : i)
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (opts.hole?.((i + 0.5) / nu, (j + 0.5) / nv)) continue
      indices.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1))
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** A sphere of radius r about the origin with noise, closed. */
export function sphereScan(r: number, noise: number, subdivisions = 5) {
  return icosphere(subdivisions, r, noise, 3)
}

/** A network written out: nodes by id at their points, curves as
 *  [from, to, grips…] and a crease flag, seeds for the cells. */
export function network(id: number, nodes: Record<number, Vec3>, curves: { from: number; to: number; via?: Vec3[]; crease?: boolean }[], seeds: Vec3[], spans: Record<string, number> = {}): NetworkFeature {
  const ns: NetworkNode[] = Object.entries(nodes).map(([k, at]) => ({ id: Number(k), at }))
  const cs: NetworkCurve[] = curves.map((c, i) => ({ id: i + 1, from: c.from, to: c.to, via: c.via ?? [], ...(c.crease ? { crease: true } : {}) }))
  return { id, kind: 'network', name: `Network ${id}`, nodes: ns, curves: cs, cells: seeds.map((seed) => ({ seed })), spans, fit: { smoothness: 0.001 }, visible: true }
}

/** A rows × cols grid network over a surface given by `at` on [0, 1]²: its
 *  nodes on the grid's crossings, a curve along each line between two, with
 *  `grips` grips evenly along it, and a seed in every cell. */
export function gridNetwork(id: number, rows: number, cols: number, at: (u: number, v: number) => Vec3, grips = 0, box: [number, number, number, number] = [0, 1, 0, 1]): NetworkFeature {
  const [u0, u1, v0, v1] = box
  const uu = (i: number) => u0 + ((u1 - u0) * i) / cols
  const vv = (j: number) => v0 + ((v1 - v0) * j) / rows
  const nodes: Record<number, Vec3> = {}
  const nid = (i: number, j: number) => j * (cols + 1) + i + 1
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) nodes[nid(i, j)] = at(uu(i), vv(j))
  const curves: { from: number; to: number; via: Vec3[] }[] = []
  const via = (a: [number, number], b: [number, number]) => Array.from({ length: grips }, (_, k) => at(a[0] + ((b[0] - a[0]) * (k + 1)) / (grips + 1), a[1] + ((b[1] - a[1]) * (k + 1)) / (grips + 1)))
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) curves.push({ from: nid(i, j), to: nid(i + 1, j), via: via([uu(i), vv(j)], [uu(i + 1), vv(j)]) })
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) curves.push({ from: nid(i, j), to: nid(i, j + 1), via: via([uu(i), vv(j)], [uu(i), vv(j + 1)]) })
  const seeds: Vec3[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) seeds.push(at((uu(i) + uu(i + 1)) / 2, (vv(j) + vv(j + 1)) / 2))
  return network(id, nodes, curves, seeds)
}

/** A closed scan from the six faces of a cube, each an n × n grid sharing
 *  its edges with its neighbours, mapped by `at` from the cube's surface —
 *  [-1, 1]³ with one coordinate ±1 — wound outward, with noise along the
 *  vertex normals. */
export function cubeScan(n: number, at: (p: Vec3) => Vec3, opts: { noise?: number; seed?: number } = {}) {
  const index = new Map<string, number>()
  const positions: number[] = []
  const indices: number[] = []
  const vertex = (q: [number, number, number]) => {
    const key = q.join(',')
    let i = index.get(key)
    if (i === undefined) {
      i = positions.length / 3
      index.set(key, i)
      positions.push(...at([q[0] / n, q[1] / n, q[2] / n]))
    }
    return i
  }
  for (let k = 0; k < 3; k++) {
    for (const s of [-1, 1]) {
      const u = (k + 1) % 3
      const v = (k + 2) % 3
      const id = (i: number, j: number) => {
        const q: [number, number, number] = [0, 0, 0]
        q[k] = s * n
        q[u] = 2 * i - n
        q[v] = 2 * j - n
        return vertex(q)
      }
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const a = id(i, j)
          const b = id(i + 1, j)
          const c = id(i + 1, j + 1)
          const d = id(i, j + 1)
          if (s > 0) indices.push(a, b, c, a, c, d)
          else indices.push(a, c, b, a, d, c)
        }
      }
    }
  }
  if (opts.noise) {
    const normals = new Float64Array(positions.length)
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3]
      const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]]
      const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
      const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      for (const x of [a, b, c]) for (let m = 0; m < 3; m++) normals[x + m] += nn[m]
    }
    const rand = random(opts.seed ?? 7)
    for (let i = 0; i < positions.length; i += 3) {
      const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
      const g = gaussian(rand) * opts.noise
      for (let m = 0; m < 3; m++) positions[i + m] += (normals[i + m] / l) * g
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** The volume a closed mesh holds. */
export function meshVolume(m: { positions: Float32Array; indices: Uint32Array }): number {
  const p = m.positions
  let v = 0
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3]
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
  }
  return v / 6
}

/** A rectangle of half-sides a, b with its corners rounded to r, in the
 *  plane: its point a share u of the way round, counter-clockwise from the
 *  middle of its +x side; the shares at the middles of its four corners;
 *  and the signed distance of (x, y) from it. */
export function roundedRect(a: number, b: number, r: number) {
  type Piece = { length: number; at: (t: number) => [number, number] }
  const line = (p: [number, number], q: [number, number]): Piece => ({ length: Math.hypot(q[0] - p[0], q[1] - p[1]), at: (t) => [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] })
  const arc = (c: [number, number], from: number): Piece => ({ length: (Math.PI * r) / 2, at: (t) => [c[0] + r * Math.cos(from + (t * Math.PI) / 2), c[1] + r * Math.sin(from + (t * Math.PI) / 2)] })
  const pieces = [
    line([a, 0], [a, b - r]),
    arc([a - r, b - r], 0),
    line([a - r, b], [-a + r, b]),
    arc([-a + r, b - r], Math.PI / 2),
    line([-a, b - r], [-a, -b + r]),
    arc([-a + r, -b + r], Math.PI),
    line([-a + r, -b], [a - r, -b]),
    arc([a - r, -b + r], (3 * Math.PI) / 2),
    line([a, -b + r], [a, 0]),
  ]
  const perimeter = pieces.reduce((s, p) => s + p.length, 0)
  const at = (u: number): [number, number] => {
    let d = (((u % 1) + 1) % 1) * perimeter
    for (const p of pieces) {
      if (d <= p.length) return p.at(p.length > 0 ? d / p.length : 0)
      d -= p.length
    }
    return pieces[pieces.length - 1].at(1)
  }
  const corners: number[] = []
  let s = 0
  pieces.forEach((p, i) => {
    if (i % 2 === 1) corners.push((s + p.length / 2) / perimeter)
    s += p.length
  })
  const signed = (x: number, y: number) => {
    const qx = Math.abs(x) - (a - r)
    const qy = Math.abs(y) - (b - r)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
  return { perimeter, at, corners, signed }
}

/** A box 2a × 2b × h scanned closed: its upright edges rounded to r, its
 *  top and bottom rims sharp, its top domed up by `dome` in the middle
 *  (and its rim with it, a little, where the rounds are);
 *  a cube's grid of n a face mapped onto it — a square's ring onto the
 *  rounded rectangle's, its corners onto the middles of the rounds. */
export function roundedBoxScan(a: number, b: number, h: number, r: number, dome: number, n: number, noise = 0.01) {
  const rect = roundedRect(a, b, r)
  const knots = [0, 1 / 8, 3 / 8, 5 / 8, 7 / 8, 1]
  const mapped = [0, ...rect.corners, 1]
  /** The share round the square's ring of its point (x, y), from (1, 0)
   *  counter-clockwise, as a share round the rounded rectangle. */
  const round = (x: number, y: number) => {
    let d: number
    if (x >= 1 && y >= 0) d = y
    else if (y >= 1) d = 1 + (1 - x)
    else if (x <= -1) d = 3 + (1 - y)
    else if (y <= -1) d = 5 + (x + 1)
    else d = 7 + (y + 1)
    const s = d / 8
    let k = 0
    while (k < knots.length - 2 && s > knots[k + 1]) k++
    return mapped[k] + ((s - knots[k]) / (knots[k + 1] - knots[k])) * (mapped[k + 1] - mapped[k])
  }
  /** The top's height over the rectangle: h, domed up in its middle. */
  const top = (x: number, y: number) => h + dome * Math.max(0, 1 - (x / a) ** 2) * Math.max(0, 1 - (y / b) ** 2)
  const mesh = cubeScan(
    n,
    ([x, y, z]) => {
      const m = Math.max(Math.abs(x), Math.abs(y))
      if (Math.abs(z) >= 1 - 1e-12) {
        if (m === 0) return [0, 0, z > 0 ? top(0, 0) : 0]
        const [qx, qy] = rect.at(round(x / m, y / m))
        return [m * qx, m * qy, z > 0 ? top(m * qx, m * qy) : 0]
      }
      const [qx, qy] = rect.at(round(x, y))
      return [qx, qy, ((z + 1) / 2) * top(qx, qy)]
    },
    { noise },
  )
  return { ...mesh, rect }
}

/** A blended box with no crease: the superellipsoid |x/a|^e + |y/b|^e +
 *  |z/c|^e = 1, a cube's grid of n a face cast onto it from the middle. */
export function blendedBoxScan(a: number, b: number, c: number, e: number, n: number, noise = 0.01) {
  return cubeScan(
    n,
    ([x, y, z]) => {
      const l = Math.hypot(x, y, z)
      const d = [x / l, y / l, z / l]
      const t = (Math.abs(d[0] / a) ** e + Math.abs(d[1] / b) ** e + Math.abs(d[2] / c) ** e) ** (-1 / e)
      return [t * d[0], t * d[1], t * d[2]]
    },
    { noise },
  )
}

/** A box with sharp edges whose top is a low roof along x that fades out
 *  both ways: a fold of `deg` along y = 0 for |x| up to a / 4, flattening
 *  to none over the next `fadeMm` mm — a crease that ends in the middle of
 *  the face at both ends, the top's rims straight. */
export function fadingFoldScan(a: number, b: number, h: number, deg: number, fadeMm: number, n: number, noise = 0.01) {
  const s0 = Math.tan(((deg / 2) * Math.PI) / 180)
  const fade = (x: number) => {
    const t = Math.min(1, Math.max(0, (Math.abs(x) - a / 4) / fadeMm))
    return 1 - t * t * (3 - 2 * t)
  }
  const top = (x: number, y: number) => h + s0 * fade(x) * (b - Math.abs(y))
  return cubeScan(
    n,
    ([x, y, z]) => {
      const px = a * x
      const py = b * y
      if (z >= 1 - 1e-12) return [px, py, top(px, py)]
      if (z <= -1 + 1e-12) return [px, py, 0]
      return [px, py, ((z + 1) / 2) * top(px, py)]
    },
    { noise },
  )
}
