// SPDX-License-Identifier: AGPL-3.0-only
// An involute gear read off cuts of a scan square to its axis: its tip and
// root circles, its base circle, its helix and its tooth thickness, and
// from those the module, pressure angle and profile shift a drawing names.
//
// The cuts come as (u, v) points in planes square to the axis, the axis at
// [0, 0], each at its height h along the axis; the tooth count comes from
// the rotational repeat (rotationalRepeat.ts). The reading:
//
// - The centre: a circle through the tips (the outline near the outermost
//   radius) — every tooth lands on it, so a scan's axis a little off is
//   moved onto the teeth's own centre.
// - The tip and root circles: each cut's outer envelope (the farthest point
//   in each sliver of angle), its 99th and 1st percentile — the envelope
//   runs along the tips and the bottoms of the gaps, never inside a bore or
//   a web.
// - The helix: where the tips lie at each height, as the phase of the
//   tooth count's harmonic; the phase moving along the axis is the turn per
//   millimetre, and with the base radius the base helix angle,
//   atan(r_b · dφ/dh).
// - The base circle: every flank point, turned back by the helix and folded
//   onto one tooth, lies at an angle ψ(r) = H − inv(acos(r_b / r)) from the
//   tooth's middle for an involute of r_b — each side its own H. The r_b
//   that brings the points closest to that is the base circle; the distance
//   left is how close the flanks are to true involutes.
// - The numbers: only the base pitch, π m cos α, is fixed by the flanks, so
//   the module and pressure angle are a pair along a line. A standard
//   pressure angle that puts the module within 1 % of a standard module (or
//   a diametral pitch) names them; otherwise 20° and the module as measured.
//   The profile shift is then whatever makes the tooth as thick as it is.
// - Each tooth: its flank points' distance from the fitted flank, and how
//   high its tip reaches. A tooth well off the others, or short of the tip
//   circle, is broken: the gear built from the rest has it whole.

import { gearGeometry, inv, pressureAt, STANDARD_DIAMETRAL_PITCHES, STANDARD_MODULES, STANDARD_PRESSURE_ANGLES, type GearSpec } from './gear'

export interface GearCut {
  /** Height along the axis, mm. */
  h: number
  /** The cut's chains: each (u, v) pairs in order, mm, the axis at [0, 0]. */
  chains: (Float32Array | number[])[]
}

export interface GearToothReading {
  index: number
  /** Where its middle lies at height 0, degrees from +u. */
  angleDeg: number
  /** Its flank points' distance from the fitted flanks, rms, mm. */
  rms: number
  /** How far its tip falls short of the tip circle, mm. */
  tipShort: number
  /** Its flank points against the median tooth's. */
  share: number
  broken: boolean
}

export interface GearReading {
  teeth: number
  /** The teeth's own centre, (u, v) mm off the axis given. */
  centre: [number, number]
  tipDiameter: number
  rootDiameter: number
  baseDiameter: number
  /** The turn per mm along the axis, radians; positive a right hand. */
  twistPerMm: number
  /** The helix at the base circle, degrees, signed as the twist. */
  baseHelixDeg: number
  /** Half a tooth at the base circle (the H of each flank), radians. */
  halfAtBase: number
  /** Where tooth 0's middle lies at h = 0, radians from +u. */
  phase: number
  /** The named gear's flanks' distance from the scan's, rms, mm, and the
   *  points read; and the closest involutes' (the base circle as measured). */
  flankRms: number
  measuredFlankRms: number
  flankPoints: number
  /** How far the phase strays from a straight helix along the axis, rms, degrees. */
  helixRms: number
  /** The gear as named: module, pressure angle, helix, shift — the
   *  numbers that rebuild the flanks read. */
  spec: GearSpec
  /** Whether the module is a standard one (or a diametral pitch) at a
   *  standard pressure angle, and which. */
  standard: { module: number; pressureDeg: number; name: string } | null
  teethRead: GearToothReading[]
}

const BINS = 2048
const TIP_BAND = 0.08
/** How far the tips may move along the face on a spur gear, mm. */
const SPUR_MM = 0.05
/** Flank points between these shares of the tooth height above the root. */
const FLANK_LOW = 0.2
const FLANK_HIGH = 0.85
/** Flank points the base circle is searched on, at most. */
const SEARCH_POINTS = 4000
/** The rms is read on the closest share of the points: a stray point or a
 *  burr at an edge does not decide the base circle. */
const TRIM = 0.9
/** A module this close to a standard one names it. */
const STANDARD_WITHIN = 0.01
/** A tooth this much further from the flanks than the median tooth, or its
 *  tip this share of the tooth height short, is broken. */
const BROKEN_RMS_TIMES = 2.5
const BROKEN_RMS_MM = 0.05
const BROKEN_TIP_SHARE = 0.15
const BROKEN_POINT_SHARE = 0.5

/** A cut's points, each chain's in order, with a NaN pair between chains. */
function pointsOf(c: GearCut): [number, number][] {
  const out: [number, number][] = []
  for (const ch of c.chains) {
    if (out.length) out.push([NaN, NaN])
    for (let i = 0; i + 1 < ch.length; i += 2) out.push([ch[i], ch[i + 1]])
  }
  return out
}

/** Points along a cut's chains, none further apart than `step` mm — the
 *  envelope reads every sliver of angle the outline crosses. */
function densified(pts: readonly [number, number][], step: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (Number.isNaN(p[0])) continue
    out.push(p)
    const q = pts[i + 1]
    if (!q || Number.isNaN(q[0])) continue
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step)
    for (let k = 1; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n])
  }
  return out
}

/** A least-squares circle (Kåsa) through 2D points. */
export function circleThrough(pts: readonly [number, number][]): { cx: number; cy: number; r: number } | null {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0
  for (const [x, y] of pts) {
    const z = x * x + y * y
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z
  }
  const n = pts.length
  if (n < 3) return null
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]]
  const B = [sxz, syz, sz]
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const d = det(A)
  if (Math.abs(d) < 1e-12) return null
  const sol = [0, 1, 2].map((c) => det(A.map((row, i) => row.map((v, j) => (j === c ? B[i] : v)))) / d)
  const cx = sol[0] / 2
  const cy = sol[1] / 2
  return { cx, cy, r: Math.sqrt(sol[2] + cx * cx + cy * cy) }
}

const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]
const median = (xs: readonly number[]) => quantile([...xs].sort((a, b) => a - b), 0.5)
const wrapHalf = (a: number, period: number) => ((((a + period / 2) % period) + period) % period) - period / 2

/** The outer envelope of a cut: the farthest radius in each sliver of angle
 *  (0 where the cut has no point). */
function envelope(pts: readonly [number, number][]): Float64Array {
  const prof = new Float64Array(BINS)
  let far = 0
  for (const [x, y] of pts) if (!Number.isNaN(x)) far = Math.max(far, Math.hypot(x, y))
  for (const [x, y] of densified(pts, Math.max(1e-3, (far * Math.PI) / BINS))) {
    const k = Math.floor((((Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * BINS) % BINS
    prof[k] = Math.max(prof[k], Math.hypot(x, y))
  }
  return prof
}

function tipAndRoot(cuts: readonly [number, number][][]): { ra: number; rf: number } {
  const env: number[] = []
  for (const pts of cuts) for (const v of envelope(pts)) if (v > 0) env.push(v)
  env.sort((a, b) => a - b)
  return { ra: quantile(env, 0.99), rf: quantile(env, 0.01) }
}

interface Flank { r: number; u: number; tooth: number }

interface BaseFit { rb: number; left: number; right: number; rms: number }

/** How close the folded flank points lie to involutes of the base radius
 *  rb, each side its own H: the rms (mm) of the closest share. */
function flankScore(flank: readonly Flank[], rb: number): BaseFit {
  const vals = flank.map((f) => Math.abs(f.u) + inv(pressureAt(rb, f.r)))
  const left = median(vals.filter((_, i) => flank[i].u < 0))
  const right = median(vals.filter((_, i) => flank[i].u >= 0))
  const res = vals.map((v, i) => (flank[i].r * (v - (flank[i].u < 0 ? left : right))) ** 2)
  res.sort((p, q) => p - q)
  const kept = res.slice(0, Math.max(1, Math.floor(res.length * TRIM)))
  return { rb, left, right, rms: Math.sqrt(kept.reduce((t, x) => t + x, 0) / kept.length) }
}

/** The base radius between lo and hi that brings the flank points closest
 *  to involutes: a coarse sweep, then a golden-section search about the best. */
function fitBase(all: readonly Flank[], lo: number, hi: number): BaseFit {
  // The search on points spread evenly over the cuts, the answer on all.
  const step = Math.ceil(all.length / SEARCH_POINTS)
  const flank = step > 1 ? all.filter((_, i) => i % step === 0) : all
  let best = flankScore(flank, lo)
  const steps = 80
  for (let i = 1; i <= steps; i++) {
    const t = flankScore(flank, lo + ((hi - lo) * i) / steps)
    if (t.rms < best.rms) best = t
  }
  const span = (hi - lo) / steps
  let a = Math.max(lo, best.rb - span)
  let b = Math.min(hi, best.rb + span)
  const g = (Math.sqrt(5) - 1) / 2
  for (let i = 0; i < 40; i++) {
    const c = b - g * (b - a)
    const d = a + g * (b - a)
    if (flankScore(flank, c).rms < flankScore(flank, d).rms) b = d
    else a = c
  }
  const end = flankScore(flank, (a + b) / 2)
  return flankScore(all, end.rms < best.rms ? end.rb : best.rb)
}

/** A standard module (or diametral pitch) within 1 % of a module, or null. */
function nearestStandard(module: number): { m: number; name: string } | null {
  let near: { m: number; name: string } | null = null
  for (const m of STANDARD_MODULES) if (!near || Math.abs(m - module) < Math.abs(near.m - module)) near = { m, name: `m ${m}` }
  for (const dp of STANDARD_DIAMETRAL_PITCHES) if (!near || Math.abs(25.4 / dp - module) < Math.abs(near.m - module)) near = { m: 25.4 / dp, name: `DP ${dp}` }
  return near && Math.abs(near.m - module) / near.m <= STANDARD_WITHIN ? near : null
}

/** A standard module's flanks are taken where they lie this close to the
 *  scan's against the measured ones. */
const STANDARD_RMS_TIMES = 1.25
const STANDARD_RMS_MM = 0.01
/** And its profile shift is one gears are cut with. A short flank fits
 *  several pressure angles alike: the Artec gear's lies 0.060 to 0.066 mm
 *  from m 2.25 at 14.5°, 16° and 17.5°, each wanting a shift of 1.25 or
 *  more — none of them its drawing's numbers. */
const STANDARD_SHIFT = 1

/** The profile shift that makes a tooth as thick as it is: its half angle
 *  at the base circle is H = ψ_p + inv α_t. */
function shiftOf(teeth: number, halfAtBase: number, helix: number, at: number): number {
  return ((halfAtBase - inv(at)) * teeth - Math.PI / 2) / (2 * Math.cos(helix) * Math.tan(at))
}

interface Named { pressureDeg: number; helix: number; module: number; fit: BaseFit; standard: GearReading['standard'] }

/** The module and pressure angle the flanks name. Only the base pitch is
 *  fixed by them: at each standard pressure angle the module that keeps it,
 *  and where that lies within 1 % of a standard module, the gear with the
 *  standard module itself — its helix from the lead, its base circle from
 *  both, its flanks read against the points again. A standard gear is
 *  taken where its flanks lie as close to the scan as the measured ones
 *  (within a quarter more, or 0.01 mm), the usual pressure angle first;
 *  otherwise 20° and the module as measured. */
function nameGear(teeth: number, flank: readonly Flank[], measured: BaseFit, twist: number): Named {
  const baseHelix = Math.atan(measured.rb * twist)
  let fallback: Named | null = null
  for (const pressureDeg of STANDARD_PRESSURE_ANGLES) {
    const an = (pressureDeg * Math.PI) / 180
    const sinB = Math.sin(baseHelix) / Math.cos(an)
    if (Math.abs(sinB) >= 1) continue
    const helix = Math.asin(sinB)
    const at = Math.atan(Math.tan(an) / Math.cos(helix))
    const module = (2 * measured.rb * Math.cos(helix)) / (teeth * Math.cos(at))
    fallback ??= { pressureDeg, helix, module, fit: measured, standard: null }
    const near = nearestStandard(module)
    if (!near) continue
    // The lead is the scan's: sin β = twist · z · m / 2.
    const sinS = (twist * teeth * near.m) / 2
    if (Math.abs(sinS) >= 1) continue
    const helixS = Math.asin(sinS)
    const atS = Math.atan(Math.tan(an) / Math.cos(helixS))
    const rbS = ((teeth * near.m) / (2 * Math.cos(helixS))) * Math.cos(atS)
    const fit = flankScore(flank, rbS)
    const shiftS = shiftOf(teeth, (fit.left + fit.right) / 2, helixS, atS)
    if (Math.abs(shiftS) <= STANDARD_SHIFT && fit.rms <= Math.max(STANDARD_RMS_TIMES * measured.rms, measured.rms + STANDARD_RMS_MM)) {
      return { pressureDeg, helix: helixS, module: near.m, fit, standard: { module: near.m, pressureDeg, name: `${near.name}, ${pressureDeg}°` } }
    }
  }
  return fallback ?? { pressureDeg: 20, helix: 0, module: (2 * measured.rb) / (teeth * Math.cos((20 * Math.PI) / 180)), fit: measured, standard: null }
}

/**
 * The gear read off the cuts, or a reason it is not one.
 */
export function fitGear(cuts: readonly GearCut[], teeth: number): GearReading | { refused: string } {
  if (!(teeth >= 6)) return { refused: 'A gear needs six teeth or more.' }
  if (cuts.length < 2) return { refused: 'A gear is read from two cuts or more.' }
  const withBreaks = cuts.map(pointsOf)
  const raw = withBreaks.map((p) => p.filter(([x]) => !Number.isNaN(x)))
  let { ra, rf } = tipAndRoot(withBreaks)
  if (!(ra > rf)) return { refused: 'The cuts show no teeth: the outline is round.' }
  // The centre: the circle through the tips, read again about the last.
  let cx = 0
  let cy = 0
  for (let it = 0; it < 12; it++) {
    const band = ra - TIP_BAND * (ra - rf)
    const tips = raw.flatMap((pts) => pts.filter(([x, y]) => Math.hypot(x - cx, y - cy) > band))
    const c = circleThrough(tips)
    if (!c) break
    const moved = Math.hypot(c.cx - cx, c.cy - cy)
    cx = c.cx
    cy = c.cy
    if (moved < 1e-5) break
  }
  const pts = raw.map((p) => p.map(([x, y]) => [x - cx, y - cy] as [number, number]))
  ;({ ra, rf } = tipAndRoot(withBreaks.map((p) => p.map(([x, y]) => [x - cx, y - cy] as [number, number]))))
  const height = ra - rf
  // units-ok: scan.gear answers in millimetres.
  if (height < 0.1) return { refused: 'The teeth are under 0.1 mm high: too little to read.' }
  const pitch = (2 * Math.PI) / teeth
  // The phase at each height: the tips' harmonic at the tooth count.
  const tipBand = ra - 0.25 * height
  const phases: number[] = []
  const hs: number[] = []
  for (let i = 0; i < pts.length; i++) {
    let re = 0
    let im = 0
    for (const [x, y] of pts[i]) {
      if (Math.hypot(x, y) < tipBand) continue
      const a = Math.atan2(y, x) * teeth
      re += Math.cos(a)
      im += Math.sin(a)
    }
    if (re === 0 && im === 0) continue
    phases.push(Math.atan2(im, re) / teeth)
    hs.push(cuts[i].h)
  }
  if (phases.length < 2) return { refused: 'Too few cuts reach the tips.' }
  for (let i = 1; i < phases.length; i++) phases[i] = phases[i - 1] + wrapHalf(phases[i] - phases[i - 1], pitch)
  const mh = hs.reduce((s, x) => s + x, 0) / hs.length
  const mp = phases.reduce((s, x) => s + x, 0) / phases.length
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < hs.length; i++) {
    sxy += (hs[i] - mh) * (phases[i] - mp)
    sxx += (hs[i] - mh) ** 2
  }
  let twist = sxx > 1e-9 ? sxy / sxx : 0
  // A turn that moves the tips this little from the first cut to the last is
  // the scan's noise: a spur gear.
  if (Math.abs(twist) * (Math.max(...hs) - Math.min(...hs)) * ra < SPUR_MM) twist = 0
  const phaseAt0 = mp - twist * mh
  const helixRms = Math.sqrt(hs.reduce((s, h, i) => s + (phases[i] - (phaseAt0 + twist * h)) ** 2, 0) / hs.length) * (180 / Math.PI)
  // Every flank point folded onto one tooth.
  const flank: Flank[] = []
  for (let i = 0; i < pts.length; i++) {
    const ph = phaseAt0 + twist * cuts[i].h
    for (const [x, y] of pts[i]) {
      const r = Math.hypot(x, y)
      if (r < rf + FLANK_LOW * height || r > rf + FLANK_HIGH * height) continue
      const turned = Math.atan2(y, x) - ph
      const u = wrapHalf(turned, pitch)
      const tooth = ((Math.round((turned - u) / pitch) % teeth) + teeth) % teeth
      flank.push({ r, u, tooth })
    }
  }
  if (flank.length < 50) return { refused: 'Too few flank points to read the involutes.' }
  const lowR = Math.min(...flank.map((f) => f.r))
  const base = fitBase(flank, 0.5 * rf, lowR * 0.9999)
  const baseHelix = Math.atan(base.rb * twist)
  const named = nameGear(teeth, flank, base, twist)
  const halfAtBase = (named.fit.left + named.fit.right) / 2
  // The shift that makes the tooth as thick as it is: H = ψ_p + inv α_t.
  const helix = named.helix
  const at = Math.atan(Math.tan((named.pressureDeg * Math.PI) / 180) / Math.cos(helix))
  const shift = shiftOf(teeth, halfAtBase, helix, at)
  // The phase of the fitted tooth: the two sides' H differing turns it.
  const phase = phaseAt0 + (named.fit.right - named.fit.left) / 2
  const spec: GearSpec = {
    teeth,
    module: named.module,
    pressureDeg: named.pressureDeg,
    helixDeg: (helix * 180) / Math.PI,
    shift,
    tipDiameter: 2 * ra,
    rootDiameter: 2 * rf,
  }
  // Each tooth: its flank's distance, its point count, its tip.
  const per = new Map<number, number[]>()
  for (const f of flank) {
    const v = f.r * (Math.abs(f.u) + inv(pressureAt(named.fit.rb, f.r)) - (f.u < 0 ? named.fit.left : named.fit.right))
    const a = per.get(f.tooth) ?? []
    a.push(v)
    per.set(f.tooth, a)
  }
  const tipOf = new Float64Array(teeth)
  for (let i = 0; i < pts.length; i++) {
    const ph = phase + twist * cuts[i].h
    const best = new Float64Array(teeth)
    for (const [x, y] of pts[i]) {
      const turned = Math.atan2(y, x) - ph
      const u = wrapHalf(turned, pitch)
      if (Math.abs(u) > pitch / 4) continue
      const tooth = ((Math.round((turned - u) / pitch) % teeth) + teeth) % teeth
      best[tooth] = Math.max(best[tooth], Math.hypot(x, y))
    }
    for (let t = 0; t < teeth; t++) tipOf[t] += best[t] / pts.length
  }
  const rmsOf = (a: number[] | undefined) => {
    if (!a?.length) return Infinity
    const sq = a.map((x) => x * x).sort((p, q) => p - q)
    const kept = sq.slice(0, Math.max(1, Math.floor(sq.length * TRIM)))
    return Math.sqrt(kept.reduce((s, x) => s + x, 0) / kept.length)
  }
  const rmsList = Array.from({ length: teeth }, (_, t) => rmsOf(per.get(t)))
  const counts = Array.from({ length: teeth }, (_, t) => per.get(t)?.length ?? 0)
  const medRms = median(rmsList.filter(Number.isFinite))
  const medCount = median(counts)
  const medTip = median([...tipOf])
  const teethRead: GearToothReading[] = Array.from({ length: teeth }, (_, t) => {
    const rms = rmsList[t]
    const tipShort = Math.max(0, medTip - tipOf[t])
    const share = medCount > 0 ? counts[t] / medCount : 0
    const broken = !(rms <= Math.max(BROKEN_RMS_TIMES * medRms, medRms + BROKEN_RMS_MM)) || tipShort > BROKEN_TIP_SHARE * height || share < BROKEN_POINT_SHARE
    let deg = ((phase + t * pitch) * 180) / Math.PI
    deg = ((deg % 360) + 360) % 360
    return { index: t, angleDeg: deg, rms: Number.isFinite(rms) ? rms : -1, tipShort, share, broken }
  })
  return {
    teeth,
    centre: [cx, cy],
    tipDiameter: 2 * ra,
    rootDiameter: 2 * rf,
    baseDiameter: 2 * named.fit.rb,
    twistPerMm: twist,
    baseHelixDeg: (baseHelix * 180) / Math.PI,
    halfAtBase,
    phase,
    flankRms: named.fit.rms,
    measuredFlankRms: base.rms,
    flankPoints: flank.length,
    helixRms,
    spec,
    standard: named.standard,
    teethRead,
  }
}

/** The flanks' distance (rms of the closest share, mm) from the gear a spec
 *  makes, for the same cuts: how well a rounded set of numbers still lies
 *  on the scan. */
export function flankRmsOf(cuts: readonly GearCut[], spec: GearSpec, phase: number, centre: [number, number] = [0, 0]): number {
  const geo = gearGeometry(spec)
  const pitch = (2 * Math.PI) / spec.teeth
  const H = geo.halfToothAtPitch + inv(geo.transversePressure)
  const height = geo.tipRadius - geo.rootRadius
  const sq: number[] = []
  for (const c of cuts) {
    const ph = phase + geo.twistPerMm * c.h
    for (const [x0, y0] of pointsOf(c)) {
      if (Number.isNaN(x0)) continue
      const x = x0 - centre[0]
      const y = y0 - centre[1]
      const r = Math.hypot(x, y)
      if (r < geo.rootRadius + FLANK_LOW * height || r > geo.rootRadius + FLANK_HIGH * height || r <= geo.baseRadius) continue
      const u = wrapHalf(Math.atan2(y, x) - ph, pitch)
      sq.push((r * (Math.abs(u) + inv(pressureAt(geo.baseRadius, r)) - H)) ** 2)
    }
  }
  if (sq.length === 0) return Infinity
  sq.sort((a, b) => a - b)
  const kept = sq.slice(0, Math.max(1, Math.floor(sq.length * TRIM)))
  return Math.sqrt(kept.reduce((s, x) => s + x, 0) / kept.length)
}
