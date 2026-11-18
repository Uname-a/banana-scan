// SPDX-License-Identifier: AGPL-3.0-only
// Unroll and flatten through the commands, as an agent drives them: a
// scanned cylinder panel with a window in it opened, a cylinder fitted to
// it, the panel unrolled by the cylinder and flattened as a sheet, and the
// pattern written as a DXF and an SVG. The mesh worker runs in this thread
// under the app's own headless session (tests/commandKit.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createMeshToolsSession, installMeshToolsSession } from '../app/meshToolsSession'
import plugin from '../plugin'

vi.setConfig({ testTimeout: 120_000 })

type Vec3 = [number, number, number]

/** A panel of a cylinder of radius 20 round +z: 42 mm of arc by 50 high on
 *  a 1 mm grid, a 10 × 8 window 16 mm along it and 20 up, as a triangle
 *  soup facing out. */
function panel(): Float32Array {
  const R = 20
  const at = (i: number, j: number): Vec3 => [R * Math.cos(i / R), R * Math.sin(i / R), j]
  const out: number[] = []
  for (let j = 0; j < 50; j++) {
    for (let i = 0; i < 42; i++) {
      if (i >= 16 && i < 26 && j >= 20 && j < 28) continue
      out.push(...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1))
    }
  }
  return Float32Array.from(out)
}

interface PatternAnswer {
  pattern: { width: number; height: number; area: number; holes: { width: number; height: number; center: [number, number] }[]; loops: number }
  distortion: { lengthPercent: { max: number; mean: number }; flipped: number }
  residual?: { rms: number; max: number }
  radius?: number
  status: string
}

let headless: Headless
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  const s = headless.session
  const session = createMeshToolsSession({
    clientRef: s.clientRef,
    sceneRef: { current: null },
    sources: s.sources,
    imports: s.imports,
    swapScan: s.swap.swapScan,
    remapScan: s.swap.remapScan,
    remeasureScan: s.swap.remeasureScan,
  })
  stops.push(installMeshToolsSession(session), session.watch())
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})

describe('flat patterns through the commands', () => {
  it('refuses with nothing to lay out', async () => {
    expect((await refused('mesh.export_pattern')).code).toBe('invalid_state')
    await run('scan.open', { bytes: stlBytes(panel()), name: 'panel.stl', discard: true })
    expect((await refused('mesh.unroll', { element: 'Cylinder 9' })).code).toBe('not_found')
  })

  it('unrolls the panel by the cylinder fitted to it, true to size', async () => {
    await run('scan.open', { bytes: stlBytes(panel()), name: 'panel.stl', discard: true })
    const fitted = await run<{ element: { id: number; name: string } }>('element.fit', { kind: 'cylinder', at: { point: [20 * Math.cos(0.4), 20 * Math.sin(0.4), 10] } })
    const a = await run<PatternAnswer>('mesh.unroll', { element: fitted.element.id })
    expect(a.radius).toBeCloseTo(20, 2)
    expect(a.residual!.max).toBeLessThan(0.01)
    expect(a.pattern.width).toBeCloseTo(42, 1)
    expect(a.pattern.height).toBeCloseTo(50, 2)
    expect(a.pattern.holes).toHaveLength(1)
    expect(a.pattern.holes[0].width).toBeCloseTo(10, 1)
    expect(a.pattern.holes[0].height).toBeCloseTo(8, 2)
    expect(a.distortion.flipped).toBe(0)
    expect(a.status).toMatch(/^Unrolled /)

    const dxf = await run<{ file: { name: string; bytes: Uint8Array } }>('mesh.export_pattern', { format: 'dxf' })
    expect(dxf.file.name).toMatch(/-unrolled\.dxf$/)
    const text = new TextDecoder().decode(dxf.file.bytes)
    expect(text.match(/LWPOLYLINE/g)).toHaveLength(2)
    expect(text).toContain('flat pattern')
    const svg = await run<{ file: { name: string; bytes: Uint8Array } }>('mesh.export_pattern', { format: 'svg' })
    expect(svg.file.name).toMatch(/-unrolled\.svg$/)
    expect(new TextDecoder().decode(svg.file.bytes).match(/<polyline/g)).toHaveLength(2)

    // Laid out at a radius a millimetre out, the arc is longer by 21/20.
    const out = await run<PatternAnswer>('mesh.unroll', { element: fitted.element.name, offset: 1 })
    expect(out.pattern.width).toBeCloseTo(42 * (21 / 20), 1)
  })

  it('flattens the panel as a sheet, with next to no stretch', async () => {
    await run('scan.open', { bytes: stlBytes(panel()), name: 'panel.stl', discard: true })
    const a = await run<PatternAnswer & { converged: boolean }>('mesh.flatten', { region: { box: { min: [-30, -30, -1], max: [30, 30, 51] } } })
    // The panel's facets are flat chords of the arc: flattened, it is the
    // chords' width, a hair short of the arc's — and its long side, the
    // 50 mm height, is laid along x.
    expect(a.pattern.width).toBeCloseTo(50, 1)
    expect(a.pattern.height).toBeCloseTo(42, 1)
    expect(a.pattern.holes).toHaveLength(1)
    expect(a.distortion.lengthPercent.max).toBeLessThan(0.1)
    expect(a.distortion.flipped).toBe(0)
    expect(a.status).toMatch(/^Flattened /)
    const dxf = await run<{ file: { name: string } }>('mesh.export_pattern')
    expect(dxf.file.name).toMatch(/-flattened\.dxf$/)
  })
})
