// SPDX-License-Identifier: AGPL-3.0-only
// A patch network laid out by itself (networkAuto.ts), on closed synthetic
// parts with 0.01 mm of noise, built through the kernel:
//
// - a 40 × 30 × 20 box, its top domed 3 mm, every edge sharp: its twelve
//   creases and nothing else, six four-sided cells with their corners on
//   the box's;
// - the same with its upright edges rounded to 4 mm: its two rims as
//   creases, the side wall between them cut down the middles of the four
//   rounds, the top and bottom given the cuts' ends as corners;
// - a can, Ø30 × 20 with a domed top: two circular rims, cut into four
//   sides that share their corners with the top and the bottom;
// - a blended box (a superellipsoid, no crease at all): laid out as a box,
//   a corner node on each corner blend.
//
// Each comes out a closed solid of six faces within 0.1 % of the scan's
// volume, every patch within 2.5 times the noise RMS and 0.1 mm at its
// worst point, tangent across every curve not a crease within 0.01°. What
// it does not reach is measured too: where three tangent patches meet at a
// corner of the blended box they are held near tangent, about 5° apart,
// not tangent; and curvature is not held across a curve at all. An open
// sheet is left out, and said why.

import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import { Builder } from '../core/build'
import type { NetworkFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { type AutoLayout, autoLayout } from '../core/networkAuto'
import { traceCurve } from '../core/networkCurve'
import { blendedBoxScan, gridScan, meshVolume, roundedBoxScan } from './networkMeshes'
import { build } from './reKit'

const kernelPromise = ReKernel.load()
const NOISE = 0.01

const sharp = roundedBoxScan(20, 15, 20, 0, 3, 60, NOISE)
const rounded = roundedBoxScan(20, 15, 20, 4, 3, 60, NOISE)
const can = roundedBoxScan(15, 15, 20, 15, 3, 50, NOISE)
const blended = blendedBoxScan(20, 15, 10, 4, 50, NOISE)

const scanOf = (m: { positions: Float32Array; indices: Uint32Array }) => new ScanPaths(m.positions, m.indices)

/** A curve's path on the scan, as the network traces it. */
function traced(scan: ScanPaths, l: AutoLayout, c: AutoLayout['curves'][number]): Float32Array {
  const at = new Map(l.nodes.map((n) => [n.id, n.at]))
  return traceCurve(scan, [at.get(c.from)!, ...c.via, at.get(c.to)!]).points
}

function worst(points: ArrayLike<number>, off: (x: number, y: number, z: number) => number): number {
  let w = 0
  for (let i = 0; i < points.length; i += 3) w = Math.max(w, off(points[i], points[i + 1], points[i + 2]))
  return w
}

async function built(m: { positions: Float32Array; indices: Uint32Array }, l: AutoLayout) {
  const k = await kernelPromise
  const f: NetworkFeature = { id: 1, kind: 'network', name: 'Auto', nodes: l.nodes, curves: l.curves, cells: l.cells, spans: {}, fit: { smoothness: 0.001 }, visible: true }
  const b = new Builder(k)
  b.setScan(new NominalSurface(m.positions, m.indices), m.positions)
  const out = await build(b, [f])
  const r = out.results.find((x) => x.id === 1)!
  expect(r.status, r.message).toBe('ok')
  return { report: r.network!, body: out.bodies.find((x) => x.id === 1)! }
}

/** What every part comes to: a closed solid of six faces holding the
 *  scan's volume, its patches on the scan and tangent across its tangent
 *  curves; the creases folded. */
async function closesWithin(m: { positions: Float32Array; indices: Uint32Array }, l: AutoLayout) {
  const { report, body } = await built(m, l)
  expect(report.patches.length).toBe(6)
  expect(report.closed).toBe(true)
  expect(body.closed).toBe(true)
  expect(body.faces).toBe(6)
  expect(Math.abs(body.volume / meshVolume(m) - 1)).toBeLessThan(0.001)
  for (const p of report.patches) {
    expect(p.rms).toBeLessThan(2.5 * NOISE)
    expect(p.max).toBeLessThan(0.1)
  }
  expect(report.worstAngle).toBeLessThan(0.01)
  for (const c of report.curves) if (c.crease) expect(c.angle).toBeGreaterThan(60)
  return report
}

describe('a patch network laid out by itself', () => {
  it('takes a sharp box’s twelve edges as its creases and fills its six faces', async () => {
    const l = autoLayout(scanOf(sharp))
    expect(l.creases).toBe(12)
    expect(l.cuts).toBe(0)
    expect(l.curves.every((c) => c.crease)).toBe(true)
    expect(l.made.map((c) => c.sides)).toEqual([4, 4, 4, 4, 4, 4])
    expect(l.left).toEqual([])
    expect(l.regions.every((r) => r.kind === 'disk' && r.action === 'cell')).toBe(true)
    // Every node on a corner of the box.
    expect(l.nodes.length).toBe(8)
    for (const n of l.nodes) expect(Math.hypot(Math.abs(n.at[0]) - 20, Math.abs(n.at[1]) - 15, Math.min(Math.abs(n.at[2]), Math.abs(n.at[2] - 20)))).toBeLessThan(0.1)
    await closesWithin(sharp, l)
  })

  it('cuts a side wall between two sharp rims down the middles of its rounds', async () => {
    const scan = scanOf(rounded)
    const l = autoLayout(scan)
    expect(l.creases).toBe(8)
    expect(l.cuts).toBe(4)
    expect(l.made.map((c) => c.sides)).toEqual([4, 4, 4, 4, 4, 4])
    expect(l.regions.map((r) => r.kind).sort()).toEqual(['disk', 'disk', 'ring'])
    const middles = rounded.rect.corners.map((u) => rounded.rect.at(u))
    for (const c of l.curves) {
      const p = traced(scan, l, c)
      if (c.crease) {
        // A crease on a rim, all along.
        expect(worst(p, (x, y, z) => Math.hypot(rounded.rect.signed(x, y), Math.min(Math.abs(z), Math.max(0, 20 - z))))).toBeLessThan(0.1)
      } else {
        // A cut straight down the middle of one round, rim to rim.
        const mid = middles.reduce((a, b) => (Math.hypot(p[0] - b[0], p[1] - b[1]) < Math.hypot(p[0] - a[0], p[1] - a[1]) ? b : a))
        expect(worst(p, (x, y) => Math.hypot(x - mid[0], y - mid[1]))).toBeLessThan(0.15)
        expect(Math.min(p[2], p[p.length - 1])).toBeLessThan(0.1)
        expect(Math.max(p[2], p[p.length - 1])).toBeGreaterThan(19.9)
      }
    }
    await closesWithin(rounded, l)
  })

  it('gives a can’s top, bottom and sides the same four corners', async () => {
    const l = autoLayout(scanOf(can))
    expect(l.creases).toBe(8)
    expect(l.cuts).toBe(4)
    expect(l.made.map((c) => c.sides)).toEqual([4, 4, 4, 4, 4, 4])
    // The top's and the bottom's corners are the cuts' ends there.
    const z = new Map(l.nodes.map((n) => [n.id, n.at[2]]))
    const ends = l.curves.filter((c) => !c.crease).flatMap((c) => [c.from, c.to])
    expect(new Set(ends).size).toBe(8)
    for (const [low, cap] of [
      [true, l.cells.find((c) => c.seed[2] < 1)],
      [false, l.cells.find((c) => c.seed[2] > 21)],
    ] as const) {
      const want = ends.filter((id) => (z.get(id)! < 1) === low).sort()
      expect([...(cap?.corners ?? [])].sort()).toEqual(want)
    }
    await closesWithin(can, l)
  })

  it('lays a part with no crease out as a box, its corners on the corner blends', async () => {
    const l = autoLayout(scanOf(blended))
    expect(l.creases).toBe(0)
    expect(l.cuts).toBe(12)
    expect(l.regions).toMatchObject([{ kind: 'closed', action: 'box' }])
    expect(l.made.map((c) => c.sides)).toEqual([4, 4, 4, 4, 4, 4])
    // One corner in each octant, on its blend: a ray from the middle toward
    // the box's corner leaves the superellipsoid at 3^(-1/4) of the way.
    expect(l.nodes.length).toBe(8)
    expect(new Set(l.nodes.map((n) => n.at.map((x) => (x > 0 ? 1 : 0)).join(''))).size).toBe(8)
    const s = 3 ** -0.25
    for (const n of l.nodes) expect(Math.hypot(Math.abs(n.at[0]) - 20 * s, Math.abs(n.at[1]) - 15 * s, Math.abs(n.at[2]) - 10 * s)).toBeLessThan(0.5)
    const report = await closesWithin(blended, l)
    // Where three tangent patches meet they are held near tangent, not
    // tangent: about 5° on this part — what the layout does not reach.
    expect(report.corners.length).toBe(8)
    for (const c of report.corners) {
      expect(c.patches).toBe(3)
      expect(c.angle).toBeLessThan(6)
    }
  })

  it('leaves an open sheet out, and says why', () => {
    const sheet = gridScan(60, 40, (u, v): Vec3 => [60 * u, 40 * v, 2 * Math.sin(3 * u) * Math.cos(2 * v)], { noise: NOISE })
    const l = autoLayout(scanOf(sheet))
    expect(l.cells).toEqual([])
    expect(l.regions).toMatchObject([{ kind: 'open', action: 'left' }])
    expect(l.left[0].why).toMatch(/rim/)
  })
})
