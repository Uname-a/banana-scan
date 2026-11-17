// SPDX-License-Identifier: AGPL-3.0-only
// Two partial scans of one part placed one on the other (deviation/overlap.ts):
// the two sides of a part, sharing only a band round its middle.
import { describe, expect, it } from 'vitest'
import { overlapAuto, overlapFromPairs } from '../src/core/deviation/overlap'
import { rigidApply, rigidCompose, rigidFromAxisAngle, rigidInvert, type Rigid } from '../src/core/deviation/rigid'
import { NominalSurface } from '../src/core/deviation/surface'
import { computeVertexNormals } from '../src/core/geometry/normals'
import { mulberry32 } from '../src/core/fit/ransac'
import { gaussian, poseError } from './helpers'

type Mesh = { positions: Float32Array; indices: Uint32Array }

/** A lumpy closed part about 80 × 60 × 40 mm with no symmetry: a sphere grid
 *  pushed out by a few waves. */
function part(n = 110): Mesh {
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= n; i++) {
    const th = (Math.PI * i) / n
    for (let j = 0; j < 2 * n; j++) {
      const ph = (Math.PI * j) / n
      const r = 1 + 0.18 * Math.sin(3 * th) * Math.cos(2 * ph + 0.4) + 0.1 * Math.cos(5 * ph) * Math.sin(th) + 0.07 * Math.sin(2 * th + ph)
      pos.push(40 * r * Math.sin(th) * Math.cos(ph) + 6, 30 * r * Math.sin(th) * Math.sin(ph), 20 * r * Math.cos(th) + 3)
    }
  }
  const at = (i: number, j: number) => i * 2 * n + (j % (2 * n))
  for (let i = 0; i < n; i++)
    for (let j = 0; j < 2 * n; j++) {
      idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1))
      idx.push(at(i, j), at(i + 1, j + 1), at(i, j + 1))
    }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }
}

/** The triangles with every corner where `keep` says, compacted. */
function piece(m: Mesh, keep: (z: number) => boolean): Mesh {
  const map = new Int32Array(m.positions.length / 3).fill(-1)
  const pos: number[] = []
  const idx: number[] = []
  for (let t = 0; t < m.indices.length; t += 3) {
    const c = [m.indices[t], m.indices[t + 1], m.indices[t + 2]]
    if (!c.every((v) => keep(m.positions[v * 3 + 2]))) continue
    for (const v of c) {
      if (map[v] < 0) {
        map[v] = pos.length / 3
        pos.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
      }
      idx.push(map[v])
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }
}

function moved(p: Float32Array, m: Rigid, noise = 0): Float32Array {
  const rand = mulberry32(7)
  const out = new Float32Array(p.length)
  const t = new Float64Array(3)
  for (let i = 0; i < p.length; i += 3) {
    rigidApply(m, p[i], p[i + 1], p[i + 2], t)
    out[i] = t[0] + gaussian(rand) * noise
    out[i + 1] = t[1] + gaussian(rand) * noise
    out[i + 2] = t[2] + gaussian(rand) * noise
  }
  return out
}

// The underside as its scanner left it: turned over and moved off.
const POSE = rigidCompose(rigidFromAxisAngle([0.3, 1, 0.1], 2.6), rigidFromAxisAngle([0, 0, 1], 0.7))
POSE.t[0] = 35
POSE.t[1] = -12
POSE.t[2] = 50
const TRUTH = rigidInvert(POSE)

function sides(band: number, noise = 0) {
  const whole = part()
  const top = piece(whole, (z) => z > 3 - band)
  const under = piece(whole, (z) => z < 3 + band)
  const surface = new NominalSurface(top.positions, top.indices)
  const ownNormals = computeVertexNormals(top.positions, top.indices)
  const other = moved(under.positions, POSE, noise)
  const otherNormals = computeVertexNormals(other, under.indices)
  return { surface, ownNormals, other, otherNormals, under }
}

describe('two partial scans of one part placed one on the other', () => {
  for (const band of [12, 6]) {
    it(`automatically, sharing a band ±${band} mm round the middle`, () => {
      const s = sides(band)
      const r = overlapAuto(s.surface, s.ownNormals, s.other, s.otherNormals)
      expect(poseError(r.transform, TRUTH, s.other)).toBeLessThan(0.05)
      expect(r.source).toBe('auto')
      expect(r.overlap).toBeGreaterThan(0.1)
      expect(r.overlap).toBeLessThan(0.8)
    }, 120_000)
  }

  it('on a band too thin to tell apart it says so, rather than placing it wrong', () => {
    const s = sides(2)
    let placed: ReturnType<typeof overlapAuto> | null = null
    try {
      placed = overlapAuto(s.surface, s.ownNormals, s.other, s.otherNormals)
    } catch (e) {
      expect(String(e)).toMatch(/Pick three points/)
    }
    if (placed) expect(poseError(placed.transform, TRUTH, s.other)).toBeLessThan(0.05)
  }, 120_000)

  it('from three rough picks, on a narrow band (a whole-scan fit drifts off here)', () => {
    const s = sides(3)
    const pairs = [[40, 0, 3], [-20, 25, 3], [0, -28, 0]].map((q) => {
      const p = new Float64Array(3)
      rigidApply(POSE, q[0] + 1, q[1] - 1, q[2], p)
      return { scan: [p[0], p[1], p[2]] as [number, number, number], nominal: q as [number, number, number] }
    })
    const r = overlapFromPairs(s.surface, s.other, s.otherNormals, pairs)
    expect(poseError(r.transform, TRUTH, s.other)).toBeLessThan(0.05)
    expect(r.source).toBe('points')
  }, 60_000)

  it('scans exported in one frame stay where they are', () => {
    const s = sides(12)
    const inPlace = moved(s.under.positions, rigidFromAxisAngle([0, 0, 1], 0))
    const r = overlapAuto(s.surface, s.ownNormals, inPlace, computeVertexNormals(inPlace, s.under.indices))
    expect(r.source).toBe('frame')
    expect(poseError(r.transform, rigidFromAxisAngle([0, 0, 1], 0), inPlace)).toBeLessThan(0.01)
  }, 120_000)

  it('with scanner noise the overlap still places it to a fraction of the noise', () => {
    const s = sides(8, 0.03)
    const r = overlapAuto(s.surface, s.ownNormals, s.other, s.otherNormals)
    expect(poseError(r.transform, TRUTH, s.other)).toBeLessThan(0.1)
    expect(r.rms).toBeLessThan(0.1)
  }, 120_000)

  it('picks along a line are refused, with the reason', () => {
    const s = sides(12)
    const line = [0, 10, 20].map((x) => ({ scan: [x, 0, 0] as [number, number, number], nominal: [x, 0, 0] as [number, number, number] }))
    expect(() => overlapFromPairs(s.surface, s.other, s.otherNormals, line)).toThrow(/line/)
  })
})
