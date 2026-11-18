// SPDX-License-Identifier: AGPL-3.0-only
// The crease graph closed before a network is laid out (networkClose.ts),
// on a part whose crease ends in the middle of a face: a 40 × 30 × 20 box
// with sharp edges whose top is a 60° roof along x for |x| ≤ 5, flattening
// to none by |x| = 17 — the fold fades out at both ends, 0.01 mm of noise.
// Suggest creases finds the fold only where it is sharp; its two ends are
// loose. Closing carries each on along the scan, steered by its principal
// lines, to the rim ahead, so the top comes out two cells either side of
// the fold, and the part one closed solid within its noise. Let go (as PR
// 27 did), the fold is left inside one patch, which misses it by 0.56 mm.
//
// And on the app's sample bracket, a real scan whose edges are rounds: every
// loose crease end is carried to another curve, and the part, its creases
// islands in one region, is laid out from its faces down the middles of its
// rounds; the network builds, each patch's deviation read (see below).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { parse3MF } from '../../../src/core/parsers/threemf'
import type { Vec3 } from '../../../src/core/types'
import { Builder } from '../core/build'
import type { NetworkFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { type AutoLayout, autoLayout } from '../core/networkAuto'
import { traceNetwork } from '../core/network'
import { scanRegions } from '../core/networkCells'
import { traceCurve } from '../core/networkCurve'
import { fadingFoldScan, meshVolume } from './networkMeshes'
import { build } from './reKit'

const kernelPromise = ReKernel.load()
const NOISE = 0.01
const fold = fadingFoldScan(20, 15, 20, 60, 12, 60, NOISE)

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

describe('a crease that ends in the middle of a face', () => {
  it('is carried on to the rim ahead, and the part lays out and sews', async () => {
    const scan = new ScanPaths(fold.positions, fold.indices)
    const l = autoLayout(scan)
    const c = l.closing!
    expect(c.stuck).toEqual([])
    // Both ends of the fold, each carried on along y = 0 to a rim of the top.
    expect(c.extended.length).toBe(2)
    for (const e of c.extended) {
      expect(Math.abs(Math.abs(e.to[0]) - 20)).toBeLessThan(0.1)
      expect(Math.abs(e.to[1])).toBeLessThan(0.6)
      expect(Math.abs(e.to[2] - 20)).toBeLessThan(0.1)
      expect(e.steered).toBeGreaterThan(0.5)
    }
    expect(l.creasesDropped).toBe(0)
    expect(l.left).toEqual([])
    expect(l.made.map((x) => x.sides)).toEqual([4, 4, 4, 4, 4, 4, 4])
    // The fold's curve, rim to rim along its ridge.
    const at = new Map(l.nodes.map((n) => [n.id, n.at]))
    const ridge = l.curves
      .map((x) => traceCurve(scan, [at.get(x.from)!, ...x.via, at.get(x.to)!]).points)
      .find((p) => Math.abs(p[1]) < 0.6 && p[2] > 19.9 && Math.abs(Math.abs(p[0]) - 20) < 0.1 && Math.abs(Math.abs(p[p.length - 3]) - 20) < 0.1 && Math.sign(p[0]) !== Math.sign(p[p.length - 3]))
    expect(ridge).toBeTruthy()
    for (let i = 0; i < ridge!.length; i += 3) expect(Math.abs(ridge![i + 1])).toBeLessThan(0.6)

    const { report, body } = await built(fold, l)
    expect(report.closed).toBe(true)
    expect(body.closed).toBe(true)
    expect(body.faces).toBe(7)
    expect(Math.abs(body.volume / meshVolume(fold) - 1)).toBeLessThan(0.001)
    for (const p of report.patches) {
      expect(p.rms).toBeLessThan(2.5 * NOISE)
      expect(p.max).toBeLessThan(0.15)
    }
  }, 120_000)

  it('let go instead, leaves the fold inside one patch, which misses it', async () => {
    const l = autoLayout(new ScanPaths(fold.positions, fold.indices), { close: false })
    expect(l.closing).toBeNull()
    expect(l.creasesDropped).toBeGreaterThan(0)
    const { report } = await built(fold, l)
    expect(Math.max(...report.patches.map((p) => p.max))).toBeGreaterThan(0.4)
  }, 120_000)
})

describe('the sample bracket', () => {
  // Measured 18 Nov 2026 (288,582 triangles). PR 32: 6 cells of 1,575
  // triangles, and the build failed on a patch 0.48 mm RMS. PR 33 read the
  // graph's faces by where each curve is 8 edges from its node and let go of
  // the curves the same region lies both sides of: 8 cells made, 1.4 % of
  // the bracket, 10 patches, 0.031 mm RMS at the median, 0.19 at worst.
  //
  // The bracket's edges are rounds, which Suggest creases takes for no
  // crease: 95 % of it was one region, its creases islands in it. PR 34 laid
  // it out from its 21 faces (networkRounds.ts), the 49 lines where they
  // meet, down the rounds' middles, its curves: 17 cells in 24 s, of which
  // the build made 14 in 28 s — 44.3 % of the bracket, 23 patches, 0.043 mm
  // RMS at the median, 0.30 at worst. A region of 49,000 triangles of three
  // loops pinched together was left, and the build refused three cells: a
  // map that folded, two splits whose curves crossed.
  //
  // Now, where the part is laid out down its rounds: crossings snapped
  // within 1.5 edges of a node two curves share, not only past the closing's
  // 4 (curves leaving one node touched 0.5–0.8 mm from it), and the stubs
  // that leaves contracted; a three-sided cell given a fourth corner, the
  // middle of its longest side, so the build need not split it from its
  // centre; a four-sided cell whose mean normal is shorter than 0.6 cut
  // across its bend. The pinched region lays out, the build refuses none:
  // 20 cells in 36 s, all made in 52 s — 72.1 % of the bracket, 22 patches,
  // 0.031 mm RMS at the median, 0.92 at worst. That worst is a cell at the
  // flange's rounded top, flat by its mean normal (0.92) but 9.4 mm off at
  // its worst point; three more are 0.20–0.29 mm. Left: regions of two loops
  // no cut stays inside (14,000 and 9,000 triangles), a tangle of 13,000,
  // and cells the build would refuse (maps that fold, splits).
  it('is laid out from its faces, down its rounds, and builds, each patch read', async () => {
    const buf = readFileSync(new URL('../../../public/samples/fridgeBracket_01-reduced.3mf', import.meta.url))
    const m = parse3MF(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const scan = new ScanPaths(m.positions, m.indices!)
    const l = autoLayout(scan)
    const c = l.closing!
    // 50 loose ends among Suggest creases' 105 curves: less the weak ones
    // and the chips, the rest carried on, none let go for it.
    expect(c.extended.length).toBeGreaterThanOrEqual(25)
    expect(c.stuck.length).toBeLessThanOrEqual(2)
    expect(l.bridging!.found).toBeGreaterThanOrEqual(50)
    expect(l.roundsLaid.whole).toBe(true)
    expect(l.roundsLaid.faces).toBeGreaterThanOrEqual(15)
    expect(l.made.length).toBeGreaterThanOrEqual(16)
    // The share of the bracket's triangles in the cells, and in those built.
    const traced = traceNetwork(scan, l.nodes, l.curves)
    const { regions, label } = scanRegions(scan, traced.nodes, traced.curves)
    const size = (seed: Vec3) => {
      const q = scan.closest(seed)
      return q ? regions[label[q.triangle]].triangles.length : 0
    }
    const share = (cells: Vec3[]) => cells.reduce((s, x) => s + size(x), 0) / scan.triangleCount
    expect(share(l.cells.map((x) => x.seed))).toBeGreaterThan(0.6)
    const { report } = await built({ positions: m.positions, indices: m.indices! }, l)
    const made = l.cells.filter((_, i) => !('refused' in report.cells[i]))
    expect(made.length).toBeGreaterThanOrEqual(16)
    expect(share(made.map((x) => x.seed))).toBeGreaterThan(0.6)
    expect(report.patches.length).toBeGreaterThanOrEqual(18)
    const rms = report.patches.map((p) => p.rms).sort((a, b) => a - b)
    expect(rms[Math.floor(rms.length / 2)]).toBeLessThan(0.05)
    expect(rms[rms.length - 1]).toBeLessThan(1.2)
  }, 600_000)
})
