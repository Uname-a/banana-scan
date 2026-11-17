// SPDX-License-Identifier: AGPL-3.0-only
// PTX: what long-range (terrestrial) laser scanners write — Leica Cyclone,
// FARO SCENE, Trimble RealWorks and others export it. A file holds one scan
// or several, one after another, each a grid of points as the scanner swept
// them, in metres:
//
//   columns
//   rows
//   the scanner's registered position          x y z
//   its registered axes                         3 lines of x y z
//   the scan's 4 × 4 transform                  4 lines of 4, the translation last
//   columns × rows points, column after column  x y z intensity [r g b]
//
// A point the beam got nothing back for is written 0 0 0, and the points
// are in the scanner's own frame, the transform taking them into the
// registered one (as CloudCompare and PCL read it).
//
// The grid is what makes a PTX a mesh without guessing: neighbours in the
// sweep are neighbours on the surface, so each square of four points is two
// triangles, except where the beam stepped off one surface onto another
// behind it. There the gap between neighbours is far wider than the sweep's
// step at that range, and no triangle is made across it. Each triangle faces
// the scanner that saw it, and keeps that winding (keepWinding). Scans that
// overlap give overlapping sheets, as the scanner saw them; Wrap makes one
// surface of them.
//
// The coordinates come out in metres, as written: the file's units are fixed
// (see core/meshUnits), and the import scales them to millimetres like any
// other file's.

import type { ParsedMesh } from '../types'
import { eachLine, gatherFloats, gatherIndices } from './textChunks'

/** A triangle is made only where its edges are at most this many sweep
 *  steps long at their range: a surface seen at up to about 83° from the
 *  beam stays whole, and a step from a near surface to one behind it breaks. */
export const PTX_EDGE_STEPS = 8

/** How many neighbouring pairs a scan's sweep step is measured from. */
const STEP_SAMPLES = 20_000

interface Scan {
  columns: number
  rows: number
  origin: [number, number, number]
  /** The transform, row after row: a point [x y z 1] times it. */
  matrix: number[]
  /** Each grid cell's vertex, or -1 where the beam got nothing back. */
  vertex: Int32Array
  /** How many of its points are read so far. */
  read: number
}

const numbers = (line: string): number[] => {
  const out: number[] = []
  for (const w of line.trim().split(/\s+/)) if (w !== '') out.push(Number(w))
  return out
}

export function parsePTX(buffer: ArrayBuffer, onProgress?: (text: string) => void): ParsedMesh {
  const bytes = new Uint8Array(buffer)
  const positions = gatherFloats()
  const colours = gatherFloats()
  let coloured = true
  const triangles = gatherIndices()
  const scans: number[] = []

  // The header being read: its numbers so far, line by line.
  let header: number[][] = []
  let scan: Scan | null = null
  let lineNo = 0

  const fail = (why: string): never => {
    throw new Error(`This PTX file cannot be read: ${why} (line ${lineNo}).`)
  }

  const startScan = (h: number[][]): Scan => {
    const columns = h[0][0]
    const rows = h[1][0]
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) fail('a scan does not start with its columns and rows')
    if (columns * rows > 2 ** 31 - 1) fail(`a scan of ${columns} × ${rows} points is more than can be read`)
    const shape = [1, 1, 3, 3, 3, 3, 4, 4, 4, 4]
    h.forEach((nums, i) => {
      if (nums.length < shape[i] || nums.slice(0, shape[i]).some((n) => !Number.isFinite(n))) fail('a scan’s header is not its position, axes and transform')
    })
    return {
      columns,
      rows,
      origin: [h[2][0], h[2][1], h[2][2]],
      matrix: h.slice(6, 10).flatMap((r) => r.slice(0, 4)),
      vertex: new Int32Array(columns * rows),
      read: 0,
    }
  }

  const finishScan = (s: Scan): void => {
    triangulate(s, positions.peek(), triangles)
    scans.push(s.columns * s.rows)
  }

  eachLine(
    bytes,
    (line) => {
      lineNo++
      if (scan === null) {
        if (header.length === 0 && line.trim() === '') return
        const nums = numbers(line)
        // Its columns, then its rows: a file that is no PTX is told at once.
        if (header.length < 2 && !(nums.length === 1 && Number.isInteger(nums[0]) && nums[0] > 0)) fail('a scan does not start with its columns and rows')
        header.push(nums)
        if (header.length === 10) {
          scan = startScan(header)
          header = []
        }
        return
      }
      const s = scan
      const p = numbers(line)
      if (p.length < 3 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) fail('a point is not x y z')
      const [x, y, z] = p
      if (x === 0 && y === 0 && z === 0) {
        s.vertex[s.read] = -1
      } else {
        const m = s.matrix
        s.vertex[s.read] = positions.length / 3
        positions.push3(x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14])
        if (p.length >= 7) colours.push3(p[4], p[5], p[6])
        else coloured = false
      }
      s.read++
      if (s.read === s.columns * s.rows) {
        finishScan(s)
        scan = null
      }
    },
    (done) => onProgress?.(`Reading PTX scans… ${Math.round(done * 100)}%`),
  )

  if (scan !== null) {
    const s: Scan = scan
    throw new Error(`This PTX file ends partway through scan ${scans.length + 1}: ${s.read.toLocaleString('en-US')} of its ${(s.columns * s.rows).toLocaleString('en-US')} points are there.`)
  }
  if (header.length > 0) throw new Error(`This PTX file ends partway through the header of scan ${scans.length + 1}.`)
  if (scans.length === 0) throw new Error('This PTX file holds no scan.')

  const indices = triangles.take()
  if (indices.length === 0) throw new Error('This PTX file’s scans make no surface: too few of their neighbouring points were seen.')
  const all = positions.take()
  const rgb = coloured ? colours.take() : null
  return compact(all, indices, rgb)
}

/** The sweep's step, as an angle: the median gap between neighbouring points
 *  over their range, down the columns and across them, the wider taken. */
function sweepStep(s: Scan, p: Float32Array): number {
  const [ox, oy, oz] = s.origin
  const range = (v: number) => Math.hypot(p[v * 3] - ox, p[v * 3 + 1] - oy, p[v * 3 + 2] - oz)
  const gap = (a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2])
  const median = (pairs: (k: number) => [number, number] | null, count: number): number => {
    const ratios: number[] = []
    const stride = Math.max(1, Math.floor(count / STEP_SAMPLES))
    for (let k = 0; k < count; k += stride) {
      const pair = pairs(k)
      if (!pair) continue
      const [a, b] = pair
      const r = (range(a) + range(b)) / 2
      if (r > 0) ratios.push(gap(a, b) / r)
    }
    if (ratios.length === 0) return 0
    ratios.sort((a, b) => a - b)
    return ratios[ratios.length >> 1]
  }
  const { rows, columns, vertex } = s
  // Down a column: the next row; across: the next column, the same row.
  const down = median((k) => {
    if (k % rows === rows - 1) return null
    const a = vertex[k]
    const b = vertex[k + 1]
    return a >= 0 && b >= 0 ? [a, b] : null
  }, columns * rows)
  const across = median((k) => {
    if (k + rows >= columns * rows) return null
    const a = vertex[k]
    const b = vertex[k + rows]
    return a >= 0 && b >= 0 ? [a, b] : null
  }, columns * rows)
  return Math.max(down, across)
}

/** Two triangles a square of the grid, where the beam saw its corners and
 *  they lie on one surface; one where it saw three. */
function triangulate(s: Scan, p: Float32Array, out: ReturnType<typeof gatherIndices>): void {
  const step = sweepStep(s, p)
  if (step === 0) return
  const [ox, oy, oz] = s.origin
  const reach = PTX_EDGE_STEPS * step
  const range = (v: number) => Math.hypot(p[v * 3] - ox, p[v * 3 + 1] - oy, p[v * 3 + 2] - oz)
  const gap2 = (a: number, b: number) => {
    const dx = p[a * 3] - p[b * 3]
    const dy = p[a * 3 + 1] - p[b * 3 + 1]
    const dz = p[a * 3 + 2] - p[b * 3 + 2]
    return dx * dx + dy * dy + dz * dz
  }
  const near = (a: number, b: number) => {
    const limit = reach * Math.max(range(a), range(b))
    return gap2(a, b) <= limit * limit
  }
  const add = (a: number, b: number, c: number) => {
    if (!near(a, b) || !near(b, c) || !near(c, a)) return
    // Facing the scanner: the normal points back along the beam.
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2]
    const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az
    const vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    if (nx * (ox - ax) + ny * (oy - ay) + nz * (oz - az) >= 0) out.push3(a, b, c)
    else out.push3(a, c, b)
  }
  const { rows, columns, vertex } = s
  for (let c = 0; c + 1 < columns; c++) {
    for (let r = 0; r + 1 < rows; r++) {
      const a = vertex[c * rows + r]
      const b = vertex[c * rows + r + 1]
      const d = vertex[(c + 1) * rows + r]
      const e = vertex[(c + 1) * rows + r + 1]
      const seen = (a >= 0 ? 1 : 0) + (b >= 0 ? 1 : 0) + (d >= 0 ? 1 : 0) + (e >= 0 ? 1 : 0)
      if (seen === 4) {
        // Cut along the shorter diagonal.
        if (gap2(a, e) <= gap2(b, d)) {
          add(a, b, e)
          add(a, e, d)
        } else {
          add(a, b, d)
          add(b, e, d)
        }
      } else if (seen === 3) {
        const [x, y, z] = [a, b, e, d].filter((v) => v >= 0)
        add(x, y, z)
      }
    }
  }
}

/** Only the points a triangle uses: a point seen alone, or across a gap
 *  from all its neighbours, is no part of the surface. */
function compact(positions: Float32Array, indices: Uint32Array, rgb: Float32Array | null): ParsedMesh {
  const vertexCount = positions.length / 3
  const remap = new Int32Array(vertexCount).fill(-1)
  let kept = 0
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    if (remap[v] < 0) remap[v] = kept++
    indices[i] = remap[v]
  }
  const outPositions = new Float32Array(kept * 3)
  const colors = rgb ? new Uint8Array(kept * 3) : null
  for (let v = 0; v < vertexCount; v++) {
    const to = remap[v]
    if (to < 0) continue
    outPositions[to * 3] = positions[v * 3]
    outPositions[to * 3 + 1] = positions[v * 3 + 1]
    outPositions[to * 3 + 2] = positions[v * 3 + 2]
    if (colors && rgb) for (let k = 0; k < 3; k++) colors[to * 3 + k] = Math.max(0, Math.min(255, Math.round(rgb[v * 3 + k])))
  }
  return { kind: 'indexed', positions: outPositions, indices, keepWinding: true, ...(colors ? { colors } : {}) }
}
