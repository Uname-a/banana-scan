// SPDX-License-Identifier: AGPL-3.0-only
// A freeform body over a region of the scan: the region cut out and closed
// (regionMesh.ts), laid out by its shape (regionLayout.ts) and built, on
// synthetic scans with 0.01 mm of noise on a plate — a round bar bent twice,
// a lump, a post with an arm off its side, and a loop, which is refused. Each
// is measured against the shape it was made of, not the scan of it, and is
// joined to the plate and written as STEP and read back.

import { describe, expect, it, vi } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import { Builder } from '../core/build'
import type { NetworkFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { regionDeviation } from '../core/regionCheck'
import { regionLayout } from '../core/regionLayout'
import { boxPlanes, type NetworkRegion, OF_CAP, OF_SCAN, OF_SKIRT, type RegionMesh, regionMesh } from '../core/regionMesh'
import { build } from './reKit'
import { arm, bar, BAR_RADIUS, blob, loop, onPlate, PLATE, type Scan, scanOf, type Sdf } from './regionScans'

vi.setConfig({ testTimeout: 240_000 })

const kernelPromise = ReKernel.load()
const NOISE = 0.01
/** The plane the regions end at: clear of the blend at the foot. */
const UP = { origin: [0, 0, 1] as Vec3, normal: [0, 0, 1] as Vec3 }
const region = (seed: Vec3, sink = 2): NetworkRegion => ({ seed, planes: [UP], sink })

const meshed = (scan: Scan, r: NetworkRegion): RegionMesh => {
  const m = regionMesh(new ScanPaths(scan.positions, scan.indices), r)
  if (typeof m === 'string') throw new Error(m)
  return m
}

/** Every edge between two triangles, each walking it its own way. */
function closed(m: { indices: Uint32Array }): boolean {
  const half = new Set<string>()
  for (let i = 0; i < m.indices.length; i += 3) for (let k = 0; k < 3; k++) {
    const h = `${m.indices[i + k]}>${m.indices[i + ((k + 1) % 3)]}`
    if (half.has(h)) return false
    half.add(h)
  }
  return [...half].every((h) => half.has(h.split('>').reverse().join('>')))
}

async function bodyOf(scan: Scan, r: NetworkRegion, laid: { density: number; lines: 4 | 8 }) {
  const k = await kernelPromise
  const f: NetworkFeature = { id: 1, kind: 'network', name: 'Freeform', nodes: [], curves: [], cells: [], spans: {}, fit: { smoothness: 0.001 }, region: { ...r, laid }, visible: true }
  const b = new Builder(k)
  b.setScan(new NominalSurface(scan.positions, scan.indices), scan.positions)
  // As a saved project holds it.
  const out = await build(b, [JSON.parse(JSON.stringify(f)) as NetworkFeature])
  const result = out.results.find((x) => x.id === 1)!
  expect(result.status, result.message).toBe('ok')
  return { k, builder: b, report: result.network!, body: out.bodies.find((x) => x.id === 1)! }
}

/** The body is one valid closed solid; it joins the plate in one; it comes
 *  back from STEP; and it is on the shape above the plane it was cut at. */
async function holds(scan: Scan, shape: Sdf, r: NetworkRegion, laid: { density: number; lines: 4 | 8 }, share: number, worst: number) {
  const { k, builder, report, body } = await bodyOf(scan, r, laid)
  expect(report.closed).toBe(true)
  expect(body.closed).toBe(true)
  expect(report.cells.every((c) => !('refused' in c))).toBe(true)
  const shapeOf = (builder as unknown as { bodyById(id: number): { shape: Parameters<ReKernel['isValid']>[0] } }).bodyById(1).shape
  expect(k.isValid(shapeOf)).toBe(true)
  expect(k.isClosedSolid(shapeOf)).toBe(true)
  const counts = k.oddEdges(shapeOf).counts
  expect(counts.free + counts.nonManifold).toBe(0)
  const plate = k.box(PLATE.min, PLATE.max)
  const common = k.common(plate, shapeOf)
  const whole = k.fuse(plate, shapeOf)
  expect(k.volume(common)).toBeGreaterThan(1)
  expect(k.isValid(whole)).toBe(true)
  expect(k.solidCount(whole)).toBe(1)
  expect(k.isClosedSolid(whole)).toBe(true)
  expect(k.volume(whole)).toBeCloseTo(k.volume(plate) + k.volume(shapeOf) - k.volume(common), 1)
  const left = k.cut(plate, shapeOf)
  expect(k.isValid(left)).toBe(true)
  const read = k.importStep(k.exportStep([whole]))
  expect(k.isValid(read)).toBe(true)
  expect(k.volume(read)).toBeCloseTo(k.volume(whole), 1)
  // Against the shape itself, where the region is the scan's: above the plane.
  const mesh = k.mesh(shapeOf, 0.01, 0.1)
  const off: number[] = []
  for (let i = 0; i < mesh.positions.length; i += 3) if (mesh.positions[i + 2] > UP.origin[2] + 0.2) off.push(Math.abs(shape([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]])))
  expect(off.length).toBeGreaterThan(300)
  const m = meshed(scan, r)
  const d = regionDeviation(m, r.planes, mesh, [0.1, 0.25])
  expect(Math.max(...off)).toBeLessThan(worst)
  expect(d.within[0].share).toBeGreaterThan(share)
  expect(d.back.p95).toBeLessThan(0.1)
  k.release(plate, common, whole, left, read)
  return { report, body, deviation: d }
}

describe('a region of the scan as a closed mesh', () => {
  it('cuts the piece at the seed between planes, snaps its rim, and closes it with a skirt and a cap', async () => {
    const scan = await scanOf(onPlate(bar), 0.5, NOISE)
    const m = meshed(scan, region([13, 6, 11]))
    expect(closed(m)).toBe(true)
    expect(m.genus).toBe(0)
    expect(m.rims.length).toBe(1)
    const rim = m.rims[0]
    for (const v of rim.loop) expect(m.positions[v * 3 + 2]).toBeCloseTo(1, 4)
    for (const v of rim.foot) expect(m.positions[v * 3 + 2]).toBeCloseTo(-1, 4)
    // The rim's points are about as far apart as the scan's: no slivers.
    const steps = rim.loop.map((v, i) => Math.hypot(...[0, 1, 2].map((k) => m.positions[v * 3 + k] - m.positions[rim.loop[(i + 1) % rim.loop.length] * 3 + k])))
    expect(Math.min(...steps)).toBeGreaterThan(0.02 * m.edge)
    expect(steps.reduce((a, b) => a + b, 0)).toBeGreaterThan(2 * Math.PI * BAR_RADIUS * 0.98)
    for (const kind of [OF_SCAN, OF_SKIRT, OF_CAP]) expect(m.of.includes(kind)).toBe(true)
    // The plate's triangles are not among it, nor anything under the plane.
    for (let t = 0; t < m.of.length; t++) if (m.of[t] === OF_SCAN) for (let k = 0; k < 3; k++) expect(m.positions[m.indices[t * 3 + k] * 3 + 2]).toBeGreaterThan(0.999)
  })

  it('takes a box as six planes, and says where a region is none', async () => {
    const scan = await scanOf(onPlate(bar), 0.6, 0)
    const paths = new ScanPaths(scan.positions, scan.indices)
    // Across the level straight: two rims, no skirt asked for.
    const piece = regionMesh(paths, { seed: [6.5, 0, 11], planes: boxPlanes([5, -5, 5], [8, 5, 14]), sink: 0 }) as RegionMesh
    expect(piece.rims.length).toBe(2)
    expect(piece.rims.every((r) => r.rows === 0)).toBe(true)
    expect(closed(piece)).toBe(true)
    expect(regionMesh(paths, { seed: [0, 0, -2], planes: [UP], sink: 1 })).toMatch(/outside plane 0/)
    expect(regionMesh(paths, { seed: [0, 0, 60], planes: [{ origin: [0, 0, 50], normal: [0, 0, 1] }], sink: 1 })).toMatch(/nothing between the planes/)
  })

  it('closes a hole of the scan inside it', async () => {
    const scan = await scanOf(onPlate(blob), 0.6, NOISE)
    const keep: number[] = []
    for (let i = 0; i < scan.indices.length; i += 3) {
      const at = [0, 1, 2].map((x) => [0, 1, 2].reduce((s, k) => s + scan.positions[scan.indices[i + k] * 3 + x] / 3, 0))
      if (Math.hypot(at[0] + 4, at[1] + 4, at[2] - 5) < 1.2) continue
      keep.push(scan.indices[i], scan.indices[i + 1], scan.indices[i + 2])
    }
    expect(keep.length).toBeLessThan(scan.indices.length)
    const m = meshed({ positions: scan.positions, indices: Uint32Array.from(keep) }, region([5, 4, 8.4]))
    expect(m.filled).toBeGreaterThan(0)
    expect(closed(m)).toBe(true)
  })

  it('counts a handle, and lays no region out that has one', async () => {
    const scan = await scanOf(onPlate(loop), 0.6, 0)
    const m = meshed(scan, { seed: [0, 0, 11], planes: [], sink: 0 })
    expect(m.genus).toBe(1)
    expect(regionLayout(m)).toMatch(/1 handle through it/)
    // Cut by a plane into an arch, it has none.
    const arch = meshed(scan, region([0, 0, 11]))
    expect(arch.genus).toBe(0)
    expect(arch.rims.length).toBe(2)
    expect(typeof regionLayout(arch)).toBe('object')
  })
})

describe('a freeform body over a region', () => {
  it('a round bar bent twice comes out closed, on the bar, and joins its plate', async () => {
    const scan = await scanOf(onPlate(bar), 0.45, NOISE)
    const { report, deviation } = await holds(scan, onPlate(bar), region([13, 6, 11]), { density: 1, lines: 4 }, 0.985, 0.3)
    expect(deviation.rms).toBeLessThan(0.03)
    expect(report.worstAngle).toBeLessThan(5)
  })

  it('a lump on a plate comes out closed, on the lump, and joins it', async () => {
    const scan = await scanOf(onPlate(blob), 0.6, NOISE)
    const { deviation } = await holds(scan, onPlate(blob), region([0, 0, 7.4]), { density: 1, lines: 4 }, 0.99, 0.25)
    expect(deviation.rms).toBeLessThan(0.025)
  })

  it('the same in eight lines, its end four patches round a node', async () => {
    const scan = await scanOf(onPlate(blob), 0.6, NOISE)
    const { report } = await holds(scan, onPlate(blob), region([0, 0, 7.4]), { density: 1, lines: 8 }, 0.99, 0.25)
    expect(report.patches.length % 8).toBe(0)
  })

  it('an arch comes out from rim to rim', async () => {
    const scan = await scanOf(onPlate(loop), 0.6, NOISE)
    await holds(scan, onPlate(loop), region([0, 0, 11]), { density: 1, lines: 4 }, 0.985, 0.25)
  })

  it('an arm off a post’s side is laid out on its own', async () => {
    const scan = await scanOf(onPlate(arm), 0.55, NOISE)
    const r = region([0, 0, 18])
    const l = regionLayout(meshed(scan, r), { density: 1, lines: 4 })
    if (typeof l === 'string') throw new Error(l)
    expect(l.branches).toBeGreaterThan(0)
    await holds(scan, onPlate(arm), r, { density: 2, lines: 4 }, 0.95, 0.6)
  })
})
