// SPDX-License-Identifier: AGPL-3.0-only
// One skin of a bent sheet (core/skin) and its points on the pattern
// (core/flatPattern patternPointsOf): a sheet 1.5 mm thick bent a quarter
// turn at a 1.5 mm inside radius, its two flanges 30 mm, 20 mm wide — both
// skins and the edges between them meshed, as a scan of a bracket is. Grown
// from the middle of a flange the skin is the whole outer skin and nothing
// of the inner one; flattened it is the outer skin's developed length,
// 30 + 3π/2 + 30 mm; and the bend's centre line falls on one straight line
// across the blank, halfway along it.

import { describe, expect, it } from 'vitest'
import { flatten } from '../../../src/core/develop/flatten'
import { patternPointsOf } from '../core/flatPattern'
import { SKIN_MIN_RADIUS, skinVertices } from '../core/skin'

type P2 = [number, number]

const T = 1.5
const RI = 1.5
const RO = RI + T
const FLANGE = 30
const WIDTH = 20
const STEP = 0.4

/** Points along a polyline every STEP or so, its ends kept. */
function along(points: P2[]): P2[] {
  const out: P2[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP))
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

/** An arc about c of radius r from angle a0 to a1 (measured from −z towards +x), every STEP or so along it. */
function arc(c: P2, r: number, a0: number, a1: number): P2[] {
  const n = Math.max(2, Math.round((Math.abs(a1 - a0) * r) / STEP))
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n
    return [c[0] + r * Math.sin(a), c[1] - r * Math.cos(a)] as P2
  })
}

/**
 * The bent sheet's section in x, z, round it once: the outer skin (flange A
 * along z = 0 from x = −30, the bend about (0, 3), flange B up x = 3), the
 * edge at B's top, the inner skin back, and the edge at A's end. Which
 * points are the outer skin's is said beside them.
 */
function section(): { pts: P2[]; outer: boolean[] } {
  const c: P2 = [0, RO]
  const outerSkin = [...along([[-FLANGE, 0], [0, 0]]), ...arc(c, RO, 0, Math.PI / 2).slice(1), ...along([[RO, RO], [RO, RO + FLANGE]]).slice(1)]
  const topEdge = along([[RO, RO + FLANGE], [RI, RO + FLANGE]]).slice(1, -1)
  const innerSkin = [...along([[RI, RO + FLANGE], [RI, RO]]), ...arc(c, RI, Math.PI / 2, 0).slice(1), ...along([[0, T], [-FLANGE, T]]).slice(1)]
  const endEdge = along([[-FLANGE, T], [-FLANGE, 0]]).slice(1, -1)
  const pts = [...outerSkin, ...topEdge, ...innerSkin, ...endEdge]
  return { pts, outer: pts.map((_, i) => i < outerSkin.length) }
}

/** The section swept along y over WIDTH, every STEP: a band closed round, open at its two ends; outward normals. */
function bentSheet() {
  const { pts, outer } = section()
  const n = pts.length
  const rows = Math.round(WIDTH / STEP)
  const positions = new Float64Array(n * (rows + 1) * 3)
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i
      positions[v * 3] = pts[i][0]
      positions[v * 3 + 1] = j * STEP
      positions[v * 3 + 2] = pts[i][1]
    }
  }
  const tri: number[] = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n + i
      const b = j * n + ((i + 1) % n)
      tri.push(a, b, a + n, b, b + n, a + n)
    }
  }
  const indices = Uint32Array.from(tri)
  // Area-weighted vertex normals, turned to face out of the sheet.
  const normals = new Float64Array(positions.length)
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
    const e1 = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k])
    const e2 = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k])
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[v * 3 + k] += f[k]
  }
  // On flange A's outer skin the normal faces −z: turned all round where it does not.
  const probe = 5 * 3
  if (normals[probe + 2] > 0) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i]
  return { positions, normals, indices, vertexCount: n * (rows + 1), n, rows, outer }
}

describe('one skin of a bent sheet', () => {
  const s = bentSheet()
  const onOuter = (v: number) => s.outer[v % s.n]

  it('grows from a flange across the bend to the other flange, and stops at the edges', () => {
    const skin = skinVertices(s.positions, s.normals, s.indices, s.vertexCount, { at: [-15, 10, 0] })
    const outerCount = s.outer.filter(Boolean).length * (s.rows + 1)
    expect(skin.length).toBe(outerCount)
    expect([...skin].every(onOuter)).toBe(true)
    // From flange B too, and with the thickness given.
    const fromB = skinVertices(s.positions, s.normals, s.indices, s.vertexCount, { at: [RO, 10, 20], thickness: T })
    expect(fromB.length).toBe(outerCount)
    expect(SKIN_MIN_RADIUS).toBeLessThan(RO)
  })

  it('does not follow a bend tighter than the radius asked for', () => {
    // The outer bend is 3 mm: asked to follow nothing tighter than 4, the skin is flange A alone.
    const skin = skinVertices(s.positions, s.normals, s.indices, s.vertexCount, { at: [-15, 10, 0], minRadius: 4 })
    expect([...skin].every((v) => s.positions[v * 3 + 2] < 0.5)).toBe(true)
    expect(skin.length).toBeGreaterThan(70 * (s.rows + 1))
  })

  it('refuses what is not a skin to grow', () => {
    expect(() => skinVertices(s.positions, s.normals, s.indices, s.vertexCount, { at: [0, 0, 0], minRadius: 0 })).toThrow(/radius/)
    expect(() => skinVertices(s.positions, s.normals, s.indices, s.vertexCount, { at: [0, 0, 0], thickness: -1 })).toThrow(/thickness/)
  })

  it('flattens to the outer skin’s developed length, the bend’s centre line straight across it', () => {
    const skin = skinVertices(s.positions, s.normals, s.indices, s.vertexCount, { at: [-15, 10, 0] })
    const { report, layout } = flatten(s.positions, s.indices, s.vertexCount, skin)
    const developed = 2 * FLANGE + (Math.PI / 2) * RO
    const { width, height } = report.figures
    expect(Math.max(width, height)).toBeCloseTo(developed, 1)
    expect(Math.min(width, height)).toBeCloseTo(WIDTH, 1)
    // The bend's centre line on the outer skin: halfway round its arc, every 2 mm across.
    const mid = Math.PI / 4
    const line = Array.from({ length: 9 }, (_, k) => [RO * Math.sin(mid), 2 + 2 * k, RO - RO * Math.cos(mid)])
    const placed = patternPointsOf(layout, line)
    expect(placed.every((p) => p.uv !== null && p.off < 0.3)).toBe(true)
    // Along the blank's long side, every point the same distance in: half the developed length, from either end.
    const long = width >= height ? 0 : 1
    const at = placed.map((p) => p.uv![long])
    for (const a of at) expect(Math.abs(a - developed / 2)).toBeLessThan(0.15)
    // A point off the sheet is placed nowhere.
    expect(patternPointsOf(layout, [[50, 50, 50]])[0].uv).toBeNull()
  })
})
