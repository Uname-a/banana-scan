// SPDX-License-Identifier: AGPL-3.0-only
// The solids a wrapped sketch makes in the kernel: a rectangle embossed on
// a cylinder and debossed into it, the volume of the shell sector it
// covers; on a cone, its sector of the offset cones; on a plane, a prism;
// and a ring — a profile with a hole — kept with its hole.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { add, cross, normalize, scale } from '../../../src/core/vec'
import { ReKernel } from '../core/kernel'
import type { Profile } from '../core/kernelTypes'
import { rectangleLoop } from '../core/loops'
import { wrapSolid } from '../core/buildWrap'
import type { WrapGeometry, WrapSurface } from '../core/wrap'

const kernelPromise = ReKernel.load()

const R = 20
const CYLINDER: WrapSurface = { kind: 'cylinder', center: [0, 0, 0], axis: [0, 0, 1], radius: R }

function rect(origin: Vec3, u: Vec3, v: Vec3, w: number, h: number): Pick<WrapGeometry, 'profiles' | 'normal' | 'middle'> {
  const corner = add(origin, scale(u, -w / 2))
  return { profiles: [{ outer: rectangleLoop(corner, u, v, w, h), holes: [] }], normal: normalize(cross(u, v))!, middle: add(origin, scale(v, h / 2)) }
}

describe('a rectangle wrapped on a cylinder', () => {
  const r = rect([R, 0, 0], [0, 1, 0], [0, 0, 1], 30, 8)
  // 30 mm of arc at R20 is 1.5 rad: the shell's sector, 8 high.
  const sector = (r0: number, r1: number) => 8 * 0.75 * (r1 * r1 - r0 * r0)

  it('embossed 2 mm out is that much of the shell outside it', async () => {
    const k = await kernelPromise
    const solid = wrapSolid(k, { surface: CYLINDER, ...r, from: 0, to: 2 })
    try {
      expect(k.isClosedSolid(solid)).toBe(true)
      expect(k.volume(solid)).toBeCloseTo(sector(R, R + 2), 2)
      const b = k.bounds(solid)
      expect(b.max[2] - b.min[2]).toBeCloseTo(8, 4)
    } finally {
      k.release(solid)
    }
  })

  it('debossed 1.5 mm in is the shell inside it', async () => {
    const k = await kernelPromise
    const solid = wrapSolid(k, { surface: CYLINDER, ...r, from: -1.5, to: 0 })
    try {
      expect(k.isClosedSolid(solid)).toBe(true)
      expect(k.volume(solid)).toBeCloseTo(sector(R - 1.5, R), 2)
    } finally {
      k.release(solid)
    }
  })

  it('keeps a hole in a profile a hole', async () => {
    const k = await kernelPromise
    // A 20 × 10 frame with a 10 × 4 window, on the tangent plane.
    const outer = rectangleLoop([R, -10, 0], [0, 1, 0], [0, 0, 1], 20, 10)
    const hole = rectangleLoop([R, -5, 3], [0, 1, 0], [0, 0, 1], 10, 4)
    const profiles: Profile[] = [{ outer, holes: [hole] }]
    const solid = wrapSolid(k, { surface: CYLINDER, profiles, normal: [1, 0, 0], middle: [R, 0, 5], from: 0, to: 1 })
    try {
      const ring = (w: number, h: number) => h * (w / R / 2) * ((R + 1) ** 2 - R * R)
      expect(k.volume(solid)).toBeCloseTo(ring(20, 10) - ring(10, 4), 2)
    } finally {
      k.release(solid)
    }
  })
})

describe('a rectangle wrapped on a cone', () => {
  it('embossed is the sector of the shell between the cone and its offset', async () => {
    const k = await kernelPromise
    const HALF = 30
    const phi = (HALF * Math.PI) / 180
    const cone: WrapSurface = { kind: 'cone', center: [0, 0, 0], axis: [0, 0, 1], radius: R, halfAngle: HALF }
    const g0: Vec3 = [Math.sin(phi), 0, Math.cos(phi)]
    const r = rect([R, 0, 0], [0, 1, 0], g0, 10, 12)
    const solid = wrapSolid(k, { surface: cone, ...r, from: 0, to: 1 })
    try {
      expect(k.isClosedSolid(solid)).toBe(true)
      // The region's area on the cone is the rectangle's, 120 mm²; a shell
      // of it 1 mm thick on a cone of this size holds its area times the
      // depth, give or take the area's growth with the offset (the mean
      // curvature, cos φ / (2 ρ sin φ)) — under 2 %.
      const v = k.volume(solid)
      expect(v).toBeGreaterThan(120)
      expect(v).toBeLessThan(120 * 1.02)
    } finally {
      k.release(solid)
    }
  })
})

describe('a rectangle wrapped on a plane', () => {
  it('is a prism of it on the plane', async () => {
    const k = await kernelPromise
    const plane: WrapSurface = { kind: 'plane', center: [0, 0, 5], normal: [0, 0, 1] }
    const r = rect([0, 0, 9], [1, 0, 0], [0, 1, 0], 10, 4)
    const solid = wrapSolid(k, { surface: plane, ...r, from: 0, to: 3 })
    try {
      expect(k.volume(solid)).toBeCloseTo(120, 6)
      const b = k.bounds(solid)
      expect(b.min[2]).toBeCloseTo(5, 6)
      expect(b.max[2]).toBeCloseTo(8, 6)
    } finally {
      k.release(solid)
    }
  })
})
