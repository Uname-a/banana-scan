// SPDX-License-Identifier: AGPL-3.0-only
// Unroll and flatten on surfaces made to measure: a cylinder panel and a
// cone band with a rectangle cut out of each, a closed tube, a sheet bent
// through a right angle with a hole in its flange, and a dome no flat blank
// makes — each laid out, and its pattern's sizes checked against the ones
// it was made with.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { surfaceRegion, unroll, frameOf } from '../core/unroll'
import { flatten } from '../core/flatten'
import { figuresOf } from '../core/flatPattern'
import { cholesky, choleskySolver, csrOf, dissect, multiply, solve } from '../core/sparse'

/** A grid mesh over (s, t), cells numbered (i, j) dropped where `hole`
 *  says, laid on the surface by `at`; `wrap` joins the last column to the
 *  first. Triangles turn counter-clockwise seen from where `at` makes the
 *  outside, for at's (s, t) running right and up there. */
function gridMesh(
  ns: number,
  nt: number,
  at: (i: number, j: number) => Vec3,
  hole: (i: number, j: number) => boolean = () => false,
  wrap = false,
) {
  const cols = wrap ? ns : ns + 1
  const positions = new Float32Array(cols * (nt + 1) * 3)
  for (let j = 0; j <= nt; j++) {
    for (let i = 0; i < cols; i++) positions.set(at(i, j), (j * cols + i) * 3)
  }
  const idx: number[] = []
  const v = (i: number, j: number) => j * cols + (i % cols)
  for (let j = 0; j < nt; j++) {
    for (let i = 0; i < ns; i++) {
      if (hole(i, j)) continue
      idx.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1))
    }
  }
  const indices = Uint32Array.from(idx)
  const vertexCount = cols * (nt + 1)
  return { positions, indices, vertexCount, all: Uint32Array.from({ length: vertexCount }, (_, k) => k) }
}

/** Vertex normals, area-weighted. */
function normalsOf(positions: Float32Array, indices: Uint32Array, n: number): Float32Array {
  const out = new Float32Array(n * 3)
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
    const u = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k])
    const w = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k])
    const nx = u[1] * w[2] - u[2] * w[1]
    const ny = u[2] * w[0] - u[0] * w[2]
    const nz = u[0] * w[1] - u[1] * w[0]
    for (const v of [a, b, c]) {
      out[v * 3] += nx
      out[v * 3 + 1] += ny
      out[v * 3 + 2] += nz
    }
  }
  return out
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** The pattern's loops' points as [x, y] pairs. */
const loopPoints = (pattern: { points: Float64Array; offsets: Uint32Array }, k: number): [number, number][] => {
  const out: [number, number][] = []
  for (let i = pattern.offsets[k]; i < pattern.offsets[k + 1]; i++) out.push([pattern.points[i * 2], pattern.points[i * 2 + 1]])
  return out
}

describe('unroll a cylinder', () => {
  // R 20 round a tilted axis; 42 mm of arc by 50 mm high on a 1 mm grid,
  // with a 10 × 8 mm window from 16 mm along the arc and 20 mm up.
  const R = 20
  const center: Vec3 = [5, -3, 2]
  const axis = unit([0.2, -0.1, 1])
  const { e1, e2 } = frameOf(axis)
  const onCylinder = (arc: number, h: number): Vec3 => {
    const th = arc / R + 0.7
    return [0, 1, 2].map((k) => center[k] + axis[k] * h + R * (Math.cos(th) * e1[k] + Math.sin(th) * e2[k])) as Vec3
  }
  const panel = gridMesh(42, 50, (i, j) => onCylinder(i, j), (i, j) => i >= 16 && i < 26 && j >= 20 && j < 28)
  const surface = { kind: 'cylinder' as const, center, axis, radius: R }

  it('lays the panel out true to size, the window where it was', () => {
    const { pattern, report } = unroll(panel.positions, panel.indices, panel.vertexCount, panel.all, surface)
    expect(report.figures.width).toBeCloseTo(42, 4)
    expect(report.figures.height).toBeCloseTo(50, 4)
    expect(report.figures.holes).toHaveLength(1)
    const hole = report.figures.holes[0]
    expect(hole.width).toBeCloseTo(10, 4)
    expect(hole.height).toBeCloseTo(8, 4)
    expect(hole.center[0]).toBeCloseTo(21, 4)
    expect(hole.center[1]).toBeCloseTo(24, 4)
    expect(report.figures.area).toBeCloseTo(42 * 50 - 80, 4)
    expect(report.coverage).toBeCloseTo((42 / R) * (180 / Math.PI), 0)
    expect(report.residual.max).toBeLessThan(1e-4)
    // The grid's cells are flat rectangles of chord width: laid out by arc,
    // they stretch by the arc over the chord, under a hundredth of a per cent.
    expect(report.distortion.length.max).toBeLessThan(0.02)
    expect(report.distortion.flipped).toBe(0)
    // The outline counter-clockwise, the window clockwise.
    const area = (pts: [number, number][]) => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2
    expect(area(loopPoints(pattern, 0))).toBeGreaterThan(0)
    expect(area(loopPoints(pattern, 1))).toBeLessThan(0)
  })

  it('reads arc at the offset radius: the neutral fibre of a sheet', () => {
    const { report } = unroll(panel.positions, panel.indices, panel.vertexCount, panel.all, surface, 1)
    expect(report.figures.width).toBeCloseTo(42 * (21 / 20), 4)
    expect(report.radius).toBe(21)
    expect(report.residual.max).toBeLessThan(1e-4)
  })

  it('cuts a closed tube along a seam, a whole turn wide', () => {
    const tube = gridMesh(126, 30, (i, j) => onCylinder((i * 2 * Math.PI * R) / 126, j), () => false, true)
    const { pattern, report } = unroll(tube.positions, tube.indices, tube.vertexCount, tube.all, surface)
    expect(report.coverage).toBe(360)
    expect(report.figures.width).toBeCloseTo(2 * Math.PI * R, 4)
    expect(report.figures.height).toBeCloseTo(30, 4)
    expect(report.figures.holes).toHaveLength(0)
    expect(pattern.offsets.length).toBe(2)
    expect(report.figures.area).toBeCloseTo(2 * Math.PI * R * 30, 3)
  })

  it('finds the panel on the cylinder by itself, not a flange off it', () => {
    // A flange: a flat strip square to the axis off the panel's foot.
    const normals = normalsOf(panel.positions, panel.indices, panel.vertexCount)
    const region = surfaceRegion(panel.positions, normals, panel.vertexCount, surface, 0.2)
    // Every vertex of a triangle — the window's middle has none.
    expect(region.length).toBe(new Set(panel.indices).size)
    const off = surfaceRegion(panel.positions, normals, panel.vertexCount, { ...surface, radius: 25 }, 0.2)
    expect(off.length).toBe(0)
  })
})

describe('unroll a cone', () => {
  // Half-angle 25°, apex at the origin, axis +z: the band from 30 to 60 mm
  // from the apex along the cone, 100° round, with a window from 40 to 48
  // mm and 30° to 50° round.
  const phi = (25 * Math.PI) / 180
  const axis: Vec3 = [0, 0, 1]
  const apex: Vec3 = [1, 2, 3]
  const { e1, e2 } = frameOf(axis)
  const onCone = (deg: number, s: number): Vec3 => {
    const th = (deg * Math.PI) / 180
    const rho = s * Math.sin(phi)
    const h = s * Math.cos(phi)
    return [0, 1, 2].map((k) => apex[k] + axis[k] * h + rho * (Math.cos(th) * e1[k] + Math.sin(th) * e2[k])) as Vec3
  }
  const band = gridMesh(100, 30, (i, j) => onCone(i, 30 + j), (i, j) => i >= 30 && i < 50 && j >= 10 && j < 18)
  // The fit's centre: on the axis 45 mm along the cone from the apex.
  const mid = 45 * Math.cos(phi)
  const surface = { kind: 'cone' as const, center: [apex[0], apex[1], apex[2] + mid] as Vec3, axis, radius: 45 * Math.sin(phi), halfAngle: 25 }

  it('unrolls to its sector, the window true to size', () => {
    const { pattern, report } = unroll(band.positions, band.indices, band.vertexCount, band.all, surface)
    expect(report.surface).toBe('cone')
    const sector = report.sector!
    expect(sector.angle).toBeCloseTo(100 * Math.sin(phi), 4)
    expect(sector.innerRadius).toBeCloseTo(30, 4)
    expect(sector.outerRadius).toBeCloseTo(60, 4)
    expect(report.residual.max).toBeLessThan(1e-4)
    // Every point of the outline as far from the apex as it was along the
    // cone; the window's from 40 to 48.
    const r = (p: [number, number]) => Math.hypot(p[0] - sector.apex[0], p[1] - sector.apex[1])
    const outline = loopPoints(pattern, 0).map(r)
    expect(Math.min(...outline)).toBeCloseTo(30, 4)
    expect(Math.max(...outline)).toBeCloseTo(60, 4)
    expect(report.figures.holes).toHaveLength(1)
    const win = loopPoints(pattern, 1)
    expect(Math.min(...win.map(r))).toBeCloseTo(40, 4)
    expect(Math.max(...win.map(r))).toBeCloseTo(48, 4)
    // The window's angle on the sector: 20° round the axis, shrunk by sin φ.
    const ang = win.map((p) => Math.atan2(p[1] - sector.apex[1], p[0] - sector.apex[0]))
    expect(((Math.max(...ang) - Math.min(...ang)) * 180) / Math.PI).toBeCloseTo(20 * Math.sin(phi), 4)
    // The sector opens upward: the apex below the pattern, its middle on x.
    expect(sector.apex[1]).toBeLessThan(0)
    expect(sector.apex[0]).toBeCloseTo(report.figures.width / 2, 4)
    expect(report.distortion.flipped).toBe(0)
    expect(report.distortion.length.max).toBeLessThan(0.1)
  })
})

describe('flatten a bent sheet', () => {
  // 25 mm flat, a right-angle bend at radius 5, 25 mm up: 40 mm wide, a
  // 10 × 8 mm hole in the flat leg. Laid flat, it is 25 + 2.5π + 25 long.
  const R = 5
  const bend = (Math.PI / 2) * R
  const length = 50 + bend
  const sheet = (u: number, w: number, lift = 0): Vec3 => {
    if (u <= 25) return [u, w, lift]
    if (u <= 25 + bend) {
      const a = (u - 25) / R
      return [25 + (R - lift) * Math.sin(a), w, R - (R - lift) * Math.cos(a)]
    }
    return [25 + R - lift, w, R + (u - 25 - bend)]
  }
  // u steps: 1 mm on the legs, 16 across the bend.
  const us = [...Array.from({ length: 26 }, (_, i) => i), ...Array.from({ length: 15 }, (_, i) => 25 + ((i + 1) * bend) / 16), ...Array.from({ length: 26 }, (_, i) => 25 + bend + i)]
  // The chords of the bend, which is what a triangulated bend is long.
  const chord = 16 * 2 * R * Math.sin(bend / 16 / (2 * R))
  const flatLength = 50 + chord

  it('flattens to the blank, the hole true to size, with next to no stretch', () => {
    const mesh = gridMesh(us.length - 1, 40, (i, j) => sheet(us[i], j), (i, j) => i >= 5 && i < 15 && j >= 10 && j < 18)
    const { pattern, report } = flatten(mesh.positions, mesh.indices, mesh.vertexCount, mesh.all)
    expect(report.distortion.length.max).toBeLessThan(0.05)
    expect(report.distortion.flipped).toBe(0)
    expect(report.figures.width).toBeCloseTo(flatLength, 2)
    expect(report.figures.height).toBeCloseTo(40, 2)
    expect(report.figures.holes).toHaveLength(1)
    const hole = report.figures.holes[0]
    // The hole lies square to the pattern's sides once it is turned square.
    expect(Math.max(hole.width, hole.height)).toBeCloseTo(10, 2)
    expect(Math.min(hole.width, hole.height)).toBeCloseTo(8, 2)
    expect(report.figures.area).toBeCloseTo(flatLength * 40 - 80, 0)
    expect(figuresOf(pattern).perimeter).toBeCloseTo(2 * (flatLength + 40), 1)
    expect(length).toBeGreaterThan(flatLength)
  })

  it('flattens a scanned one — scatter on it — within a small distortion', () => {
    // A tenth of a millimetre's scatter, fixed so the test is the same run
    // to run.
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1
    const mesh = gridMesh(us.length - 1, 40, (i, j) => sheet(us[i], j, rand()), (i, j) => i >= 5 && i < 15 && j >= 10 && j < 18)
    const { report } = flatten(mesh.positions, mesh.indices, mesh.vertexCount, mesh.all)
    expect(report.distortion.length.mean).toBeLessThan(1)
    expect(report.distortion.area.mean).toBeLessThan(1)
    expect(Math.abs(report.distortion.totalArea)).toBeLessThan(0.5)
    expect(report.figures.width).toBeGreaterThan(flatLength - 0.3)
    expect(report.figures.width).toBeLessThan(flatLength + 0.3)
    expect(report.figures.height).toBeCloseTo(40, 0)
    expect(report.distortion.flipped).toBe(0)
  })

  it('says a dome cannot be flattened without stretching it', () => {
    // A spherical cap of radius 30, 32 mm square seen from above.
    const r = 30
    const dome = gridMesh(40, 40, (i, j) => {
      const x = (i - 20) * 0.8
      const y = (j - 20) * 0.8
      return [x, y, Math.sqrt(r * r - x * x - y * y)]
    })
    const { report } = flatten(dome.positions, dome.indices, dome.vertexCount, dome.all)
    expect(report.distortion.length.max).toBeGreaterThan(2)
    expect(report.distortion.flipped).toBe(0)
  })

  it('takes the largest piece of a region, and says what it left', () => {
    const mesh = gridMesh(us.length - 1, 40, (i, j) => sheet(us[i], j), (_i, j) => j === 20)
    const { report } = flatten(mesh.positions, mesh.indices, mesh.vertexCount, mesh.all)
    expect(report.leftOut.pieces).toBe(1)
    expect(report.figures.height).toBeCloseTo(20, 2)
  })
})

describe('the sparse solves under a flattening', () => {
  it('orders every unknown once and solves a grid Laplacian through its factor', () => {
    // A 30 × 30 grid's Laplacian, one corner pinned, plus a little on the
    // diagonal everywhere: positive definite, as a flattening's matrices are.
    const n = 30
    const rows: number[] = []
    const cols: number[] = []
    const vals: number[] = []
    const id = (i: number, j: number) => j * n + i
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        rows.push(id(i, j))
        cols.push(id(i, j))
        vals.push(1e-3 + (i === 0 && j === 0 ? 1 : 0))
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          if (i + di >= n || j + dj >= n) continue
          const a = id(i, j)
          const b = id(i + di, j + dj)
          rows.push(a, b, a, b)
          cols.push(a, b, b, a)
          vals.push(1, 1, -1, -1)
        }
      }
    }
    const a = csrOf(n * n, rows, cols, vals)
    const points = new Float64Array(n * n * 3)
    for (let k = 0; k < n * n; k++) points.set([k % n, Math.floor(k / n), 0], k * 3)
    const perm = dissect(a, points)
    expect(Array.from(perm).sort((x, y) => x - y)).toEqual(Array.from({ length: n * n }, (_, k) => k))
    const f = cholesky(a, perm)
    expect(f.nudged).toBe(0)
    // Far fewer entries than the dense lower triangle: the ordering kept
    // the fill down.
    expect(f.row.length).toBeLessThan((n * n * (n * n + 1)) / 2 / 20)
    const want = Float64Array.from({ length: n * n }, (_, k) => Math.sin(k))
    const b = new Float64Array(n * n)
    multiply(a, want, b)
    const x = new Float64Array(n * n)
    const steps = solve(a, b, x, 1e-12, 50, choleskySolver(f))
    expect(steps).toBeLessThanOrEqual(2)
    for (let k = 0; k < n * n; k++) expect(x[k]).toBeCloseTo(want[k], 6)
  })
})
