// SPDX-License-Identifier: AGPL-3.0-only
// Planes along a path: datum planes square to a curve at stations along it
// — to cut sections across a bent tube, a rail or a swept rim, or to sketch
// a sweep's profile on. The curve is a chain of pieces end to end (lines,
// arcs, circles, splines, as a sweep takes them) or a run of points (a
// traced centreline, a section's outline); a station is a length along it.
//
// Each plane's normal is the curve's tangent there; its sheet's u and v are
// carried along the curve turning as little as they can (a
// rotation-minimizing frame, by the double reflection of Wang et al.), so a
// set of sections across a bend keep their sheets the same way up and a
// profile sketched on one lines up with the next.
//
// Pure numbers. Lines and arcs are walked exactly, by their own length; a
// run of points is taken as the polyline through them, its tangent at a
// station read off the points `reach` either side of it, so a scanned
// centreline's scatter does not tip the planes.

import type { Vec3 } from '../../../src/core/types'
import { add, addScaled, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { LoopPiece } from './kernelTypes'
import { bsplineAt } from './sketchSpline'

/** One stretch of a path, walked by its length from its start. */
interface Span {
  length: number
  at(s: number): { point: Vec3; tangent: Vec3 }
  start: Vec3
  end: Vec3
}

/** A path: its spans end to end. A run of points has `smooth`: its
 *  tangent is read over a reach, not off the segment a station lies on. */
export interface PathCurve {
  spans: Span[]
  closed: boolean
  smooth: boolean
}

/** A spline's span is walked by chords this many to a knot span. */
const SPLINE_SAMPLES = 64
/** Ends nearer than this are one point, mm. */
const JOIN_MM = 1e-3

function lineSpan(a: Vec3, b: Vec3): Span | null {
  const l = len(sub(b, a))
  if (!(l > 1e-9)) return null
  const d = scale(sub(b, a), 1 / l)
  return { length: l, start: a, end: b, at: (s) => ({ point: addScaled(a, d, s), tangent: d }) }
}

/** An arc about `center` from `from` turning `sweep` radians about `axis`
 *  by the right hand. */
function arcSpan(center: Vec3, axis: Vec3, from: Vec3, sweep: number): Span | null {
  const r = len(sub(from, center))
  if (!(r > 1e-9) || !(sweep > 1e-12)) return null
  const e1 = scale(sub(from, center), 1 / r)
  const e2 = cross(axis, e1)
  const at = (s: number) => {
    const t = s / r
    return { point: add(center, add(scale(e1, r * Math.cos(t)), scale(e2, r * Math.sin(t)))), tangent: add(scale(e1, -Math.sin(t)), scale(e2, Math.cos(t))) }
  }
  return { length: r * sweep, start: from, end: at(r * sweep).point, at }
}

function splineSpan(piece: Extract<LoopPiece, { kind: 'spline' }>): Span | null {
  const lo = piece.knots[0]
  const hi = piece.knots[piece.knots.length - 1]
  const n = SPLINE_SAMPLES * Math.max(1, piece.knots.length - 1)
  const t: number[] = []
  const s: number[] = [0]
  const pts: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    t.push(lo + ((hi - lo) * i) / n)
    pts.push(bsplineAt(piece, t[i]) as Vec3)
    if (i > 0) s.push(s[i - 1] + len(sub(pts[i], pts[i - 1])))
  }
  const length = s[n]
  if (!(length > 1e-9)) return null
  const eps = (hi - lo) * 1e-6
  const at = (x: number) => {
    let i = 0
    while (i < n - 1 && s[i + 1] < x) i++
    const f = s[i + 1] > s[i] ? Math.max(0, Math.min(1, (x - s[i]) / (s[i + 1] - s[i]))) : 0
    const u = t[i] + (t[i + 1] - t[i]) * f
    const a = bsplineAt(piece, Math.max(lo, u - eps)) as Vec3
    const b = bsplineAt(piece, Math.min(hi, u + eps)) as Vec3
    return { point: bsplineAt(piece, u) as Vec3, tangent: normalize(sub(b, a)) ?? [1, 0, 0] }
  }
  return { length, start: pts[0], end: pts[n], at }
}

function pieceSpan(piece: LoopPiece): Span | null {
  switch (piece.kind) {
    case 'line':
      return lineSpan(piece.a, piece.b)
    case 'spline':
      return splineSpan(piece)
    case 'circle': {
      const n = normalize(piece.normal)
      if (!n) return null
      const seed: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
      const e1 = normalize(cross(n, seed))!
      return arcSpan(piece.center, n, addScaled(piece.center, e1, piece.radius), 2 * Math.PI)
    }
    case 'arc': {
      const c = circumcenter(piece.a, piece.m, piece.b)
      if (!c) return lineSpan(piece.a, piece.b)
      const axis = normalize(cross(sub(piece.a, c), sub(piece.m, c)))
      if (!axis) return lineSpan(piece.a, piece.b)
      const e1 = normalize(sub(piece.a, c))!
      const e2 = cross(axis, e1)
      const d = sub(piece.b, c)
      let sweep = Math.atan2(dot(d, e2), dot(d, e1))
      if (sweep <= 0) sweep += 2 * Math.PI
      return arcSpan(c, axis, piece.a, sweep)
    }
  }
}

/** A span walked the other way. */
function reversed(span: Span): Span {
  return {
    length: span.length,
    start: span.end,
    end: span.start,
    at: (s) => {
      const r = span.at(span.length - s)
      return { point: r.point, tangent: scale(r.tangent, -1) }
    },
  }
}

/** The centre of the circle through three points, or null on a line. */
function circumcenter(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const n = cross(ab, ac)
  const nn = dot(n, n)
  if (nn < 1e-18) return null
  const term = add(scale(cross(n, ab), dot(ac, ac)), scale(cross(ac, n), dot(ab, ab)))
  return add(a, scale(term, 1 / (2 * nn)))
}

/** A chain of pieces end to end as a path, each piece turned to run on
 *  from the one before — or why they do not make one. */
export function curveOfPieces(pieces: readonly LoopPiece[]): PathCurve | string {
  const spans = pieces.map(pieceSpan).filter((s): s is Span => s !== null)
  if (spans.length === 0) return 'The path has no length.'
  const out: Span[] = []
  for (let k = 0; k < spans.length; k++) {
    let span = spans[k]
    if (out.length === 0) {
      // The first runs towards the second.
      const next = spans[1]
      if (next) {
        const near = (p: Vec3) => Math.min(len(sub(p, next.start)), len(sub(p, next.end)))
        if (near(span.start) < near(span.end)) span = reversed(span)
      }
    } else {
      const end = out[out.length - 1].end
      if (len(sub(span.end, end)) < len(sub(span.start, end))) span = reversed(span)
      const gap = len(sub(span.start, end))
      if (gap > JOIN_MM) return `The path’s pieces do not join end to end — a gap of ${round3(gap)} mm.`
    }
    out.push(span)
  }
  const closed = (out.length > 1 && len(sub(out[out.length - 1].end, out[0].start)) <= JOIN_MM) || pieces.every((p) => p.kind === 'circle')
  return { spans: out, closed, smooth: false }
}

/** A run of points as a path — closed where its ends meet. */
export function curveOfPoints(points: readonly Vec3[]): PathCurve | string {
  const kept: Vec3[] = []
  for (const p of points) if (kept.length === 0 || len(sub(p, kept[kept.length - 1])) > 1e-9) kept.push(p)
  if (kept.length < 2) return 'The path needs two points apart at least.'
  const closed = kept.length > 3 && len(sub(kept[0], kept[kept.length - 1])) < 1e-6
  const spans: Span[] = []
  for (let i = 0; i + 1 < kept.length; i++) {
    const s = lineSpan(kept[i], kept[i + 1])
    if (s) spans.push(s)
  }
  return { spans, closed, smooth: true }
}

/** A circle, or an arc of it from `fromDeg` to `toDeg` measured from u
 *  about the normal by the right hand. */
export function curveOfCircle(center: Vec3, normal: Vec3, radius: number, u: Vec3, fromDeg = 0, toDeg = 360): PathCurve | string {
  const n = normalize(normal)
  if (!n || !(radius > 0)) return 'The circle has no size or no normal.'
  const e1 = normalize(sub(u, scale(n, dot(u, n))))
  if (!e1) return 'The circle’s zero direction lies along its normal.'
  const e2 = cross(n, e1)
  const sweep = ((toDeg - fromDeg) * Math.PI) / 180
  if (!(Math.abs(sweep) > 1e-9)) return 'The arc has no sweep.'
  if (Math.abs(sweep) > 2 * Math.PI + 1e-9) return 'An arc turns once round at most.'
  const a0 = (fromDeg * Math.PI) / 180
  const start = add(center, add(scale(e1, radius * Math.cos(a0)), scale(e2, radius * Math.sin(a0))))
  const span = arcSpan(center, sweep > 0 ? n : scale(n, -1), start, Math.abs(sweep))!
  return { spans: [span], closed: Math.abs(Math.abs(sweep) - 2 * Math.PI) < 1e-9, smooth: false }
}

/** The path's whole length. */
export function curveLength(c: PathCurve): number {
  return c.spans.reduce((sum, s) => sum + s.length, 0)
}

/** The point and tangent at a length along the path — wrapped round a
 *  closed one, held to its ends on an open one. */
function evaluate(c: PathCurve, at: number): { point: Vec3; tangent: Vec3 } {
  const total = curveLength(c)
  let s = c.closed ? ((at % total) + total) % total : Math.max(0, Math.min(total, at))
  for (let i = 0; i < c.spans.length; i++) {
    const span = c.spans[i]
    if (s <= span.length || i === c.spans.length - 1) return span.at(Math.min(s, span.length))
    s -= span.length
  }
  return c.spans[0].at(0)
}

/** The tangent a station reads: the curve's own, or over a run of points
 *  the chord from `reach` before to `reach` after. */
function tangentAt(c: PathCurve, s: number, reach: number): Vec3 {
  const here = evaluate(c, s)
  if (!c.smooth) return here.tangent
  const total = curveLength(c)
  const P = (x: number) => evaluate(c, x).point
  const h = Math.min(reach, total / 4)
  // Near an open end, three points on one side, to the second order: a
  // one-sided chord tips the plane by half the turn over the reach.
  if (!c.closed && s - h < 0) return normalize(sub(sub(scale(P(s + h), 4), scale(here.point, 3)), P(s + 2 * h))) ?? here.tangent
  if (!c.closed && s + h > total) return normalize(sub(add(scale(here.point, 3), P(s - 2 * h)), scale(P(s - h), 4))) ?? here.tangent
  return normalize(sub(P(s + h), P(s - h))) ?? here.tangent
}

/** How stations are asked for: every `spacing` mm from the start (the end
 *  too, with `ends`), `count` spread evenly end to end (round a closed
 *  path, evenly with none twice), or lengths along it named. */
export type StationsAsk = { spacing: number; ends?: boolean } | { count: number } | { at: number[] }

/** At most this many planes in one go. */
export const PATH_PLANES_MAX = 200

/** The lengths along the path the stations stand at — or why not. */
export function stationLengths(c: PathCurve, ask: StationsAsk): number[] | string {
  const total = curveLength(c)
  if (!(total > 0)) return 'The path has no length.'
  let out: number[]
  if ('at' in ask) {
    out = ask.at.slice()
    const off = out.find((s) => !c.closed && (s < -1e-9 || s > total + 1e-9))
    if (off !== undefined) return `Station ${round3(off)} mm lies off the path, which runs 0 to ${round3(total)} mm.`
  } else if ('count' in ask) {
    const n = Math.round(ask.count)
    if (!(n >= 1)) return 'Ask for one plane at least.'
    out = n === 1 ? [c.closed ? 0 : total / 2] : Array.from({ length: n }, (_, i) => (c.closed ? (total * i) / n : (total * i) / (n - 1)))
  } else {
    if (!(ask.spacing > 0)) return 'The spacing must be above zero.'
    const n = Math.floor(total / ask.spacing + 1e-9)
    if (n + 1 > PATH_PLANES_MAX) return `That is ${n + 1} planes — ${PATH_PLANES_MAX} at most in one go: a wider spacing or fewer.`
    out = Array.from({ length: n + 1 }, (_, i) => i * ask.spacing)
    if (c.closed && total - out[out.length - 1] < 1e-6) out.pop()
    if (ask.ends && !c.closed && total - out[out.length - 1] > 1e-6) out.push(total)
  }
  if (out.length > PATH_PLANES_MAX) return `That is ${out.length} planes — ${PATH_PLANES_MAX} at most in one go: a wider spacing or fewer.`
  if (out.length === 0) return 'No station falls on the path.'
  return out
}

/** A plane square to the path. `basisU` × `basisV` = `normal`, the tangent. */
export interface PathPlane {
  /** Length along the path, mm. */
  s: number
  origin: Vec3
  normal: Vec3
  basisU: Vec3
  basisV: Vec3
}

/**
 * The planes square to the path at the stations, their sheets carried
 * along it turning as little as they can from the first — whose v is as
 * near `up` as it lets it (the coordinate axis furthest from the tangent,
 * without one). `reach` (mm) is how far either side of a station a run of
 * points' tangent is read over.
 */
export function planesAlong(c: PathCurve, stations: readonly number[], opts: { up?: Vec3; reach?: number } = {}): PathPlane[] {
  const total = curveLength(c)
  const pointsIn = c.spans.length
  const reach = opts.reach ?? Math.max(total / 200, (2 * total) / Math.max(1, pointsIn))
  const order = stations.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s)
  // The frame marched from the start through the stations in order of
  // length, a short step at a time, so it turns with the path and not by
  // the chord between stations.
  const step = Math.max(total / 4000, 1e-3)
  let x = order.length > 0 ? Math.min(0, order[0].s) : 0
  let p = evaluate(c, x).point
  let t = tangentAt(c, x, reach)
  let u = startU(t, opts.up)
  const out: PathPlane[] = new Array(stations.length)
  for (const { s: target, i } of order) {
    while (x < target - 1e-12) {
      const nx = Math.min(target, x + step)
      const np = evaluate(c, nx).point
      const nt = tangentAt(c, nx, reach)
      u = transport(p, t, u, np, nt)
      x = nx
      p = np
      t = nt
    }
    const basisU = normalize(sub(u, scale(t, dot(u, t)))) ?? startU(t)
    out[i] = { s: target, origin: p, normal: t, basisU, basisV: cross(t, basisU) }
  }
  return out
}

/** u for a first plane: square to the tangent, v = t × u as near `up` as
 *  it lets it. */
function startU(t: Vec3, up?: Vec3): Vec3 {
  const pick = up ? normalize(sub(up, scale(t, dot(up, t)))) : null
  const vUp = pick ?? normalize(sub(furthestAxis(t), scale(t, dot(furthestAxis(t), t))))!
  return cross(vUp, t)
}

function furthestAxis(t: Vec3): Vec3 {
  const a = t.map(Math.abs)
  return a[2] <= a[0] && a[2] <= a[1] ? [0, 0, 1] : a[1] <= a[0] ? [0, 1, 0] : [1, 0, 0]
}

/** One step of the double reflection: u at p with tangent t carried to q
 *  with tangent tq. */
function transport(p: Vec3, t: Vec3, u: Vec3, q: Vec3, tq: Vec3): Vec3 {
  const v1 = sub(q, p)
  const c1 = dot(v1, v1)
  if (c1 < 1e-24) return u
  const uL = sub(u, scale(v1, (2 / c1) * dot(v1, u)))
  const tL = sub(t, scale(v1, (2 / c1) * dot(v1, t)))
  const v2 = sub(tq, tL)
  const c2 = dot(v2, v2)
  if (c2 < 1e-24) return uL
  return sub(uL, scale(v2, (2 / c2) * dot(v2, uL)))
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
