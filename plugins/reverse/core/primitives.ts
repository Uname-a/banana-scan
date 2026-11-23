// SPDX-License-Identifier: AGPL-3.0-only
// Solids made from a description alone: a cylinder about an axis, and the
// solid an extracted element becomes — a slab, a cylinder, a cone, a sphere
// or a torus — and a shadow section's block. The builder hands its kernel in.

import { addScaled, cross, dot, normalize } from '../../../src/core/vec'
import { gearGeometry, gearOutline, type Vec2 } from '../../../src/core/geometry/gear'
import type { Vec3 } from '../../../src/core/types'
import type { Primitive } from './features'
import type { ReKernel } from './kernel'
import type { LoopPiece, Shape } from './kernelTypes'
import { arcPiece, rectangleLoop } from './loops'

/** A solid cylinder about the axis through `origin`, from `from` to `to`
 *  millimetres along it. */
export function cylinderSolid(k: ReKernel, origin: Vec3, axis: Vec3, radius: number, from: number, to: number): Shape {
  const n = normalize(axis)
  if (!n) throw new Error('The axis has no direction.')
  const disc = k.face({ outer: [{ kind: 'circle', center: origin, normal: n, radius }], holes: [] })
  try {
    return k.extrude(disc, n, from, to)
  } finally {
    k.release(disc)
  }
}

/** A helical gear's sections are at most this many degrees of turn apart:
 *  the loft through them lies within a micrometre of the true helicoid on a
 *  gear of 100 mm (it bends the turned outlines into a smooth surface, so
 *  its error falls with the fourth power of the step). */
const GEAR_SECTION_DEG = 3
const GEAR_SECTIONS_MAX = 24

/** An involute gear, its axis along `dir`, from `from` to `to`: its outline
 *  stood straight up for a spur gear, lofted through outlines turned by the
 *  helix for a helical one; a bore cut through where one is given. */
function gearSolid(k: ReKernel, p: Extract<Primitive, { kind: 'gear' }>): Shape {
  const n = normalize(p.dir)
  if (!n) throw new Error('The gear’s axis has no direction.')
  const along = dot(p.zeroDir, n)
  const u = normalize(addScaled(p.zeroDir, n, -along))
  if (!u) throw new Error('The gear’s zero direction lies along its axis.')
  const v = cross(n, u)
  const geo = gearGeometry(p.spec)
  const at = (h: number): LoopPiece[] => {
    const base = addScaled(p.origin, n, h)
    const lift = (q: Vec2): Vec3 => addScaled(addScaled(base, u, q[0]), v, q[1])
    const phase = (p.phaseDeg * Math.PI) / 180 + geo.twistPerMm * h
    return gearOutline(p.spec, phase).map((piece): LoopPiece =>
      piece.kind === 'line'
        ? { kind: 'line', a: lift(piece.a), b: lift(piece.b) }
        : piece.kind === 'arc'
          ? { kind: 'arc', a: lift(piece.a), m: lift(piece.m), b: lift(piece.b) }
          : { kind: 'spline', poles: piece.poles.map(lift), knots: piece.knots, mults: piece.mults },
    )
  }
  if (!(p.to > p.from)) throw new Error('The gear needs a face width: to beyond from.')
  let solid: Shape
  if (Math.abs(geo.twistPerMm) < 1e-12) {
    const face = k.face({ outer: at(p.from), holes: [] })
    try {
      solid = k.extrude(face, n, 0, p.to - p.from)
    } finally {
      k.release(face)
    }
  } else {
    const turnDeg = (Math.abs(geo.twistPerMm) * (p.to - p.from) * 180) / Math.PI
    const count = Math.min(GEAR_SECTIONS_MAX, Math.max(2, Math.ceil(turnDeg / GEAR_SECTION_DEG) + 1))
    const profiles = Array.from({ length: count }, (_, i) => ({ outer: at(p.from + ((p.to - p.from) * i) / (count - 1)), holes: [] }))
    solid = k.loft(profiles, count === 2)
  }
  if (!(p.bore > 0)) return solid
  if (p.bore / 2 >= geo.rootRadius) {
    k.release(solid)
    throw new Error(`The bore (Ø${p.bore}) reaches the root circle (Ø${Math.round(2 * geo.rootRadius * 1000) / 1000}).`)
  }
  const hole = cylinderSolid(k, p.origin, n, p.bore / 2, p.from - 1, p.to + 1)
  try {
    return k.cut(solid, hole)
  } finally {
    k.release(solid)
    k.release(hole)
  }
}

/** The solid an extracted element becomes. */
export function primitiveSolid(k: ReKernel, p: Primitive): Shape {
  switch (p.kind) {
    case 'slab': {
      const u = normalize(p.basisU) ?? [1, 0, 0]
      const v = normalize(p.basisV) ?? [0, 1, 0]
      const corner = addScaled(addScaled(p.origin, u, -p.extentU), v, -p.extentV)
      const face = k.face({ outer: rectangleLoop(corner, u, v, 2 * p.extentU, 2 * p.extentV), holes: [] })
      try {
        return k.extrude(face, p.normal, -p.thickness / 2, p.thickness / 2)
      } finally {
        k.release(face)
      }
    }
    case 'cylinder':
      return cylinderSolid(k, p.origin, p.axis, p.radius, -p.length / 2, p.length / 2)
    case 'cone': {
      // A trapezoid in a plane through the axis, turned about it: the
      // small radius at one end, the large at the other.
      const n = normalize(p.axis) ?? [0, 0, 1]
      const u = normalize(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) ?? [1, 0, 0]
      const a = addScaled(p.origin, n, -p.length / 2)
      const b = addScaled(p.origin, n, p.length / 2)
      const pts: Vec3[] = [a, addScaled(a, u, Math.max(p.radius1, 1e-6)), addScaled(b, u, Math.max(p.radius2, 1e-6)), b]
      const loop: LoopPiece[] = pts.map((q, i) => ({ kind: 'line', a: q, b: pts[(i + 1) % 4] }))
      const face = k.face({ outer: loop, holes: [] })
      try {
        return k.revolve(face, p.origin, n, 2 * Math.PI)
      } finally {
        k.release(face)
      }
    }
    case 'sphere': {
      // A half disc turned about its diameter.
      const n: Vec3 = [0, 0, 1]
      const top = addScaled(p.center, n, p.radius)
      const bottom = addScaled(p.center, n, -p.radius)
      const face = k.face({ outer: [{ kind: 'line', a: top, b: bottom }, arcPiece(p.center, [0, 1, 0], bottom, top, Math.PI)], holes: [] })
      try {
        return k.revolve(face, p.center, n, 2 * Math.PI)
      } finally {
        k.release(face)
      }
    }
    case 'prism': {
      // Each region stood up on its own, the blocks joined into one body.
      const n = normalize(p.dir) ?? [0, 0, 1]
      const blocks: Shape[] = []
      try {
        for (const profile of p.profiles) {
          const face = k.face(profile)
          try {
            blocks.push(k.extrude(face, n, p.from, p.to))
          } finally {
            k.release(face)
          }
        }
        if (blocks.length === 1) return blocks.pop()!
        return k.fuseAll(blocks)
      } finally {
        for (const b of blocks) k.release(b)
      }
    }
    case 'gear':
      return gearSolid(k, p)
    case 'torus': {
      // The tube's circle in a plane through the axis, turned about it.
      const n = normalize(p.axis) ?? [0, 0, 1]
      const u = normalize(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) ?? [1, 0, 0]
      const meridian = normalize(cross(n, u)) ?? [0, 1, 0]
      const face = k.face({ outer: [{ kind: 'circle', center: addScaled(p.center, u, p.majorRadius), normal: meridian, radius: Math.max(p.minorRadius, 1e-6) }], holes: [] })
      try {
        return k.revolve(face, p.center, n, 2 * Math.PI)
      } finally {
        k.release(face)
      }
    }
  }
}
