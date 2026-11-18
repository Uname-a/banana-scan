// SPDX-License-Identifier: AGPL-3.0-only
// scan.curvature: curvature shading switched on by an agent and read back in
// numbers — the shares of the part that are flat, convex and concave, the
// tightest rounds, and the bends at a place. In the in-process worker
// (commandKit.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useCurvature } from '../src/state/curvatureStore'
import { useShell } from '../src/state/shellStore'
import { boxMesh, cylinderMesh, icosphere } from './helpers'
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from './commandKit'

type Vec3 = [number, number, number]

interface Answer {
  shown: boolean
  workspace: string
  quantity: string
  radius: number
  radiusAuto: boolean
  spacing: number
  range: { curvature: number; radius: number; auto: boolean }
  flatRadius: number
  flatAuto: boolean
  noise: number
  noiseFloor: number
  shares: { flat: number; convex: number; concave: number; saddle: number; unread?: number }
  tightest: { convexRadius: number | null; concaveRadius: number | null }
  at?: { vertex: number; k1: number; k2: number; r1: number | null; r2: number | null; shape: string; dir1: Vec3; dir2: Vec3; points: number; rms: number }
}

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

describe('scan.curvature', () => {
  it('refuses without a scan', async () => {
    expect((await refused('scan.curvature')).code).toBe('no_scan')
  })

  it('reads a cylinder: its wall convex at 1/R round and straight along', async () => {
    useShell.getState().setWorkspace('deviation')
    const { positions } = cylinderMesh(5, 30, 96, 60, 0.01)
    await run('scan.open', { bytes: stlBytes(positions), name: 'cylinder.stl', discard: true })
    const a = await run<Answer>('scan.curvature', { radius: 1.5, at: { point: [5, 0, 2] } })
    // Shown, and its workspace put on screen.
    expect(a.shown).toBe(true)
    expect(a.workspace).toBe('measure')
    expect(useShell.getState().workspace).toBe('elements')
    expect(useCurvature.getState().values).not.toBeNull()
    expect(a.radius).toBeCloseTo(1.5, 9)
    expect(a.radiusAuto).toBe(false)
    expect(a.at!.shape).toBe('convex')
    // One fit on 0.01 mm of scatter: within a few hundredths.
    expect(Math.abs(a.at!.k1 - 0.2)).toBeLessThan(0.03)
    expect(Math.abs(a.at!.k2)).toBeLessThan(0.03)
    expect(a.at!.r1!).toBeGreaterThan(4.3)
    expect(a.at!.r1!).toBeLessThan(5.8)
    // Round the axis, and along it.
    expect(Math.abs(a.at!.dir1[2])).toBeLessThan(0.1)
    expect(Math.abs(a.at!.dir2[2])).toBeGreaterThan(0.99)
    // The wall is two thirds of the area of a 30 × ⌀10 cylinder (π·10·30
    // against 2·π·25); its rims, read over the sharp edge, are convex too.
    expect(a.shares.convex).toBeGreaterThan(0.6)
    expect(a.shares.concave).toBeLessThan(0.02)
    // Nothing concave but the quadric straddling the sharp rims, gently.
    expect(a.tightest.concaveRadius === null || a.tightest.concaveRadius > 20).toBe(true)
    expect(a.tightest.convexRadius!).toBeLessThan(5)
  })

  it('reads a block as flats, with its edges convex', async () => {
    await run('scan.open', { bytes: stlBytes(boxMesh(20, 80, 0.01)), name: 'block.stl', discard: true })
    const a = await run<Answer>('scan.curvature', { radius: null, at: { point: [0, 0, 10] } })
    expect(a.radiusAuto).toBe(true)
    expect(a.at!.shape).toBe('flat')
    expect(a.at!.r1 === null || a.at!.r1 > 100).toBe(true)
    // The faces, but for a band about a radius wide along each edge.
    expect(a.shares.flat).toBeGreaterThan(0.4)
    expect(a.shares.convex).toBeGreaterThan(0.1)
    expect(a.shares.concave).toBeLessThan(0.05)
  })

  it('reads a ball as convex all over, and as concave with nothing to show', async () => {
    await run('scan.open', { bytes: stlBytes(soupOf(icosphere(4, 10, 0.01))), name: 'ball.stl', discard: true })
    const a = await run<Answer>('scan.curvature', { quantity: 'gaussian', rangeRadius: 8, flatRadius: 50 })
    expect(a.quantity).toBe('gaussian')
    expect(a.shares.convex).toBeGreaterThan(0.99)
    expect(a.range.radius).toBeCloseTo(8, 6)
    expect(a.range.auto).toBe(false)
    expect(a.flatRadius).toBe(50)
    // Back to the radius the mesh gives, and switched off.
    const b = await run<Answer>('scan.curvature', { radius: null, rangeRadius: null, show: false })
    expect(b.shown).toBe(false)
    expect(b.radiusAuto).toBe(true)
    // Eight edge lengths or more, as the scan's scatter asks.
    expect(b.radius).toBeGreaterThanOrEqual(8 * b.spacing * (1 - 1e-6))
    expect(b.noise).toBeGreaterThan(0)
    expect(b.flatAuto).toBe(false) // 50 is still set
    expect(b.radius).toBeLessThan(24 * b.spacing)
    expect(b.range.auto).toBe(true)
    expect(b.shares.convex).toBeGreaterThan(0.99)
  })
})
