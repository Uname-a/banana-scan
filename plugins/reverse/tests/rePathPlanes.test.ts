// SPDX-License-Identifier: AGPL-3.0-only
// Planes along a path: square to a helix and to an arc at the stations
// asked for, standing on the curve, their sheets carried along turning as
// little as they can.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { cross, dot, len, normalize, sub } from '../../../src/core/vec'
import { curveLength, curveOfCircle, curveOfPieces, curveOfPoints, planesAlong, stationLengths, type PathCurve } from '../core/pathPlanes'
import { routePieces } from '../core/sweepRoute'

const curve = (c: PathCurve | string): PathCurve => {
  if (typeof c === 'string') throw new Error(c)
  return c
}

/** A helix of radius r rising `pitch` a turn, as a traced centreline would
 *  come: points along it. */
function helix(r: number, pitch: number, turns: number, n: number) {
  const c = pitch / (2 * Math.PI)
  const pts: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * turns * i) / n
    pts.push([r * Math.cos(t), r * Math.sin(t), c * t])
  }
  const speed = Math.hypot(r, c)
  return {
    pts,
    length: 2 * Math.PI * turns * speed,
    at: (s: number) => {
      const t = s / speed
      return { point: [r * Math.cos(t), r * Math.sin(t), c * t] as Vec3, tangent: normalize([-r * Math.sin(t), r * Math.cos(t), c])! }
    },
  }
}

describe('planes along a helix', () => {
  const h = helix(15, 12, 2, 4000)
  const c = curve(curveOfPoints(h.pts))

  it('measures the helix its length', () => {
    expect(curveLength(c)).toBeCloseTo(h.length, 2)
  })

  it('stands each plane on the helix, square to it, at the stations', () => {
    const stations = stationLengths(c, { spacing: 10, ends: true })
    if (typeof stations === 'string') throw new Error(stations)
    expect(stations[0]).toBe(0)
    expect(stations[stations.length - 1]).toBeCloseTo(curveLength(c), 9)
    expect(stations[1]).toBe(10)
    const planes = planesAlong(c, stations)
    for (const p of planes) {
      const exact = h.at(p.s)
      expect(len(sub(p.origin, exact.point))).toBeLessThan(0.01)
      // Square to it: the normal within a few hundredths of a degree of the
      // tangent.
      expect((Math.acos(Math.min(1, dot(p.normal, exact.tangent))) * 180) / Math.PI).toBeLessThan(0.05)
      // The sheet's axes square to each other and to the normal.
      expect(Math.abs(dot(p.basisU, p.normal))).toBeLessThan(1e-9)
      expect(Math.abs(dot(p.basisV, p.normal))).toBeLessThan(1e-9)
      expect(len(sub(cross(p.basisU, p.basisV), p.normal))).toBeLessThan(1e-9)
    }
  })

  it('carries the sheet round without spinning it about the curve', () => {
    // A helix's rotation-minimizing frame turns about the tangent at a rate
    // of its torsion, τ = c / (r² + c²) — measured against the Frenet
    // normal, which points at the axis.
    const r = 15
    const cc = 12 / (2 * Math.PI)
    const tau = cc / (r * r + cc * cc)
    const stations = [0, 20, 40, 60]
    const planes = planesAlong(c, stations)
    const angle = (s: number, u: Vec3) => {
      const p = h.at(s).point
      const toAxis = normalize([-p[0], -p[1], 0])!
      const b = cross(h.at(s).tangent, toAxis)
      return Math.atan2(dot(u, b), dot(u, toAxis))
    }
    const a0 = angle(0, planes[0].basisU)
    for (let i = 1; i < stations.length; i++) {
      let d = angle(stations[i], planes[i].basisU) - a0
      d = Math.atan2(Math.sin(d), Math.cos(d))
      expect(d).toBeCloseTo(-tau * stations[i], 3)
    }
  })
})

describe('planes along an arc', () => {
  const R = 40
  const arc = curve(curveOfCircle([5, 0, 0], [0, 0, 1], R, [1, 0, 0], 0, 120))

  it('is square to the arc, on it, at evenly spread stations end to end', () => {
    expect(curveLength(arc)).toBeCloseTo((R * 2 * Math.PI) / 3, 9)
    const stations = stationLengths(arc, { count: 5 })
    if (typeof stations === 'string') throw new Error(stations)
    const planes = planesAlong(arc, stations, { up: [0, 0, 1] })
    planes.forEach((p, i) => {
      const t = ((120 * i) / 4) * (Math.PI / 180)
      expect(p.origin[0]).toBeCloseTo(5 + R * Math.cos(t), 6)
      expect(p.origin[1]).toBeCloseTo(R * Math.sin(t), 6)
      expect(p.normal[0]).toBeCloseTo(-Math.sin(t), 9)
      expect(p.normal[1]).toBeCloseTo(Math.cos(t), 9)
      // In a flat curve the sheet keeps its v on the curve's normal.
      expect(p.basisV[2]).toBeCloseTo(1, 9)
    })
  })

  it('reads an arc piece of a chain the same', () => {
    const t = (60 * Math.PI) / 180
    const pieces = curve(curveOfPieces([{ kind: 'arc', a: [R, 0, 0], m: [R * Math.cos(t / 2), R * Math.sin(t / 2), 0], b: [R * Math.cos(t), R * Math.sin(t), 0] }]))
    const planes = planesAlong(pieces, [(R * t) / 2])
    expect(planes[0].normal[0]).toBeCloseTo(-Math.sin(t / 2), 9)
    expect(planes[0].normal[1]).toBeCloseTo(Math.cos(t / 2), 9)
  })

  it('follows a route through its bend, square to the straights and the arc', () => {
    const route = routePieces({ points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], bendRadius: 20 }, [0, 0, 0])
    if (typeof route === 'string') throw new Error(route)
    const c = curve(curveOfPieces(route.pieces))
    // 80 straight, a quarter turn of R20, 80 straight.
    expect(curveLength(c)).toBeCloseTo(160 + 10 * Math.PI, 6)
    const [straight, bend, after] = planesAlong(c, [40, 80 + 5 * Math.PI, 120 + 10 * Math.PI])
    expect(straight.normal[0]).toBeCloseTo(1, 9)
    expect(bend.normal[0]).toBeCloseTo(Math.SQRT1_2, 9)
    expect(bend.normal[1]).toBeCloseTo(Math.SQRT1_2, 9)
    expect(bend.origin[0]).toBeCloseTo(80 + 20 * Math.SQRT1_2, 6)
    expect(after.normal[1]).toBeCloseTo(1, 9)
    expect(after.origin[0]).toBeCloseTo(100, 9)
  })

  it('refuses stations off the path, and too many', () => {
    expect(stationLengths(arc, { at: [500] })).toMatch(/off the path/)
    expect(stationLengths(arc, { spacing: 0.1 })).toMatch(/at most/)
  })
})
