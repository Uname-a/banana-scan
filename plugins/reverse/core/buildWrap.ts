// SPDX-License-Identifier: AGPL-3.0-only
// The solid an emboss or a deboss makes: a sketch's profiles wrapped onto a
// cylinder, a cone or a plane (core/wrap.ts) and given a depth along the
// surface's normal — between two offsets of the surface, `from` and `to`
// mm out from it (in, negative).
//
// On a plane that is a prism of the profiles laid onto it. On a cylinder or
// a cone, the shell between the two offsets of the surface is cut by the
// profiles' walls — ruled surfaces through the wrapped outline straight
// out along the normal, reaching past the shell either side — and the
// pieces of it inside the profiles kept: their faces the two offset
// surfaces themselves, exact, and the walls square to them.

import type { Vec3 } from '../../../src/core/types'
import { addScaled, dot, normalize, scale, sub } from '../../../src/core/vec'
import type { ReKernel, Shape } from './kernel'
import { cylinderSolid, primitiveSolid } from './primitives'
import type { LoopPiece } from './kernelTypes'
import { interpolateCubic, liftLoop, placeFlat, wrapDepthProblem, wrapOfGeometry, type Development, type WrapGeometry, type WrappedProfile, type WrapSurface } from './wrap'

/**
 * The solid of a wrap step: the profiles between the offsets `from` and
 * `to`. Throws with a sentence where the kernel cannot make it.
 */
export function wrapSolid(k: ReKernel, g: WrapGeometry): Shape {
  const made = wrapOfGeometry(g)
  if (typeof made === 'string') throw new Error(made)
  const { dev, wrapped } = made
  const problem = wrapDepthProblem(g, wrapped, dev)
  if (problem) throw new Error(problem)
  const lo = Math.min(g.from, g.to)
  const hi = Math.max(g.from, g.to)
  if (g.surface.kind === 'plane') return planeWrap(k, dev, wrapped, lo, hi)
  if (g.surface.kind === 'region') throw new Error('A region of the scan is wrapped onto through its fitted sheet (regionWrapSolid).')
  return curvedWrap(k, dev, wrapped, g.surface, lo, hi)
}

/**
 * The solid of a wrap onto a region of the scan: the sheet fitted through
 * the region (`sheet`, one face, the caller's) thickened between the
 * offsets, cut by walls through the wrapped outline straight out along the
 * sheet's normal, and the pieces inside the profiles kept. The outline is
 * found on the scan through the region's layout (`dev`) and taken onto the
 * sheet: the sheet's faces are the solid's.
 */
export function regionWrapSolid(k: ReKernel, g: Pick<WrapGeometry, 'from' | 'to'>, dev: Development, wrapped: readonly WrappedProfile[], sheet: Shape): Shape {
  const lo = Math.min(g.from, g.to)
  const hi = Math.max(g.from, g.to)
  if (!(hi - lo > 1e-6)) throw new Error('The wrap needs a depth above zero.')
  if (lo < -1e-9 && hi > 1e-9) throw new Error('A wrap onto a region lies on one side of it.')
  // Which way the sheet's normal points against the scan's outside.
  const [touch] = k.sheetPoints(sheet, [dev.touch.point])
  const sign = dot(touch.normal, dev.touch.normal) < 0 ? -1 : 1
  const outward = hi > 1e-9
  const way = outward === sign > 0 ? 'out' : 'in'
  const reach = Math.max(0.5, (hi - lo) * 0.5)
  const onSheet = (flat: readonly (readonly [number, number])[]) =>
    k.sheetPoints(
      sheet,
      flat.map((f) => placeFlat(dev, [f[0], f[1]], 0)),
    ).map((x) => ({ point: x.point, normal: scale(x.normal, sign) }))
  const lift = (loop: WrappedProfile['outer'], w: number, taken: Map<WrappedProfile['outer']['pieces'][number], { point: Vec3; normal: Vec3 }[]>): LoopPiece[] =>
    loop.pieces.map((piece) => {
      let at = taken.get(piece)
      if (!at) {
        at = onSheet(piece.flat)
        taken.set(piece, at)
      }
      const { poles, knots, mults } = interpolateCubic(
        at.map((x) => addScaled(x.point, x.normal, w)),
        piece.params,
      )
      return { kind: 'spline', poles, knots, mults }
    })
  const slab = k.thickenTracked(sheet, hi - lo, way).shape
  const walls: Shape[] = []
  let pieces: Shape[] = []
  try {
    const taken = new Map()
    for (const p of wrapped) for (const loop of [p.outer, ...p.holes]) walls.push(k.ruledWall(lift(loop, lo - reach, taken), lift(loop, hi + reach, taken)))
    pieces = k.split(slab, walls)
    const kept = new Set<number>()
    for (const p of wrapped) {
      const [mid] = onSheet([p.inside])
      const probe = addScaled(mid.point, mid.normal, (lo + hi) / 2)
      const i = pieces.findIndex((piece) => k.containsPoint(piece, probe))
      if (i < 0) throw new Error('The wrap’s walls did not cut the sheet’s slab round a profile — the profile may reach past where the sheet was fitted.')
      kept.add(i)
    }
    const keep = [...kept].map((i) => pieces[i])
    if (keep.length === 1) {
      const only = keep[0]
      pieces = pieces.filter((x) => x !== only)
      return only
    }
    return k.fuseAll(keep)
  } finally {
    k.release(slab)
    for (const w of walls) k.release(w)
    for (const p of pieces) k.release(p)
  }
}

function planeWrap(k: ReKernel, dev: Development, wrapped: readonly WrappedProfile[], lo: number, hi: number): Shape {
  const solids: Shape[] = []
  try {
    for (const p of wrapped) {
      const face = k.face({ outer: liftLoop(p.outer, dev, lo), holes: p.holes.map((h) => liftLoop(h, dev, lo)) })
      try {
        solids.push(k.extrude(face, dev.touch.normal, 0, hi - lo))
      } finally {
        k.release(face)
      }
    }
    if (solids.length === 1) return solids.pop()!
    return k.fuseAll(solids)
  } finally {
    for (const s of solids) k.release(s)
  }
}

function curvedWrap(k: ReKernel, dev: Development, wrapped: readonly WrappedProfile[], surface: Extract<WrapSurface, { kind: 'cylinder' | 'cone' }>, lo: number, hi: number): Shape {
  const a = normalize(surface.axis)!
  const depth = hi - lo
  // The walls reach this far past the shell either side, so they cut it
  // through — inward no further than the surface allows.
  const reach = Math.max(0.5, depth * 0.5)
  let inward = reach
  const allPlaced = (w: number) => wrapped.every((p) => [p.outer, ...p.holes].every((l) => l.pieces.every((piece) => piece.flat.every((f) => dev.place(f[0], f[1], w) !== null))))
  while (inward > 1e-3 && !allPlaced(lo - inward)) inward /= 2
  if (!allPlaced(lo - inward)) throw new Error('The wrap’s walls cannot reach inside the surface there — less depth.')
  // The height along the axis the shell must cover.
  let h0 = Infinity
  let h1 = -Infinity
  for (const p of wrapped)
    for (const piece of p.outer.pieces)
      for (const f of piece.flat)
        for (const w of [lo - inward, hi + reach]) {
          const h = dot(sub(placeFlat(dev, f, w), surface.center), a)
          h0 = Math.min(h0, h)
          h1 = Math.max(h1, h)
        }
  const pad = Math.max(1, (h1 - h0) * 0.05)
  const shell = shellBetween(k, surface, a, lo, hi, h0 - pad, h1 + pad)
  const walls: Shape[] = []
  let pieces: Shape[] = []
  try {
    for (const p of wrapped) for (const loop of [p.outer, ...p.holes]) walls.push(k.ruledWall(liftLoop(loop, dev, lo - inward), liftLoop(loop, dev, hi + reach)))
    pieces = k.split(shell, walls)
    const kept = new Set<number>()
    for (const p of wrapped) {
      const probe = placeFlat(dev, p.inside, (lo + hi) / 2)
      const i = pieces.findIndex((piece) => k.containsPoint(piece, probe))
      if (i < 0) throw new Error('The wrap’s walls did not cut the shell round a profile.')
      kept.add(i)
    }
    const keep = [...kept].map((i) => pieces[i])
    if (keep.length === 1) {
      const only = keep[0]
      pieces = pieces.filter((x) => x !== only)
      return only
    }
    return k.fuseAll(keep)
  } finally {
    k.release(shell)
    for (const w of walls) k.release(w)
    for (const p of pieces) k.release(p)
  }
}

/** The solid between the surface's offsets `lo` and `hi`, from height `h0`
 *  to `h1` along the axis (from the surface's centre). The inner solid
 *  reaches a little further each end, so the cut leaves no face on face. */
function shellBetween(k: ReKernel, s: Extract<WrapSurface, { kind: 'cylinder' | 'cone' }>, a: Vec3, lo: number, hi: number, h0: number, h1: number): Shape {
  const extra = Math.max(0.5, (h1 - h0) * 0.05)
  if (s.kind === 'cylinder') {
    const outer = cylinderSolid(k, s.center, a, s.radius + hi, h0, h1)
    if (!(s.radius + lo > 1e-6)) return outer
    const inner = cylinderSolid(k, s.center, a, s.radius + lo, h0 - extra, h1 + extra)
    try {
      return k.cut(outer, inner)
    } finally {
      k.release(outer)
      k.release(inner)
    }
  }
  const phi = (s.halfAngle * Math.PI) / 180
  const tan = Math.tan(phi)
  const cos = Math.cos(phi)
  // The radius of the cone offset w at height h.
  const r = (h: number, w: number) => s.radius + h * tan + w / cos
  // Where the inner offset comes to its apex: no lower than just above it.
  const floor = (-s.radius - lo / cos) / tan + 1e-3
  const frustum = (w: number, from: number, to: number) => {
    const f = Math.max(from, floor)
    const mid = (f + to) / 2
    return primitiveSolid(k, { kind: 'cone', origin: [s.center[0] + a[0] * mid, s.center[1] + a[1] * mid, s.center[2] + a[2] * mid], axis: a, radius1: Math.max(1e-6, r(f, w)), radius2: r(to, w), length: to - f })
  }
  const outer = frustum(hi, h0, h1)
  const inner = frustum(lo, h0 - extra, h1 + extra)
  try {
    return k.cut(outer, inner)
  } finally {
    k.release(outer)
    k.release(inner)
  }
}
