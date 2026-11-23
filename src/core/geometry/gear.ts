// SPDX-License-Identifier: AGPL-3.0-only
// An involute gear's geometry: what its numbers make of it, and its outline
// square to the axis.
//
// A gear is named the way a drawing names it: the tooth count, the normal
// module and pressure angle, the helix angle at the reference circle (plus
// for a right hand, minus for a left, 0 for a spur gear), the profile shift
// coefficient and the tip and root diameters. Square to the axis (the
// transverse plane) a helical gear's teeth are involutes of the base circle
// as a spur gear's are, with the transverse module m/cos β and pressure
// angle atan(tan α / cos β); going along the axis the outline turns by
// tan β / r for each millimetre, r the reference radius — the same turn at
// every radius, so the teeth are true helicoids.
//
// The outline is drawn tooth by tooth from the tooth's middle: an arc at the
// tip, each flank an involute from the tip down to the base circle (or the
// root circle, where that lies outside it), a straight radial foot from
// the base circle to the root, and an arc along the root to the next tooth.
// Each flank is a cubic B-spline through Hermite pieces of the involute,
// within a few ten-thousandths of a millimetre of it.

export type Vec2 = [number, number]

export interface GearSpec {
  teeth: number
  /** The normal module, mm. */
  module: number
  /** The normal pressure angle, degrees. */
  pressureDeg: number
  /** The helix angle at the reference circle, degrees: plus a right hand,
   *  minus a left, 0 a spur gear. */
  helixDeg: number
  /** The profile shift coefficient, in modules (normal). */
  shift: number
  tipDiameter: number
  rootDiameter: number
}

export interface GearGeometry {
  /** The transverse module and pressure angle (radians). */
  transverseModule: number
  transversePressure: number
  pitchRadius: number
  baseRadius: number
  tipRadius: number
  rootRadius: number
  /** Half a tooth's angular thickness at the reference circle, radians. */
  halfToothAtPitch: number
  /** Half a tooth's angle at the tip, radians: 0 or less for a tooth that
   *  comes to a point under the tip circle. */
  halfToothAtTip: number
  /** The angle a transverse section turns per millimetre along the axis,
   *  radians: positive for a right hand. */
  twistPerMm: number
  /** The helix angle at the base circle, radians. */
  baseHelix: number
  /** The axial length of one full turn of a tooth, mm; Infinity for a spur
   *  gear. */
  lead: number
}

/** The involute function. */
export const inv = (a: number): number => Math.tan(a) - a

const RAD = Math.PI / 180

/** The pressure angle of an involute of the base circle `rb` at radius r. */
export const pressureAt = (rb: number, r: number): number => (r <= rb ? 0 : Math.acos(rb / r))

export function gearGeometry(g: GearSpec): GearGeometry {
  const beta = g.helixDeg * RAD
  const an = g.pressureDeg * RAD
  const mt = g.module / Math.cos(beta)
  const at = Math.atan(Math.tan(an) / Math.cos(beta))
  const rp = (g.teeth * mt) / 2
  const rb = rp * Math.cos(at)
  // Transverse thickness at the reference circle: s = m_t (π/2) + 2 x m_n tan α_t.
  const s = (mt * Math.PI) / 2 + 2 * g.shift * g.module * Math.tan(at)
  const halfPitch = s / (2 * rp)
  const ra = g.tipDiameter / 2
  const rf = g.rootDiameter / 2
  const halfAt = (r: number) => halfPitch + inv(at) - inv(pressureAt(rb, r))
  const twist = Math.tan(beta) / rp
  return {
    transverseModule: mt,
    transversePressure: at,
    pitchRadius: rp,
    baseRadius: rb,
    tipRadius: ra,
    rootRadius: rf,
    halfToothAtPitch: halfPitch,
    halfToothAtTip: halfAt(ra),
    twistPerMm: twist,
    baseHelix: Math.atan(Math.tan(beta) * Math.cos(at)),
    lead: twist === 0 ? Infinity : (2 * Math.PI) / Math.abs(twist),
  }
}

/** Half a tooth's angular thickness at radius r (r at or above the base
 *  circle), radians. */
export function halfToothAt(geo: GearGeometry, r: number): number {
  return geo.halfToothAtPitch + inv(geo.transversePressure) - inv(pressureAt(geo.baseRadius, r))
}

/** Why a gear's numbers cannot make a gear, or null. */
export function gearProblem(g: GearSpec): string | null {
  if (!Number.isInteger(g.teeth) || g.teeth < 3 || g.teeth > 400) return 'The tooth count is a whole number from 3 to 400.'
  if (!(g.module > 0)) return 'The module must be above 0.'
  if (!(g.pressureDeg >= 5 && g.pressureDeg <= 40)) return 'The pressure angle lies between 5 and 40°.'
  if (!(Math.abs(g.helixDeg) <= 60)) return 'The helix angle lies between −60 and 60°.'
  if (!Number.isFinite(g.shift) || Math.abs(g.shift) > 3) return 'The profile shift lies between −3 and 3.'
  if (!(g.rootDiameter > 0) || !(g.tipDiameter > g.rootDiameter)) return 'The tip diameter must lie above the root diameter, and both above 0.'
  const geo = gearGeometry(g)
  // The sizes are left out: the message is shown in whatever units the
  // page reads in, and this file does not know them.
  if (geo.tipRadius <= geo.baseRadius) return 'The tip circle lies inside the base circle: no involute to draw — a larger tip diameter, or a smaller module.'
  if (geo.halfToothAtTip <= 1e-4) return `The teeth come to a point under the tip circle: make the tip diameter smaller (under ${round3((2 * pointedRadius(geo)) / g.module)} modules).`
  const foot = Math.max(geo.baseRadius, geo.rootRadius)
  const halfFoot = halfToothAt(geo, foot)
  if (halfFoot >= Math.PI / g.teeth - 1e-4) return 'The teeth meet each other at the root: the profile shift or the tooth count is too large for this module.'
  return null
}

const round3 = (x: number) => Math.round(x * 1000) / 1000

/** The radius at which the teeth come to a point. */
function pointedRadius(geo: GearGeometry): number {
  let lo = geo.baseRadius
  let hi = geo.tipRadius
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2
    if (halfToothAt(geo, m) > 0) lo = m
    else hi = m
  }
  return lo
}

/** One piece of an outline in the transverse plane. */
export type GearPiece =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; a: Vec2; m: Vec2; b: Vec2 }
  /** A cubic B-spline: its poles, distinct knots and their multiplicities. */
  | { kind: 'spline'; poles: Vec2[]; knots: number[]; mults: number[] }

/** Hermite pieces a flank is drawn with. */
const FLANK_PIECES = 6

const polar = (r: number, a: number): Vec2 => [r * Math.cos(a), r * Math.sin(a)]

/** One flank as a cubic B-spline from radius r0 to r1, its angle from the
 *  tooth's middle `mid` side × halfToothAt(r): side +1 the flank on the
 *  counter-clockwise side of the tooth. Drawn against s = t², t the roll
 *  angle (tan of the pressure angle): s runs with the length along the
 *  involute, so the pieces are even and the curve's tangent is finite at
 *  the base circle, where against the radius it is not. */
function flank(geo: GearGeometry, mid: number, side: 1 | -1, r0: number, r1: number): GearPiece {
  const rb = geo.baseRadius
  const half0 = halfToothAt(geo, rb)
  const at = (s: number): { p: Vec2; d: Vec2 } => {
    const t = Math.sqrt(Math.max(0, s))
    const q = 1 + t * t
    const r = rb * Math.sqrt(q)
    // The angle from the tooth's middle falls by inv α = t − atan t.
    const th = mid + side * (half0 - (t - Math.atan(t)))
    const dr = rb / (2 * Math.sqrt(q))
    const dth = (-side * t) / (2 * q)
    const c = Math.cos(th)
    const sn = Math.sin(th)
    return { p: [r * c, r * sn], d: [dr * c - r * dth * sn, dr * sn + r * dth * c] }
  }
  const s0 = Math.max(0, (r0 / rb) ** 2 - 1)
  const s1 = (r1 / rb) ** 2 - 1
  // The angle grows as s^1.5 off the base circle, which no cubic follows
  // closely over a long piece: the pieces are short there and longer out.
  const knot = (i: number) => s0 + (s1 - s0) * (i / FLANK_PIECES) ** 2
  const poles: Vec2[] = []
  for (let i = 0; i < FLANK_PIECES; i++) {
    const h = knot(i + 1) - knot(i)
    const a = at(knot(i))
    const b = at(knot(i + 1))
    if (i === 0) poles.push(a.p)
    poles.push([a.p[0] + (a.d[0] * h) / 3, a.p[1] + (a.d[1] * h) / 3], [b.p[0] - (b.d[0] * h) / 3, b.p[1] - (b.d[1] * h) / 3], b.p)
  }
  const knots = Array.from({ length: FLANK_PIECES + 1 }, (_, i) => i)
  const mults = knots.map((_, i) => (i === 0 || i === FLANK_PIECES ? 4 : 3))
  return { kind: 'spline', poles, knots, mults }
}

const reversed = (p: GearPiece): GearPiece =>
  p.kind === 'line' ? { kind: 'line', a: p.b, b: p.a } : p.kind === 'arc' ? { kind: 'arc', a: p.b, m: p.m, b: p.a } : { kind: 'spline', poles: [...p.poles].reverse(), knots: p.knots.map((k) => p.knots[p.knots.length - 1] - k).reverse(), mults: [...p.mults].reverse() }

/**
 * The gear's outline square to the axis, counter-clockwise, as one closed
 * loop of pieces: tooth 0's middle at angle `phase` (radians from +u
 * towards +v). Throws on numbers that make no gear (gearProblem).
 */
export function gearOutline(g: GearSpec, phase: number): GearPiece[] {
  const problem = gearProblem(g)
  if (problem) throw new Error(problem)
  const geo = gearGeometry(g)
  const pitch = (2 * Math.PI) / g.teeth
  const rf = geo.rootRadius
  const foot = Math.max(geo.baseRadius, rf)
  const ra = geo.tipRadius
  const halfTip = geo.halfToothAtTip
  const halfFoot = halfToothAt(geo, foot)
  const out: GearPiece[] = []
  for (let k = 0; k < g.teeth; k++) {
    const mid = phase + k * pitch
    // Counter-clockwise: up the clockwise flank, over the tip, down the
    // counter-clockwise flank, along the root to the next tooth.
    if (foot > rf) out.push({ kind: 'line', a: polar(rf, mid - halfFoot), b: polar(foot, mid - halfFoot) })
    out.push(flank(geo, mid, -1, foot, ra))
    out.push({ kind: 'arc', a: polar(ra, mid - halfTip), m: polar(ra, mid), b: polar(ra, mid + halfTip) })
    out.push(reversed(flank(geo, mid, 1, foot, ra)))
    if (foot > rf) out.push({ kind: 'line', a: polar(foot, mid + halfFoot), b: polar(rf, mid + halfFoot) })
    const next = mid + pitch
    out.push({ kind: 'arc', a: polar(rf, mid + halfFoot), m: polar(rf, mid + pitch / 2), b: polar(rf, next - halfFoot) })
  }
  return out
}

/** The standard modules (ISO 54, first and second choice), mm. */
export const STANDARD_MODULES = [0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.125, 1.25, 1.375, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 25]

/** The usual diametral pitches, teeth per inch of reference diameter. */
export const STANDARD_DIAMETRAL_PITCHES = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 72, 80, 96, 120]

/** The pressure angles gears are cut at, degrees, the usual one first. */
export const STANDARD_PRESSURE_ANGLES = [20, 14.5, 25, 22.5, 17.5]
