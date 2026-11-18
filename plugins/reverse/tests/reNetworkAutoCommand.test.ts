// SPDX-License-Identifier: AGPL-3.0-only
// reverse.network.auto as an agent calls it: a can with a domed top laid
// out by itself into a closed network of six patches in one undo step, its
// layout, deviation and continuity in the answer and the network read back
// as any other; its input within what an agent's client lists; and an open
// sheet refused, nothing changed. In the in-process worker, the kernel in
// this thread, the viewport's scan stood in for by the mesh drawn on.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listCommands } from '../../../src/commands/registry'
import { SCHEMA_BUDGET, schemaWeight } from '../../../src/commands/schema'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, undoLabels, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { gridScan, roundedBoxScan } from './networkMeshes'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 300_000 })

const NOISE = 0.01
const can = roundedBoxScan(15, 15, 20, 15, 3, 50, NOISE)
const sheet = gridScan(60, 40, (u, v): Vec3 => [60 * u, 40 * v, 2 * Math.sin(3 * u) * Math.cos(2 * v)], { noise: NOISE })

let shown: { positions: Float32Array; indices: Uint32Array } = can
const scene = { scanPositions: () => shown.positions, scanIndices: () => Uint32Array.from(shown.indices) } as unknown as SceneManager

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

async function open(mesh: typeof can | typeof sheet, name: string) {
  shown = mesh
  await run('scan.open', { bytes: stlBytes(soupOf(mesh)), name, discard: true })
}

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: scene }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Auto {
  result?: { status: string; message?: string }
  closed?: boolean
  line: string
  patches?: { patch: number; rms: number; max: number }[]
  layout: { creases: number; cuts: number; cells: number; patches: number; regions: { kind: string; action: string; cuts?: number }[]; left?: unknown[] }
  deviation: { rms: number; worstRms: number; worstMax: number; worstPatch: number }
  continuity: { tangent: number; creases: number; curvature: string; corners?: number }
  bodies?: { changed?: { id: number; closed?: boolean; surface?: boolean; faces: number }[]; added?: { closed?: boolean; faces: number }[] }
}

describe('reverse.network.auto', () => {
  it('lists its input within what an agent’s client takes', () => {
    const c = listCommands().find((x) => x.name === 'reverse.network.auto')!
    expect(c).toBeTruthy()
    const w = schemaWeight(c.input)
    expect(w.bytes).toBeLessThanOrEqual(SCHEMA_BUDGET.bytes)
    expect(w.depth).toBeLessThanOrEqual(SCHEMA_BUDGET.depth)
  })

  it('lays a can out by itself into a closed network of six patches, in one undo step', async () => {
    await open(can, 'can.stl')
    const made = await run<Auto>('reverse.network.auto', { name: 'Can skin' })
    expect(made.result?.status, made.result?.message).toBe('ok')
    expect(made.closed).toBe(true)
    expect(made.layout).toMatchObject({ creases: 8, cuts: 4, cells: 6, patches: 6 })
    expect(made.layout.regions.map((r) => `${r.kind} ${r.action}`).sort()).toEqual(['disk cell', 'disk cell', 'ring cut'])
    expect(made.layout.left).toBeUndefined()
    // The deviation, per patch and in short.
    expect(made.patches?.length).toBe(6)
    for (const p of made.patches!) {
      expect(p.rms).toBeLessThan(2.5 * NOISE)
      expect(p.max).toBeLessThan(0.1)
    }
    expect(made.deviation.worstMax).toBe(Math.max(...made.patches!.map((p) => p.max)))
    expect(made.deviation.rms).toBeLessThan(2 * NOISE)
    // Tangent across the cuts, the rims folded; curvature said not held.
    expect(made.continuity.tangent).toBeLessThan(0.01)
    expect(made.continuity.creases).toBe(8)
    expect(made.continuity.curvature).toMatch(/not held/)
    expect(made.line).toMatch(/closed — a solid/)
    expect(undoLabels().at(-1)).toBe('Agent: lay out patch network “Can skin”')

    // Read back as any network.
    const read = await run<{ status: string; closed: boolean; counts: { patches: number; refused: number } }>('reverse.network.read', { feature: 'Can skin', detail: 'brief' })
    expect(read.status).toBe('ok')
    expect(read.closed).toBe(true)
    expect(read.counts).toMatchObject({ patches: 6, refused: 0 })
  })

  it('refuses an open sheet, saying why, and changes nothing', async () => {
    await open(sheet, 'sheet.stl')
    const before = undoLabels().length
    const r = await refused('reverse.network.auto', {})
    expect(r.message).toMatch(/No region of the scan came out a cell/)
    expect(r.message).toMatch(/rim/)
    expect(undoLabels().length).toBe(before)
  })
})
