// SPDX-License-Identifier: AGPL-3.0-only
// How a body made over a region of the scan (regionMesh.ts) follows it: the
// scan's surface there against the body, and the body's, outside its skirts,
// against the scan.

import { emptyHit, NominalSurface } from '../../../src/core/deviation/surface'
import type { Vec3 } from '../../../src/core/types'
import { OF_SCAN, type RegionMesh, type RegionPlane } from './regionMesh'

export interface RegionDeviation {
  /** Places of the scan read, evenly by area. */
  points: number
  rms: number
  p95: number
  max: number
  /** The share of the scan's surface within each distance asked. */
  within: { mm: number; share: number }[]
  /** Where it is furthest off, the places apart. */
  worst: { at: Vec3; off: number }[]
  /** The body's own surface, off the scan: what it has that the scan has
   *  not. */
  back: { points: number; rms: number; p95: number; max: number }
}

const SAMPLES = 20_000
const WORST = 4

interface Sample {
  at: Vec3
  off: number
}

/** The middles of the triangles taken evenly by area, `off` a surface. */
function read(m: { positions: ArrayLike<number>; indices: ArrayLike<number> }, take: (triangle: number, at: Vec3) => boolean, against: { positions: ArrayLike<number>; indices: ArrayLike<number> }): Sample[] {
  const s = new NominalSurface(Float32Array.from(against.positions), Uint32Array.from(against.indices))
  const hit = emptyHit()
  const p = m.positions
  const area = (t: number) => {
    const [a, b, c] = [0, 1, 2].map((k) => m.indices[t * 3 + k] * 3)
    const u = [0, 1, 2].map((x) => p[b + x] - p[a + x])
    const v = [0, 1, 2].map((x) => p[c + x] - p[a + x])
    return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2
  }
  const list: { t: number; at: Vec3; a: number }[] = []
  let total = 0
  for (let t = 0; t < m.indices.length / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => m.indices[t * 3 + k] * 3)
    const at = [0, 1, 2].map((x) => (p[a + x] + p[b + x] + p[c + x]) / 3) as Vec3
    if (!take(t, at)) continue
    const own = area(t)
    list.push({ t, at, a: own })
    total += own
  }
  const each = total / Math.min(SAMPLES, Math.max(1, list.length))
  const out: Sample[] = []
  let carried = each / 2
  for (const x of list) {
    carried += x.a
    while (carried >= each) {
      carried -= each
      if (s.closest(x.at[0], x.at[1], x.at[2], hit)) out.push({ at: x.at, off: hit.distance })
      if (x.a < each) break
    }
  }
  return out
}

/** A body's mesh against the region it was made over. */
export function regionDeviation(m: RegionMesh, planes: readonly RegionPlane[], body: { positions: ArrayLike<number>; indices: ArrayLike<number> }, tolerances: readonly number[]): RegionDeviation {
  const on = read(m, (t) => m.of[t] === OF_SCAN, body)
  // The body's surface clear of the planes: its skirts and caps are its own.
  const clear = (q: Vec3) => planes.every((w) => (q[0] - w.origin[0]) * w.normal[0] + (q[1] - w.origin[1]) * w.normal[1] + (q[2] - w.origin[2]) * w.normal[2] > m.edge)
  const back = read(body, (_, at) => clear(at), m)
  const stats = (s: readonly Sample[]) => {
    const d = s.map((x) => x.off).sort((a, b) => a - b)
    return { points: d.length, rms: Math.sqrt(d.reduce((a, x) => a + x * x, 0) / Math.max(1, d.length)), p95: d[Math.floor(d.length * 0.95)] ?? 0, max: d[d.length - 1] ?? 0 }
  }
  const worst: Sample[] = []
  const size = Math.hypot(m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2])
  for (const x of [...on].sort((a, b) => b.off - a.off)) {
    if (worst.length >= WORST) break
    if (worst.every((w) => Math.hypot(w.at[0] - x.at[0], w.at[1] - x.at[1], w.at[2] - x.at[2]) > size / 12)) worst.push(x)
  }
  return { ...stats(on), within: tolerances.map((mm) => ({ mm, share: on.filter((x) => x.off <= mm).length / Math.max(1, on.length) })), worst, back: stats(back) }
}
