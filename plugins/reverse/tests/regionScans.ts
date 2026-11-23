// SPDX-License-Identifier: AGPL-3.0-only
// The synthetic scans a freeform body's tests are made over: shapes given by
// their distance, meshed evenly by Manifold's level set and moved off by
// noise along the surface — a bent round bar, a blob and an arm, on a plate.

import type { Vec3 } from '../../../src/core/types'
import { loadManifold } from './reLocal'
import { gaussian, random } from './networkMeshes'

export type Sdf = (p: Vec3) => number

const len = (...v: number[]) => Math.hypot(...v)

/** The plate all of them stand on: its top at z = 0. */
export const PLATE: { min: Vec3; max: Vec3 } = { min: [-14, -14, -4], max: [22, 22, 0] }

function box(min: Vec3, max: Vec3): Sdf {
  return (p) => {
    const q = [0, 1, 2].map((k) => Math.max(min[k] - p[k], p[k] - max[k]))
    return len(...q.map((x) => Math.max(0, x))) + Math.min(0, Math.max(...q))
  }
}

/** Two shapes joined with a blend of about r between them. */
function joined(a: Sdf, b: Sdf, r: number): Sdf {
  return (p) => {
    const x = a(p)
    const y = b(p)
    const h = Math.max(0, r - Math.abs(x - y))
    return Math.min(x, y) - (h * h) / (4 * r)
  }
}

export const plate = box(PLATE.min, PLATE.max)

/** A bar of radius 2 mm: up 5, bent over 4 mm round, along x 5, bent again in
 *  the level, along y 5, its end flat. */
export const BAR_RADIUS = 2
const line: Vec3[] = []
{
  const arc = (c: Vec3, from: (t: number) => Vec3) => {
    for (let i = 0; i <= 60; i++) line.push(from((i / 60) * (Math.PI / 2)).map((x, k) => x + c[k]) as Vec3)
  }
  line.push([0, 0, -2])
  arc([4, 0, 5], (t) => [-4 * Math.cos(t), 0, 4 * Math.sin(t)])
  arc([9, 4, 9], (t) => [4 * Math.sin(t), -4 * Math.cos(t), 0])
  line.push([13, 9, 9])
}
export const bar: Sdf = (p) => {
  let best = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]
    const d = [0, 1, 2].map((k) => line[i + 1][k] - a[k])
    const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2))
    best = Math.min(best, len(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1], p[2] - a[2] - t * d[2]))
  }
  return Math.max(best - BAR_RADIUS, p[1] - 8)
}

/** A lump: two balls run together. */
export const blob: Sdf = joined(
  (p) => len(p[0], p[1], (p[2] - 1) * 1.25) - 8,
  (p) => len(p[0] - 5, p[1] - 4, p[2] - 4) - 4.5,
  3,
)

/** A post with an arm off its side. */
export const arm: Sdf = joined(
  (p) => Math.max(len(p[0], p[1]) - 4, p[2] - 18),
  (p) => Math.max(len(p[1], p[2] - 10) - 2.2, Math.abs(p[0] - 6) - 8),
  1.5,
)

/** A loop standing on the plate: a handle, with a hole through it. */
export const loop: Sdf = (p) => len(len(p[0], p[2] - 2) - 7, p[1]) - 2

export interface Scan {
  positions: Float32Array
  indices: Uint32Array
}

/** A shape as a scan, its triangles' sides about `edge` mm. */
export async function scanOf(shape: Sdf, edge: number, noise: number, min: Vec3 = [-15, -15, -5], max: Vec3 = [23, 23, 20]): Promise<Scan> {
  const { Manifold } = await loadManifold()
  const made = Manifold.levelSet((p) => -shape([p[0], p[1], p[2]]), { min, max }, edge, 0, 0.001)
  const mesh = made.getMesh()
  const n = mesh.numVert
  const positions = new Float32Array(n * 3)
  const rand = random(11)
  const e = 1e-3
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map((k) => mesh.vertProperties[i * mesh.numProp + k]) as Vec3
    const g = [0, 1, 2].map((k) => shape(p.map((x, j) => (j === k ? x + e : x)) as Vec3) - shape(p.map((x, j) => (j === k ? x - e : x)) as Vec3))
    const l = len(...g) || 1
    const off = noise * gaussian(rand)
    for (let k = 0; k < 3; k++) positions[i * 3 + k] = p[k] + (off * g[k]) / l
  }
  made.delete()
  return { positions, indices: Uint32Array.from(mesh.triVerts) }
}

/** A shape on the plate, with a small blend at its foot. */
export const onPlate = (shape: Sdf): Sdf => joined(shape, plate, 0.6)
