// SPDX-License-Identifier: AGPL-3.0-only
// Curvature-continuous patches (G2, networkFit.ts), measured across every
// curve not a crease as the step in the normal curvature square to it, on
// PR 27's closed synthetic parts with 0.01 mm of noise:
//
// - a box with upright edges rounded to 4 mm, its side wall cut down the
//   middles of the rounds: fitted G1 the curvature steps 9–10 % across each
//   cut; G2, 1–2 %, at the same deviation;
// - a can, whose sides are one cylinder: within 0.003 1/mm either way;
// - a blended box (a superellipsoid): G1 steps 18–50 %; G2 brings every
//   curve within 8 %, five of the twelve within 5 % — the rest is what it
//   does not reach — and costs 0.007 mm of RMS on the worst patch.

import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { Builder } from '../core/build'
import type { NetworkFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { autoLayout } from '../core/networkAuto'
import { G2_SHARE } from '../core/networkFit'
import { blendedBoxScan, roundedBoxScan } from './networkMeshes'
import { build } from './reKit'

const kernelPromise = ReKernel.load()
const NOISE = 0.01

async function fitted(m: { positions: Float32Array; indices: Uint32Array }, continuity: 'g1' | 'g2') {
  const k = await kernelPromise
  const l = autoLayout(new ScanPaths(m.positions, m.indices))
  const f: NetworkFeature = { id: 1, kind: 'network', name: 'Auto', nodes: l.nodes, curves: l.curves, cells: l.cells, spans: {}, fit: { smoothness: 0.001, continuity }, visible: true }
  const b = new Builder(k)
  b.setScan(new NominalSurface(m.positions, m.indices), m.positions)
  const out = await build(b, [f])
  const r = out.results.find((x) => x.id === 1)!
  expect(r.status, r.message).toBe('ok')
  expect(r.network!.closed).toBe(true)
  const tangent = r.network!.curves.filter((c) => !c.crease)
  for (const c of tangent) expect(c.curvature, `curve ${c.curve}`).toBeTruthy()
  return { report: r.network!, tangent }
}

describe('patches held curvature-continuous (G2)', () => {
  it('meets within tolerance across the cuts down a box’s rounds, where G1 steps', async () => {
    const m = roundedBoxScan(20, 15, 20, 4, 3, 60, NOISE)
    const g1 = await fitted(m, 'g1')
    expect(g1.tangent.length).toBe(4)
    for (const c of g1.tangent) {
      expect(c.curvature!.g2).toBe(false)
      expect(c.curvature!.share).toBeGreaterThan(0.06)
    }
    const g2 = await fitted(m, 'g2')
    for (const c of g2.tangent) {
      expect(c.curvature!.g2).toBe(true)
      expect(c.curvature!.share).toBeLessThan(0.03)
      expect(c.angle).toBeLessThan(0.01)
    }
    for (const p of g2.report.patches) {
      expect(p.rms).toBeLessThan(2.5 * NOISE)
      expect(p.max).toBeLessThan(0.1)
    }
  }, 120_000)

  it('reads a can’s sides continuous either way', async () => {
    const m = roundedBoxScan(15, 15, 20, 15, 3, 50, NOISE)
    for (const continuity of ['g1', 'g2'] as const) {
      const { tangent } = await fitted(m, continuity)
      for (const c of tangent) expect(c.curvature!.jump).toBeLessThan(0.003)
    }
  }, 120_000)

  it('brings a blended box near G2, and says where it is not reached', async () => {
    const m = blendedBoxScan(20, 15, 10, 4, 50, NOISE)
    const g1 = await fitted(m, 'g1')
    expect(Math.max(...g1.tangent.map((c) => c.curvature!.share))).toBeGreaterThan(0.3)
    const g2 = await fitted(m, 'g2')
    expect(g2.tangent.length).toBe(12)
    for (const c of g2.tangent) expect(c.curvature!.share).toBeLessThan(0.08)
    expect(g2.tangent.filter((c) => c.curvature!.g2).length).toBeGreaterThanOrEqual(4)
    // Not every curve within G2_SHARE: said so, curve by curve.
    expect(g2.tangent.some((c) => !c.curvature!.g2 && c.curvature!.share > G2_SHARE)).toBe(true)
    for (const p of g2.report.patches) expect(p.rms).toBeLessThan(0.03)
  }, 120_000)
})
