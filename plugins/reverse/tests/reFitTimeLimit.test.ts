// SPDX-License-Identifier: AGPL-3.0-only
// A sketch's fit stopped at its time limit: a cut of many wandering bits,
// as a cut along a scan's scatter is, refused as a timeout with the part
// left as it was and the session free for the next call; the same cut
// fitted where it is given the time; a limit nested in another.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { densify, prism } from '../../../tests/shellMesh'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { addEntity, emptySketch } from '../core/sketch'
import { solveSketch } from '../core/solver'
import { checkTime, timeKept, TimeUp, withinTime } from '../core/timeLimit'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec2 = [number, number]

/** The walls of 60 islands, each wandering its own way, beside one plain
 *  square: a cut along scatter falls into as many. */
const SCAN = (() => {
  const rand = mulberry32(3)
  const parts = [soupOf(prism(densify([[-30, 0], [-10, 0], [-10, 20], [-30, 20]], 0.5), 4, 0.004), [0, 0, 0])]
  for (let i = 0; i < 60; i++) {
    const r0 = 0.8 + 1.4 * rand() ** 2
    const waves = [2, 3, 4, 5, 7].map((k) => [k, (0.3 * rand()) / Math.sqrt(k), 2 * Math.PI * rand()])
    const m = Math.max(16, Math.round((r0 * 2 * Math.PI) / 0.2))
    const loop = Array.from({ length: m }, (_, j): Vec2 => {
      const a = (2 * Math.PI * j) / m
      const r = Math.max(0.2, r0 * (1 + waves.reduce((s, [k, b, f]) => s + b * Math.cos(k * a + f), 0)) + 0.05 * (rand() - 0.5))
      return [6 * (i % 10) + r * Math.cos(a), 6 * Math.floor(i / 10) + r * Math.sin(a)]
    })
    parts.push(soupOf(prism(loop, 4, 0.004), [0, 0, 0]))
  }
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
})()

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(SCAN), name: 'bits.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

const PLANE = { kind: 'world', axis: 'z', offset: 2 }
const ACCEPT = { sigmas: 2, kinds: ['tangent', 'horizontal', 'vertical'] }
const add = (name: string, fit: object) => ({ feature: { kind: 'sketch', name, plane: PLANE, sketch: { fit } } })

describe('the time limit of a fit', () => {
  it('stops a fit that is past it, with nothing changed, and leaves the session free', async () => {
    const t = performance.now()
    const e = await refused('reverse.feature.add', add('Bits', { chains: 'all', accept: ACCEPT, timeLimit: 0.2 }))
    expect(e.code).toBe('timeout')
    expect(e.message).toMatch(/did not finish in 0\.2 s and was stopped; nothing was changed/)
    expect(performance.now() - t).toBeLessThan(10_000)
    expect(useReverse.getState().features).toEqual([])
    expect(useReverse.getState().sketchDraft).toBeNull()
    // The next call runs, under its own limit and not the one before it.
    const ok = await run<{ feature: { id: number } }>('reverse.feature.add', add('Square', { chains: { at: [-20, 10] }, accept: ACCEPT }))
    expect(ok.feature.id).toBeGreaterThan(0)
  })

  it('leaves an edited sketch as it was', async () => {
    await run('reverse.feature.add', add('Square', { chains: { at: [-20, 10] } }))
    const was = JSON.stringify(useReverse.getState().features)
    const e = await refused('reverse.sketch.edit', { sketch: 'Square', add: { fit: { chains: 'all', accept: ACCEPT, timeLimit: 0.2 } } })
    expect(e.code).toBe('timeout')
    expect(JSON.stringify(useReverse.getState().features)).toBe(was)
    expect(useReverse.getState().sketchDraft).toBeNull()
  })

  it('fits the same bits where it has the time', async () => {
    const all = await run<{ fitted: { skipped?: string }[] }>('reverse.feature.add', add('Bits', { chains: 'all', timeLimit: 120 }))
    expect(all.fitted.filter((f) => !f.skipped).length).toBeGreaterThan(50)
  })

  it('refuses a limit that is none', async () => {
    for (const timeLimit of [0, -1, 1e6]) expect((await refused('reverse.feature.add', add('Bits', { timeLimit }))).code).toBe('invalid_input')
  })
})

describe('within a time', () => {
  const wait = (ms: number) => {
    const t = performance.now()
    while (performance.now() - t < ms);
  }

  it('is checked by the solver, and not outside a limited run', () => {
    const line = () => {
      const s = emptySketch()
      addEntity(s, { kind: 'line', a: [0, 0], b: [5, 0.1], points: Array.from({ length: 30 }, (_, i): Vec2 => [i / 6, 0.02 * Math.sin(i)]) })
      return s
    }
    expect(() =>
      withinTime(1, () => {
        wait(3)
        return solveSketch(line())
      }),
    ).toThrow(TimeUp)
    expect(() => checkTime()).not.toThrow()
    expect(solveSketch(line()).ok).toBe(true)
  })

  it('keeps the shorter of two, puts the outer one back, and lets a run finish once it is kept', () => {
    withinTime(10_000, () => {
      expect(() =>
        withinTime(1, () => {
          wait(3)
          checkTime()
        }),
      ).toThrow('0.001 s')
      checkTime()
    })
    expect(() =>
      withinTime(1, () =>
        withinTime(10_000, () => {
          wait(3)
          checkTime()
        }),
      ),
    ).toThrow('0.001 s')
    withinTime(1, () => {
      wait(3)
      timeKept()
      checkTime()
    })
  })
})
