// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.body as an agent calls it: a bent bar on a plate made a
// closed body in one undo step, its deviation, checks and layouts tried in
// the answer, joined to an extruded plate by the boolean the description
// names, kept by a saved part, and left alone by reverse.network.edit; its
// input within what an agent's client lists; and what it refuses, nothing
// changed. In the in-process worker, the kernel in this thread, the
// viewport's scan stood in for by the mesh.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listCommands } from '../../../src/commands/registry'
import { SCHEMA_BUDGET, schemaWeight } from '../../../src/commands/schema'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, undoLabels, type Headless } from '../../../tests/commandKit'
import { validateReversePart } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import type { NetworkFeature } from '../core/features'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'
import { bar, onPlate, PLATE, type Scan, scanOf } from './regionScans'

vi.setConfig({ testTimeout: 300_000 })

let shown: Scan
const scene = { scanPositions: () => shown.positions, scanIndices: () => Uint32Array.from(shown.indices) } as unknown as SceneManager
let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: scene }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  shown = await scanOf(onPlate(bar), 0.5, 0.01)
  await run('scan.open', { bytes: stlBytes(soupOf(shown as never)), name: 'bar.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Made {
  id: number
  status: string
  closed: boolean
  valid: boolean
  volume: number
  faces: number
  region: { triangles: number; rims: number }
  deviation: { rms: number; p95: number; max: number; within: { mm: number; pct: number }[]; worst: unknown[]; bodyToScan: { p95: number } }
  smooth: { worstAngle: number; worstGap: number }
  tried: { density: number; lines: number; closed: boolean; patches: number; pctWithin: number; ms: number }[]
  warnings?: string[]
}
const ASK = { at: [13, 6, 11], planes: [{ point: [0, 0, 1], normal: [0, 0, 3] }], sink: 2 }

describe('reverse.freeform.body', () => {
  it('lists its input within what an agent’s client takes', () => {
    const c = listCommands().find((x) => x.name === 'reverse.freeform.body')!
    expect(c).toBeTruthy()
    const w = schemaWeight(c.input)
    expect(w.bytes).toBeLessThanOrEqual(SCHEMA_BUDGET.bytes)
    expect(w.depth).toBeLessThanOrEqual(SCHEMA_BUDGET.depth)
  })

  it('makes a closed body over the bar, and a boolean joins it to a plate', async () => {
    const had = undoLabels().length
    const made = await run<Made>('reverse.freeform.body', { ...ASK, name: 'Hook' })
    expect(made).toMatchObject({ status: 'ok', closed: true, valid: true })
    expect(undoLabels().length).toBe(had + 1)
    expect(made.deviation.within.find((w) => w.mm === 0.1)!.pct).toBeGreaterThan(99)
    expect(made.deviation.within.find((w) => w.mm === 0.25)!.pct).toBeGreaterThan(99.9)
    expect(made.deviation.bodyToScan.p95).toBeLessThan(0.05)
    expect(made.region.rims).toBe(1)
    // The simplest layout was enough, so no other was tried.
    expect(made.tried.length).toBe(1)
    expect(made.tried[0]).toMatchObject({ density: 1, lines: 4, closed: true })
    expect(made.warnings).toBeUndefined()
    // The plate as profiles make it, and the two joined as the description says.
    const size = [PLATE.max[0] - PLATE.min[0], PLATE.max[1] - PLATE.min[1]]
    const centre = [(PLATE.max[0] + PLATE.min[0]) / 2, (PLATE.max[1] + PLATE.min[1]) / 2]
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Outline', plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', center: centre, size }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Plate', sketchId: 'Outline', extent: { kind: 'distance', from: PLATE.min[2], to: 0 }, op: 'new' } })
    await run('reverse.feature.add', { feature: { kind: 'boolean', name: 'Joined', body: 'Plate', tool: 'Hook', op: 'join' } })
    const check = await run<{ bodies: { ok: boolean; closed: boolean; valid: boolean; clean: boolean; roundTrip: { ok: boolean } }[] }>('reverse.body.check', { roundTrip: true })
    expect(check.bodies).toMatchObject([{ ok: true, closed: true, valid: true, roundTrip: { ok: true } }])
    const body = useReverse.getState().bodies
    expect(body.length).toBe(1)
    expect(body[0].closed).toBe(true)
    expect(body[0].volume).toBeGreaterThan(size[0] * size[1] * 4 + made.volume * 0.7)
    // The part as a project keeps it.
    const f = useReverse.getState().features.find((x) => x.id === made.id) as NetworkFeature
    expect(f.region?.laid).toEqual({ density: 1, lines: 4 })
    const part = JSON.parse(JSON.stringify({ features: [f], nextFeatureId: 9, nextOfKind: {}, version: 3 }))
    expect(() => validateReversePart(part)).not.toThrow()
    part.features[0].region.sink = 'deep'
    expect(() => validateReversePart(part)).toThrow(/network.region/)
    // Its curves are not drawn: an edit of them is refused, its fit is not.
    expect((await refused('reverse.network.edit', { feature: 'Hook', fill: 'all' })).message).toMatch(/laid out by itself/)
    const read = await run<{ closed: boolean; counts: { patches: number } }>('reverse.network.read', { feature: 'Hook', detail: 'brief' })
    expect(read.closed).toBe(true)
    expect(read.counts.patches).toBe(made.tried[0].patches)
    await run('reverse.network.edit', { feature: 'Hook', fit: { smoothness: 0.002 } })
    expect((useReverse.getState().features.find((x) => x.id === made.id) as NetworkFeature).fit.smoothness).toBe(0.002)
    expect(useReverse.getState().results[made.id].network?.closed).toBe(true)
  })

  it('refuses a seed outside its planes, a handle, and a box the wrong way round, nothing changed', async () => {
    const had = undoLabels().length
    expect((await refused('reverse.freeform.body', { ...ASK, at: [18, 18, 0] })).message).toMatch(/outside plane 0/)
    expect((await refused('reverse.freeform.body', { at: [13, 6, 11], box: { min: [0, 0, 5], max: [1, 1, 1] } })).message).toMatch(/under max/)
    expect((await refused('reverse.freeform.body', { at: [13, 6, 11], planes: [{ point: [0, 0, 1], normal: [0, 0, 0] }] })).message).toMatch(/no length/)
    expect(undoLabels().length).toBe(had)
    expect(useReverse.getState().features.length).toBe(0)
  })
})
