// SPDX-License-Identifier: AGPL-3.0-only
// The wrap feature and planes along a path, as an agent drives them: a
// rectangle drawn on the plane tangent to a measured cylinder read where
// it lands, embossed on the cylinder's body and debossed into it, and
// planes made square to the cylinder's axis and along a route. The kernel
// runs in this thread.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { cylinderMesh } from '../../../tests/helpers'
import { validateFeatureJson } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { useStore } from '../../../src/state/store'
import { localKernel } from './reLocal'

vi.setConfig({ testTimeout: 180_000 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any

describe('a sketch wrapped onto a measured cylinder', () => {
  let headless: Headless
  let session: ReverseSession
  const stops: (() => void)[] = []
  let R = 20
  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    await run('scan.open', { bytes: stlBytes(cylinderMesh(20, 40, 180, 24).positions), name: 'can.stl', discard: true })
    const fit = await run<A>('element.fit', { kind: 'cylinder', at: { point: [20, 0, 0] }, axis: [0, 0, 1], name: 'Can' })
    R = fit.element.fit.radius
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

  /** The label: 30 wide round the can and 8 up it, on the plane touching
   *  it along +X. */
  const label = () => ({ kind: 'sketch', name: 'Label', plane: { kind: 'world', axis: 'x', offset: R, up: 'z' }, sketch: { shapes: [{ kind: 'rectangle', from: [-15, -4], to: [15, 4] }] } })

  it('reads where it lands: the arc its width over the radius, its outline its own length', async () => {
    await run('reverse.feature.clear')
    await run('reverse.feature.add', { feature: label() })
    const read = await run<A>('reverse.sketch.wrap_read', { sketchId: 'Label', surface: 'Can', depth: 1 })
    expect(read.tiltDeg).toBeCloseTo(0, 6)
    expect(read.touch.normal[0]).toBeCloseTo(1, 6)
    expect(read.arcDeg).toBeCloseTo(((30 / R) * 180) / Math.PI, 2)
    expect(read.profiles).toHaveLength(1)
    expect(read.profiles[0].perimeter).toBeCloseTo(76, 1)
    expect(read.offsets).toEqual({ from: 0, to: 1 })
    expect(read.problem).toBeUndefined()
    // Each outline point on the can.
    for (const p of read.profiles[0].outline) expect(Math.hypot(p[0], p[1])).toBeCloseTo(R, 2)
  })

  it('embosses the can’s body and debosses it, by the shell sector it covers', async () => {
    await run('reverse.feature.clear')
    const can = await run<A>('reverse.feature.add', { feature: { kind: 'extract', name: 'Body', element: 'Can', op: 'new' } })
    expect(can.result.status, can.result.message).toBe('ok')
    const bodyId = can.bodies.changed[0].id
    const before = meshVolume(bodyId)
    await run('reverse.feature.add', { feature: label() })
    const sector = (r0: number, r1: number) => 8 * (30 / R / 2) * (r1 * r1 - r0 * r0)
    const up = await run<A>('reverse.feature.add', { feature: { kind: 'wrap', name: 'Raised', sketchId: 'Label', surface: 'Can', depth: 1 } })
    expect(up.result.status, up.result.message).toBe('ok')
    const raised = up.bodies.changed.find((b: A) => b.id === bodyId)
    expect(raised.closed).toBe(true)
    // Read off the meshes drawn, a curved face's chords lose a little:
    // within 3 % of the shell sector.
    const near = (got: number, want: number) => expect(Math.abs(got - want) / want).toBeLessThan(0.03)
    near(meshVolume(bodyId) - before, sector(R, R + 1))
    const f = useReverse.getState().features.find((x) => x.name === 'Raised')!
    expect(f).toMatchObject({ kind: 'wrap', op: 'join', depth: 1, regionPick: { given: 'all' } })
    expect(() => validateFeatureJson(JSON.parse(JSON.stringify(f)))).not.toThrow()
    const down = await run<A>('reverse.feature.update', { feature: 'Raised', set: { op: 'cut', depth: 0.8 } })
    expect(down.result.status, down.result.message).toBe('ok')
    near(before - meshVolume(bodyId), sector(R - 0.8, R))
  })

  it('refuses a sketch square to the axis, and a surface that is no cylinder, cone or plane', async () => {
    await run('reverse.feature.clear')
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Lid', plane: { kind: 'world', axis: 'z', offset: 20 }, sketch: { shapes: [{ kind: 'rectangle', from: [-5, -5], to: [5, 5] }] } } })
    const lid = await run<A>('reverse.feature.add', { feature: { kind: 'wrap', name: 'On lid', sketchId: 'Lid', surface: 'Can', depth: 1 } })
    expect(lid.result).toMatchObject({ status: 'failed', message: expect.stringContaining('square to the cylinder’s axis') })
    await run('element.construct', { kind: 'point', method: 'point-coords', params: [0, 0, 0], name: 'Origin' })
    const e = await refused('reverse.feature.add', { feature: { kind: 'wrap', name: 'On point', sketchId: 'Lid', surface: 'Origin', depth: 1 } })
    expect(e.message).toMatch(/wraps onto a cylinder, a cone or a plane/)
  })

  it('makes planes square to the can’s axis at stations along it, as plane elements in one step', async () => {
    const count = () => useStore.getState().elements.filter((e) => e.kind === 'plane').length
    const was = count()
    const made = await run<A>('reverse.plane.along_path', { path: { element: 'Can' }, stations: { count: 3 }, name: 'Ring' })
    expect(made.planes).toHaveLength(3)
    expect(count()).toBe(was + 3)
    for (const p of made.planes) {
      expect(Math.abs(p.normal[2])).toBeCloseTo(1, 6)
      expect(p.element.name).toMatch(/^Ring \d$/)
      const el = useStore.getState().elements.find((e) => e.id === p.element.id)!
      expect(el.fit?.kind).toBe('plane')
    }
    expect(made.planes[1].origin[2]).toBeCloseTo(0, 1)
    await run('history.undo')
    expect(count()).toBe(was)
  })

  it('reads planes along a route through its bend without making them', async () => {
    const was = useStore.getState().elements.length
    const read = await run<A>('reverse.plane.along_path', { path: { route: { points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], bendRadius: 20 } }, stations: { at: [40, 80 + 5 * Math.PI] }, create: false })
    expect(useStore.getState().elements.length).toBe(was)
    expect(read.length).toBeCloseTo(160 + 10 * Math.PI, 2)
    expect(read.planes[0].normal).toEqual([1, 0, 0])
    expect(read.planes[1].normal[0]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(read.planes[1].plane).toMatchObject({ kind: 'oriented' })
    expect(read.planes[1].construct).toMatchObject({ kind: 'plane', method: 'plane-coords' })
    const off = await refused('reverse.plane.along_path', { path: { points: [[0, 0, 0], [10, 0, 0]] }, stations: { at: [20] }, create: false })
    expect(off.message).toMatch(/off the path/)
  })
})
