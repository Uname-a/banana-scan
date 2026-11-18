// SPDX-License-Identifier: AGPL-3.0-only
// A sketch wrapped onto a cylinder, a cone and a plane: its lengths kept
// along the surface, the arc it takes round the axis its width over the
// radius, and the unroll of what it wraps to the sketch again.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { add, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import { rectangleLoop } from '../core/loops'
import type { Profile } from '../core/kernelTypes'
import { bsplineAt } from '../core/sketchSpline'
import { developmentFor, interpolateCubic, liftLoop, placeFlat, wrapFacts, wrapProfiles, type Development, type WrapSurface } from '../core/wrap'
import { unroll } from '../../mesh-tools/core/unroll'

const R = 20
const CYLINDER: WrapSurface = { kind: 'cylinder', center: [0, 0, 0], axis: [0, 0, 1], radius: R }
const HALF = 30
const CONE: WrapSurface = { kind: 'cone', center: [0, 0, 0], axis: [0, 0, 1], radius: R, halfAngle: HALF }
const rad = (deg: number) => (deg * Math.PI) / 180

/** A w × h rectangle on the plane through `origin` with sides along u and
 *  v, its normal u × v, centred on the origin across u. */
function rectangle(origin: Vec3, u: Vec3, v: Vec3, w: number, h: number): { profile: Profile; normal: Vec3; middle: Vec3 } {
  const corner = add(origin, scale(u, -w / 2))
  const profile = { outer: rectangleLoop(corner, u, v, w, h), holes: [] }
  return { profile, normal: normalize(cross(u, v))!, middle: add(origin, add(scale(v, h / 2), [0, 0, 0])) }
}

function wrapped(surface: WrapSurface, r: ReturnType<typeof rectangle>) {
  const dev = developmentFor(surface, { normal: r.normal }, r.middle)
  if (typeof dev === 'string') throw new Error(dev)
  const profiles = wrapProfiles([r.profile], dev)
  if (typeof profiles === 'string') throw new Error(profiles)
  return { dev, profiles }
}

/** A wrapped piece's length on the surface, its samples dense. */
function lengthOnSurface(dev: Development, flat: readonly [number, number][], n = 400): number {
  let s = 0
  let prev: Vec3 | null = null
  for (let i = 0; i < flat.length - 1; i++) {
    const [a, b] = [flat[i], flat[i + 1]]
    for (let k = 0; k <= n; k++) {
      if (k === 0 && prev) continue
      const t = k / n
      const at = placeFlat(dev, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], 0)
      if (prev) s += len(sub(at, prev))
      prev = at
    }
  }
  return s
}

describe('a rectangle wrapped on a cylinder', () => {
  // Drawn on the plane that touches the cylinder along x = R: 30 wide round
  // it, 8 up it.
  const r = rectangle([R, 0, 0], [0, 1, 0], [0, 0, 1], 30, 8)

  it('touches along the line under the sketch and takes its width over the radius in arc', () => {
    const { dev, profiles } = wrapped(CYLINDER, r)
    expect(dev.tiltDeg).toBeCloseTo(0, 9)
    expect(dev.touch.normal[0]).toBeCloseTo(1, 12)
    const facts = wrapFacts(profiles, dev)
    expect(facts.across[0]).toBeCloseTo(-15, 9)
    expect(facts.across[1]).toBeCloseTo(15, 9)
    expect(facts.along[1] - facts.along[0]).toBeCloseTo(8, 9)
    expect(facts.arcDeg!).toBeCloseTo((30 / R) * (180 / Math.PI), 6)
    // The corner at u = 15 lands 15 mm of arc round: 0.75 rad. y counts
    // from the drawing's middle, 4 up.
    const corner = placeFlat(dev, [15, -4], 0)
    expect(corner[0]).toBeCloseTo(R * Math.cos(0.75), 9)
    expect(corner[1]).toBeCloseTo(R * Math.sin(0.75), 9)
    expect(corner[2]).toBeCloseTo(0, 9)
  })

  it('keeps every side its length along the surface', () => {
    const { dev, profiles } = wrapped(CYLINDER, r)
    const sides = profiles[0].outer.pieces.map((p) => lengthOnSurface(dev, p.flat))
    expect(sides.map((s) => Math.round(s * 1e4) / 1e4).sort((a, b) => a - b)).toEqual([8, 8, 30, 30])
    // The sampled outline is the curve's: chords 2° apart fall short by
    // under a hundredth of a per cent.
    expect(wrapFacts(profiles, dev).perimeters[0]).toBeCloseTo(76, 1)
  })

  it('lifts each side as a cubic through its samples, out along the normal at every offset', () => {
    const { dev, profiles } = wrapped(CYLINDER, r)
    const inner = liftLoop(profiles[0].outer, dev, 0)
    const outer = liftLoop(profiles[0].outer, dev, 2)
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i]
      const b = outer[i]
      if (a.kind !== 'spline' || b.kind !== 'spline') throw new Error('not a spline')
      expect(b.knots).toEqual(a.knots)
      for (const t of [0, 0.13, 0.5, 0.77, 1]) {
        const p = bsplineAt(a, t) as Vec3
        const q = bsplineAt(b, t) as Vec3
        // On the cylinder, and its partner 2 mm straight out from the axis.
        expect(Math.hypot(p[0], p[1])).toBeCloseTo(R, 5)
        expect(Math.hypot(q[0], q[1])).toBeCloseTo(R + 2, 5)
        expect(q[2]).toBeCloseTo(p[2], 9)
        expect(Math.atan2(q[1], q[0])).toBeCloseTo(Math.atan2(p[1], p[0]), 9)
      }
    }
  })

  it('wraps from the side the drawing is on, and refuses a sketch square to the axis or past half a turn', () => {
    const back = rectangle([-R, 0, 0], [0, -1, 0], [0, 0, 1], 10, 5)
    const { dev } = wrapped(CYLINDER, back)
    expect(dev.touch.normal[0]).toBeCloseTo(-1, 12)
    const flat = rectangle([0, 0, 10], [1, 0, 0], [0, 1, 0], 10, 5)
    expect(developmentFor(CYLINDER, { normal: flat.normal }, flat.middle)).toMatch(/square to the cylinder’s axis/)
    const wide = rectangle([R, 0, 0], [0, 1, 0], [0, 0, 1], 2 * Math.PI * R + 1, 5)
    const dev2 = developmentFor(CYLINDER, { normal: wide.normal }, wide.middle) as Development
    expect(wrapProfiles([wide.profile], dev2)).toMatch(/half a turn/)
  })
})

describe('a rectangle wrapped on a cone', () => {
  // The plane touching the 30° cone along its generatrix in the xz-plane,
  // the sketch's v up the slant, its origin where the radius is R.
  const g0: Vec3 = [Math.sin(rad(HALF)), 0, Math.cos(rad(HALF))]
  const r = rectangle([R, 0, 0], [0, 1, 0], g0, 10, 12)

  it('lays the sketch on the sector about the apex: the slant its radius, the angle round shrunk by sin', () => {
    const { dev } = wrapped(CONE, r)
    expect(dev.tiltDeg).toBeCloseTo(0, 9)
    // From the apex, 40 mm up the slant to the sketch's origin.
    const s0 = R / Math.sin(rad(HALF))
    const [x, y] = dev.flat([R, 0, 0])
    expect(x).toBeCloseTo(0, 9)
    expect(y).toBeCloseTo(s0, 9)
    // The corner 5 across: α = atan(5 / 40) on the sector, α / sin 30° round
    // the axis, at √(5² + 40²) from the apex.
    const p = placeFlat(dev, [5, s0], 0)
    const apexZ = -R / Math.tan(rad(HALF))
    const rho = Math.hypot(5, s0)
    const theta = Math.atan2(5, s0) / Math.sin(rad(HALF))
    expect(Math.atan2(p[1], p[0])).toBeCloseTo(theta, 9)
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(rho * Math.sin(rad(HALF)), 9)
    expect(p[2] - apexZ).toBeCloseTo(rho * Math.cos(rad(HALF)), 9)
  })

  it('keeps every side its length along the surface, and the arc round the axis the sector’s', () => {
    const { dev, profiles } = wrapped(CONE, r)
    const sides = profiles[0].outer.pieces.map((p) => lengthOnSurface(dev, p.flat))
    expect(sides.map((s) => Math.round(s * 1e4) / 1e4).sort((a, b) => a - b)).toEqual([10, 10, 12, 12])
    const s0 = R / Math.sin(rad(HALF))
    const facts = wrapFacts(profiles, dev)
    // The widest the drawing turns round the axis is at its foot, nearest
    // the apex: 2·atan(5 / 40) / sin 30°.
    expect(facts.arcDeg!).toBeCloseTo((2 * Math.atan2(5, s0)) / Math.sin(rad(HALF)) * (180 / Math.PI), 4)
    // Each sample lies on the cone.
    for (const piece of profiles[0].outer.pieces) {
      for (const f of piece.flat) {
        const q = placeFlat(dev, f, 0)
        const h = q[2] + R / Math.tan(rad(HALF))
        expect(Math.hypot(q[0], q[1])).toBeCloseTo(h * Math.tan(rad(HALF)), 9)
      }
    }
  })

  it('moves a point out along the cone’s normal', () => {
    const { dev } = wrapped(CONE, r)
    const s0 = R / Math.sin(rad(HALF))
    const on = dev.place(3, s0 + 4, 0)!
    const off = dev.place(3, s0 + 4, 1.5)!
    expect(len(sub(off.point, on.point))).toBeCloseTo(1.5, 12)
    expect(dot(normalize(sub(off.point, on.point))!, on.normal)).toBeCloseTo(1, 12)
    // The normal is square to the slant.
    const slant = normalize(sub(on.point, [0, 0, -R / Math.tan(rad(HALF))]))!
    expect(dot(on.normal, slant)).toBeCloseTo(0, 12)
  })
})

describe('a rectangle wrapped on a plane', () => {
  it('is the sketch laid onto the plane where it is drawn', () => {
    const plane: WrapSurface = { kind: 'plane', center: [0, 0, 5], normal: [0, 0, 1] }
    // Drawn 3 mm above the plane, parallel to it.
    const r = rectangle([0, 0, 8], [1, 0, 0], [0, 1, 0], 10, 4)
    const { dev, profiles } = wrapped(plane, r)
    const loop = liftLoop(profiles[0].outer, dev, 1)
    expect(loop.every((p) => p.kind === 'line')).toBe(true)
    const pts = loop.map((p) => (p.kind === 'line' ? p.a : [0, 0, 0]))
    expect(pts.map((p) => p.map((c) => Math.round(c * 1e9) / 1e9 + 0))).toEqual([
      [-5, 0, 6],
      [5, 0, 6],
      [5, 4, 6],
      [-5, 4, 6],
    ])
  })
})

describe('a cubic through points', () => {
  it('passes through every one at its parameter', () => {
    const pts: Vec3[] = []
    for (let i = 0; i <= 9; i++) pts.push([Math.cos(i / 3), Math.sin(i / 3), i * 0.2])
    const t = pts.map((_, i) => i / 9)
    const s = interpolateCubic(pts, t)
    for (let i = 0; i < pts.length; i++) {
      const p = bsplineAt(s, t[i])
      for (let k = 0; k < 3; k++) expect(p[k]).toBeCloseTo(pts[i][k], 10)
    }
  })
})

/** The wrapped rectangle as a mesh of the surface it covers: a grid on the
 *  development laid onto the surface, every vertex in the region. */
function wrappedMesh(dev: Development, x: [number, number], y: [number, number], nx = 60, ny = 20) {
  const positions: number[] = []
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const p = placeFlat(dev, [x[0] + ((x[1] - x[0]) * i) / nx, y[0] + ((y[1] - y[0]) * j) / ny], 0)
      positions.push(...p)
    }
  const indices: number[] = []
  const at = (i: number, j: number) => j * (nx + 1) + i
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      // Wound so the normal faces out of the surface.
      indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1))
    }
  const count = positions.length / 3
  return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices), count, region: Uint32Array.from({ length: count }, (_, i) => i) }
}

describe('wrapped, then unrolled', () => {
  it('gives the sketch back on a cylinder', () => {
    const r = rectangle([R, 0, 0], [0, 1, 0], [0, 0, 1], 30, 8)
    const { dev, profiles } = wrapped(CYLINDER, r)
    const facts = wrapFacts(profiles, dev)
    const mesh = wrappedMesh(dev, facts.across, facts.along)
    const { report } = unroll(mesh.positions, mesh.indices, mesh.count, mesh.region, { kind: 'cylinder', center: [0, 0, 0], axis: [0, 0, 1], radius: R })
    expect(report.figures.width).toBeCloseTo(30, 6)
    expect(report.figures.height).toBeCloseTo(8, 6)
    expect(report.figures.area).toBeCloseTo(240, 5)
    expect(report.residual.max).toBeLessThan(1e-9)
  })

  it('gives the sketch back on a cone, as its sector', () => {
    const g0: Vec3 = [Math.sin(rad(HALF)), 0, Math.cos(rad(HALF))]
    const r = rectangle([R, 0, 0], [0, 1, 0], g0, 10, 12)
    const { dev, profiles } = wrapped(CONE, r)
    const facts = wrapFacts(profiles, dev)
    const mesh = wrappedMesh(dev, facts.across, facts.along)
    const { report } = unroll(mesh.positions, mesh.indices, mesh.count, mesh.region, { kind: 'cone', center: [0, 0, 0], axis: [0, 0, 1], radius: R, halfAngle: HALF })
    // The sector's layout is the rectangle turned about the apex: the same
    // size and the same sides.
    expect(report.figures.area).toBeCloseTo(120, 4)
    expect(report.figures.perimeter).toBeCloseTo(44, 4)
    expect(report.sector!.innerRadius).toBeCloseTo(R / Math.sin(rad(HALF)), 6)
    // Per cent: the mesh's chords, not the layout.
    expect(report.distortion.length.max).toBeLessThan(0.01)
    // And the development reads each point back where it was laid.
    for (const piece of profiles[0].outer.pieces) for (const f of piece.flat) {
      const back = dev.develop(placeFlat(dev, f, 0))
      expect(back[0]).toBeCloseTo(f[0], 9)
      expect(back[1]).toBeCloseTo(f[1], 9)
    }
  })
})
