// SPDX-License-Identifier: AGPL-3.0-only
// A patch network laid out by itself (Auto layout): the scan's creases as
// the network's crease curves, and the regions they leave cut into cells of
// three to six sides by tangent curves along the part's features — what a
// person does by hand in the box, patch by patch. The fit, the sewing and
// the deviation are the network's own (network.ts, networkBody.ts): this
// only places the curves and fills the regions.
//
// The creases are Suggest creases' (networkCreases.ts): the sharp edges
// and folds, a round left alone, their ends merged into shared nodes, a
// closed chain cut at its corners — or into four where it has fewer than
// three. A crease that ends in the middle of a face (a fold that fades
// out) closes nothing and is let go. The scan is then flooded without
// crossing a curve (networkCells.scanRegions), and each region read for
// what it is:
//
// - a disk, one loop of curves round it, is a cell as it is when it has
//   three to six corners — the nodes where its boundary turns more than
//   30°. A loop that turns smoothly all the way round (a rim with rounded
//   corners, a circle) has none: four of its nodes, evenly round it, are
//   made the cell's corners — a curve split where no node is near. One
//   with more than six is cut across between two corners, the pair that
//   leaves both sides four to six corners by the shortest cut.
// - a ring, between two loops — the side wall of a box whose top and
//   bottom rims are sharp and whose upright edges are rounded — is cut
//   across from each corner of one loop to the other: to a corner there
//   if one is as near as the loop, else to a node, else the loop split at
//   its nearest point. Rings are cut before the disks are read, and the
//   cuts' ends are the corners of the disks beside them, so a can's top
//   patch and its side patches share them; where neither loop has two
//   corners, four are spread round the longer one. On a box
//   with rounded upright edges the cuts run down the middles of the rounds
//   — the bend's own lines — and the sides come out as four patches.
// - a closed region no curve touches at all — a part with no crease, a
//   blended box — is laid out as a box: its axes the region's principal
//   axes, its eight corners where rays from its centre toward the corners
//   of the box round it leave the scan, its twelve curves through where
//   rays toward the box's edges do. On a blended box those are the middles
//   of its corner and edge blends.
//
// Before the regions are read for what they are, the curves that separate
// nothing go (unbridge): of two curves along one trace — closing can draw
// two between a pair of nodes — the second; then each curve the same
// region lies both sides of, as the flood reads it, not the graph's faces:
// a loop round nothing, or a bridge from one tangle of curves to another,
// walked once each way round the face it is in. A bridge is let go, its
// island a loop of its own in the region. Asked to (`bridges: 'cut'`), a
// bridge to a knot — an island under KNOT_MM of curve — goes with the knot,
// and any other is taken for a first cut and given a second beside it, a
// quarter of the way round its island, to the rest; on the sample bracket
// that made fewer cells and patches, a worse worst patch, in five times
// the time, so letting go is the default.
//
// Where the creases then leave most of the part one region — half the
// scan or more, of three loops or more, or touched by curves that close
// none: a part whose edges are rounds, which Suggest creases takes for no
// crease, its creases islands in it — the part is laid out from its faces
// instead (networkRounds.ts). Its curves are let go; every face grows until
// it meets the next down a round's middle, or at a sharp edge; and the
// lines where they meet are its curves, a node where three meet, a crease
// where Suggest creases found one along the line. A smaller region the
// rules below cannot lay out (a disk or ring no cut stays inside, three
// loops or more, a tangle, a box that is not round its middle) gets its
// rounds' middles drawn the same way, once. A region laid out so is cut
// more freely after: along the scan inside it where a straight section
// leaves it (networkRounds.regionPath), a five- or six-sided cell cut into
// a four-sided one and another, a curve its face runs both ways round let
// go, a loop pinched to its longest at a node cut to it once; a three-sided
// cell given a fourth corner at the middle of its longest side, so the
// build need not split it from its centre; a four-sided one that bends
// round (its mean normal under BENT_FLAT long) cut across the bend. There,
// crossings are snapped near a node two curves share too — two curves
// leaving one node can touch inside the closing's guard — and the stubs
// that leaves contracted.
//
// Each round places what the last read asked for and reads the scan
// again — a crossing its cuts made with a curve snapped into a node first; a region whose cut runs out of it, a region of three loops or
// more, or one bounded by the scan's own rim (an open scan: no curve is
// drawn along a rim yet) is left out and said why. Last, a node only two
// smooth curves of a kind run through, and no cell's corner — a crease
// cut in four where nothing meets it — is made a grip of one curve. The
// cells are checked as the build reads and maps them, and those of three,
// five or six sides are split from their centres into four-sided patches
// by the network itself (networkSplit.ts): a cell whose split the build
// would refuse is left out, said why.
//
// Measured (reNetworkAuto.test.ts), 0.01 mm of noise on 0.3–0.7 mm edges:
// a 40 × 30 × 20 box with a domed top, its edges sharp, comes out as its
// twelve edges; with its upright edges rounded to 4 mm, as its two rims
// and four cuts within 0.15 mm of the rounds' middles; a can as its rims
// and four cuts; a blended box as a box, its corners within 0.5 mm of
// where the diagonals leave it. Each builds into a solid of six faces
// within 0.04 % of the scan's volume, the patches 0.010–0.021 mm RMS and
// under 0.09 mm at worst, tangent within 0.002° across every cut; the
// blended box's corners of three tangent patches are about 5° apart. A
// layout of the 43,000-triangle box takes 0.4 s.

import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import { symmetricEigen3 } from '../../../src/core/fit/linalg'
import type { Vec3 } from '../../../src/core/types'
import type { NetworkCell, NetworkCurve, NetworkNode } from './features'
import { readNetwork, traceNetwork, type TracedNetwork } from './network'
import { CORNER_DEG, curveSides, faceSides, type GraphFace, type HalfEdge, readCells, regionSeed, type ScanRegion, scanRegions, SIDES_MAX, SIDES_MIN } from './networkCells'
import { suggestCreases } from './networkCreases'
import { type CurveTrace, endTangent, traceCurve } from './networkCurve'
import { cellMesh } from './networkMap'
import { regionPath, roundMiddles } from './networkRounds'
import { Bends, type Closing, closeCreases, type ClosingWork, contractShort, gripsOf, march, marchStep, snapCrossings, TraceGrid } from './networkClose'

/** How a layout is made. */
export interface AutoOptions {
  /** Take the scan's creases as crease curves (true by default). */
  creases?: boolean
  /** Suggest creases' thresholds, deg. */
  strongDeg?: number
  weakDeg?: number
  /** Close the crease graph — crossings snapped, near ends joined, loose
   *  ends carried on to another curve (networkClose.ts) — before any is
   *  let go (true by default). */
  close?: boolean
  /** A crease is taken whose mean angle is this or more, deg
   *  (MIN_CREASE_DEG by default). */
  minDeg?: number
  /** A curve with one region on both sides — a bridge from one tangle of
   *  curves to another — let go ('drop', the default), given a second cut
   *  beside it ('cut'), or left as it is ('keep'). See unbridge. */
  bridges?: 'cut' | 'drop' | 'keep'
  /** Draw tangent curves down the middles of the rounds of a region the
   *  creases leave no way to lay out (true by default). */
  rounds?: boolean
}

/** What a region of the scan was, as the creases left it, and what was
 *  done with it. */
export interface AutoRegion {
  kind: 'disk' | 'ring' | 'closed' | 'loops' | 'open'
  /** A point inside it. */
  at: Vec3
  triangles: number
  /** The loops of curves round it. */
  loops: number
  /** cell: a cell as it was; corners: its corners chosen; cut: cut into
   *  cells; box: laid out as a box; rounds: curves drawn down the middles
   *  of its rounds; left: not laid out (why). */
  action: 'cell' | 'corners' | 'cut' | 'box' | 'rounds' | 'left'
  /** Curves cut across it. */
  cuts?: number
  why?: string
}

/** A cell made, with its sides — a cell of three, five or six is split
 *  into that many patches by the build. */
export interface AutoCell {
  seed: Vec3
  sides: number
}

/** A network laid out: its nodes, curves and filled cells as the feature
 *  holds them, and how it was made. */
export interface AutoLayout {
  nodes: NetworkNode[]
  curves: NetworkCurve[]
  cells: NetworkCell[]
  nextId: number
  /** The crease curves taken from the scan, and those let go. */
  creases: number
  creasesDropped: number
  /** How the crease graph was closed before any was let go. */
  closing: Closing | null
  /** Creases left out before closing: turning under minDeg, and short
   *  ones ending loose (chips). */
  creasesWeak: number
  creasesChips: number
  /** Curves let go to untangle regions no loop closed round. */
  untangled: number
  /** What the bridge passes did; null when they were not run. */
  bridging: Bridging | null
  /** Crossings the layout's own cuts made with curves, snapped into nodes. */
  crossings: number
  /** The regions laid out down the middles of their rounds, the faces
   *  found in them, the curves drawn, and the time it took. */
  roundsLaid: RoundsLaid
  /** The tangent curves cut across regions, and the box's curves. */
  cuts: number
  regions: AutoRegion[]
  made: AutoCell[]
  /** The regions at the end that are no cell, and why. */
  left: { at: Vec3; why: string }[]
  /** Cells left out because the build, reading them as it does — split
   *  from their centres, mapped — would refuse them. */
  buildRefused: number
  /** The patches the cells make: a four-sided cell one, the others one a
   *  side. */
  patches: number
  rounds: number
  ms: number
}

/** A piece of fewer triangles than this is a crumb between curves meeting
 *  at a node, not a region. */
const CRUMB_TRIANGLES = 12
/** The most rounds of placing and reading again. */
const ROUNDS = 24
/** A region is laid out down its rounds' middles if it has this many
 *  triangles, and this share of the scan's. */
const ROUNDS_MIN_TRIANGLES = 500
const ROUNDS_MIN_SHARE = 0.01
/** A line where two faces meet shorter than this (mm, and mean edges)
 *  between two junctions makes them one. */
const ROUND_SHORT_MM = 1.5
const ROUND_SHORT_EDGES = 6
/** The creases leave most of the part one region when it holds this share
 *  of the scan's triangles. */
const WHOLE_SHARE = 0.5
/** A line where two faces meet is a crease if this share of its points
 *  lies within CREASE_NEAR_EDGES mean edges of a crease Suggest creases
 *  found. */
const CREASE_SHARE = 0.6
const CREASE_NEAR_EDGES = 4
/** A cell whose area-weighted mean normal is shorter than this bends round
 *  too far for one patch (a 90° bend reads 0.71, a half-round 0.64). */
const BENT_FLAT = 0.6
/** Where the part was laid out down its rounds, two curves meeting at a
 *  node that come this near again further than this many mean edges from
 *  it cross there. */
const NEAR_NODE_EDGES = 1.5
/** The most pairs of corners a large cell is cut between along the scan. */
const ALONG_TRIES = 6
/** A cut along the scan keeps this many mean edges off the region's
 *  boundary where it can. */
const ALONG_OFF_EDGES = 6
/** A curve down a round's middle has a grip every this many mm. */
const ROUND_GRIP_MM = 3
/** The share of a cut's points that must lie in the region it cuts. */
const CUT_INSIDE = 0.8
/** A corner of the other loop is taken for a cut's end if it is no further
 *  than this times the loop's nearest point. */
const CORNER_REACH = 1.35
/** The most passes of untangling. */
const UNTANGLE_PASSES = 8
/** A crease is taken whose mean angle across is this or more, deg. */
export const MIN_CREASE_DEG = 30
/** A crease shorter than this (mm, and mean edges) that ends loose is a
 *  chip and let go before the graph is closed. */
const CHIP_MM = 4
const CHIP_EDGES = 20
/** A node is taken for a point of a loop within this many mean edges. */
const NODE_EDGES = 3
/** The most passes of reading the cells as the build does. */
const BUILD_PASSES = 4
/** The most passes over the bridges. */
const BRIDGE_PASSES = 8
/** A bridge's island with less curve than this, mm, is a knot. */
const KNOT_MM = 8
/** Two curves between the same nodes whose traces are within this many
 *  mean edges of each other are one curve twice. */
const DUPLICATE_EDGES = 2

type Read = {
  traced: TracedNetwork
  faces: GraphFace[]
  regions: ScanRegion[]
  label: Int32Array
}

const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The network being laid out. */
class Work implements ClosingWork {
  nodes: NetworkNode[] = []
  curves: NetworkCurve[] = []
  nextId = 1
  /** The nodes chosen as a smooth loop's corners. */
  chosen = new Set<number>()
  /** The curve each piece of a split curve was split from. */
  origin = new Map<number, number>()
  /** The piece each second piece was split off: a split of a split
   *  points to the piece, not to the first curve. */
  parent = new Map<number, number>()
  cuts = 0
  private traces = new Map<number, { key: string; trace: CurveTrace }>()

  constructor(readonly scan: ScanPaths) {}

  node(at: Vec3): number {
    const id = this.nextId++
    this.nodes.push({ id, at: [at[0], at[1], at[2]] })
    return id
  }

  curve(from: number, to: number, via: Vec3[], crease: boolean): number {
    const id = this.nextId++
    this.curves.push({ id, from, to, via: via.map((p) => [p[0], p[1], p[2]] as Vec3), ...(crease ? { crease: true } : {}) })
    return id
  }

  /** The nodes by id, made again when the list is replaced or a node is
   *  added; a node moved in place is the same object. */
  private byId: { list: NetworkNode[]; length: number; map: Map<number, NetworkNode> } | null = null

  at(id: number): Vec3 {
    let b = this.byId
    if (!b || b.list !== this.nodes || b.length !== this.nodes.length) b = this.byId = { list: this.nodes, length: this.nodes.length, map: new Map(this.nodes.map((n) => [n.id, n])) }
    const n = b.map.get(id) ?? this.nodes.find((x) => x.id === id)!
    return n.at
  }

  traceOf(c: NetworkCurve): CurveTrace {
    const key = JSON.stringify([this.at(c.from), c.via, this.at(c.to)])
    const had = this.traces.get(c.id)
    if (had?.key === key) return had.trace
    const trace = traceCurve(this.scan, [this.at(c.from), ...c.via, this.at(c.to)])
    this.traces.set(c.id, { key, trace })
    return trace
  }

  /** The point of a curve nearest p: where, how far, and the trace's
   *  point index. */
  nearestOn(c: NetworkCurve, p: Vec3): { at: Vec3; d: number; i: number } | null {
    const t = this.traceOf(c)
    const n = t.points.length / 3
    let best: { at: Vec3; d: number; i: number } | null = null
    for (let i = 0; i < n; i++) {
      const q: Vec3 = [t.points[i * 3], t.points[i * 3 + 1], t.points[i * 3 + 2]]
      const d = dist(q, p)
      if (!best || d < best.d) best = { at: q, d, i }
    }
    return best
  }

  /** Whether a curve is one of `ids`, or a piece split off one of them
   *  since the id `since` was given out. */
  from(id: number, ids: ReadonlySet<number>, since: number): boolean {
    for (let x: number | undefined = id; x !== undefined; x = x >= since ? this.parent.get(x) : undefined) if (ids.has(x)) return true
    return false
  }

  /** The curve a piece was split from, or itself. */
  originOf(id: number): number {
    return this.origin.get(id) ?? id
  }

  /** A node at a point of a curve — of the pieces it has been split into,
   *  the one nearest: a node of it within a few edges, or the piece split
   *  there in two, each with the grips on its side. */
  splitAt(curveId: number, p: Vec3): number {
    const family = this.originOf(curveId)
    let c: NetworkCurve | null = null
    let near: { at: Vec3; d: number; i: number } | null = null
    for (const x of this.curves) {
      if (this.originOf(x.id) !== family) continue
      const q = this.nearestOn(x, p)
      if (q && (!near || q.d < near.d)) [near, c] = [q, x]
    }
    if (!c || !near) throw new Error(`no curve ${curveId} to split`)
    const tol = NODE_EDGES * this.scan.edge
    if (dist(this.at(c.from), near.at) <= tol) return c.from
    if (dist(this.at(c.to), near.at) <= tol) return c.to
    const t = this.traceOf(c)
    // The grips before the point along the trace stay with the first half.
    const before = t.grips.slice(1, 1 + c.via.length).filter((g) => g < near!.i).length
    const id = this.node(near.at)
    const first: NetworkCurve = { ...c, to: id, via: c.via.slice(0, before) }
    const second: NetworkCurve = { ...c, id: this.nextId++, from: id, via: c.via.slice(before) }
    this.origin.set(second.id, family)
    this.parent.set(second.id, c.id)
    const was = c.id
    this.curves = this.curves.flatMap((x) => (x.id === was ? [first, second] : [x]))
    this.traces.delete(was)
    return id
  }

  /** Two nodes made one, halfway between them on the scan: the curves of
   *  the one gone run to the other, and a curve between the two, now a
   *  loop with nothing on it, goes. */
  mergeNodes(keep: number, gone: number): void {
    if (keep === gone) return
    const a = this.at(keep)
    const b = this.at(gone)
    const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    const on = this.scan.closest(mid)
    const k = this.nodes.find((n) => n.id === keep)!
    k.at = on ? [on.point[0], on.point[1], on.point[2]] : mid
    this.nodes = this.nodes.filter((n) => n.id !== gone)
    this.curves = this.curves
      .map((c) => (c.from === gone || c.to === gone ? { ...c, from: c.from === gone ? keep : c.from, to: c.to === gone ? keep : c.to } : c))
      .filter((c) => !(c.from === c.to && c.via.length < 2))
    if (this.chosen.delete(gone)) this.chosen.add(keep)
  }

  read(): Read {
    const traced = traceNetwork(this.scan, this.nodes, this.curves)
    const { faces, regions, label } = scanRegions(this.scan, traced.nodes, traced.curves)
    return { traced, faces, regions, label }
  }
}

/** The network laid out on the scan (see above). */
export function autoLayout(scan: ScanPaths, opts: AutoOptions = {}): AutoLayout {
  const t0 = performance.now()
  const w = new Work(scan)
  let creases = 0
  let creasesDropped = 0
  let closing: Closing | null = null
  let creasesWeak = 0
  let creasesChips = 0
  const bends = new Bends(scan)
  if (opts.creases !== false) {
    const found = suggestCreases(scan, { ...(opts.strongDeg !== undefined ? { strongDeg: opts.strongDeg } : {}), ...(opts.weakDeg !== undefined ? { weakDeg: opts.weakDeg } : {}) })
    const idOf = new Map<number, number>()
    for (const n of found.nodes) idOf.set(n.id, w.node(n.at))
    // A crease that turns less than minDeg on the average is a scan's
    // ripple or a round's shoulder rather than an edge of the part: on the
    // sample bracket, wandering chains of 13–30° along its rounds, a
    // chord a fifth of their length.
    const minDeg = opts.minDeg ?? MIN_CREASE_DEG
    const kept = found.curves.filter((c) => c.angle >= minDeg)
    creasesWeak = found.curves.length - kept.length
    for (const c of kept) w.curve(idOf.get(c.from)!, idOf.get(c.to)!, c.via, true)
    // Chips: a short crease with an end no other reaches.
    const chip = Math.max(CHIP_MM, CHIP_EDGES * scan.edge)
    const lengthOf = new Map(kept.map((c, i) => [w.curves[i].id, c.length]))
    for (;;) {
      const count = new Map<number, number>()
      for (const c of w.curves) for (const n of [c.from, c.to]) count.set(n, (count.get(n) ?? 0) + 1)
      const chips = w.curves.filter((c) => (lengthOf.get(c.id) ?? Infinity) < chip && (count.get(c.from) === 1 || count.get(c.to) === 1))
      if (chips.length === 0) break
      creasesChips += chips.length
      const gone = new Set(chips.map((c) => c.id))
      w.curves = w.curves.filter((c) => !gone.has(c.id))
    }
    if (opts.close !== false && w.curves.length > 0) closing = closeCreases(w, bends)
    // A crease that still ends where no other does closes nothing: let go,
    // and so the one it then leaves loose.
    for (;;) {
      const count = new Map<number, number>()
      for (const c of w.curves) for (const n of [c.from, c.to]) count.set(n, (count.get(n) ?? 0) + (c.from === c.to ? 2 : 1))
      const loose = w.curves.filter((c) => count.get(c.from) === 1 || count.get(c.to) === 1)
      if (loose.length === 0) break
      creasesDropped += loose.length
      const gone = new Set(loose.map((c) => c.id))
      w.curves = w.curves.filter((c) => !gone.has(c.id))
    }
    const used = new Set(w.curves.flatMap((c) => [c.from, c.to]))
    w.nodes = w.nodes.filter((n) => used.has(n.id))
    creases = w.curves.filter((c) => c.crease).length
  }

  const regions: AutoRegion[] = []
  let rounds = 0
  const snapped = { crossings: 0 }
  let read = w.read()
  // Untangled: a region curves touch but no loop of them closes round —
  // traces that cross where the snapping found no crossing, or run
  // within a triangle of each other — loses the shortest curve touching
  // it, and the creases that leaves loose go with it; read again.
  let untangled = 0
  for (let pass = 0; pass < UNTANGLE_PASSES; pass++) {
    const tangled = read.regions.filter((r) => r.faces.length === 0 && r.curveEdges > 0 && r.triangles.length >= CRUMB_TRIANGLES)
    if (tangled.length === 0) break
    const byTriangle = new Map<number, number[]>()
    for (const c of read.traced.curves) {
      const p = c.trace.points
      for (let i = 0; i < p.length; i += 3) {
        const q = scan.closest([p[i], p[i + 1], p[i + 2]])
        if (!q) continue
        const list = byTriangle.get(q.triangle)
        if (!list) byTriangle.set(q.triangle, [c.id])
        else if (!list.includes(c.id)) list.push(c.id)
      }
    }
    const lengthOf = new Map(read.traced.curves.map((c) => [c.id, c.trace.length]))
    const gone = new Set<number>()
    for (const r of tangled) {
      const touching = new Set<number>()
      for (const t of r.triangles) for (const c of byTriangle.get(t) ?? []) touching.add(c)
      const shortest = [...touching].filter((c) => !gone.has(c)).sort((a, b) => (lengthOf.get(a) ?? 0) - (lengthOf.get(b) ?? 0))[0]
      if (shortest !== undefined) gone.add(shortest)
    }
    if (gone.size === 0) break
    untangled += gone.size
    w.curves = w.curves.filter((c) => !gone.has(c.id))
    for (;;) {
      const count = new Map<number, number>()
      for (const c of w.curves) for (const n of [c.from, c.to]) count.set(n, (count.get(n) ?? 0) + (c.from === c.to ? 2 : 1))
      const loose = w.curves.filter((c) => count.get(c.from) === 1 || count.get(c.to) === 1)
      if (loose.length === 0) break
      untangled += loose.length
      const drop = new Set(loose.map((c) => c.id))
      w.curves = w.curves.filter((c) => !drop.has(c.id))
    }
    const used = new Set(w.curves.flatMap((c) => [c.from, c.to]))
    w.nodes = w.nodes.filter((n) => used.has(n.id))
    read = w.read()
  }
  // Bridges: a curve with one region on both sides closes nothing (see
  // unbridge).
  let bridging: Bridging | null = null
  if ((opts.bridges ?? 'drop') !== 'keep' && w.curves.length > 0) {
    bridging = { duplicates: 0, found: 0, cut: 0, dropped: 0, knots: 0, knotCurves: 0, passes: 0 }
    for (let pass = 0; pass < BRIDGE_PASSES; pass++) {
      if (!unbridge(w, read, bends, opts.bridges === 'cut' ? 'cut' : 'drop', bridging)) break
      bridging.passes++
      snapCrossings(w, snapped)
      read = w.read()
    }
  }
  // The rounds' middles, for a region the creases leave no way to lay out.
  const roundsTried = new Uint8Array(scan.triangleCount)
  const roundsMin = Math.max(ROUNDS_MIN_TRIANGLES, ROUNDS_MIN_SHARE * scan.triangleCount)
  const roundsLaid: RoundsLaid = { regions: 0, faces: 0, curves: 0, creases: 0, whole: false, ms: 0 }
  // Where the creases leave most of the part one region of many loops or
  // none — a part whose edges are rounds, its creases islands in it — the
  // part is laid out from its faces instead: the curves all let go, every
  // face grown until it meets the next down a round's middle or at a sharp
  // edge, the line a crease where Suggest creases found one along it.
  if (opts.rounds !== false && read.regions.length > 0) {
    const largest = read.regions.reduce((a, b) => (b.triangles.length > a.triangles.length ? b : a))
    const tangled = largest.faces.length >= 3 || (largest.faces.length === 0 && largest.curveEdges > 0)
    if (tangled && largest.triangles.length >= WHOLE_SHARE * scan.triangleCount) {
      const creaseGrid = new TraceGrid(Math.max(marchStep(scan), 2 * scan.edge))
      for (const c of w.curves) if (c.crease) creaseGrid.add(c.id, w.traceOf(c).points)
      w.curves = []
      w.nodes = []
      w.chosen.clear()
      const all = new Uint32Array(scan.triangleCount)
      for (let t = 0; t < all.length; t++) all[t] = t
      const near = CREASE_NEAR_EDGES * scan.edge
      const onCrease = (points: readonly Vec3[]) => points.filter((q) => creaseGrid.nearest(q, near, () => true)).length >= CREASE_SHARE * points.length
      layRounds(w, { triangles: all, faces: [], rimEdges: 0, curveEdges: 0 }, roundsLaid, onCrease)
      roundsLaid.whole = true
      roundsTried.fill(1)
      read = w.read()
    }
  }
  // A region is known by its first triangle and its size: one the creases
  // left is reported once, as found, with what was done with it.
  const keyOf = (r: ScanRegion) => `${r.triangles[0]}:${r.triangles.length}`
  const first = new Set(read.regions.map(keyOf))
  const reported = new Set<string>()
  // A large region laid out down its rounds' middles — none the creases
  // lay out alone — is cut more freely: along the scan inside it where a
  // straight section leaves it, its five- and six-sided cells cut into
  // four-sided ones, a curve its face runs both ways round let go, a loop
  // pinched to its longest cut once.
  const along = (r: ScanRegion) => roundsTried[r.triangles[0]] === 1 && r.triangles.length >= roundsMin
  const tighten = () => {
    if (roundsLaid.regions === 0) {
      snapCrossings(w, snapped)
      return
    }
    snapCrossings(w, snapped, NEAR_NODE_EDGES)
    contractShort(w, { contracted: 0 })
  }
  // Why a region was last left, by a triangle of it: what the end says of
  // the region that triangle is in then.
  const lastWhy = new Map<number, string>()
  for (; rounds < ROUNDS; rounds++) {
    let changed = false
    let ringCut = false
    const roundsBefore = roundsLaid.curves
    // Rings first: their cuts' ends are the corners of the disks beside
    // them, so the top of a can and its side share them — the disks read
    // the next round, with the cuts in.
    const order = [...read.regions].sort((a, b) => (a.faces.length === 2 ? 0 : 1) - (b.faces.length === 2 ? 0 : 1))
    for (const region of order) {
      if (region.triangles.length < CRUMB_TRIANGLES) continue
      if (ringCut && region.faces.length !== 2) continue
      const at = regionSeed(scan, region.triangles)
      const entry = (kind: AutoRegion['kind'], action: AutoRegion['action'], extra: Partial<AutoRegion> = {}) => {
        const key = keyOf(region)
        if (extra.why) lastWhy.set(region.triangles[Math.floor(region.triangles.length / 2)], extra.why)
        if (!first.has(key) || reported.has(key)) return
        reported.add(key)
        regions.push({ kind, at: round4(at), triangles: region.triangles.length, loops: region.faces.length, action, ...extra })
      }
      // A large region the creases leave no way to lay out: the middles
      // of its rounds drawn (layRounds), once — whether any were or not.
      const rounds = (kind: AutoRegion['kind']): boolean => {
        if (opts.rounds === false || region.triangles.length < roundsMin || roundsTried[region.triangles[0]]) return false
        for (const t of region.triangles) roundsTried[t] = 1
        const did = layRounds(w, region, roundsLaid)
        if (did === 0) return false
        entry(kind, 'rounds', { cuts: did })
        changed = true
        return true
      }
      if (region.faces.length === 0) {
        if (region.curveEdges > 0) {
          if (!rounds('loops')) entry('loops', 'left', { why: TANGLED_WHY })
          continue
        }
        if (region.rimEdges > 0) {
          entry('open', 'left', { why: OPEN_WHY })
          continue
        }
        if (layBox(w, region)) {
          entry('closed', 'box', { cuts: 12 })
          changed = true
        } else if (!rounds('closed')) entry('closed', 'left', { why: 'laid out as a box, a ray from its middle left it nowhere — it is not round its middle' })
        continue
      }
      if (region.faces.length === 1) {
        const face = read.faces[region.faces[0]]
        const did = disk(w, read, face, region, along(region))
        if (did === 'cell') entry('disk', 'cell')
        else if (did === 'corners') {
          entry('disk', 'corners')
          changed = true
        } else if (did === 'cut') {
          entry('disk', 'cut', { cuts: 1 })
          changed = true
        } else if (!rounds('disk')) entry('disk', 'left', { why: did.why })
        continue
      }
      if (region.faces.length === 2) {
        const did = ring(w, read, region, along(region))
        if (typeof did === 'number') {
          entry('ring', 'cut', { cuts: did })
          changed = true
          ringCut = true
        } else if (!rounds('ring')) entry('ring', 'left', { why: did.why })
        continue
      }
      // Three loops or more: its rounds first, where it has any.
      if (rounds('loops')) continue
      const did = multiLoop(w, read, region, bends)
      if (typeof did === 'number') {
        entry('loops', 'cut', { cuts: did })
        changed = true
      } else if (along(region) && pinchCut(w, read, region)) {
        entry('loops', 'cut', { cuts: 1 })
        changed = true
      } else entry('loops', 'left', { why: did.why })
    }
    if (!changed) break
    // A cut across a region can cross a curve inside it — a crease of an
    // island, one a bridge leads to: the crossing made a node. Where the
    // part was laid out down its rounds, near a node too — two curves
    // leaving one node can touch inside the closing's guard — and the stubs
    // that leaves contracted.
    tighten()
    read = w.read()
    // A round's middle drawn to a tangle can be a bridge of its own.
    if (roundsLaid.curves > roundsBefore && opts.bridges !== 'keep') {
      const tally = bridging ?? { duplicates: 0, found: 0, cut: 0, dropped: 0, knots: 0, knotCurves: 0, passes: 0 }
      for (let pass = 0; pass < BRIDGE_PASSES && unbridge(w, read, bends, 'drop', tally); pass++) {
        tighten()
        read = w.read()
      }
    }
  }
  // A node only two curves of a kind run through, smoothly, and no cell's
  // corner, is a grip of one curve: a leftover of a crease cut in four,
  // where the two traces' ends can pinch off a crumb of the scan that the
  // map reads as a hole in the cell.
  for (let pass = 0; pass < 4 && mergeThrough(w, read); pass++) read = w.read()

  // The cells: every region of three to six corners — a smooth loop's
  // chosen ones among them — checked as the build reads them.
  const seeds: Vec3[] = []
  const given: (number[] | undefined)[] = []
  const left: AutoLayout['left'] = []
  for (const region of read.regions) {
    if (region.triangles.length < CRUMB_TRIANGLES) continue
    const at = regionSeed(scan, region.triangles)
    if (region.faces.length !== 1) {
      const said = [...lastWhy].filter(([t]) => read.label[t] === read.label[region.triangles[0]]).map(([, why]) => why).pop()
      left.push({ at: round4(at), why: said ?? (region.faces.length === 0 ? (region.curveEdges > 0 ? TANGLED_WHY : region.rimEdges > 0 ? OPEN_WHY : 'no curve round it') : `${region.faces.length} loops of curves round it`) })
      continue
    }
    const corners = cornersOf(w, read, read.faces[region.faces[0]])
    if (!corners) {
      left.push({ at: round4(at), why: 'its boundary has no corner' })
      continue
    }
    seeds.push(at)
    given.push(corners.chosen ? corners.list : undefined)
  }
  const cells = readCells(scan, read.traced.nodes, read.traced.curves, seeds, given.map((g) => (g ? new Set(g) : undefined)))
  const out: NetworkCell[] = []
  const made: AutoCell[] = []
  const nodeAt = new Map(read.traced.nodes.map((n) => [n.id, n.at]))
  cells.cells.forEach((c, i) => {
    if (c.status !== 'ok') {
      left.push({ at: round4(seeds[i]), why: c.message })
      return
    }
    // The cell's own mesh, as the map reads it: a disk, one boundary.
    const mesh = cellMesh(scan, c.triangles, c.holes, c.corners.map((id) => nodeAt.get(id)!))
    if (typeof mesh === 'string') {
      left.push({ at: round4(seeds[i]), why: mesh })
      return
    }
    out.push({ seed: round4(seeds[i]), ...(given[i] ? { corners: given[i] } : {}) })
    made.push({ seed: round4(seeds[i]), sides: c.sides.length })
  })
  const nodes = w.nodes.map((n) => ({ ...n, at: round6(n.at) }))
  const curves = w.curves.map((c) => ({ ...c, via: c.via.map(round6) }))
  // The cells read as the build reads them — those of three, five or six
  // sides split from their centres, the pieces read again and mapped — and
  // one it would refuse left out; the rest read again, a split's spokes
  // having run into its neighbours' sides. The build's own scan, its
  // triangles in another order, can still read a cell on the edge of a rule
  // the other way; it says why of any it refuses.
  let checked = 0
  for (let pass = 0; pass < BUILD_PASSES && out.length > 0; pass++) {
    const reading = readNetwork(scan, { nodes, curves, cells: out, spans: {}, fit: { smoothness: 0.001 } }, undefined, { fit: false })
    const refused = new Map<number, string>()
    reading.outcomes.forEach((o, i) => {
      if ('refused' in o) refused.set(i, o.refused)
    })
    if (refused.size === 0) break
    for (const [i, why] of refused) left.push({ at: out[i].seed, why: `as the build reads it — ${why}` })
    checked += refused.size
    const keep = (_: unknown, i: number) => !refused.has(i)
    out.splice(0, out.length, ...out.filter(keep))
    made.splice(0, made.length, ...made.filter(keep))
  }
  return {
    nodes,
    curves,
    cells: out,
    buildRefused: checked,
    nextId: w.nextId,
    creases,
    creasesDropped,
    closing,
    untangled,
    bridging,
    crossings: snapped.crossings,
    roundsLaid,
    creasesWeak,
    creasesChips,
    cuts: w.cuts,
    regions,
    made,
    left,
    patches: made.reduce((s, c) => s + (c.sides === 4 ? 1 : c.sides), 0),
    rounds: rounds + 1,
    ms: performance.now() - t0,
  }
}

const TANGLED_WHY = 'curves touch it, but they close no loop round it — they cross or end where no node joins them'
const OPEN_WHY = 'the scan’s own rim bounds it — the layout draws no curve along an open edge of the scan yet'

const round4 = (p: ArrayLike<number>): Vec3 => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4, Math.round(p[2] * 1e4) / 1e4]
const round6 = (p: ArrayLike<number>): Vec3 => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6, Math.round(p[2] * 1e6) / 1e6]

/** The loop's nodes in order round it, once each. */
function loopNodes(face: GraphFace): number[] {
  const seen = new Set<number>()
  return face.nodes.filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
}

/** A face's corners: by the rule (a turn of over 30°), with the nodes
 *  chosen as a smooth loop's corners — `chosen` when any are — in order
 *  round it; null where it has none and none were chosen. */
function cornersOf(w: Work, read: Read, face: GraphFace): { list: number[]; chosen: boolean } | null {
  const rule = faceSides(face, read.traced.nodes, read.traced.curves)
  const ruled = new Set('corners' in rule ? rule.corners : [])
  const order = loopNodes(face)
  const picked = order.filter((n) => w.chosen.has(n))
  if (picked.length === 0) return ruled.size > 0 ? { list: order.filter((n) => ruled.has(n)), chosen: false } : null
  return { list: order.filter((n) => ruled.has(n) || w.chosen.has(n)), chosen: true }
}

/** The arc length round a loop at each of its nodes, from the node its
 *  first curve leaves, and the loop's length. */
function loopLengths(read: Read, face: GraphFace): { at: Map<number, number>; length: number } {
  const len = new Map(read.traced.curves.map((c) => [c.id, c.trace.length]))
  const at = new Map<number, number>()
  let s = 0
  // face.nodes[i] is the node the i-th half-edge arrives at.
  const start = face.nodes[face.nodes.length - 1]
  at.set(start, 0)
  for (let i = 0; i < face.edges.length; i++) {
    s += len.get(face.edges[i].curve) ?? 0
    if (!at.has(face.nodes[i])) at.set(face.nodes[i], s)
  }
  return { at, length: s }
}

/** `count` nodes evenly round a loop, from the corners it has: a node near
 *  each place, else the curve split there. Added to the chosen. */
function spreadCorners(w: Work, read: Read, face: GraphFace, keep: readonly number[], count: number): number[] {
  const { at, length } = loopLengths(read, face)
  if (length <= 0) return []
  const order = loopNodes(face)
  const start = keep.length > 0 ? at.get(keep[0])! : at.get(order[0])!
  const out: number[] = [...keep]
  for (let k = 0; k < count; k++) {
    const want = (start + (length * k) / count) % length
    const has = out.find((n) => circular(at.get(n) ?? -1e9, want, length) < length / (2.5 * count))
    if (has !== undefined) continue
    // The node nearest the place, if it is near enough; else a split.
    let best = -1
    let bestD = Infinity
    for (const n of order) {
      const d = circular(at.get(n)!, want, length)
      if (d < bestD) [bestD, best] = [d, n]
    }
    if (best >= 0 && !out.includes(best) && bestD < length / (2 * count)) {
      out.push(best)
      continue
    }
    const place = pointRound(read, face, want)
    if (!place) continue
    const id = w.splitAt(place.curve, place.at)
    if (!out.includes(id)) out.push(id)
  }
  for (const n of out) w.chosen.add(n)
  return out
}

const circular = (a: number, b: number, length: number) => {
  const d = Math.abs(a - b) % length
  return Math.min(d, length - d)
}

/** The point an arc length round a loop, and the curve it is on. */
function pointRound(read: Read, face: GraphFace, s: number): { at: Vec3; curve: number } | null {
  const byId = new Map(read.traced.curves.map((c) => [c.id, c]))
  let left = s
  for (const h of face.edges) {
    const c = byId.get(h.curve)
    if (!c) continue
    const l = c.trace.length
    if (left <= l) {
      const want = h.forward ? left : l - left
      const t = c.trace
      let i = 1
      while (i < t.at.length - 1 && t.at[i] < want) i++
      return { at: [t.points[i * 3], t.points[i * 3 + 1], t.points[i * 3 + 2]], curve: c.id }
    }
    left -= l
  }
  return null
}

/** A disk read: a cell as it is, its corners chosen, cut across, or why
 *  not. */
function disk(w: Work, read: Read, face: GraphFace, region: ScanRegion, along = false): 'cell' | 'corners' | 'cut' | { why: string } {
  const rule = faceSides(face, read.traced.nodes, read.traced.curves)
  if (!('corners' in rule) && !rule.message.startsWith('one side')) {
    // A large region's face run both ways along a curve — one the labels
    // read two regions either side of, so the bridges kept: let go.
    const twice = new Set(face.edges.filter((h) => face.edges.some((g) => g.curve === h.curve && g.forward !== h.forward)).map((h) => h.curve))
    if (along && twice.size > 0) {
      w.curves = w.curves.filter((c) => !twice.has(c.id))
      pruneLoose(w)
      return 'cut'
    }
    return { why: rule.message }
  }
  const corners = cornersOf(w, read, face)
  const count = corners?.list.length ?? 0
  // A large cell of five or six corners cut into a four-sided one and
  // another, where a cut stays inside it: the build splits such a cell from
  // its centre, and on a bent one the split folds.
  if (along && (count === 5 || count === 6)) {
    const list = corners!.list
    const step = count === 6 ? 3 : 2
    const pairs = list.map((a, i) => ({ a, b: list[(i + step) % count] })).sort((p, q) => dist(w.at(p.a), w.at(p.b)) - dist(w.at(q.a), w.at(q.b)))
    for (const p of pairs.slice(0, 3)) if (tryCut(w, read, region, p.a, p.b) || tryCut(w, read, region, p.a, p.b, true)) return 'cut'
  }
  // A large three-sided cell given a fourth corner, the middle of its
  // longest side: four-sided, the build need not split it from its centre.
  if (along && count === 3 && fourthCorner(w, read, face, corners!.list)) return 'corners'
  // A large four-sided cell that bends round — its mean normal short of
  // BENT_FLAT, the scan under it turned past what one patch follows — cut
  // across the bend, between the middles of its two longer sides.
  if (along && count === 4 && flatness(w.scan, region.triangles) < BENT_FLAT && acrossBend(w, read, region, face, corners!.list)) return 'cut'
  if (count >= SIDES_MIN && count <= SIDES_MAX) return 'cell'
  if (count < SIDES_MIN) {
    const nodes = loopNodes(face)
    // Three nodes round a smooth loop are its three corners; four or
    // more, four spread evenly.
    if (nodes.length === 3 && count === 0) {
      for (const n of nodes) w.chosen.add(n)
      return 'corners'
    }
    const got = spreadCorners(w, read, face, corners?.list ?? [], 4)
    return got.length >= SIDES_MIN ? 'corners' : { why: 'no corners could be put round it' }
  }
  // Over six: cut across between two corners.
  const list = corners!.list
  const n = list.length
  const pairs: { a: number; b: number; d: number }[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 3; j < n; j++) {
      const one = j - i + 1
      const other = n - (j - i) + 1
      if (one < 4 || other < 4) continue
      const fit = (one <= SIDES_MAX ? 0 : 1) + (other <= SIDES_MAX ? 0 : 1)
      pairs.push({ a: list[i], b: list[j], d: dist(w.at(list[i]), w.at(list[j])) * (1 + fit) })
    }
  }
  pairs.sort((p, q) => p.d - q.d)
  for (const p of pairs.slice(0, 6)) if (tryCut(w, read, region, p.a, p.b)) return 'cut'
  if (along) {
    // Along the scan: the nearest pairs no curve joins yet, a few.
    const joined = (a: number, b: number) => w.curves.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))
    let tried = 0
    for (const p of pairs) {
      if (tried >= ALONG_TRIES) break
      if (joined(p.a, p.b)) continue
      tried++
      if (tryCut(w, read, region, p.a, p.b, true)) return 'cut'
    }
  }
  return { why: `${n} corners, and no cut between two of them stays inside it` }
}

/** The region's index in the read. */
function regionIndex(read: Read, region: ScanRegion): number {
  return read.label[region.triangles[0]]
}

/** A tangent curve from node a to node b, kept if its trace keeps to the
 *  region. */
function tryCut(w: Work, read: Read, region: ScanRegion, a: number, b: number, along = false): boolean {
  if (a === b) return false
  if (w.curves.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))) return false
  // Along: the shortest way inside the region, kept off its boundary,
  // gripped every ROUND_GRIP_MM — where a straight section leaves it.
  let via: Vec3[] = []
  if (along) {
    const path = regionPath(w.scan, region.triangles, w.at(a), w.at(b), ALONG_OFF_EDGES * w.scan.edge)
    if (!path) return false
    let length = 0
    for (let i = 1; i < path.length; i++) length += dist(path[i], path[i - 1])
    via = gripsAlong(path, Math.min(Math.max(ROUND_GRIP_MM, 4 * marchStep(w.scan)), Math.max(length / 3, marchStep(w.scan))))
  }
  const trace = traceCurve(w.scan, [w.at(a), ...via, w.at(b)])
  const n = trace.points.length / 3
  if (n < 3) return false
  const own = regionIndex(read, region)
  let inside = 0
  let counted = 0
  for (let i = 1; i < n - 1; i++) {
    const c = w.scan.closest([trace.points[i * 3], trace.points[i * 3 + 1], trace.points[i * 3 + 2]])
    if (!c) continue
    counted++
    if (read.label[c.triangle] === own) inside++
  }
  if (counted === 0 || inside / counted < CUT_INSIDE) return false
  w.curve(a, b, via, false)
  w.cuts++
  return true
}

/** Points along a path every `every` mm, short of its ends. */
function gripsAlong(path: readonly Vec3[], every: number): Vec3[] {
  let length = 0
  for (let i = 1; i < path.length; i++) length += dist(path[i], path[i - 1])
  const via: Vec3[] = []
  let next = every
  let s = 0
  for (let i = 1; i < path.length; i++) {
    s += dist(path[i], path[i - 1])
    if (s >= next && length - s > every / 2) {
      via.push(path[i])
      next = s + every
    }
  }
  return via
}

/** A ring cut across from each corner of one loop to the other: the
 *  cuts made, or why none. */
function ring(w: Work, read: Read, region: ScanRegion, along = false): number | { why: string } {
  let [fa, fb] = region.faces.map((f) => read.faces[f])
  let ca = cornersOf(w, read, fa)?.list ?? []
  let cb = cornersOf(w, read, fb)?.list ?? []
  if (ca.length < cb.length || (ca.length === cb.length && loopLengths(read, fa).length < loopLengths(read, fb).length)) {
    ;[fa, fb] = [fb, fa]
    ;[ca, cb] = [cb, ca]
  }
  if (ca.length < 2) ca = spreadCorners(w, read, fa, ca, 4)
  if (ca.length < 2) return { why: 'no corners could be put round its loops to cut it from' }
  // The other loop's curves, as they stand before any is split.
  const otherCurves = new Set(fb.edges.map((h) => w.originOf(h.curve)))
  const used = new Set<number>()
  let made = 0
  for (const a of ca) {
    const pa = w.at(a)
    // The other loop's point nearest the corner.
    let near: { at: Vec3; d: number; curve: number } | null = null
    for (const c of w.curves) {
      if (!otherCurves.has(w.originOf(c.id))) continue
      const q = w.nearestOn(c, pa)
      if (q && (!near || q.d < near.d)) near = { at: q.at, d: q.d, curve: c.id }
    }
    if (!near) continue
    // A corner of the other loop as near as the loop itself, else a node
    // of it, else the loop split there.
    let target = -1
    let best = CORNER_REACH * near.d + NODE_EDGES * w.scan.edge
    for (const b of cb) {
      if (used.has(b)) continue
      const d = dist(pa, w.at(b))
      if (d <= best) [best, target] = [d, b]
    }
    if (target < 0) target = w.splitAt(near.curve, near.at)
    if (used.has(target)) continue
    if (tryCut(w, read, region, a, target) || (along && tryCut(w, read, region, a, target, true))) {
      used.add(target)
      // Both ends corners of the loops they are on, for the disks beside.
      w.chosen.add(a)
      w.chosen.add(target)
      made++
    }
  }
  if (made < 2) return { why: made === 0 ? 'no cut between its two loops stays inside it' : 'only one cut between its two loops stays inside it — two at least make it cells' }
  return made
}

/** A closed region with no curve laid out as a box round its principal
 *  axes (see above); false where a ray finds no scan. */
function layBox(w: Work, region: ScanRegion): boolean {
  const scan = w.scan
  const idx = scan.indices
  const pos = scan.positions
  const seen = new Uint8Array(pos.length / 3)
  const verts: number[] = []
  for (const t of region.triangles) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]
      if (!seen[v]) {
        seen[v] = 1
        verts.push(v)
      }
    }
  }
  const c: Vec3 = [0, 0, 0]
  for (const v of verts) for (let k = 0; k < 3; k++) c[k] += pos[v * 3 + k] / verts.length
  const cov = new Float64Array(9)
  for (const v of verts) {
    const d = [pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += d[i] * d[j]
  }
  const axes = symmetricEigen3(cov).vectors
  const half = axes.map((a) => {
    let m = 0
    for (const v of verts) m = Math.max(m, Math.abs((pos[v * 3] - c[0]) * a[0] + (pos[v * 3 + 1] - c[1]) * a[1] + (pos[v * 3 + 2] - c[2]) * a[2]))
    return m
  })
  const size = Math.max(...half)
  const reach = Math.max(3 * scan.edge, 0.03 * size)
  /** Where a ray from the middle toward the box point s (in half sizes
   *  along the axes) leaves the region's scan. */
  const exit = (s: Vec3): Vec3 | null => {
    const d: Vec3 = [0, 0, 0]
    for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) d[i] += s[k] * half[k] * axes[k][i]
    const l = Math.hypot(d[0], d[1], d[2])
    if (l === 0) return null
    const u: Vec3 = [d[0] / l, d[1] / l, d[2] / l]
    let best = -1
    let bestT = 0
    for (const v of verts) {
      const q: Vec3 = [pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]]
      const t = q[0] * u[0] + q[1] * u[1] + q[2] * u[2]
      if (t <= 0) continue
      const perp = Math.hypot(q[0] - t * u[0], q[1] - t * u[1], q[2] - t * u[2])
      if (perp <= reach && t > bestT) [bestT, best] = [t, v]
    }
    if (best < 0) return null
    // Onto the scan where the ray is, from the vertex beside it.
    const p: Vec3 = [c[0] + bestT * u[0], c[1] + bestT * u[1], c[2] + bestT * u[2]]
    const on = scan.closest(p)
    return on ? on.point : [pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]]
  }
  const corner: number[] = []
  const signs = (i: number): Vec3 => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]
  const points: Vec3[] = []
  for (let i = 0; i < 8; i++) {
    const p = exit(signs(i))
    if (!p) return false
    points.push(p)
  }
  const edges: { a: number; b: number; via: Vec3[] }[] = []
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue
      const j = i | bit
      const axis = bit === 1 ? 0 : bit === 2 ? 1 : 2
      const via: Vec3[] = []
      for (const t of [-0.5, 0, 0.5]) {
        const s = signs(i)
        s[axis] = t
        const p = exit(s)
        if (!p) return false
        via.push(p)
      }
      edges.push({ a: i, b: j, via })
    }
  }
  for (const p of points) corner.push(w.node(p))
  for (const e of edges) {
    w.curve(corner[e.a], corner[e.b], e.via, false)
    w.cuts++
  }
  return true
}

/** The nodes two curves of a kind run through smoothly — no turn past
 *  CORNER_DEG, no corner chosen — made grips: the two curves one, keeping
 *  the first's id. Whether any was. */
function mergeThrough(w: Work, read: Read): boolean {
  const fits = new Map(read.traced.curves.map((c) => [c.id, c.fit]))
  // A curve joined this pass is read again before its other end is.
  const touched = new Set<number>()
  let merged = false
  for (const n of [...w.nodes]) {
    if (w.chosen.has(n.id)) continue
    const at = w.curves.filter((c) => c.from === n.id || c.to === n.id)
    if (at.length !== 2 || at[0].id === at[1].id || at.some((c) => c.from === c.to || touched.has(c.id))) continue
    const [p, q] = at
    if ((p.crease === true) !== (q.crease === true)) continue
    const fp = fits.get(p.id)
    const fq = fits.get(q.id)
    if (!fp || !fq) continue
    // Each curve leaving the node: the turn between arriving by one and
    // leaving by the other.
    const leave = (c: NetworkCurve, f: typeof fp): Vec3 => {
      if (c.from === n.id) return endTangent(f, 0)
      const t = endTangent(f, 1)
      return [-t[0], -t[1], -t[2]]
    }
    const a = leave(p, fp)
    const b = leave(q, fq)
    const turn = (Math.acos(Math.max(-1, Math.min(1, -(a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))) * 180) / Math.PI
    if (turn > CORNER_DEG) continue
    // p run into the node, q out of it.
    const into = p.to === n.id ? { from: p.from, via: p.via } : { from: p.to, via: [...p.via].reverse() }
    const out = q.from === n.id ? { to: q.to, via: q.via } : { to: q.from, via: [...q.via].reverse() }
    if (into.from === out.to && into.via.length + out.via.length + 1 < 2) continue
    const joined: NetworkCurve = { ...p, from: into.from, to: out.to, via: [...into.via, n.at, ...out.via] }
    w.curves = w.curves.filter((c) => c.id !== q.id).map((c) => (c.id === p.id ? joined : c))
    w.nodes = w.nodes.filter((x) => x.id !== n.id)
    touched.add(p.id)
    merged = true
  }
  return merged
}

/** The share of a path's points on the region's own triangles. */
function insideShare(w: Work, read: Read, region: ScanRegion, points: ArrayLike<number>): number {
  const own = regionIndex(read, region)
  let inside = 0
  let counted = 0
  for (let i = 3; i + 5 < points.length; i += 3) {
    const c = w.scan.closest([points[i], points[i + 1], points[i + 2]])
    if (!c) continue
    counted++
    if (read.label[c.triangle] === own) inside++
  }
  return counted === 0 ? 1 : inside / counted
}

/** A region with three loops or more round it: two cuts from the loop
 *  nearest its longest to the longest, a quarter of the nearer loop's
 *  length either side of where the two come nearest — the piece between
 *  them a cell, the rest one loop fewer. Each cut marched along the
 *  scan's principal lines toward the other loop (networkClose.ts), a
 *  straight section where the march does not meet it inside the region.
 *  The cuts made, or why none. */
function multiLoop(w: Work, read: Read, region: ScanRegion, bends: Bends): number | { why: string } {
  const loops = region.faces.map((f) => read.faces[f])
  const lengths = loops.map((f) => loopLengths(read, f).length)
  const outer = lengths.indexOf(Math.max(...lengths))
  const byId = new Map(read.traced.curves.map((c) => [c.id, c]))
  const pointsOf = (f: GraphFace) => f.edges.flatMap((h) => {
    const t = byId.get(h.curve)?.trace
    if (!t) return []
    const out: Vec3[] = []
    for (let i = 0; i < t.points.length; i += 3) out.push([t.points[i], t.points[i + 1], t.points[i + 2]])
    return out
  })
  const outerPts = pointsOf(loops[outer])
  // The loop nearest the longest, and where.
  let near: { loop: number; d: number } | null = null
  const outerNodes = new Set(loops[outer].nodes)
  const clear = 2 * NODE_EDGES * w.scan.edge
  loops.forEach((f, i) => {
    // A loop that shares a node with the longest is a piece of the same
    // boundary the graph reads as two, not a loop beside it.
    if (i === outer || f.nodes.some((n) => outerNodes.has(n))) return
    const pts = pointsOf(f)
    let d = Infinity
    for (let a = 0; a < pts.length; a += 2) for (let b = 0; b < outerPts.length; b += 2) d = Math.min(d, dist(pts[a], outerPts[b]))
    if (d > clear && (!near || d < near.d)) near = { loop: i, d }
  })
  if (!near) return { why: `${loops.length} loops of curves round it, none clear of its longest — the graph meets itself round it` }
  const inner = loops[(near as { loop: number }).loop]
  const { length } = loopLengths(read, inner)
  if (!(length > 0)) return { why: 'a loop round it has no length' }
  // Where on the inner loop it comes nearest the outer.
  let s0 = 0
  let best = Infinity
  for (let k = 0; k < 64; k++) {
    const p = pointRound(read, inner, (length * k) / 64)
    if (!p) continue
    for (let b = 0; b < outerPts.length; b += 2) {
      const d = dist(p.at, outerPts[b])
      if (d < best) [best, s0] = [d, (length * k) / 64]
    }
  }
  // The longest loop's curves as they stand: a family split before has
  // pieces on other loops too.
  const outerIds = new Set(loops[outer].edges.map((h) => h.curve))
  const grid = new TraceGrid(1.5 * marchStep(w.scan))
  for (const c of w.curves) if (outerIds.has(c.id)) grid.add(c.id, w.traceOf(c).points)
  // A pair of cuts or none: one alone joins two loops by a slit.
  const before = { nodes: w.nodes.map((n) => ({ ...n })), curves: w.curves.slice(), chosen: new Set(w.chosen), cuts: w.cuts, nextId: w.nextId }
  let made = 0
  const failed: string[] = []
  // Either side of where the loops come nearest, a quarter of the way
  // round, else a sixth or a third.
  const tries = [[1 / 4, -1 / 4], [1 / 6, -1 / 6], [1 / 3, -1 / 3]].flat()
  let side = 0
  for (const share of tries) {
    if (made >= 2) break
    // One cut each side.
    if ((share > 0 ? 1 : 2) & side) continue
    const s = s0 + share * length
    const place = pointRound(read, inner, ((s % length) + length) % length)
    if (!place) {
      failed.push('no point round the loop')
      continue
    }
    const a = w.splitAt(place.curve, place.at)
    if (!marchCut(w, read, region, bends, a, grid, outerPts, () => w.curves.filter((c) => outerIds.has(c.id)), failed, 'the loops touch there')) continue
    made++
    side |= share > 0 ? 1 : 2
  }
  if (made < 2) {
    w.nodes = before.nodes
    w.curves = before.curves
    w.chosen = before.chosen
    w.cuts = before.cuts
  }
  if (made < 2) return { why: `${loops.length} loops of curves round it, and ${made === 0 ? 'no cut' : 'only one cut'} from one to another stays inside it (${failed.join('; ')})` }
  return made
}

/** A cut from node a to the nearest of `goals`, the points of the curves
 *  in `grid`: marched along the scan's principal lines (networkClose.ts)
 *  to the first of them it meets, or where the march does not meet one
 *  inside the region, a straight section to the nearest of `fallback`'s
 *  curves. Made — a tangent curve, both ends chosen corners — if it keeps
 *  to the region and joins two nodes no curve joins; else why not, in
 *  `failed`. */
function marchCut(w: Work, read: Read, region: ScanRegion, bends: Bends, a: number, grid: TraceGrid, goals: readonly Vec3[], fallback: () => NetworkCurve[], failed: string[], touching: string, isTarget?: (curve: number) => boolean): boolean {
  const pa = w.at(a)
  // The nearest goal: where the cut heads.
  let goal: Vec3 | null = null
  let gd = Infinity
  for (const q of goals) {
    const d = dist(q, pa)
    if (d < gd) [gd, goal] = [d, q]
  }
  if (!goal) {
    failed.push('no other loop')
    return false
  }
  const target = goal as Vec3
  const step = marchStep(w.scan)
  // With `isTarget`, the grid holds every curve: the march stops at the
  // first it meets past its start, and one not a target ends the try — a
  // cut across another curve would cross it.
  const away = (at: Vec3) => !isTarget || dist(at, pa) > 2 * step
  const m = march(w.scan, bends, pa, [target[0] - pa[0], target[1] - pa[1], target[2] - pa[2]], 3 * gd + 4 * step, (p) => grid.nearest(p, 1.5 * step, (_, at) => away(at)), target)
  let to = -1
  let via: Vec3[] = []
  if (m.hit && isTarget && !isTarget(m.hit.curve)) {
    failed.push('the march met another curve first')
    return false
  }
  if (m.hit) {
    const flat = m.points.flatMap((p) => [p[0], p[1], p[2]])
    if (insideShare(w, read, region, flat) >= CUT_INSIDE) {
      to = w.splitAt(m.hit.curve, m.hit.at)
      via = gripsOf(m.points, w.at(to))
    } else failed.push('the march left it')
  } else failed.push(m.why ?? 'the march met nothing')
  if (to < 0) {
    const nearest = fallback().sort((x, y) => w.nearestOn(x, target)!.d - w.nearestOn(y, target)!.d)[0]
    if (!nearest) {
      failed.push('no curve of the other loop')
      return false
    }
    to = w.splitAt(nearest.id, target)
    const straight = traceCurve(w.scan, [pa, w.at(to)])
    const share = insideShare(w, read, region, straight.points)
    if (share < CUT_INSIDE) {
      failed.push(`a straight cut ${Math.round(share * 100)} % inside it`)
      return false
    }
    if (isTarget) {
      const end = w.at(to)
      const p = straight.points
      for (let i = 0; i + 2 < p.length; i += 3) {
        const q: Vec3 = [p[i], p[i + 1], p[i + 2]]
        if (dist(q, pa) <= 2 * step || dist(q, end) <= 2 * step) continue
        const hit = grid.nearest(q, step, () => true)
        if (hit && !isTarget(hit.curve)) {
          failed.push('a straight cut crosses another curve')
          return false
        }
      }
    }
  }
  if (to === a || w.curves.some((c) => (c.from === a && c.to === to) || (c.from === to && c.to === a))) {
    failed.push(to === a ? touching : 'a curve already joins them there')
    return false
  }
  w.curve(a, to, via, false)
  w.cuts++
  w.chosen.add(a)
  w.chosen.add(to)
  return true
}

/** What the bridge passes did (see unbridge). */
export interface Bridging {
  /** Curves let go as a second trace of another: the same two nodes, the
   *  traces within DUPLICATE_EDGES mean edges of each other. */
  duplicates: number
  /** Curves found with one region on both sides. */
  found: number
  /** Bridges given a second cut. */
  cut: number
  /** Let go — with `bridges: 'drop'`, every one; else a loop round
   *  nothing, a curve whose faces do not run round it both ways, or a
   *  bridge no second cut stays inside the region beside. */
  dropped: number
  /** Knots let go: a bridge with the small tangle of creases it hangs. */
  knots: number
  /** Curves let go with the knots. */
  knotCurves: number
  passes: number
}

/** A half-edge's key. */
const halfKey = (h: HalfEdge) => `${h.curve}${h.forward ? '+' : '-'}`

/** The farthest any point of trace a is from trace b, either way. */
function traceApart(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const one = (p: ArrayLike<number>, q: ArrayLike<number>) => {
    let worst = 0
    for (let i = 0; i < p.length; i += 3) {
      let d = Infinity
      for (let j = 0; j < q.length && d > worst; j += 3) d = Math.min(d, Math.hypot(p[i] - q[j], p[i + 1] - q[j + 1], p[i + 2] - q[j + 2]))
      worst = Math.max(worst, d)
    }
    return worst
  }
  return Math.max(one(a, b), one(b, a))
}

/** One pass over the curves that separate nothing (see autoLayout): a
 *  second trace of a curve let go; then of the curves the same region lies
 *  both sides of, as the scan's labels read them, a loop let go, a knot let
 *  go with its bridge, and each other bridge whose island no other this
 *  pass reaches given its second cut — or, with `mode` 'drop', let go.
 *  Whether anything changed. */
function unbridge(w: Work, read: Read, bends: Bends, mode: 'cut' | 'drop', tally: Bridging): boolean {
  const byId = new Map(read.traced.curves.map((c) => [c.id, c]))
  const lenOf = (id: number) => byId.get(id)?.trace.length ?? 0
  const crease = new Set(w.curves.filter((c) => c.crease).map((c) => c.id))
  const gone = new Set<number>()
  const since = w.nextId
  // Duplicates: closing can leave two curves along one trace — a march
  // that met a crease at its node, two near ends joined both ways. Of the
  // pair, a crease kept before a tangent curve, the first before the
  // second.
  const tol = DUPLICATE_EDGES * w.scan.edge
  const pairs = new Map<string, number[]>()
  for (const c of read.traced.curves) {
    const k = c.from < c.to ? `${c.from}:${c.to}` : `${c.to}:${c.from}`
    const list = pairs.get(k) ?? []
    list.push(c.id)
    pairs.set(k, list)
  }
  for (const list of pairs.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [x, y] = [list[i], list[j]]
        if (gone.has(x) || gone.has(y)) continue
        if (Math.abs(lenOf(x) - lenOf(y)) > 2 * tol) continue
        if (traceApart(byId.get(x)!.trace.points, byId.get(y)!.trace.points) > tol) continue
        gone.add(crease.has(x) && !crease.has(y) ? y : x)
        tally.duplicates++
      }
    }
  }
  // The curves the same region lies both sides of.
  const sides = curveSides(w.scan, read.traced.curves, read.label, read.regions)
  const found = read.traced.curves.filter((c) => {
    const s = sides.get(c.id)
    return !gone.has(c.id) && s !== undefined && s.left >= 0 && s.left === s.right && s.votes >= 2
  })
  tally.found += found.length
  const isBridge = new Set(found.map((c) => c.id))
  const faceOf = new Map<string, number>()
  read.faces.forEach((f, i) => f.edges.forEach((h) => faceOf.set(halfKey(h), i)))
  // The curves at each node, for the islands.
  const at = new Map<number, number[]>()
  for (const c of read.traced.curves) {
    if (gone.has(c.id)) continue
    for (const n of [c.from, c.to]) {
      const list = at.get(n) ?? []
      list.push(c.id)
      at.set(n, list)
    }
  }
  /** The curves reached from a node without crossing one curve, their
   *  length, and whether the other node was reached. */
  const reach = (from: number, without: number, other: number): { curves: Set<number>; length: number; joined: boolean } => {
    const curves = new Set<number>()
    const seen = new Set([from])
    const queue = [from]
    let joined = false
    while (queue.length > 0) {
      const n = queue.pop()!
      if (n === other) joined = true
      for (const id of at.get(n) ?? []) {
        if (id === without || curves.has(id)) continue
        curves.add(id)
        const c = byId.get(id)!
        for (const m of [c.from, c.to]) if (!seen.has(m)) (seen.add(m), queue.push(m))
      }
    }
    return { curves, length: [...curves].reduce((s, id) => s + lenOf(id), 0), joined }
  }
  // Each: its island — the smaller side, by its curves' length — and the
  // node it hangs from; the smallest first.
  const plans = found.map((c) => {
    if (c.from === c.to) return { c, island: null, hang: c.from, size: 0 }
    const one = reach(c.from, c.id, c.to)
    if (one.joined) return { c, island: null, hang: c.from, size: 0 }
    const two = reach(c.to, c.id, c.from)
    return one.length <= two.length ? { c, island: one, hang: c.from, size: one.length } : { c, island: two, hang: c.to, size: two.length }
  })
  plans.sort((a, b) => a.size - b.size)
  const step = marchStep(w.scan)
  // The curves an island or bridge this pass has taken in, and the cuts
  // made, which a later march may end on.
  const used = new Set<number>()
  const made = new Set<number>()
  let changed = gone.size > 0
  const letGo = (id: number) => {
    gone.add(id)
    tally.dropped++
    changed = true
  }
  for (const p of plans) {
    const id = p.c.id
    if (gone.has(id) || used.has(id) || (p.island && [...p.island.curves].some((x) => used.has(x) || gone.has(x)))) continue
    used.add(id)
    for (const x of p.island?.curves ?? []) used.add(x)
    // A loop round nothing, a curve whose two ends join without it (round
    // a handle of the part), or — `mode` 'drop' — every bridge: let go,
    // its island a loop of its own in the region.
    if (!p.island || mode === 'drop') {
      letGo(id)
      continue
    }
    // A knot: the island and all that hangs from it, under KNOT_MM of
    // curve — a tangle of short creases round a scan's blemish, too small
    // for a patch — let go with its bridge.
    if (p.island.length < KNOT_MM) {
      gone.add(id)
      for (const x of p.island.curves) gone.add(x)
      tally.knots++
      tally.knotCurves += p.island.curves.size
      changed = true
      continue
    }
    // The second cut, along the face the bridge is run both ways round:
    // from the island's side of the walk — its own curves, not a bridge — a
    // quarter of the way round from where it hangs, else three quarters or
    // half; to the nearest point of the walk's other side.
    const f = faceOf.get(`${id}+`)
    const region = read.regions[sides.get(id)!.left]
    if (f === undefined || f !== faceOf.get(`${id}-`) || !region) {
      letGo(id)
      continue
    }
    const face = read.faces[f]
    const m = face.edges.length
    const i1 = face.edges.findIndex((h) => h.curve === id)
    const i2 = face.edges.map((h) => h.curve).lastIndexOf(id)
    const inner: number[] = []
    for (let k = i1 + 1; k < i2; k++) inner.push(k)
    const outer: number[] = []
    for (let k = (i2 + 1) % m; k !== i1; k = (k + 1) % m) outer.push(k)
    const [own, rest] = face.nodes[i1] === p.hang ? [inner, outer] : face.nodes[i2] === p.hang ? [outer, inner] : [null, null]
    if (!own || !rest) {
      letGo(id)
      continue
    }
    const loop = own.map((k) => face.edges[k]).filter((h) => !isBridge.has(h.curve) && !gone.has(h.curve))
    const loopLength = loop.reduce((s, h) => s + lenOf(h.curve), 0)
    const targets = new Set(rest.map((k) => face.edges[k].curve).filter((x) => x !== id && !gone.has(x)))
    const isTarget = (x: number) => w.from(x, targets, since) || w.from(x, made, since)
    const grid = new TraceGrid(1.5 * step)
    const goals: Vec3[] = []
    for (const x of w.curves) {
      const pts = w.traceOf(x).points
      grid.add(x.id, pts)
      if (!isTarget(x.id)) continue
      for (let i = 0; i < pts.length; i += 3) goals.push([pts[i], pts[i + 1], pts[i + 2]])
    }
    const failed: string[] = []
    let done = false
    for (const share of loopLength > 0 ? [1 / 4, 3 / 4, 1 / 2] : []) {
      const place = pointAlong(read, loop, share * loopLength)
      if (!place) continue
      const a = w.splitAt(place.curve, place.at)
      const fallback = () => w.curves.filter((x) => w.from(x.id, targets, since))
      if (marchCut(w, read, region, bends, a, grid, goals, fallback, failed, 'the island touches the rest there', isTarget)) {
        made.add(w.curves[w.curves.length - 1].id)
        done = true
        break
      }
    }
    if (done) {
      tally.cut++
      changed = true
    } else {
      letGo(id)
    }
  }
  if (gone.size === 0) return changed
  w.curves = w.curves.filter((c) => !w.from(c.id, gone, since))
  for (;;) {
    const count = new Map<number, number>()
    for (const c of w.curves) for (const n of [c.from, c.to]) count.set(n, (count.get(n) ?? 0) + (c.from === c.to ? 2 : 1))
    const loose = w.curves.filter((c) => count.get(c.from) === 1 || count.get(c.to) === 1)
    if (loose.length === 0) break
    const drop = new Set(loose.map((c) => c.id))
    w.curves = w.curves.filter((c) => !drop.has(c.id))
  }
  const usedNodes = new Set(w.curves.flatMap((c) => [c.from, c.to]))
  w.nodes = w.nodes.filter((n) => usedNodes.has(n.id))
  for (const n of [...w.chosen]) if (!usedNodes.has(n)) w.chosen.delete(n)
  return true
}

/** The point an arc length along a run of half-edges, and the curve it is
 *  on. */
function pointAlong(read: Read, edges: readonly HalfEdge[], s: number): { at: Vec3; curve: number } | null {
  return pointRound(read, { edges: edges.slice(), nodes: [] }, s)
}

/** What layRounds did, over the layout. */
export interface RoundsLaid {
  regions: number
  faces: number
  curves: number
  /** Of the curves, those along a sharp edge Suggest creases found. */
  creases: number
  /** The whole part laid out from its faces, its creases let go. */
  whole: boolean
  ms: number
}

/** Tangent curves down the middles of a region's rounds (networkRounds.ts):
 *  a node where three faces meet, a line where two do a curve, gripped
 *  every ROUND_GRIP_MM along it; a line that reaches the region's boundary
 *  ends on the curve there, split; two junctions a short line apart are
 *  one node. The curves made. */
function layRounds(w: Work, region: ScanRegion, tally: RoundsLaid, onCrease?: (points: readonly Vec3[]) => boolean): number {
  const r = roundMiddles(w.scan, region.triangles)
  tally.ms += r.ms
  if (r.faces < 2 || r.chains.length === 0) return 0
  const scan = w.scan
  const lengthOf = (p: readonly Vec3[]) => p.reduce((s, q, i) => (i === 0 ? 0 : s + dist(q, p[i - 1])), 0)
  const short = Math.max(ROUND_SHORT_MM, ROUND_SHORT_EDGES * scan.edge)
  // Junctions a short line apart are one.
  const parent = r.junctions.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (const c of r.chains) {
    if (c.from && c.to && 'junction' in c.from && 'junction' in c.to && lengthOf(c.points) < short) parent[find(c.from.junction)] = find(c.to.junction)
  }
  // The curves round the region as they stand, for the lines' ends on it.
  const step = marchStep(scan)
  const grid = new TraceGrid(Math.max(step, 2 * scan.edge))
  for (const c of w.curves) grid.add(c.id, w.traceOf(c).points)
  const reach = Math.min(4 * NODE_EDGES * scan.edge, Math.max(step, 2 * scan.edge))
  const nodeOf = new Map<number, number>()
  const onScan = (p: Vec3): Vec3 => {
    const q = scan.closest(p)
    return q ? [q.point[0], q.point[1], q.point[2]] : p
  }
  const junction = (j: number): number => {
    const root = find(j)
    let id = nodeOf.get(root)
    if (id === undefined) {
      const members = r.junctions.filter((_, i) => find(i) === root)
      const c: Vec3 = [0, 0, 0]
      for (const m of members) for (let k = 0; k < 3; k++) c[k] += m[k] / members.length
      id = w.node(onScan(c))
      nodeOf.set(root, id)
    }
    return id
  }
  const border = (p: Vec3): number => {
    let hit = grid.nearest(p, reach, () => true)
    // Past the grid's reach, the nearest of every curve's points.
    if (!hit) {
      let best: { curve: number; at: Vec3; d: number } | null = null
      for (const c of w.curves) {
        const q = w.nearestOn(c, p)
        if (q && q.d < 4 * reach && (!best || q.d < best.d)) best = { curve: c.id, at: q.at, d: q.d }
      }
      hit = best
    }
    if (!hit) return -1
    return w.splitAt(hit.curve, hit.at)
  }
  const endOf = (e: { junction: number } | { border: Vec3 }): number => ('junction' in e ? junction(e.junction) : border(e.border))
  // A junction a short line from the boundary is a node on it.
  for (const c of r.chains) {
    if (!c.from || !c.to || lengthOf(c.points) >= short) continue
    const [j, b] = 'junction' in c.from && 'border' in c.to ? [c.from.junction, c.to.border] : 'junction' in c.to && 'border' in c.from ? [c.to.junction, c.from.border] : [-1, null]
    if (j < 0 || !b || nodeOf.has(find(j))) continue
    const id = border(b)
    if (id >= 0) nodeOf.set(find(j), id)
  }
  let made = 0
  for (const c of r.chains) {
    const length = lengthOf(c.points)
    if (length < short) continue
    let a: number
    let b: number
    if (!c.from || !c.to) {
      // A loop: a node on it, the curve round from it.
      if (c.from || c.to || length < 4 * short) continue
      a = b = w.node(onScan(c.points[0]))
    } else {
      a = endOf(c.from)
      b = endOf(c.to)
      if (a < 0 || b < 0 || a === b) continue
    }
    // Grips every ROUND_GRIP_MM along the line, short of its ends.
    const via: Vec3[] = []
    const every = Math.max(ROUND_GRIP_MM, 4 * step)
    let next = every
    let s = 0
    for (let i = 1; i < c.points.length; i++) {
      s += dist(c.points[i], c.points[i - 1])
      if (s >= next && length - s > every / 2) {
        via.push(onScan(c.points[i]))
        next = s + every
      }
    }
    if (a === b && via.length < 2) continue
    const crease = onCrease?.(c.points) ?? false
    w.curve(a, b, via, crease)
    if (crease) tally.creases++
    made++
  }
  pruneLoose(w)
  tally.regions++
  tally.faces += r.faces
  tally.curves += made
  return made
}

/** Curves with an end no other curve reaches let go, and those that then
 *  are; the nodes no curve reaches gone. */
function pruneLoose(w: Work): void {
  for (;;) {
    const count = new Map<number, number>()
    for (const c of w.curves) for (const n of [c.from, c.to]) count.set(n, (count.get(n) ?? 0) + (c.from === c.to ? 2 : 1))
    const loose = w.curves.filter((c) => count.get(c.from) === 1 || count.get(c.to) === 1)
    if (loose.length === 0) break
    const drop = new Set(loose.map((c) => c.id))
    w.curves = w.curves.filter((c) => !drop.has(c.id))
  }
  const used = new Set(w.curves.flatMap((c) => [c.from, c.to]))
  w.nodes = w.nodes.filter((n) => used.has(n.id))
  for (const n of [...w.chosen]) if (!used.has(n)) w.chosen.delete(n)
}

/** A large region of three loops or more one of which meets its longest
 *  at a node — the graph pinched there, so no two cuts from loop to loop
 *  are needed: one cut along the scan inside it, from that loop's node
 *  farthest from where they meet to the longest loop's nearest node,
 *  splits it in two. Whether one was made. */
function pinchCut(w: Work, read: Read, region: ScanRegion): boolean {
  const loops = region.faces.map((f) => read.faces[f])
  const len = new Map(read.traced.curves.map((c) => [c.id, c.trace.length]))
  const lengthOf = (f: GraphFace) => f.edges.reduce((s, h) => s + (len.get(h.curve) ?? 0), 0)
  const outer = loops.reduce((a, b) => (lengthOf(b) > lengthOf(a) ? b : a))
  const outerNodes = [...new Set(outer.nodes)]
  for (const f of loops) {
    if (f === outer) continue
    const own = [...new Set(f.nodes)]
    const shared = own.filter((n) => outerNodes.includes(n))
    if (shared.length === 0) continue
    // The loop's node farthest from where it meets the longest.
    const far = own.filter((n) => !shared.includes(n)).sort((a, b) => Math.min(...shared.map((m) => dist(w.at(b), w.at(m)))) - Math.min(...shared.map((m) => dist(w.at(a), w.at(m)))))
    for (const a of far.slice(0, 2)) {
      const targets = outerNodes.filter((n) => !own.includes(n)).sort((x, y) => dist(w.at(x), w.at(a)) - dist(w.at(y), w.at(a)))
      for (const b of targets.slice(0, 2)) if (tryCut(w, read, region, a, b, true)) return true
    }
  }
  return false
}

/** A node at the middle of a three-cornered face's longest side, chosen a
 *  corner with the three; whether one was put there. */
function fourthCorner(w: Work, read: Read, face: GraphFace, corners: readonly number[]): boolean {
  const { at, length } = loopLengths(read, face)
  if (!(length > 0)) return false
  const s = corners.map((n) => at.get(n) ?? 0).sort((a, b) => a - b)
  let best = -1
  let bestL = 0
  for (let i = 0; i < s.length; i++) {
    const l = ((i + 1 < s.length ? s[i + 1] : s[0] + length) - s[i])
    if (l > bestL) [bestL, best] = [l, i]
  }
  if (best < 0) return false
  const place = pointRound(read, face, (s[best] + bestL / 2) % length)
  if (!place) return false
  const id = w.splitAt(place.curve, place.at)
  if (corners.includes(id)) return false
  for (const n of corners) w.chosen.add(n)
  w.chosen.add(id)
  return true
}

/** The length of the area-weighted mean of the triangles' normals: 1 on a
 *  flat, less the further the surface turns. */
function flatness(scan: ScanPaths, triangles: ArrayLike<number>): number {
  const p = scan.positions
  const idx = scan.indices
  let x = 0
  let y = 0
  let z = 0
  let area = 0
  for (let k = 0; k < triangles.length; k++) {
    const t = triangles[k]
    const a = idx[t * 3] * 3
    const b = idx[t * 3 + 1] * 3
    const c = idx[t * 3 + 2] * 3
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
    const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
    // The cross product is the normal times twice the area.
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    x += n[0]
    y += n[1]
    z += n[2]
    area += Math.hypot(n[0], n[1], n[2])
  }
  return area > 0 ? Math.hypot(x, y, z) / area : 1
}

/** A four-cornered face cut between the middles of its two longer
 *  opposite sides, straight or along the scan; whether it was. */
function acrossBend(w: Work, read: Read, region: ScanRegion, face: GraphFace, corners: readonly number[]): boolean {
  const { at, length } = loopLengths(read, face)
  if (!(length > 0) || corners.length !== 4) return false
  const s = corners.map((n) => at.get(n) ?? 0).sort((a, b) => a - b)
  const side = (i: number) => ({ from: s[i], len: (i + 1 < 4 ? s[i + 1] : s[0] + length) - s[i] })
  const sides = [0, 1, 2, 3].map(side)
  // The pair of opposite sides the longer together.
  const k = sides[0].len + sides[2].len >= sides[1].len + sides[3].len ? 0 : 1
  const mids = [sides[k], sides[k + 2]].map((x) => pointRound(read, face, (x.from + x.len / 2) % length))
  if (!mids[0] || !mids[1]) return false
  const a = w.splitAt(mids[0].curve, mids[0].at)
  const b = w.splitAt(mids[1].curve, mids[1].at)
  if (a === b || corners.includes(a) || corners.includes(b)) return false
  if (!(tryCut(w, read, region, a, b) || tryCut(w, read, region, a, b, true))) return false
  for (const n of corners) w.chosen.add(n)
  return true
}
