// SPDX-License-Identifier: AGPL-3.0-only
// A wrap onto a free-form region of a scan, as an agent drives it: read
// where it lands and how far the region's layout stretches under it, built
// as an emboss on a sheet fitted through the region, saved and listed with
// its region as a count, and refused on a dome with the reason. The kernel
// runs in this thread, with no viewport: the scan's triangles reach it from
// the mesh worker.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { validateFeatureJson, featureToJson } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'

vi.setConfig({ testTimeout: 180_000 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any

/** A grid sheet over [−h, h]² lifted by z = f(x, y), as a triangle soup
 *  facing +z. */
function sheetSoup(h: number, n: number, f: (x: number, y: number) => number): Float32Array {
  const p = (i: number, j: number) => {
    const x = -h + (2 * h * i) / n
    const y = -h + (2 * h * j) / n
    return [x, y, f(x, y)]
  }
  const out: number[] = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) out.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1), ...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1))
  return Float32Array.from(out)
}

const gentle = (x: number, y: number) => 0.004 * x * x + 0.0015 * y * y + 0.001 * x * y

describe('a sketch wrapped onto a free-form region of a scan', () => {
  let headless: Headless
  let session: ReverseSession
  const stops: (() => void)[] = []
  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
  }, 120_000)
  afterAll(() => {
    for (const stop of stops) stop()
    headless.stop()
  })

  /** A body's volume off its mesh. */
  function meshVolume(bodyId: number): number {
    const m = session.meshes.get(bodyId)!
    let v = 0
    for (let i = 0; i + 2 < m.indices.length; i += 3) {
      const [p, q, r] = [0, 1, 2].map((k) => [0, 1, 2].map((j) => m.positions[m.indices[i + k] * 3 + j]))
      v += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])
    }
    return Math.abs(v) / 6
  }

  const label = { kind: 'sketch', name: 'Label', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', from: [-15, -6], to: [15, 6] }] } }
  const all = { box: { min: [-50, -50, -10], max: [50, 50, 20] } }

  it('reads where it lands on a gently curved sheet, and how little the layout stretches under it', async () => {
    await run('scan.open', { bytes: stlBytes(sheetSoup(40, 80, gentle)), name: 'panel.stl', discard: true })
    await run('reverse.feature.clear')
    await run('reverse.feature.add', { feature: label })
    const read = await run<A>('reverse.sketch.wrap_read', { sketchId: 'Label', region: all, depth: 1.5 })
    expect(read.surface).toBeUndefined()
    expect(read.region.points).toBe(81 * 81)
    expect(read.stretch.maxPct).toBeGreaterThan(0)
    expect(read.stretch.maxPct).toBeLessThan(0.5)
    expect(read.stretch.problem).toBeUndefined()
    expect(read.tiltDeg).toBeLessThan(1)
    expect(Math.abs(read.profiles[0].perimeter - 84) / 84).toBeLessThan(read.stretch.maxPct / 100 + 1e-3)
    for (const p of read.profiles[0].outline) expect(Math.abs(p[2] - gentle(p[0], p[1]))).toBeLessThan(0.02)
  })

  it('embosses it on a sheet fitted through the region, kept with the region as a count', async () => {
    await run('reverse.feature.clear')
    await run('reverse.feature.add', { feature: label })
    const made = await run<A>('reverse.feature.add', { feature: { kind: 'wrap', name: 'Raised', sketchId: 'Label', region: all, depth: 1.5, op: 'new' } })
    expect(made.result.status, made.result.message).toBe('ok')
    const body = made.bodies.changed[0]
    expect(body.closed).toBe(true)
    expect(Math.abs(meshVolume(body.id) - 540) / 540).toBeLessThan(0.03)
    const f = useReverse.getState().features.find((x) => x.name === 'Raised')!
    expect(f.kind).toBe('wrap')
    expect((f as A).region).toHaveLength(81 * 81)
    // A file holds the region as a list, and reads it back.
    const json = JSON.parse(JSON.stringify(featureToJson(f)))
    expect(Array.isArray(json.region)).toBe(true)
    expect(() => validateFeatureJson(json)).not.toThrow()
    const one = await run<A>('reverse.feature.list', { feature: 'Raised' })
    expect(one.region).toEqual({ points: 81 * 81 })
  })

  it('refuses a dome, saying how far it stretches', async () => {
    const R = 25
    await run('scan.open', { bytes: stlBytes(sheetSoup(20, 60, (x, y) => Math.sqrt(Math.max(0, R * R - x * x - y * y)) - R)), name: 'dome.stl', discard: true })
    await run('reverse.feature.clear')
    await run('reverse.feature.add', { feature: { ...label, sketch: { shapes: [{ kind: 'rectangle', from: [-13, -13], to: [13, 13] }] } } })
    const read = await run<A>('reverse.sketch.wrap_read', { sketchId: 'Label', region: { box: { min: [-30, -30, -30], max: [30, 30, 5] } } })
    expect(read.stretch.maxPct).toBeGreaterThan(2)
    expect(read.stretch.problem).toMatch(/does not lay out flat under the sketch/)
    const made = await run<A>('reverse.feature.add', { feature: { kind: 'wrap', name: 'On dome', sketchId: 'Label', region: { box: { min: [-30, -30, -30], max: [30, 30, 5] } }, depth: 1, op: 'new' } })
    expect(made.result).toMatchObject({ status: 'failed', message: expect.stringContaining('does not lay out flat under the sketch') })
  })
})
