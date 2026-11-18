// SPDX-License-Identifier: AGPL-3.0-only
// A sketch wrapped onto a free-form region of a scan: the region laid out
// flat, the sketch carried back through the layout. On a gently curved
// patch its lengths hold within the stretch the layout reports; wrapped and
// flattened again it is the sketch; a dome, which no layout lays out
// without stretching it, is refused saying so; and the kernel stands it on
// a sheet fitted through the region, the volume its area times the depth.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { len, sub } from '../../../src/core/vec'
import { flatten } from '../../../src/core/develop/flatten'
import { Builder } from '../core/build'
import type { Feature, SketchFeature, WrapFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import type { Profile } from '../core/kernelTypes'
import { rectangleLoop } from '../core/loops'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import type { Sketch } from '../core/sketch'
import { placeFlat, wrapProfiles, type Development } from '../core/wrap'
import { layOutRegion, regionDevelopment, stretchProblem, stretchUnder, type RegionLayout } from '../core/wrapRegion'
import { rectangleSketch } from './reKit'

/** A grid mesh over [−h, h]² lifted by z = f(x, y), wound to face +z. */
function patchMesh(h: number, n: number, f: (x: number, y: number) => number) {
  const positions: number[] = []
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x = -h + (2 * h * i) / n
      const y = -h + (2 * h * j) / n
      positions.push(x, y, f(x, y))
    }
  const at = (i: number, j: number) => j * (n + 1) + i
  const indices: number[] = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1))
  const count = positions.length / 3
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(indices), count, all: Uint32Array.from({ length: count }, (_, i) => i) }
}

/** A gently curved free-form patch: bowed both ways, a little twisted. */
const gentle = (x: number, y: number) => 0.004 * x * x + 0.0015 * y * y + 0.001 * x * y

/** A w × h rectangle centred on the origin on the plane z = 0 — tangent to
 *  the gentle patch there. */
const rect = (w: number, h: number): Profile => ({ outer: rectangleLoop([-w / 2, -h / 2, 0], [1, 0, 0], [0, 1, 0], w, h), holes: [] })

function layout(mesh: ReturnType<typeof patchMesh>): RegionLayout {
  const l = layOutRegion(mesh.positions, mesh.triangles, mesh.count, mesh.all)
  if (typeof l === 'string') throw new Error(l)
  return l
}

function wrapOn(l: RegionLayout, region: Uint32Array, profiles: Profile[]) {
  const dev = regionDevelopment(l, { kind: 'region', region }, [0, 0, 1], [0, 0, 0])
  if (typeof dev === 'string') throw new Error(dev)
  const wrapped = wrapProfiles(profiles, dev)
  if (typeof wrapped === 'string') throw new Error(wrapped)
  return { dev, wrapped }
}

/** A stretch of the layout's length on the scan: sampled densely. */
function lengthOnScan(dev: Development, a: [number, number], b: [number, number], n = 400): number {
  let s = 0
  let prev: Vec3 | null = null
  for (let k = 0; k <= n; k++) {
    const t = k / n
    const p = placeFlat(dev, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], 0)
    if (prev) s += len(sub(p, prev))
    prev = p
  }
  return s
}

describe('a sketch wrapped onto a gently curved free-form region', () => {
  const mesh = patchMesh(40, 80, gentle)
  const l = layout(mesh)

  it('lands where it is drawn and keeps its lengths within the stretch the layout reports', () => {
    const { dev, wrapped } = wrapOn(l, mesh.all, [rect(30, 12)])
    expect(dev.tiltDeg).toBeLessThan(1)
    expect(len(sub(dev.touch.point, [0, 0, 0]))).toBeLessThan(1e-6)
    const stretch = stretchUnder(l, wrapped)
    expect(stretch.triangles).toBeGreaterThan(100)
    // Doubly curved, it does not lay out exactly — but well under the
    // limit, and the lengths keep to what it says.
    expect(stretch.maxPct).toBeGreaterThan(0)
    expect(stretch.maxPct).toBeLessThan(0.5)
    expect(stretchProblem(stretch)).toBeNull()
    const sides = wrapped[0].outer.pieces.map((p) => lengthOnScan(dev, p.flat[0], p.flat[p.flat.length - 1]))
    const want = [30, 12, 30, 12]
    sides.forEach((s, i) => {
      // Within the most stretch under it, and the chords of the mesh.
      expect(Math.abs(s - want[i]) / want[i]).toBeLessThan(stretch.maxPct / 100 + 1e-3)
    })
    // Every corner on the scan.
    for (const piece of wrapped[0].outer.pieces) {
      const p = placeFlat(dev, piece.flat[0], 0)
      expect(Math.abs(p[2] - gentle(p[0], p[1]))).toBeLessThan(0.02)
    }
  })

  it('wrapped, then flattened, is the sketch again', () => {
    const { dev, wrapped } = wrapOn(l, mesh.all, [rect(30, 12)])
    // The wrapped rectangle as a mesh of its own: a grid between its
    // corners on the layout, carried onto the scan.
    const [c0, c1, c2, c3] = wrapped[0].outer.pieces.map((p) => p.flat[0])
    const nx = 60
    const ny = 24
    const positions: number[] = []
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const [s, t] = [i / nx, j / ny]
        const q: [number, number] = [0, 1].map((k) => (1 - s) * (1 - t) * c0[k] + s * (1 - t) * c1[k] + s * t * c2[k] + (1 - s) * t * c3[k]) as [number, number]
        positions.push(...placeFlat(dev, q, 0))
      }
    const at = (i: number, j: number) => j * (nx + 1) + i
    const indices: number[] = []
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1))
    const count = positions.length / 3
    const flat = flatten(Float64Array.from(positions), Uint32Array.from(indices), count, Uint32Array.from({ length: count }, (_, i) => i))
    // Laid out again on its own, the stretch the region's layout put under
    // it is shared out afresh: the rectangle comes back within the two
    // layouts' stretch — its perimeter and its area, however it is turned.
    const tol = (stretchUnder(l, wrapped).maxPct + flat.report.distortion.length.max) / 100 + 2e-3
    expect(Math.abs(flat.report.figures.perimeter - 84) / 84).toBeLessThan(tol)
    expect(Math.abs(flat.report.figures.area - 360) / 360).toBeLessThan(2 * tol)
    expect(flat.report.figures.holes).toHaveLength(0)
  })

  it('refuses a sketch that reaches past the region', () => {
    const dev = regionDevelopment(l, { kind: 'region', region: mesh.all }, [0, 0, 1], [0, 0, 0]) as Development
    expect(wrapProfiles([rect(100, 10)], dev)).toMatch(/past the marked region/)
  })
})

describe('a region too curved to lay out', () => {
  it('is refused, saying how far it stretches and where', () => {
    // A dome of R 25, its cap to 20 mm out marked.
    const R = 25
    const mesh = patchMesh(20, 60, (x, y) => Math.sqrt(Math.max(0, R * R - x * x - y * y)) - R)
    const l = layout(mesh)
    const { wrapped } = wrapOn(l, mesh.all, [rect(26, 26)])
    const stretch = stretchUnder(l, wrapped)
    expect(stretch.maxPct).toBeGreaterThan(2)
    const said = stretchProblem(stretch)
    expect(said).toMatch(/does not lay out flat under the sketch: laying it out stretches a length by [\d.]+ % at \(/)
    expect(said).toMatch(/past 2 %/)
  })
})

describe('a wrap onto a region, built', () => {
  const kernelPromise = ReKernel.load()

  /** The rectangle's sketch on z = 0 and the wrap of it onto the scan. */
  function features(op: 'join' | 'cut', depth: number, region: Uint32Array): Feature[] {
    const sketch: SketchFeature = rectangleSketch(1, 30, 12, [-15, -6])
    const keys = findRegions(sketch.sketch).map((r) => r.key)
    const wrap: WrapFeature = { id: 2, kind: 'wrap', name: 'Label', sketchId: 1, regions: keys, surface: 0, region, depth, op: op === 'join' ? 'new' : 'new', ...(op === 'cut' ? { flip: true } : {}), visible: true }
    return [sketch, wrap]
  }

  async function build(fs: Feature[], mesh: ReturnType<typeof patchMesh>) {
    const builder = new Builder(await kernelPromise)
    builder.setScan(null, mesh.positions, mesh.triangles)
    const steps = resolveFeatures(fs, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
    const sketches = new Map<number, Sketch>(fs.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
    return builder.build(steps, (id) => sketches.get(id))
  }

  it('stands the sketch out of the scan by the depth: its area on the scan times the depth', async () => {
    const mesh = patchMesh(40, 80, gentle)
    const out = await build(features('join', 1.5, mesh.all), mesh)
    const r = out.results.find((x) => x.id === 2)!
    expect(r.status, r.message).toBe('ok')
    const body = out.bodies.find((b) => b.id === 2)!
    expect(body.closed).toBe(true)
    // 360 mm² on a gently curved sheet, 1.5 deep: the offset grows the area
    // by a hair on the convex side.
    expect(Math.abs(body.volume - 540) / 540).toBeLessThan(0.02)
    // It stands on the scan: its lowest point on the patch's bottom, near 0.
    expect(body.box!.min[2]).toBeGreaterThan(-0.05)
    expect(body.box!.max[2]).toBeLessThan(1.5 + 0.004 * 15 * 15 + 0.0015 * 36 + 0.001 * 90 + 0.1)
  })

  it('sinks it in the other way', async () => {
    const mesh = patchMesh(40, 80, gentle)
    const out = await build(features('cut', 1, mesh.all), mesh)
    const r = out.results.find((x) => x.id === 2)!
    expect(r.status, r.message).toBe('ok')
    const body = out.bodies.find((b) => b.id === 2)!
    expect(Math.abs(body.volume - 360) / 360).toBeLessThan(0.02)
    expect(body.box!.min[2]).toBeLessThan(-0.9)
  })

  it('is refused on a dome, with the reason', async () => {
    const R = 25
    const mesh = patchMesh(20, 60, (x, y) => Math.sqrt(Math.max(0, R * R - x * x - y * y)) - R)
    const sketch: SketchFeature = rectangleSketch(1, 26, 26, [-13, -13])
    const wrap: WrapFeature = { id: 2, kind: 'wrap', name: 'Label', sketchId: 1, regions: findRegions(sketch.sketch).map((x) => x.key), surface: 0, region: mesh.all, depth: 1, op: 'new', visible: true }
    const out = await build([sketch, wrap], mesh)
    const r = out.results.find((x) => x.id === 2)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/does not lay out flat under the sketch/)
  })
})
