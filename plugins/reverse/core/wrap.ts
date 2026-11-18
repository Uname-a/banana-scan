// SPDX-License-Identifier: AGPL-3.0-only
// Wrapping a sketch onto a surface: a closed profile — an outline, a
// logo, letters — laid onto a measured cylinder, cone or plane with its
// lengths kept true along the surface. The inverse of an unroll
// (plugins/mesh-tools core/unroll): a cylinder's arc round the axis is the
// sketch's x and the height along it its y; a cone is laid out as the
// sector an unroll makes of it, the apex its centre; a plane takes the
// sketch as it is.
//
// Where the sketch goes on the surface is where it is drawn: the surface
// is touched by a plane — the tangent plane along the line of the surface
// whose normal is nearest the sketch's, on the side the drawing lies —
// and the sketch, moved rigidly onto that plane about its own middle (not
// at all, when it is drawn on such a plane), is rolled onto the surface
// from that line. A sketch on a plane tangent to a cylinder wraps from
// where it touches; one drawn a little off it is first laid onto it.
//
// Pure numbers: the solid an emboss or a deboss makes of it is the
// builder's (core/build.ts wrapOf), the kernel's walls the ruled
// surfaces through the wrapped outline along the surface's normal.

import type { Vec2 } from '../../../src/core/flat/types'
import type { Vec3 } from '../../../src/core/types'
import { add, addScaled, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { LoopPiece, Profile } from './kernelTypes'
import { piecePoints } from './loops'
import { profileMiddle } from './profiles'

/** The surfaces a sketch wraps onto, as the measured elements give them.
 *  A cone's radius is the one at `center`, growing along `axis`; its
 *  half-angle in degrees — as an unroll takes it. */
export type WrapSurface =
  | { kind: 'plane'; center: Vec3; normal: Vec3 }
  | { kind: 'cylinder'; center: Vec3; axis: Vec3; radius: number }
  | { kind: 'cone'; center: Vec3; axis: Vec3; radius: number; halfAngle: number }

/** The kinds of element a sketch wraps onto. */
export const WRAP_KINDS = ['cylinder', 'cone', 'plane'] as const

/** A cone this near a cylinder is wrapped as one, as an unroll takes it. */
const CONE_MIN_HALF_ANGLE_DEG = 1e-4

/** A sketch's plane tipped further than this from the plane that touches
 *  the surface is refused: a sketch square to a cylinder's axis has no
 *  line of it to roll from. Degrees. */
export const WRAP_MAX_TILT_DEG = 75

/** How a surface is laid out flat about the line the sketch touches it
 *  along: the plane touching it there (`touch`, its normal outward), x
 *  across the line and y along it, and the way back onto the surface. */
export interface Development {
  surface: WrapSurface
  /** The plane touching the surface: a point on the line it touches along,
   *  its outward normal, `across` (x) and `along` (y) — along the axis on a
   *  cylinder, up the slant from the apex on a cone. */
  touch: { point: Vec3; normal: Vec3; across: Vec3; along: Vec3 }
  /** Degrees the sketch's plane is turned from the touching plane — 0 for
   *  a sketch drawn on a plane tangent to the surface (or parallel to it). */
  tiltDeg: number
  /** A point of the sketch's plane laid onto the touching plane and read
   *  there as x, y — mm, the arc along the surface and the length along it. */
  flat(p: Vec3): Vec2
  /** The place on the surface at x, y, moved `w` along the outward normal,
   *  and the normal there — or null where x, y does not lie on it: past a
   *  turn round a cylinder, round a cone or past its apex. */
  place(x: number, y: number, w?: number): { point: Vec3; normal: Vec3 } | null
  /** A point on (or off) the surface read back as x, y: the unroll. */
  develop(p: Vec3): Vec2
}

const unit = (v: Vec3, what: string): Vec3 => {
  const n = normalize(v)
  if (!n) throw new Error(`${what} has no direction.`)
  return n
}

/** The rotation by the least angle taking unit `from` to unit `to`. */
function rotationBetween(from: Vec3, to: Vec3): (v: Vec3) => Vec3 {
  const c = dot(from, to)
  const axis = cross(from, to)
  const s = len(axis)
  if (s < 1e-12) return (v) => v
  const k = scale(axis, 1 / s)
  // Rodrigues: v cos + (k × v) sin + k (k · v)(1 − cos).
  return (v) => add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)))
}

/**
 * How `surface` is laid out for a sketch on the plane `sketch` (its normal
 * and a point in it), whose drawing has its middle at `middle`: the line it
 * touches along and the way back — or a sentence why it does not wrap.
 */
export function developmentFor(surface: WrapSurface, sketch: { normal: Vec3 }, middle: Vec3): Development | string {
  const N = normalize(sketch.normal)
  if (!N) return 'The sketch’s plane has no normal.'
  if (surface.kind === 'plane') {
    const n0 = normalize(surface.normal)
    if (!n0) return 'The plane has no normal.'
    // Any way across the plane will do: the sketch is read and laid back
    // by the same one.
    const across = Math.abs(n0[0]) < 0.9 ? cross(n0, [1, 0, 0]) : cross(n0, [0, 1, 0])
    return finish(surface, N, middle, n0, surface.center, (c) => planeLayout(across, n0)(c))
  }
  const a = normalize(surface.axis)
  if (!a) return `The ${surface.kind} has no axis.`
  if (!(surface.radius > 0)) return `The ${surface.kind} has no radius.`
  // The way out from the axis the touching line lies: the sketch's normal
  // square to the axis, turned to the side the drawing lies.
  const across = sub(N, scale(a, dot(N, a)))
  const lean = len(across)
  if (lean < Math.sin(((90 - WRAP_MAX_TILT_DEG) * Math.PI) / 180) * 0.999) {
    return `The sketch’s plane is square to the ${surface.kind}’s axis — it touches no line of it. Sketch on a plane along the axis: tangent to the ${surface.kind}, or parallel to such a plane.`
  }
  let r0 = scale(across, 1 / lean)
  const fromAxis = sub(middle, surface.center)
  const side = dot(sub(fromAxis, scale(a, dot(fromAxis, a))), r0)
  if (side < 0) r0 = scale(r0, -1)
  const e1 = cross(a, r0)
  const coneDeg = surface.kind === 'cone' ? surface.halfAngle : 0
  if (surface.kind === 'cone' && !(coneDeg < 90)) return 'The cone’s half-angle must be under 90°.'
  if (surface.kind === 'cylinder' || Math.abs(coneDeg) < CONE_MIN_HALF_ANGLE_DEG) {
    const R = surface.radius
    const foot = addScaled(surface.center, a, dot(fromAxis, a))
    const point = addScaled(foot, r0, R)
    return finish(surface, N, middle, r0, point, () => cylinderLayout(foot, a, r0, e1, R))
  }
  if (coneDeg < 0) return 'The cone’s half-angle must be above 0°.'
  const phi = (coneDeg * Math.PI) / 180
  const sin = Math.sin(phi)
  const cos = Math.cos(phi)
  const apex = addScaled(surface.center, a, -surface.radius / Math.tan(phi))
  const n0 = sub(scale(r0, cos), scale(a, sin))
  return finish(surface, N, middle, n0, apex, () => coneLayout(apex, a, r0, e1, sin, cos))
}

interface Layout {
  across: Vec3
  along: Vec3
  /** The reference point x, y count from on the touching plane. */
  origin: Vec3
  place(x: number, y: number, w: number): { point: Vec3; normal: Vec3 } | null
  develop(p: Vec3): Vec2
}

function planeLayout(sketchU: Vec3, n0: Vec3): (center: Vec3) => Layout {
  return (center) => {
    const across = unit(sub(sketchU, scale(n0, dot(sketchU, n0))), 'The sketch')
    const along = cross(n0, across)
    return {
      across,
      along,
      origin: center,
      place: (x, y, w) => ({ point: addScaled(addScaled(addScaled(center, across, x), along, y), n0, w), normal: n0 }),
      develop: (p) => [dot(sub(p, center), across), dot(sub(p, center), along)],
    }
  }
}

function cylinderLayout(foot: Vec3, a: Vec3, r0: Vec3, e1: Vec3, R: number): Layout {
  const turn = Math.PI * R
  return {
    across: e1,
    along: a,
    origin: addScaled(foot, r0, R),
    place: (x, y, w) => {
      // Past half a turn either way it laps itself.
      if (!(Math.abs(x) < turn) || !(R + w > 0)) return null
      const t = x / R
      const radial = add(scale(r0, Math.cos(t)), scale(e1, Math.sin(t)))
      return { point: addScaled(addScaled(foot, a, y), radial, R + w), normal: radial }
    },
    develop: (p) => {
      const d = sub(p, foot)
      return [R * Math.atan2(dot(d, e1), dot(d, r0)), dot(d, a)]
    },
  }
}

function coneLayout(apex: Vec3, a: Vec3, r0: Vec3, e1: Vec3, sin: number, cos: number): Layout {
  const g0 = add(scale(a, cos), scale(r0, sin))
  return {
    across: e1,
    along: g0,
    origin: apex,
    place: (x, y, w) => {
      // On the sector the cone lays out to: the apex its centre, the
      // touching line up its middle. An angle α on it is α / sin round the
      // axis.
      const rho = Math.hypot(x, y)
      if (!(y > 0) || !(rho > 0)) return null
      const theta = Math.atan2(x, y) / sin
      if (!(Math.abs(theta) < Math.PI)) return null
      const radial = add(scale(r0, Math.cos(theta)), scale(e1, Math.sin(theta)))
      const normal = sub(scale(radial, cos), scale(a, sin))
      const onCone = add(scale(a, rho * cos), scale(radial, rho * sin))
      // Offset inside past the axis is no surface.
      if (!(rho * sin + w * cos > 0)) return null
      return { point: addScaled(add(apex, onCone), normal, w), normal }
    },
    develop: (p) => {
      const d = sub(p, apex)
      const h = dot(d, a)
      const c1 = dot(d, r0)
      const c2 = dot(d, e1)
      const rho = Math.hypot(c1, c2)
      const theta = Math.atan2(c2, c1)
      // Its distance from the apex along the cone, at its nearest point on
      // it — as the unroll takes it.
      const s = h * cos + rho * sin
      const alpha = theta * sin
      return [s * Math.sin(alpha), s * Math.cos(alpha)]
    },
  }
}

function finish(surface: WrapSurface, N: Vec3, middle: Vec3, n0: Vec3, point: Vec3, layoutOf: (point: Vec3) => Layout): Development {
  // The sketch's normal taken the way that turns it least onto the
  // touching plane's: a sketch drawn from inside lands where it is drawn,
  // seen from outside as it would be through the plane.
  const from = dot(N, n0) < 0 ? scale(N, -1) : N
  const tiltDeg = (Math.acos(Math.min(1, Math.abs(dot(N, n0)))) * 180) / Math.PI
  const turnOnto = rotationBetween(from, n0)
  // The drawing's middle dropped onto the touching plane: what the sketch
  // turns about.
  const pivot = addScaled(middle, n0, -dot(sub(middle, point), n0))
  const lay = layoutOf(point)
  const flat = (p: Vec3): Vec2 => {
    const onto = add(pivot, turnOnto(sub(p, middle)))
    const d = sub(onto, lay.origin)
    return [dot(d, lay.across), dot(d, lay.along)]
  }
  return {
    surface,
    touch: { point: surface.kind === 'plane' ? pivot : point, normal: n0, across: lay.across, along: lay.along },
    tiltDeg,
    flat,
    place: (x, y, w = 0) => lay.place(x, y, w),
    develop: lay.develop,
  }
}

// ---- profiles --------------------------------------------------------------------------

/** One piece of a profile wrapped: the points it was sampled at, laid
 *  flat (x, y) and the parameter each sits at along it (chord length on
 *  the flat, 0 to 1) — the same for every offset the builder lifts it to,
 *  so the walls between two offsets run along the normal. */
export interface WrappedPiece {
  flat: Vec2[]
  params: number[]
  /** The sketch piece it came from, where the profile knows it. */
  entity?: number
}

export interface WrappedLoop {
  pieces: WrappedPiece[]
}

export interface WrappedProfile {
  outer: WrappedLoop
  holes: WrappedLoop[]
  /** A point inside the profile, laid flat: what the builder keeps the
   *  piece of the shell round. */
  inside: Vec2
}

/** The finest step a wrapped outline is sampled at round the surface:
 *  degrees of arc between samples on a curved surface. A cubic through
 *  points this close lies within a micron of the curve on any part. */
const WRAP_STEP_DEG = 2
/** At most this many samples a piece. */
const WRAP_MAX_SAMPLES = 160

/** A piece's points in the sketch plane, fine enough to wrap: a line cut
 *  into steps, an arc and a spline at their own points closer together,
 *  a whole circle as two halves (a curve through one point twice is no
 *  curve to interpolate). */
function pieceSamples(piece: LoopPiece, maxStep: number): Vec3[][] {
  if (piece.kind === 'circle') {
    const pts = piecePoints(piece, Math.PI / 90)
    const half = Math.floor((pts.length - 1) / 2)
    return [pts.slice(0, half + 1), pts.slice(half)].map((p) => densify(p, maxStep))
  }
  return [densify(piece.kind === 'line' ? [piece.a, piece.b] : piecePoints(piece, Math.PI / 90), maxStep)]
}

function densify(pts: readonly Vec3[], maxStep: number): Vec3[] {
  const out: Vec3[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const d = len(sub(pts[i], pts[i - 1]))
    const n = Math.min(WRAP_MAX_SAMPLES, Math.max(1, Math.ceil(d / maxStep)))
    for (let k = 1; k <= n; k++) out.push(addScaled(pts[i - 1], sub(pts[i], pts[i - 1]), k / n))
  }
  // At least four points: a cubic through them.
  while (out.length < 4) {
    const longest = out.slice(1).reduce((best, p, i) => (len(sub(p, out[i])) > len(sub(out[best + 1], out[best])) ? i : best), 0)
    out.splice(longest + 1, 0, scale(add(out[longest], out[longest + 1]), 0.5))
  }
  return out
}

/** The step a surface is sampled at, mm along it. */
export function wrapStep(surface: WrapSurface, reach: number): number {
  if (surface.kind === 'plane') return Infinity
  const r = surface.kind === 'cylinder' ? surface.radius : Math.max(1e-3, Math.min(surface.radius, reach))
  return Math.max(0.05, (r * WRAP_STEP_DEG * Math.PI) / 180)
}

/** The profiles of a sketch laid flat on the development, each piece
 *  sampled — or why one does not lie on the surface. */
export function wrapProfiles(profiles: readonly Profile[], dev: Development): WrappedProfile[] | string {
  const reach = coneReach(profiles, dev)
  const step = wrapStep(dev.surface, reach)
  const out: WrappedProfile[] = []
  for (const profile of profiles) {
    const loop = (pieces: readonly LoopPiece[]): WrappedLoop => ({
      pieces: pieces.flatMap((piece) =>
        pieceSamples(piece, step).map((pts) => {
          const flat = pts.map((p) => dev.flat(p))
          return { flat, params: chordParams(flat), ...(piece.entity !== undefined ? { entity: piece.entity } : {}) }
        }),
      ),
    })
    const outer = loop(profile.outer)
    const holes = profile.holes.map(loop)
    for (const l of [outer, ...holes]) {
      for (const piece of l.pieces) {
        for (const [x, y] of piece.flat) {
          if (!dev.place(x, y, 0)) return offSurfaceWords(dev.surface)
        }
      }
    }
    const inside = insidePoint(polygonOf(outer), holes.map(polygonOf))
    if (!inside) return 'A profile has no inside to wrap — it is a sliver.'
    out.push({ outer, holes, inside })
  }
  return out
}

/** On a cone, how far from the apex the drawing lies — the radius its
 *  sampling step is read at. */
function coneReach(profiles: readonly Profile[], dev: Development): number {
  if (dev.surface.kind !== 'cone') return Infinity
  let near = Infinity
  for (const p of profiles) for (const piece of p.outer) for (const q of piecePoints(piece)) near = Math.min(near, Math.hypot(...dev.flat(q)) * Math.sin((dev.surface.halfAngle * Math.PI) / 180))
  return near
}

function offSurfaceWords(s: WrapSurface): string {
  if (s.kind === 'cylinder') return `The sketch is wider than half a turn round the cylinder either way from where it touches — ${round2(Math.PI * s.radius)} mm of arc each way at R${round2(s.radius)}. Move it, or wrap it in pieces.`
  if (s.kind === 'cone') return 'The sketch reaches past the cone’s apex, or further round it than half a turn either way from where it touches — move it onto the cone.'
  return 'The sketch does not lie on the plane.'
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** Chord-length parameters, 0 to 1. */
function chordParams(pts: readonly Vec2[]): number[] {
  const t = [0]
  for (let i = 1; i < pts.length; i++) t.push(t[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = t[t.length - 1]
  return total > 0 ? t.map((v) => v / total) : pts.map((_, i) => i / (pts.length - 1))
}

/** A loop's points end to end. */
export function polygonOf(loop: WrappedLoop): Vec2[] {
  const out: Vec2[] = []
  for (const piece of loop.pieces) for (const p of piece.flat) if (out.length === 0 || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 1e-9) out.push(p)
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop()
  return out
}

/** A point well inside the outer polygon and outside its holes: the middle
 *  of the widest run inside along the lines across it at a few heights. */
export function insidePoint(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[]): Vec2 | null {
  if (outer.length < 3) return null
  let lo = Infinity
  let hi = -Infinity
  for (const p of outer) {
    lo = Math.min(lo, p[1])
    hi = Math.max(hi, p[1])
  }
  let best: { at: Vec2; width: number } | null = null
  const LINES = 23
  for (let k = 1; k <= LINES; k++) {
    const y = lo + ((hi - lo) * k) / (LINES + 1)
    const xs: number[] = []
    for (const poly of [outer, ...holes]) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        if (a[1] <= y === b[1] <= y) continue
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
      }
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1] - xs[i]
      if (!best || width > best.width) best = { at: [(xs[i] + xs[i + 1]) / 2, y], width }
    }
  }
  return best && best.width > 1e-9 ? best.at : null
}

// ---- lifting --------------------------------------------------------------------------

/** A wrapped piece lifted to the surface moved `w` along its normal: a
 *  cubic B-spline through the samples on their parameters — the same knots
 *  at every offset — as the kernel's spline piece takes it. */
export function liftPiece(piece: WrappedPiece, dev: Development, w: number): LoopPiece {
  const pts = piece.flat.map(([x, y]) => {
    const at = dev.place(x, y, w)
    if (!at) throw new Error('The wrapped outline left the surface.')
    return at.point
  })
  if (dev.surface.kind === 'plane' && isStraight(piece.flat)) return { kind: 'line', a: pts[0], b: pts[pts.length - 1], ...(piece.entity !== undefined ? { entity: piece.entity } : {}) }
  const { poles, knots, mults } = interpolateCubic(pts, piece.params)
  return { kind: 'spline', poles, knots, mults, ...(piece.entity !== undefined ? { entity: piece.entity } : {}) }
}

function isStraight(pts: readonly Vec2[]): boolean {
  const a = pts[0]
  const b = pts[pts.length - 1]
  const d = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (!(d > 0)) return false
  return pts.every((p) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / d < 1e-9)
}

/** A wrapped loop lifted to offset `w`: its pieces end to end. */
export function liftLoop(loop: WrappedLoop, dev: Development, w: number): LoopPiece[] {
  return loop.pieces.map((p) => liftPiece(p, dev, w))
}

/** Where on the surface, moved `w` out, a flat point lies. */
export function placeFlat(dev: Development, p: Vec2, w: number): Vec3 {
  const at = dev.place(p[0], p[1], w)
  if (!at) throw new Error('The point is off the surface.')
  return at.point
}

/**
 * The cubic B-spline through `points` at parameters `params` (0 to 1,
 * increasing): knots by averaging (Piegl & Tiller 9.8), the poles solved
 * for. Knots distinct, with their multiplicities, as the kernel takes them.
 */
export function interpolateCubic(points: readonly Vec3[], params: readonly number[]): { poles: Vec3[]; knots: number[]; mults: number[] } {
  const n = points.length - 1
  const p = 3
  if (n < p) throw new Error('A cubic needs four points.')
  const U: number[] = []
  for (let i = 0; i <= p; i++) U.push(0)
  for (let j = 1; j <= n - p; j++) {
    let s = 0
    for (let i = j; i < j + p; i++) s += params[i]
    U.push(s / p)
  }
  for (let i = 0; i <= p; i++) U.push(1)
  // The system N(t_k) · P = Q, dense: a piece is a few dozen points.
  const A: number[][] = []
  for (let k = 0; k <= n; k++) A.push(basisRow(U, p, n, params[k]))
  const poles = solve(A, points)
  const knots: number[] = []
  const mults: number[] = []
  for (const u of U) {
    if (knots.length > 0 && Math.abs(u - knots[knots.length - 1]) < 1e-12) mults[mults.length - 1]++
    else {
      knots.push(u)
      mults.push(1)
    }
  }
  return { poles, knots, mults }
}

/** The n + 1 basis functions of degree p on knots U at t. */
function basisRow(U: readonly number[], p: number, n: number, t: number): number[] {
  const row = new Array<number>(n + 1).fill(0)
  if (t >= U[n + 1]) {
    row[n] = 1
    return row
  }
  let span = p
  while (span < n && t >= U[span + 1]) span++
  const N = new Array<number>(p + 1).fill(0)
  const left = new Array<number>(p + 1).fill(0)
  const right = new Array<number>(p + 1).fill(0)
  N[0] = 1
  for (let j = 1; j <= p; j++) {
    left[j] = t - U[span + 1 - j]
    right[j] = U[span + j] - t
    let saved = 0
    for (let r = 0; r < j; r++) {
      const tmp = N[r] / (right[r + 1] + left[j - r])
      N[r] = saved + right[r + 1] * tmp
      saved = left[j - r] * tmp
    }
    N[j] = saved
  }
  for (let j = 0; j <= p; j++) row[span - p + j] = N[j]
  return row
}

/** A · X = B for three right-hand sides, by elimination with partial
 *  pivoting. */
function solve(A0: readonly number[][], B: readonly Vec3[]): Vec3[] {
  const n = A0.length
  const A = A0.map((r) => r.slice())
  const X = B.map((b) => [b[0], b[1], b[2]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-14) throw new Error('The outline’s points could not be interpolated.')
    if (piv !== c) {
      ;[A[c], A[piv]] = [A[piv], A[c]]
      ;[X[c], X[piv]] = [X[piv], X[c]]
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]
      if (f === 0) continue
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      for (let k = 0; k < 3; k++) X[r][k] -= f * X[c][k]
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    for (let k = 0; k < 3; k++) {
      let s = X[c][k]
      for (let j = c + 1; j < n; j++) s -= A[c][j] * X[j][k]
      X[c][k] = s / A[c][c]
    }
  }
  return X as Vec3[]
}

// ---- reading it ------------------------------------------------------------------------

/** What a wrapped sketch comes to on the surface, for an answer: the box
 *  it takes on the development (x across, y along, mm), the arc it covers
 *  round the axis (degrees), and the lengths of its outer loops measured
 *  along the surface. */
export interface WrapFacts {
  across: [number, number]
  along: [number, number]
  /** Degrees round the axis the drawing covers — a cylinder's or a cone's. */
  arcDeg?: number
  /** Each profile's outer loop's length on the surface, mm — the same as on
   *  the sketch, which is what keeping lengths true means. */
  perimeters: number[]
}

export function wrapFacts(profiles: readonly WrappedProfile[], dev: Development): WrapFacts {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  let t0 = Infinity
  let t1 = -Infinity
  const perimeters: number[] = []
  const c = dev.surface.kind === 'plane' ? null : dev.surface
  const a = c ? normalize(c.axis)! : null
  const r0 = a ? normalize(sub(dev.touch.normal, scale(a, dot(dev.touch.normal, a))))! : null
  const e1 = a && r0 ? cross(a, r0) : null
  for (const p of profiles) {
    let perimeter = 0
    for (const piece of p.outer.pieces) {
      let prev: Vec3 | null = null
      for (const [x, y] of piece.flat) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
        const at = placeFlat(dev, [x, y], 0)
        if (prev) perimeter += len(sub(at, prev))
        prev = at
        if (a && r0 && e1) {
          const d = sub(at, c!.center)
          const theta = Math.atan2(dot(d, e1), dot(d, r0))
          t0 = Math.min(t0, theta)
          t1 = Math.max(t1, theta)
        }
      }
    }
    perimeters.push(perimeter)
  }
  return { across: [x0, x1], along: [y0, y1], ...(a ? { arcDeg: ((t1 - t0) * 180) / Math.PI } : {}), perimeters }
}

// ---- a step ---------------------------------------------------------------------------

/** What a wrap step carries to the builder: plain numbers, as a step
 *  crosses to the worker. */
export interface WrapGeometry {
  surface: WrapSurface
  /** The sketch's profiles in the part, on its plane. */
  profiles: Profile[]
  /** The sketch plane's normal and the drawing's middle: what the
   *  development is read from (developmentFor). */
  normal: Vec3
  middle: Vec3
  /** The offsets of the surface the solid lies between, mm along the
   *  outward normal. */
  from: number
  to: number
}

/** The development and the wrapped profiles of a step — or why not. */
export function wrapOfGeometry(g: Pick<WrapGeometry, 'surface' | 'profiles' | 'normal' | 'middle'>): { dev: Development; wrapped: WrappedProfile[] } | string {
  const dev = developmentFor(g.surface, { normal: g.normal }, g.middle)
  if (typeof dev === 'string') return dev
  const wrapped = wrapProfiles(g.profiles, dev)
  if (typeof wrapped === 'string') return wrapped
  return { dev, wrapped }
}

/** Why the offsets do not make a solid on this surface, or null. */
export function wrapDepthProblem(g: Pick<WrapGeometry, 'surface' | 'from' | 'to'>, wrapped: readonly WrappedProfile[], dev: Development): string | null {
  const lo = Math.min(g.from, g.to)
  const hi = Math.max(g.from, g.to)
  if (!(hi - lo > 1e-6)) return 'The wrap needs a depth above zero.'
  if (g.surface.kind === 'cylinder' && !(g.surface.radius + lo > 1e-3)) return `The cut goes ${round3(-lo)} mm in — as deep as the cylinder’s radius R${round3(g.surface.radius)} or deeper.`
  for (const p of wrapped)
    for (const loop of [p.outer, ...p.holes])
      for (const piece of loop.pieces)
        for (const f of piece.flat) if (!dev.place(f[0], f[1], lo)) return `The cut goes ${round3(-lo)} mm in, past the cone’s axis under the sketch — less depth, or the sketch further from the apex.`
  return null
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** The middle of several profiles: their middles' mean. */
export function profilesMiddle(profiles: readonly Profile[]): Vec3 {
  const sum: Vec3 = [0, 0, 0]
  for (const p of profiles) {
    const m = profileMiddle(p)
    for (let k = 0; k < 3; k++) sum[k] += m[k] / profiles.length
  }
  return sum
}
