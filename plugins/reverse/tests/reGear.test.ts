// SPDX-License-Identifier: AGPL-3.0-only
// A gear read off a scan and built: a helical gear of 30 teeth, module 2,
// 15° right hand, 12 mm wide round a Ø20 bore, meshed and opened as a scan;
// scan.gear finds its band of teeth and reads its numbers back, and a gear
// feature made of the reading lies on the scan. Then the feature on its
// own: a spur gear's volume against its outline's area, the same gear
// turned by a helix keeping it, a tooth count driven by a parameter, and
// numbers that make no gear refused with the reason. On the in-process
// worker, the kernel in this thread — as reCommands.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { gearSoup, sampleOutline } from '../../../tests/gearKit'
import { gearOutline, type GearSpec } from '../../../src/core/geometry/gear'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 240_000 })

type Vec3 = [number, number, number]
interface Body { id: number; name: string; closed: boolean; volume: number }
interface Added { feature: { id: number; name: string }; result: { status: string; message?: string } | null }
interface GearRead {
  from: number
  to: number
  axis: { origin: Vec3; dir: Vec3; zeroDir: Vec3 }
  centreOff: number
  teeth: number
  module: number
  pressureDeg: number
  helixDeg: number
  shift: number
  tipDiameter: number
  rootDiameter: number
  phaseDeg: number
  standard: { name: string } | null
  flankRms: number
  broken: unknown[]
}

const HELICAL: GearSpec = { teeth: 30, module: 2, pressureDeg: 20, helixDeg: 15, shift: 0, tipDiameter: (30 * 2) / Math.cos((15 * Math.PI) / 180) + 4, rootDiameter: (30 * 2) / Math.cos((15 * Math.PI) / 180) - 5 }

/** A triangle soup's volume, mm³. */
function soupVolume(soup: Float32Array): number {
  let v = 0
  for (let i = 0; i < soup.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = soup.subarray(i, i + 9)
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  }
  return v / 6
}

/** A closed outline's area, mm². */
function area(pts: [number, number][]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []
const soup = gearSoup(HELICAL, 0.1, 0, 12, { step: 0.25, bore: 20 })
/** The gear as scan.gear reads it, once: the search cuts the scan some 60 times. */
let reading: Promise<{ gears: GearRead[] }> | null = null
const read = () => (reading ??= run<{ gears: GearRead[] }>('scan.gear', { axis: 'Z' }))

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(soup), name: 'gear.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

/** The body a feature made, as the part stands rebuilt. */
const bodyOf = async (added: Added) => (await run<{ bodies: Body[] }>('reverse.build')).bodies.find((b) => Math.floor(b.id) === added.feature.id)!

describe('a gear read off a scan and built', () => {
  it('finds the band of teeth and reads 30 teeth, module 2 at 20°, 15° right hand', async () => {
    const r = await read()
    expect(r.gears).toHaveLength(1)
    const g = r.gears[0]
    expect(g.teeth).toBe(30)
    expect(g.standard?.name).toBe('m 2, 20°')
    expect(g.module).toBe(2)
    expect(g.pressureDeg).toBe(20)
    expect(Math.abs(g.helixDeg - 15)).toBeLessThan(0.1)
    expect(Math.abs(g.shift)).toBeLessThan(0.05)
    expect(g.tipDiameter).toBeCloseTo(HELICAL.tipDiameter, 1)
    expect(g.rootDiameter).toBeCloseTo(HELICAL.rootDiameter, 1)
    expect(Math.abs(g.from)).toBeLessThan(0.15)
    expect(Math.abs(g.to - 12)).toBeLessThan(0.15)
    expect(g.centreOff).toBeLessThan(0.01)
    expect(g.flankRms).toBeLessThan(0.02)
    expect(g.broken).toEqual([])
  })

  it('builds the gear it reads, on the scan within 0.05 mm, as large as the mesh', async () => {
    const g = (await read()).gears[0]
    const added = await run<Added>('reverse.feature.add', {
      feature: { kind: 'gear', name: 'Gear', teeth: g.teeth, module: g.module, pressureDeg: g.pressureDeg, helixDeg: g.helixDeg, shift: g.shift, tipDiameter: g.tipDiameter, rootDiameter: g.rootDiameter, origin: g.axis.origin, dir: g.axis.dir, zeroDir: g.axis.zeroDir, from: 0, to: 12, phaseDeg: g.phaseDeg, bore: 20 },
    })
    expect(added.result?.status, added.result?.message).toBe('ok')
    const body = await bodyOf(added)
    expect(body.closed).toBe(true)
    expect(Math.abs(body.volume - soupVolume(soup)) / soupVolume(soup)).toBeLessThan(0.005)
    const score = await run<{ within: number; read: number }>('reverse.body.compare', { tolerance: 0.05, detail: 'score' })
    expect(score.within / score.read).toBeGreaterThan(0.97)
  })
})

describe('the gear feature', () => {
  const spur = (extra: Record<string, unknown> = {}) => ({ kind: 'gear', name: 'Spur', teeth: 20, module: 2, pressureDeg: 20, helixDeg: 0, shift: 0, tipDiameter: 44, rootDiameter: 35, origin: [0, 0, 30], dir: [0, 0, 1], zeroDir: [1, 0, 0], from: 0, to: 10, phaseDeg: 0, ...extra })

  it('builds a spur gear as its outline stood up, and a helix keeps its volume', async () => {
    const outline = area(sampleOutline(gearOutline({ teeth: 20, module: 2, pressureDeg: 20, helixDeg: 0, shift: 0, tipDiameter: 44, rootDiameter: 35 }, 0), 0.02))
    const made = await run<Added>('reverse.feature.add', { feature: spur() })
    expect(made.result?.status, made.result?.message).toBe('ok')
    const straight = await bodyOf(made)
    expect(straight.closed).toBe(true)
    // Within 0.2 %: the body's volume is read off its mesh.
    expect(Math.abs(straight.volume - outline * 10) / (outline * 10)).toBeLessThan(0.002)
    // The same transverse outline turned along the axis: as much material.
    // The helical gear is named to keep the transverse outline: its normal
    // module m_t cos β, its normal pressure angle atan(tan α_t cos β).
    const beta = (20 * Math.PI) / 180
    const pressureDeg = (Math.atan(Math.tan(beta) * Math.cos(beta)) * 180) / Math.PI
    const helical = await run<Added>('reverse.feature.add', { feature: spur({ name: 'Helical', module: 2 * Math.cos(beta), pressureDeg, helixDeg: 20, origin: [100, 0, 30] }) })
    expect(helical.result?.status, helical.result?.message).toBe('ok')
    const turned = await bodyOf(helical)
    expect(turned.closed).toBe(true)
    expect(Math.abs(turned.volume - straight.volume) / straight.volume).toBeLessThan(0.001)
  })

  it('follows a parameter on its tooth count', async () => {
    await run('reverse.parameter.add', { name: 'z', expression: '20', kind: 'integer' })
    const made = await run<Added>('reverse.feature.add', { feature: spur({ exprs: { teeth: 'z', tipDiameter: '(z + 2) * 2 mm', rootDiameter: '(z - 2.5) * 2 mm' } }) })
    expect(made.result?.status, made.result?.message).toBe('ok')
    const before = (await bodyOf(made)).volume
    await run('reverse.parameter.set', { name: 'z', expression: '24' })
    const after = (await bodyOf(made)).volume
    // Module 2 at 24 teeth: a larger gear, its area as (z + 2)² nearly.
    expect(after / before).toBeGreaterThan(1.3)
    expect(after / before).toBeLessThan(1.5)
  })

  it('refuses numbers that make no gear, saying why', async () => {
    expect((await refused('reverse.feature.add', { feature: spur({ tipDiameter: 60 }) })).message).toMatch(/come to a point/)
    expect((await refused('reverse.feature.add', { feature: spur({ to: 0 }) })).message).toMatch(/face width/)
    expect((await refused('reverse.feature.add', { feature: spur({ bore: 40 }) })).message).toMatch(/bore/)
  })
})
