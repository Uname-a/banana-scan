// SPDX-License-Identifier: AGPL-3.0-only
// The crease graph closed before a patch network is laid out on it
// (networkAuto.ts): on a real part Suggest creases' curves end in the open
// — a sharp edge that runs into a round, a fold that fades — and cross
// where no node joins them, so they bound no region and the layout let
// them go. Here they are made to close instead, in three steps:
//
// 1. Crossings. Two curves whose traces pass within an edge of each other
//    away from a node they share are split there, and the two new nodes
//    made one. A curve's end a few edges short of another curve (a T that
//    does not quite touch) is taken onto it the same way.
// 2. Near ends. A loose end with another loose end within JOIN_MM ahead of
//    it — within 60° of the way its curve runs into it — is joined to it:
//    the two nodes made one where they are nearly one, else bridged by a
//    curve, a crease where the scan turns sharply across its middle.
// 3. Extensions. Every end still loose is carried on along the scan from
//    where it ends, the way its curve ran into it, steered onto a line of
//    principal curvature where the scan bends more one way than the other
//    (the middle of a round's run, the axis of a hole): within STEER_DEG of
//    the heading, the principal direction nearest it, half and half. It
//    stops where it comes within a step of another curve: that curve is
//    split there, and the crease is carried on to the new node, its grips
//    the march's points every GRIP_MM — one curve, still a crease, so the
//    patches either side are left untied past its end and the angle they
//    meet at there is measured, not forced. An end whose
//    march leaves the scan, turns back on itself or runs MAX_SHARE of the
//    part's size finding nothing stays loose, and is let go as before.
//
// The same march cuts a region the creases leave with three loops or more
// round it (networkAuto.ts, multiLoop): a cut leaves one loop toward the
// nearest point of another, steered along the principal lines, and stops
// where it meets that loop — a boundary along the part's own lines rather
// than a straight section, where the scan has lines to follow.

import { computeVertexNormals } from '../../../src/core/geometry/normals'
import { CurvatureFitter, type CurvatureFit, defaultCurvatureRadius } from '../../../src/core/geometry/principalCurvature'
import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import type { NetworkCurve } from './features'

/** What the closing needs of the layout's network (networkAuto's Work). */
export interface ClosingWork {
  readonly scan: ScanPaths
  nodes: { id: number; at: Vec3 }[]
  curves: NetworkCurve[]
  node(at: Vec3): number
  curve(from: number, to: number, via: Vec3[], crease: boolean): number
  at(id: number): Vec3
  traceOf(c: NetworkCurve): { points: Float32Array; length: number }
  splitAt(curveId: number, p: Vec3): number
  originOf(id: number): number
  mergeNodes(keep: number, gone: number): void
}

/** How the crease graph was closed. */
export interface Closing {
  /** Crossings and near misses snapped into shared nodes. */
  crossings: number
  /** Loose ends joined to a loose end near them. */
  joined: number
  /** Loose ends carried on to another curve, each: where it started and
   *  ended, its length, and the share of its steps a principal line
   *  steered. */
  extended: { from: Vec3; to: Vec3; length: number; steered: number }[]
  /** Curves too short to be a patch's side, their nodes made one. */
  contracted: number
  /** Loose ends no march found a curve from, and why. */
  stuck: { at: Vec3; why: string }[]
}

/** A crossing: traces within this many mean edges of each other. */
const CROSS_EDGES = 1.5
/** Points within this many mean edges of a node both curves share are
 *  their meeting there, not a crossing. */
const GUARD_EDGES = 4
/** Loose ends within this of each other (mm, and never under JOIN_EDGES
 *  mean edges) are joined. */
const JOIN_MM = 3
const JOIN_EDGES = 15
/** Two nodes this close (mean edges) are made one, not bridged. */
const ONE_EDGES = 3
/** A march's step, mean edges, never under STEP_MIN mm. */
const STEP_EDGES = 2
const STEP_MIN = 0.25
/** How far a march may run, as a share of the part's diagonal. */
const MAX_SHARE = 0.5
/** A principal direction within this of the heading steers it, deg. */
const STEER_DEG = 35
/** The scan bends more one way than the other where the principal
 *  curvatures differ by this share of the larger, and by ANISO_MIN 1/mm. */
const ANISO_SHARE = 0.35
const ANISO_MIN = 1 / 200
/** A march stops at a sharp edge: the normal turned past this in a step
 *  (cosine; 60°). */
const EDGE_COS = 0.5
/** A march's grips, mm apart. */
const GRIP_MM = 4
/** A curve shorter than this (mm, and mean edges) is contracted. */
const SHORT_MM = 1.5
const SHORT_EDGES = 6
/** A bridge is a crease where the scan turns more than this across it, deg. */
const SHARP_DEG = 20

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: ArrayLike<number>) => Math.hypot(a[0], a[1], a[2])
const unit = (a: ArrayLike<number>): Vec3 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The scan's principal curvatures, read where a march asks (PR 24's
 *  fitter, at its default radius), the fitter made on first use. */
export class Bends {
  private fitter: CurvatureFitter | null = null
  constructor(readonly scan: ScanPaths) {}

  /** The fit at the vertex of `triangle` nearest p. */
  at(p: Vec3, triangle: number): CurvatureFit | null {
    const { positions: pos, indices: idx } = this.scan
    let v = idx[triangle * 3]
    let best = Infinity
    for (let k = 0; k < 3; k++) {
      const w = idx[triangle * 3 + k]
      const d = Math.hypot(pos[w * 3] - p[0], pos[w * 3 + 1] - p[1], pos[w * 3 + 2] - p[2])
      if (d < best) [best, v] = [d, w]
    }
    if (!this.fitter) {
      const normals = computeVertexNormals(pos, idx)
      this.fitter = new CurvatureFitter({ positions: pos, normals, indices: idx, vertexCount: pos.length / 3 }, defaultCurvatureRadius(this.scan.edge), this.scan.edge)
    }
    return this.fitter.fitAt(v)
  }
}

/** The principal direction a march at heading h turns to, if the scan
 *  bends more one way than the other there and one is near h. */
export function principalNear(fit: CurvatureFit | null, h: Vec3): Vec3 | null {
  if (!fit) return null
  const big = Math.max(Math.abs(fit.k1), Math.abs(fit.k2))
  const diff = Math.abs(fit.k1 - fit.k2)
  if (!(diff >= ANISO_MIN && diff >= ANISO_SHARE * big)) return null
  const a = dot(fit.dir1, h)
  const b = dot(fit.dir2, h)
  const d = Math.abs(a) >= Math.abs(b) ? (a >= 0 ? fit.dir1 : (fit.dir1.map((x) => -x) as Vec3)) : b >= 0 ? fit.dir2 : (fit.dir2.map((x) => -x) as Vec3)
  return dot(d, h) >= Math.cos((STEER_DEG * Math.PI) / 180) ? [d[0], d[1], d[2]] : null
}

/** Trace points by grid cell, for what a point comes near. */
export class TraceGrid {
  private cells = new Map<string, { curve: number; at: Vec3 }[]>()
  constructor(readonly size: number) {}
  private key(p: ArrayLike<number>, dx = 0, dy = 0, dz = 0) {
    return `${Math.floor(p[0] / this.size) + dx},${Math.floor(p[1] / this.size) + dy},${Math.floor(p[2] / this.size) + dz}`
  }
  add(curve: number, points: ArrayLike<number>): void {
    for (let i = 0; i + 2 < points.length; i += 3) {
      const at: Vec3 = [points[i], points[i + 1], points[i + 2]]
      const k = this.key(at)
      const list = this.cells.get(k)
      if (list) list.push({ curve, at })
      else this.cells.set(k, [{ curve, at }])
    }
  }
  /** The nearest point within r (≤ size) of p that `keep` takes. */
  nearest(p: ArrayLike<number>, r: number, keep: (curve: number, at: Vec3) => boolean): { curve: number; at: Vec3; d: number } | null {
    let best: { curve: number; at: Vec3; d: number } | null = null
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const x of this.cells.get(this.key(p, dx, dy, dz)) ?? []) {
            const d = dist(x.at, p)
            if (d <= r && (!best || d < best.d) && keep(x.curve, x.at)) best = { curve: x.curve, at: x.at, d }
          }
        }
      }
    }
    return best
  }
}

/** A march along the scan (see above): its points after the start, what
 *  it met, and how many of its steps a principal line steered. */
export interface March {
  points: Vec3[]
  hit: { curve: number; at: Vec3 } | null
  steered: number
  why?: string
}

/** The step a march takes on this scan, mm. */
export const marchStep = (scan: ScanPaths) => Math.max(STEP_MIN, STEP_EDGES * scan.edge)

/** March from `start` along `heading` until `hit` finds something, the
 *  scan is left, or `maxLength` is run. `toward`, when given, is a point
 *  the march keeps turning to where no principal line steers it. */
export function march(scan: ScanPaths, bends: Bends, start: Vec3, heading: Vec3, maxLength: number, hit: (p: Vec3, travelled: number) => { curve: number; at: Vec3 } | null, toward?: Vec3): March {
  const step = marchStep(scan)
  const points: Vec3[] = []
  let p: Vec3 = [start[0], start[1], start[2]]
  let h = unit(heading)
  let steered = 0
  let lastNormal: Vec3 | null = null
  for (let travelled = 0; travelled < maxLength; ) {
    const q: Vec3 = [p[0] + step * h[0], p[1] + step * h[1], p[2] + step * h[2]]
    const c = scan.closest(q)
    if (!c) return { points, hit: null, steered, why: 'the march left the scan' }
    const moved = sub(c.point, p)
    const m = len(moved)
    // Over a sharp edge the nearest point does not move on, or the scan's
    // normal turns more in a step than a round as tight as the step turns
    // it.
    const fit = bends.at(c.point, c.triangle)
    const n = fit ? unit(cross(fit.dir1, fit.dir2)) : c.normal
    if (m < 0.25 * step || (lastNormal && Math.abs(dot(n, lastNormal)) < EDGE_COS)) return { points, hit: null, steered, why: 'the march ran onto a sharp edge no curve is on' }
    lastNormal = n
    let next = unit(moved)
    const s = dot(next, n)
    next = unit([next[0] - s * n[0], next[1] - s * n[1], next[2] - s * n[2]])
    if (dot(next, h) < 0) return { points, hit: null, steered, why: 'the march turned back on itself' }
    const line = principalNear(fit, next)
    if (line) {
      next = unit([next[0] + line[0], next[1] + line[1], next[2] + line[2]])
      steered++
    } else if (toward) {
      const to = sub(toward, c.point)
      const t = dot(to, n)
      const aim = unit([to[0] - t * n[0], to[1] - t * n[1], to[2] - t * n[2]])
      if (len(to) > step) next = unit([next[0] + aim[0], next[1] + aim[1], next[2] + aim[2]])
    }
    p = [c.point[0], c.point[1], c.point[2]]
    h = next
    travelled += m
    points.push(p)
    const met = hit(p, travelled)
    if (met) return { points, hit: met, steered }
  }
  return { points, hit: null, steered, why: 'the march ran its length and met no curve' }
}

/** The march's grips: a point every GRIP_MM, none within a grip's
 *  half of either end. */
export function gripsOf(points: readonly Vec3[], end: Vec3): Vec3[] {
  const out: Vec3[] = []
  let since = 0
  for (let i = 1; i < points.length; i++) {
    since += dist(points[i], points[i - 1])
    if (since >= GRIP_MM && dist(points[i], end) >= GRIP_MM / 2) {
      out.push(points[i])
      since = 0
    }
  }
  return out
}

/** The size of the part, its bounding box's diagonal, mm. */
function diagonal(scan: ScanPaths): number {
  const p = scan.positions
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k])
      hi[k] = Math.max(hi[k], p[i + k])
    }
  }
  return dist(lo, hi)
}

/** The degree of each node: the curve ends at it. */
function degrees(w: ClosingWork): Map<number, number> {
  const count = new Map<number, number>()
  for (const c of w.curves) for (const n of [c.from, c.to]) count.set(n, (count.get(n) ?? 0) + 1)
  return count
}

/** The way a curve runs into its end node `n`, from its trace: the chord
 *  from a point a few steps back. */
function headingInto(w: ClosingWork, c: NetworkCurve, n: number, back: number): Vec3 {
  const t = w.traceOf(c)
  const count = t.points.length / 3
  const at = (i: number): Vec3 => [t.points[i * 3], t.points[i * 3 + 1], t.points[i * 3 + 2]]
  const intoTo = c.to === n
  const end = intoTo ? at(count - 1) : at(0)
  let i = intoTo ? count - 1 : 0
  while ((intoTo ? i > 0 : i < count - 1) && dist(at(i), end) < back) i += intoTo ? -1 : 1
  return unit(sub(end, at(i)))
}

/** Whether the scan turns sharply across p, square to `along`: the
 *  normals a few edges either side. */
function sharpAcross(scan: ScanPaths, p: Vec3, along: Vec3): boolean {
  const c = scan.closest(p)
  if (!c) return false
  const side = unit(cross(along, c.normal))
  const normalAt = (s: number) => {
    const sum: Vec3 = [0, 0, 0]
    for (const k of [3, 4, 5]) {
      const q = scan.closest([p[0] + s * k * scan.edge * side[0], p[1] + s * k * scan.edge * side[1], p[2] + s * k * scan.edge * side[2]])
      if (q) for (let i = 0; i < 3; i++) sum[i] += q.normal[i]
    }
    return unit(sum)
  }
  const a = normalAt(1)
  const b = normalAt(-1)
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI > SHARP_DEG
}

/** The crease graph closed (see above). */
export function closeCreases(w: ClosingWork, bends: Bends): Closing {
  const out: Closing = { crossings: 0, joined: 0, extended: [], stuck: [], contracted: 0 }
  snapCrossings(w, out)
  joinNear(w, out)
  extendLoose(w, bends, out)
  // An extension's trace, a section between its grips, can cross a curve
  // its march passed beside.
  contractShort(w, out)
  snapCrossings(w, out)
  return out
}

/** 4: a curve shorter than SHORT_MM (and SHORT_EDGES mean edges) between
 *  two nodes is no patch's side — a knot of creases where a small
 *  feature's edges meet, cut by the snapping into stubs: its two nodes
 *  made one. */
function contractShort(w: ClosingWork, out: Closing): void {
  const short = Math.max(SHORT_MM, SHORT_EDGES * w.scan.edge)
  for (let pass = 0; pass < 50; pass++) {
    let best: NetworkCurve | null = null
    let bestL = short
    for (const c of w.curves) {
      if (c.from === c.to) continue
      const l = w.traceOf(c).length
      if (l < bestL) [bestL, best] = [l, c]
    }
    if (!best) return
    w.mergeNodes(best.from, best.to)
    // Two curves now running between the same two nodes along one way are
    // one: the later goes.
    const seen = new Map<string, NetworkCurve>()
    const gone = new Set<number>()
    for (const c of w.curves) {
      if (c.via.length > 0) continue
      const key = c.from < c.to ? `${c.from}:${c.to}` : `${c.to}:${c.from}`
      if (seen.has(key)) gone.add(c.id)
      else seen.set(key, c)
    }
    if (gone.size > 0) w.curves = w.curves.filter((c) => !gone.has(c.id))
    out.contracted++
  }
}

/** 1: crossings and near misses made shared nodes. */
function snapCrossings(w: ClosingWork, out: Closing): void {
  const scan = w.scan
  const r = Math.max(CROSS_EDGES * scan.edge, 1e-6)
  const guard = GUARD_EDGES * scan.edge
  for (let pass = 0; pass < 8; pass++) {
    const grid = new TraceGrid(Math.max(r, scan.edge))
    for (const c of w.curves) grid.add(c.id, w.traceOf(c).points)
    const byId = new Map(w.curves.map((c) => [c.id, c]))
    // The nearest approach of each pair of curves, away from nodes they share.
    const best = new Map<string, { a: number; b: number; pa: Vec3; pb: Vec3; d: number }>()
    for (const c of w.curves) {
      const pts = w.traceOf(c).points
      for (let i = 0; i + 2 < pts.length; i += 3) {
        const p: Vec3 = [pts[i], pts[i + 1], pts[i + 2]]
        const near = grid.nearest(p, r, (other, at) => {
          if (other === c.id) return false
          const o = byId.get(other)
          if (!o) return false
          for (const n of [c.from, c.to]) if ((n === o.from || n === o.to) && (dist(w.at(n), p) < guard || dist(w.at(n), at) < guard)) return false
          return true
        })
        if (!near) continue
        const key = c.id < near.curve ? `${c.id}:${near.curve}` : `${near.curve}:${c.id}`
        const had = best.get(key)
        if (!had || near.d < had.d) best.set(key, { a: c.id, b: near.curve, pa: p, pb: near.at, d: near.d })
      }
    }
    if (best.size === 0) return
    let snapped = 0
    // Each pair once a pass: the splits move what the others were read on.
    const touched = new Set<number>()
    for (const x of [...best.values()].sort((p, q) => p.d - q.d)) {
      const fa = w.originOf(x.a)
      const fb = w.originOf(x.b)
      if (touched.has(fa) || touched.has(fb)) continue
      touched.add(fa)
      touched.add(fb)
      const na = w.splitAt(x.a, x.pa)
      const nb = w.splitAt(x.b, x.pb)
      if (na !== nb) w.mergeNodes(na, nb)
      snapped++
    }
    out.crossings += snapped
    if (snapped === 0) return
  }
}

/** 2: loose ends joined to loose ends near them. */
function joinNear(w: ClosingWork, out: Closing): void {
  const scan = w.scan
  const reach = Math.max(JOIN_MM, JOIN_EDGES * scan.edge)
  const deg = degrees(w)
  const loose = w.curves.flatMap((c) => [c.from, c.to].filter((n) => deg.get(n) === 1 && c.from !== c.to).map((n) => ({ n, c })))
  const pairs: { a: (typeof loose)[number]; b: (typeof loose)[number]; d: number }[] = []
  const cosMax = Math.cos(Math.PI / 3)
  for (let i = 0; i < loose.length; i++) {
    for (let j = i + 1; j < loose.length; j++) {
      const a = loose[i]
      const b = loose[j]
      if (a.c.id === b.c.id) continue
      const d = dist(w.at(a.n), w.at(b.n))
      if (d > reach) continue
      if (d > ONE_EDGES * scan.edge) {
        const ab = unit(sub(w.at(b.n), w.at(a.n)))
        const ha = headingInto(w, a.c, a.n, 4 * scan.edge)
        const hb = headingInto(w, b.c, b.n, 4 * scan.edge)
        if (dot(ha, ab) < cosMax || dot(hb, ab) > -cosMax) continue
      }
      pairs.push({ a, b, d })
    }
  }
  const used = new Set<number>()
  for (const p of pairs.sort((x, y) => x.d - y.d)) {
    if (used.has(p.a.n) || used.has(p.b.n)) continue
    used.add(p.a.n)
    used.add(p.b.n)
    const pa = w.at(p.a.n)
    const pb = w.at(p.b.n)
    if (p.d <= ONE_EDGES * scan.edge) w.mergeNodes(p.a.n, p.b.n)
    else {
      const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]
      w.curve(p.a.n, p.b.n, [], sharpAcross(scan, mid, unit(sub(pb, pa))))
    }
    out.joined++
  }
}

/** 3: the loose ends left carried on to another curve. */
function extendLoose(w: ClosingWork, bends: Bends, out: Closing): void {
  const scan = w.scan
  const step = marchStep(scan)
  const maxLength = MAX_SHARE * diagonal(scan)
  const grid = new TraceGrid(1.5 * step)
  for (const c of w.curves) grid.add(c.id, w.traceOf(c).points)
  const deg = degrees(w)
  const loose = w.curves.flatMap((c) => [c.from, c.to].filter((n) => deg.get(n) === 1 && c.from !== c.to).map((n) => ({ n, curve: c.id })))
  for (const end of loose) {
    const c = w.curves.find((x) => x.id === end.curve)
    // Joined meanwhile by another's march.
    if (!c || (degrees(w).get(end.n) ?? 0) !== 1) continue
    const start = w.at(end.n)
    const heading = headingInto(w, c, end.n, 4 * step)
    const own = w.originOf(c.id)
    const m = march(scan, bends, start, heading, maxLength, (p, travelled) =>
      grid.nearest(p, 1.5 * step, (curve, at) => {
        // Its own curve only well behind where it has come from.
        if (w.originOf(curve) === own && dist(at, start) < travelled + 2 * step) return false
        // Not the march's own first steps.
        return dist(at, start) > 2 * step || travelled > 4 * step
      }),
    )
    if (!m.hit) {
      out.stuck.push({ at: start, why: m.why ?? 'no curve met' })
      continue
    }
    const target = w.splitAt(m.hit.curve, m.hit.at)
    if (target === end.n) {
      out.stuck.push({ at: start, why: 'the march came back to where it began' })
      continue
    }
    const to = w.at(target)
    // The crease carried on as one curve, still a crease: past its end
    // the two patches beside are not tied tangent, but they fit the same
    // smooth scan and meet as near tangent as it is, which the fit's
    // reading measures. A curve of its own there would make its end a
    // corner of five-sided cells, or a side of two curves of two kinds,
    // which the fit ties across neither.
    // The curve ending at the end now: the split may have cut its own.
    const own2 = w.curves.find((x) => x.from === end.n || x.to === end.n)
    if (!own2) {
      out.stuck.push({ at: start, why: 'the end was lost to the split' })
      continue
    }
    const grips = gripsOf(m.points, to)
    const into = own2.to === end.n ? { from: own2.from, via: own2.via } : { from: own2.to, via: [...own2.via].reverse() }
    const id = own2.id
    w.curves = w.curves.map((x) => (x.id === id ? { ...x, from: into.from, to: target, via: [...into.via, start, ...grips] } : x))
    w.nodes = w.nodes.filter((x) => x.id !== end.n)
    const made = w.curves.find((x) => x.id === id)!
    grid.add(id, w.traceOf(made).points)
    let length = 0
    for (let i = 1; i < m.points.length; i++) length += dist(m.points[i], m.points[i - 1])
    out.extended.push({ from: start, to, length: length + dist(start, m.points[0] ?? start), steered: m.points.length > 0 ? m.steered / m.points.length : 0 })
  }
}
