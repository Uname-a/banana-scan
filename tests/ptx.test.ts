// SPDX-License-Identifier: AGPL-3.0-only
// PTX, a long-range laser scanner's gridded scans (core/parsers/ptx): a wall
// swept by a scanner made a surface that faces it, a near wall in front of a
// far one kept apart, the beam's dropouts, a scan's transform, two scans in
// one file, colour, a file cut off; then the formats and units it opens with,
// and the whole read through scan.open, in metres made millimetres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parsePTX } from '../src/core/parsers/ptx'
import { isModelFile, isPtxFile, isReferenceFile, SCAN_ACCEPT, REFERENCE_ACCEPT } from '../src/core/formats'
import { fixedUnits } from '../src/core/meshUnits'
import { meshUnitsFor } from '../src/state/unitsPromptStore'
import { refused, run, startHeadless, type Headless } from './commandKit'

type V3 = [number, number, number]

interface ScanSpec {
  columns: number
  rows: number
  /** Where the beam at azimuth and elevation (radians) lands, in the
   *  scanner's frame; null for no return. */
  hit: (az: number, el: number, column: number, row: number) => V3 | null
  /** The 4 × 4, a point [x y z 1] times it; identity if left out. */
  matrix?: number[][]
  origin?: V3
  rgb?: (column: number, row: number) => V3
  step?: number
}

const I4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

/** A scan's lines as a scanner exports them, column after column. */
function scanLines(s: ScanSpec): string[] {
  const step = s.step ?? (0.5 * Math.PI) / 180
  const m = s.matrix ?? I4
  const origin = s.origin ?? [m[3][0], m[3][1], m[3][2]]
  const lines = [String(s.columns), String(s.rows), origin.join(' '), '1 0 0', '0 1 0', '0 0 1', ...m.map((r) => r.join(' '))]
  for (let c = 0; c < s.columns; c++) {
    for (let r = 0; r < s.rows; r++) {
      const az = (c - (s.columns - 1) / 2) * step
      const el = (r - (s.rows - 1) / 2) * step
      const p = s.hit(az, el, c, r)
      const xyz = p ? p.map((v) => v.toFixed(6)).join(' ') : '0 0 0'
      const rgb = s.rgb ? ` ${s.rgb(c, r).join(' ')}` : ''
      lines.push(`${xyz} 0.5${rgb}`)
    }
  }
  return lines
}

const ptx = (...scans: ScanSpec[]): ArrayBuffer => new TextEncoder().encode(scans.flatMap(scanLines).join('\r\n') + '\r\n').buffer as ArrayBuffer

/** Where a beam from the scanner meets the wall x = d. */
const wallAt = (d: number) => (az: number, el: number): V3 => {
  const dir: V3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]
  const t = d / dir[0]
  return [dir[0] * t, dir[1] * t, dir[2] * t]
}

const vertex = (p: Float32Array, v: number): V3 => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const triangles = (m: { indices?: Uint32Array }) => (m.indices?.length ?? 0) / 3

describe('a PTX scan made a surface', () => {
  it('joins a wall’s grid into two triangles a square, facing the scanner, in metres', () => {
    const mesh = parsePTX(ptx({ columns: 12, rows: 9, hit: wallAt(5) }))
    expect(mesh.kind).toBe('indexed')
    expect(mesh.keepWinding).toBe(true)
    expect(mesh.positions.length / 3).toBe(12 * 9)
    expect(triangles(mesh)).toBe(2 * 11 * 8)
    const idx = mesh.indices!
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((v) => vertex(mesh.positions, v))
      expect(a[0]).toBeCloseTo(5, 5)
      // Its normal points back at the scanner at the origin.
      expect(dot(cross(sub(b, a), sub(c, a)), sub([0, 0, 0], a))).toBeGreaterThan(0)
    }
    expect(mesh.colors).toBeUndefined()
  })

  it('makes no triangle from a near wall to the far one seen past its edge', () => {
    const near = wallAt(2)
    const far = wallAt(6)
    const mesh = parsePTX(ptx({ columns: 20, rows: 6, hit: (az, el) => (az < 0 ? near(az, el) : far(az, el)) }))
    const idx = mesh.indices!
    let nearTris = 0
    let farTris = 0
    for (let t = 0; t < idx.length; t += 3) {
      const xs = [idx[t], idx[t + 1], idx[t + 2]].map((v) => mesh.positions[v * 3])
      const onNear = xs.every((x) => Math.abs(x - 2) < 1e-4)
      const onFar = xs.every((x) => Math.abs(x - 6) < 1e-4)
      expect(onNear || onFar).toBe(true)
      if (onNear) nearTris++
      else farTris++
    }
    // Ten columns each side: nine squares across each wall, five down.
    expect(nearTris).toBe(2 * 9 * 5)
    expect(farTris).toBe(2 * 9 * 5)
  })

  it('leaves out what the beam got nothing back for, and a point seen alone', () => {
    const wall = wallAt(4)
    // A hole of one point: its four squares lose a corner each and keep one triangle.
    const hole = parsePTX(ptx({ columns: 5, rows: 5, hit: (az, el, c, r) => (c === 2 && r === 2 ? null : wall(az, el)) }))
    expect(triangles(hole)).toBe(2 * 4 * 4 - 4)
    expect(hole.positions.length / 3).toBe(24)
    // A point with no neighbour seen is no part of the surface.
    const lone = parsePTX(ptx({ columns: 6, rows: 6, hit: (az, el, c, r) => (c < 3 || (c === 5 && r === 5) ? wall(az, el) : null) }))
    expect(lone.positions.length / 3).toBe(3 * 6)
    expect(triangles(lone)).toBe(2 * 2 * 5)
  })

  it('takes each point through its scan’s transform, the translation on the last row', () => {
    // A quarter turn about z, then 10 m along x: (x, y, z) → (10 − y, x, z).
    const matrix = [[0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 1, 0], [10, 0, 0, 1]]
    const mesh = parsePTX(ptx({ columns: 4, rows: 4, hit: wallAt(5), matrix }))
    for (let v = 0; v < mesh.positions.length / 3; v++) expect(mesh.positions[v * 3 + 1]).toBeCloseTo(5, 5)
    const idx = mesh.indices!
    const [a, b, c] = [idx[0], idx[1], idx[2]].map((v) => vertex(mesh.positions, v))
    // Facing the scanner, now at (10, 0, 0).
    expect(dot(cross(sub(b, a), sub(c, a)), sub([10, 0, 0], a))).toBeGreaterThan(0)
  })

  it('reads every scan in the file, each a grid of its own', () => {
    const mesh = parsePTX(ptx({ columns: 4, rows: 3, hit: wallAt(3) }, { columns: 5, rows: 5, hit: wallAt(3), matrix: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 2, 1]] }))
    expect(mesh.positions.length / 3).toBe(4 * 3 + 5 * 5)
    expect(triangles(mesh)).toBe(2 * 3 * 2 + 2 * 4 * 4)
  })

  it('keeps the scanner’s colours when every point has them', () => {
    const mesh = parsePTX(ptx({ columns: 3, rows: 3, hit: wallAt(2), rgb: (c, r) => [c * 100, r * 100, 7] }))
    expect(mesh.colors).toBeInstanceOf(Uint8Array)
    expect(mesh.colors!.length).toBe(mesh.positions.length)
    expect(Array.from(mesh.colors!.slice(0, 3))).toEqual([0, 0, 7])
    // Colour on some points only: none.
    const lines = scanLines({ columns: 2, rows: 2, hit: wallAt(2), rgb: () => [1, 2, 3] })
    lines[lines.length - 1] = lines[lines.length - 1].split(' ').slice(0, 4).join(' ')
    expect(parsePTX(new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer).colors).toBeUndefined()
  })

  it('says where a file is cut off or is not a PTX', () => {
    const lines = scanLines({ columns: 4, rows: 4, hit: wallAt(3) })
    const cut = (n: number) => new TextEncoder().encode(lines.slice(0, n).join('\n')).buffer as ArrayBuffer
    expect(() => parsePTX(cut(lines.length - 3))).toThrow('ends partway through scan 1: 13 of its 16 points')
    expect(() => parsePTX(cut(5))).toThrow('partway through the header of scan 1')
    expect(() => parsePTX(new ArrayBuffer(0))).toThrow('holds no scan')
    expect(() => parsePTX(new TextEncoder().encode('solid x\nfacet normal 0 0 1\n').buffer as ArrayBuffer)).toThrow(/cannot be read: a scan does not start with its columns and rows \(line 1\)/)
    const nothing = scanLines({ columns: 3, rows: 3, hit: () => null })
    expect(() => parsePTX(new TextEncoder().encode(nothing.join('\n')).buffer as ArrayBuffer)).toThrow('make no surface')
  })
})

describe('what a PTX opens as', () => {
  it('is the scan, never the reference, and in metres whatever units are asked', async () => {
    expect(isModelFile('site.PTX')).toBe(true)
    expect(isPtxFile('site.ptx')).toBe(true)
    expect(isReferenceFile('site.ptx')).toBe(false)
    expect(SCAN_ACCEPT).toContain('.ptx')
    expect(REFERENCE_ACCEPT).not.toContain('.ptx')
    expect(fixedUnits('site.ptx', 'in')).toBe('m')
    expect(fixedUnits('part.3mf', 'in')).toBe('mm')
    expect(fixedUnits('part.ply', 'cm')).toBe('cm')
    expect(await meshUnitsFor('site.ptx')).toBe('m')
    expect(await meshUnitsFor('part.obj')).toBe('mm')
  })
})

describe('scan.open with a PTX', () => {
  let headless: Headless
  beforeAll(async () => {
    headless = await startHeadless()
  })
  afterAll(() => headless.stop())

  it('reads the metres as millimetres, and a plane fits the wall where it is', async () => {
    const bytes = new Uint8Array(ptx({ columns: 30, rows: 30, hit: wallAt(5) }))
    const { scan } = await run<{ scan: { units: string; triangles: number; bounds: { min: number[]; max: number[] } } }>('scan.open', { bytes, name: 'wall.ptx', units: 'mm', discard: true })
    expect(scan.units).toBe('m')
    expect(scan.triangles).toBe(2 * 29 * 29)
    expect(scan.bounds.min[0]).toBeCloseTo(5000, 1)
    expect(scan.bounds.max[0]).toBeCloseTo(5000, 1)
    const fit = await run<{ element: { fit: { normal: number[]; center: number[] } } }>('element.fit', { kind: 'plane', at: { point: [5000, 0, 0] } })
    expect(Math.abs(fit.element.fit.normal[0])).toBeCloseTo(1, 4)
    expect(fit.element.fit.center[0]).toBeCloseTo(5000, 2)
  })

  it('is refused as the reference', async () => {
    const bytes = new Uint8Array(ptx({ columns: 4, rows: 4, hit: wallAt(5) }))
    const e = await refused('deviation.open_reference', { bytes, name: 'wall.ptx' })
    expect(e.message).toMatch(/PTX|ptx/)
  })
})
