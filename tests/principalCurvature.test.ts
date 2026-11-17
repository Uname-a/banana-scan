// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import {
  autoCurvatureRange,
  classifyCurvature,
  curvatureOf,
  curvatureShares,
  CurvatureFitter,
  curvatureNoise,
  defaultCurvatureRadius,
  meshSpacing,
  noiseRadius,
  principalCurvatures,
} from '../src/core/geometry/principalCurvature'
import { cylinderMesh, gaussian, icosphere } from './helpers'
import { mulberry32 } from '../src/core/fit/ransac'

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** A flat square sheet in z = 0, `n` × `n` squares of `size` mm, each split
 *  in two, its vertices scattered along z by `noise` mm. */
function sheet(size: number, n: number, noise = 0, seed = 5) {
  const rand = mulberry32(seed)
  const positions = new Float32Array((n + 1) * (n + 1) * 3)
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const o = (j * (n + 1) + i) * 3
      positions[o] = (i / n - 0.5) * size
      positions[o + 1] = (j / n - 0.5) * size
      positions[o + 2] = noise * gaussian(rand)
    }
  const indices: number[] = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1)
    }
  return { positions, indices: Uint32Array.from(indices) }
}

function graphOf(m: { positions: Float32Array; indices: Uint32Array }) {
  return buildMeshGraph({ kind: 'indexed', positions: m.positions, indices: m.indices })
}

describe('principal curvatures by quadric fit', () => {
  it('reads 1/R both ways on a ball, convex positive', () => {
    const g = graphOf(icosphere(4, 10))
    const { k1, k2 } = principalCurvatures(g, { radius: 2 })
    for (let v = 0; v < g.vertexCount; v++) {
      expect(Math.abs(k1[v] - 0.1)).toBeLessThan(0.002)
      expect(Math.abs(k2[v] - 0.1)).toBeLessThan(0.002)
    }
  })

  it('reads 1/R on a noisy ball, within a few per cent', () => {
    // 0.02 mm of scatter on edges of about 0.35 mm — more than enough to
    // swamp a one-ring reading — read over a 2 mm ball.
    const g = graphOf(icosphere(5, 10, 0.02))
    const { k1, k2 } = principalCurvatures(g, { radius: 2 })
    const both = [...Array.from(k1), ...Array.from(k2)]
    expect(median(both)).toBeCloseTo(0.1, 2)
    const off = both.map((k) => Math.abs(k - 0.1))
    expect(median(off)).toBeLessThan(0.01)
    // Nine in ten within a fifth of the true curvature.
    expect([...off].sort((a, b) => a - b)[Math.floor(off.length * 0.9)]).toBeLessThan(0.02)
  })

  it('is negative inside a hollow: the ball with its normals turned in', () => {
    const g = graphOf(icosphere(4, 10))
    for (let i = 0; i < g.normals.length; i++) g.normals[i] = -g.normals[i]
    const { k1, k2 } = principalCurvatures(g, { radius: 2 })
    expect(Math.abs(k1[0] + 0.1)).toBeLessThan(0.002)
    expect(Math.abs(k2[0] + 0.1)).toBeLessThan(0.002)
    expect(classifyCurvature(k1[0], k2[0], 0.01)).toBe('concave')
  })

  for (const noise of [0, 0.02]) {
    it(`reads 1/R and 0 on a cylinder wall${noise ? ', noisy' : ''}`, () => {
      const { positions } = cylinderMesh(5, 30, 96, 60, noise)
      const g = buildMeshGraph({ kind: 'soup', positions })
      const { k1, k2 } = principalCurvatures(g, { radius: 1.5 })
      const big: number[] = []
      const small: number[] = []
      for (let v = 0; v < g.vertexCount; v++) {
        const x = g.positions[v * 3], y = g.positions[v * 3 + 1], z = g.positions[v * 3 + 2]
        // The wall, away from the rims where it meets the caps.
        if (Math.abs(z) < 12 && Math.abs(Math.hypot(x, y) - 5) < 0.2) {
          big.push(k1[v])
          small.push(k2[v])
        }
      }
      expect(big.length).toBeGreaterThan(1000)
      expect(median(big)).toBeCloseTo(0.2, 2)
      expect(Math.abs(median(small))).toBeLessThan(0.005)
      if (!noise) {
        for (const k of big) expect(k).toBeCloseTo(0.2, 2)
        for (const k of small) expect(Math.abs(k)).toBeLessThan(0.005)
      } else {
        expect(median(big.map((k) => Math.abs(k - 0.2)))).toBeLessThan(0.015)
        expect(median(small.map((k) => Math.abs(k)))).toBeLessThan(0.015)
      }
    })
  }

  it('reads nothing on a plane, noisy or not, out to its rim', () => {
    for (const noise of [0, 0.02]) {
      const g = graphOf(sheet(40, 120, noise))
      const { k1, k2 } = principalCurvatures(g, { radius: 2 })
      const all = [...Array.from(k1), ...Array.from(k2)]
      // Every vertex is read — the rim included, on its half a ball.
      expect(all.every((k) => Number.isFinite(k))).toBe(true)
      if (!noise) for (const k of all) expect(Math.abs(k)).toBeLessThan(1e-4)
      else {
        expect(median(all.map(Math.abs))).toBeLessThan(0.006)
        expect(Math.abs(median(all))).toBeLessThan(0.002)
      }
    }
  })

  it('gives the bend directions at a point: round the cylinder, and along it', () => {
    const { positions } = cylinderMesh(5, 30, 96, 60)
    const g = buildMeshGraph({ kind: 'soup', positions })
    let v = 0
    for (; v < g.vertexCount; v++) {
      const x = g.positions[v * 3], y = g.positions[v * 3 + 1], z = g.positions[v * 3 + 2]
      if (Math.abs(z) < 3 && Math.abs(Math.hypot(x, y) - 5) < 1e-3) break
    }
    const fitter = new CurvatureFitter(g, 1.5, meshSpacing(g.positions, g.indices))
    const fit = fitter.fitAt(v)!
    expect(fit.k1).toBeCloseTo(0.2, 2)
    expect(Math.abs(fit.k2)).toBeLessThan(0.005)
    // The bend of 1/R runs round the axis (z), the straight one along it.
    expect(Math.abs(fit.dir1[2])).toBeLessThan(0.05)
    expect(Math.abs(fit.dir2[2])).toBeGreaterThan(0.99)
    expect(fit.points).toBeGreaterThan(30)
    expect(fit.rms).toBeLessThan(0.01)
  })

  it('reads a large ball off a share of its points, as true', () => {
    const g = graphOf(icosphere(5, 10))
    const spacing = meshSpacing(g.positions, g.indices)
    // A ball of 5 mm holds some 800 vertices here; it is read off fewer.
    const { k1, k2 } = principalCurvatures(g, { radius: 5 })
    expect(median(Array.from(k1))).toBeCloseTo(0.1, 2)
    expect(median(Array.from(k2))).toBeCloseTo(0.1, 2)
    expect(defaultCurvatureRadius(spacing)).toBeCloseTo(8 * spacing, 9)
  })

  it('splits a part by area: flat, convex, concave, saddle', () => {
    // Four vertices of equal area, one of each.
    const k1 = Float32Array.from([0, 0.2, 0.001, 0.2, NaN])
    const k2 = Float32Array.from([0, 0.1, -0.3, -0.2, NaN])
    const area = Float32Array.from([1, 1, 1, 1, 1])
    const s = curvatureShares(k1, k2, area, 0.01)
    expect(s.flat).toBeCloseTo(0.25, 9)
    expect(s.convex).toBeCloseTo(0.25, 9)
    expect(s.concave).toBeCloseTo(0.25, 9)
    expect(s.saddle).toBeCloseTo(0.25, 9)
    expect(s.unread).toBeCloseTo(0.2, 9)
    expect(curvatureOf(0.2, -0.3, 'principal')).toBeCloseTo(-0.3, 9)
    expect(curvatureOf(0.2, -0.3, 'mean')).toBeCloseTo(-0.05, 9)
    expect(curvatureOf(0.2, -0.3, 'gaussian')).toBeCloseTo(-0.06, 9)
    // The range: what nine in ten stay under, never under a part-sized round.
    expect(autoCurvatureRange(Float32Array.from([0, 0, 0]), Float32Array.from([0, 0, 0]), 100)).toBeCloseTo(0.02, 9)
  })

  it('widens the default radius on a noisy scan, and says what its scatter reads', () => {
    // A clean mesh is read at eight edge lengths; one with scatter wider, till
    // the scatter reads under a twentieth of a round as tight as the radius.
    expect(noiseRadius(0.3, 0)).toBeCloseTo(2.4, 9)
    const r = noiseRadius(0.12, 0.05)
    expect(r).toBeGreaterThan(0.96)
    expect(curvatureNoise(r, 0.12, 0.02) * r).toBeLessThanOrEqual(0.05 + 1e-9)
    // The floor it names holds on a noisy sheet: nine vertices in ten read
    // under it, give or take the estimate's spread.
    const g = graphOf(sheet(20, 160, 0.06))
    const read = principalCurvatures(g)
    expect(read.noise).toBeGreaterThan(0.04)
    expect(read.noise).toBeLessThan(0.07)
    expect(read.radius).toBeGreaterThan(8 * read.spacing)
    const all = Array.from(read.k1).map((k, i) => Math.max(Math.abs(k), Math.abs(read.k2[i]))).sort((a, b) => a - b)
    const p90 = all[Math.floor(all.length * 0.9)]
    expect(p90).toBeLessThan(1.5 * read.noiseFloor)
    expect(p90).toBeGreaterThan(0.5 * read.noiseFloor)
    // With flat at 1.5 times the floor, the sheet reads flat.
    expect(curvatureShares(read.k1, read.k2, read.area, 1.5 * read.noiseFloor).flat).toBeGreaterThan(0.9)
  })
})
