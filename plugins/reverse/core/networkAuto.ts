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
// Each round places what the last read asked for and reads the scan
// again; a region whose cut runs out of it, a region of three loops or
// more, or one bounded by the scan's own rim (an open scan: no curve is
// drawn along a rim yet) is left out and said why. Last, a node only two
// smooth curves of a kind run through, and no cell's corner — a crease
// cut in four where nothing meets it — is made a grip of one curve. The
// cells are checked as the build reads and maps them, and those of three,
// five or six sides are split from their centres into four-sided patches
// by the network itself (networkSplit.ts).
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
import { traceNetwork, type TracedNetwork } from './network'
import { CORNER_DEG, faceSides, type GraphFace, readCells, regionSeed, type ScanRegion, scanRegions, SIDES_MAX, SIDES_MIN } from './networkCells'
import { suggestCreases } from './networkCreases'
import { type CurveTrace, endTangent, traceCurve } from './networkCurve'
import { cellMesh } from './networkMap'
import { Bends, type Closing, closeCreases, type ClosingWork, gripsOf, march, marchStep, TraceGrid } from './networkClose'

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
   *  cells; box: laid out as a box; left: not laid out (why). */
  action: 'cell' | 'corners' | 'cut' | 'box' | 'left'
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
  /** The tangent curves cut across regions, and the box's curves. */
  cuts: number
  regions: AutoRegion[]
  made: AutoCell[]
  /** The regions at the end that are no cell, and why. */
  left: { at: Vec3; why: string }[]
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
const ROUNDS = 14
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

  at(id: number): Vec3 {
    return this.nodes.find((n) => n.id === id)!.at
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
  // A region is known by its first triangle and its size: one the creases
  // left is reported once, as found, with what was done with it.
  const keyOf = (r: ScanRegion) => `${r.triangles[0]}:${r.triangles.length}`
  const first = new Set(read.regions.map(keyOf))
  const reported = new Set<string>()
  // Why a region was last left, by a triangle of it: what the end says of
  // the region that triangle is in then.
  const lastWhy = new Map<number, string>()
  for (; rounds < ROUNDS; rounds++) {
    let changed = false
    let ringCut = false
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
      if (region.faces.length === 0) {
        if (region.curveEdges > 0) {
          entry('loops', 'left', { why: TANGLED_WHY })
          continue
        }
        if (region.rimEdges > 0) {
          entry('open', 'left', { why: OPEN_WHY })
          continue
        }
        if (layBox(w, region)) {
          entry('closed', 'box', { cuts: 12 })
          changed = true
        } else entry('closed', 'left', { why: 'laid out as a box, a ray from its middle left it nowhere — it is not round its middle' })
        continue
      }
      if (region.faces.length === 1) {
        const face = read.faces[region.faces[0]]
        const did = disk(w, read, face, region)
        if (did === 'cell') entry('disk', 'cell')
        else if (did === 'corners') {
          entry('disk', 'corners')
          changed = true
        } else if (did === 'cut') {
          entry('disk', 'cut', { cuts: 1 })
          changed = true
        } else entry('disk', 'left', { why: did.why })
        continue
      }
      if (region.faces.length === 2) {
        const did = ring(w, read, region)
        if (typeof did === 'number') {
          entry('ring', 'cut', { cuts: did })
          changed = true
          ringCut = true
        } else entry('ring', 'left', { why: did.why })
        continue
      }
      const did = multiLoop(w, read, region, bends)
      if (typeof did === 'number') {
        entry('loops', 'cut', { cuts: did })
        changed = true
      } else entry('loops', 'left', { why: did.why })
    }
    if (!changed) break
    read = w.read()
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
  return {
    nodes: w.nodes.map((n) => ({ ...n, at: round6(n.at) })),
    curves: w.curves.map((c) => ({ ...c, via: c.via.map(round6) })),
    cells: out,
    nextId: w.nextId,
    creases,
    creasesDropped,
    closing,
    untangled,
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
function disk(w: Work, read: Read, face: GraphFace, region: ScanRegion): 'cell' | 'corners' | 'cut' | { why: string } {
  const rule = faceSides(face, read.traced.nodes, read.traced.curves)
  if (!('corners' in rule) && !rule.message.startsWith('one side')) return { why: rule.message }
  const corners = cornersOf(w, read, face)
  const count = corners?.list.length ?? 0
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
  return { why: `${n} corners, and no cut between two of them stays inside it` }
}

/** The region's index in the read. */
function regionIndex(read: Read, region: ScanRegion): number {
  return read.label[region.triangles[0]]
}

/** A tangent curve from node a to node b, kept if its trace keeps to the
 *  region. */
function tryCut(w: Work, read: Read, region: ScanRegion, a: number, b: number): boolean {
  if (a === b) return false
  if (w.curves.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))) return false
  const trace = traceCurve(w.scan, [w.at(a), w.at(b)])
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
  w.curve(a, b, [], false)
  w.cuts++
  return true
}

/** A ring cut across from each corner of one loop to the other: the
 *  cuts made, or why none. */
function ring(w: Work, read: Read, region: ScanRegion): number | { why: string } {
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
    if (tryCut(w, read, region, a, target)) {
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
    const pa = w.at(a)
    // The outer loop's point nearest the start: where the cut heads.
    let goal: Vec3 | null = null
    let gd = Infinity
    for (const q of outerPts) {
      const d = dist(q, pa)
      if (d < gd) [gd, goal] = [d, q]
    }
    if (!goal) {
      failed.push('no other loop')
      continue
    }
    const target = goal as Vec3
    const m = march(w.scan, bends, pa, [target[0] - pa[0], target[1] - pa[1], target[2] - pa[2]], 3 * gd + 4 * marchStep(w.scan), (p) => grid.nearest(p, 1.5 * marchStep(w.scan), () => true), target)
    let to = -1
    let via: Vec3[] = []
    if (m.hit) {
      const flat = m.points.flatMap((p) => [p[0], p[1], p[2]])
      if (insideShare(w, read, region, flat) >= CUT_INSIDE) {
        to = w.splitAt(m.hit.curve, m.hit.at)
        via = gripsOf(m.points, w.at(to))
      } else failed.push('the march left it')
    } else failed.push(m.why ?? 'the march met nothing')
    if (to < 0) {
      const outerCurve = w.curves.filter((c) => outerIds.has(c.id)).sort((x, y) => w.nearestOn(x, target)!.d - w.nearestOn(y, target)!.d)[0]
      if (!outerCurve) {
        failed.push('no curve of the other loop')
        continue
      }
      to = w.splitAt(outerCurve.id, target)
      const straight = traceCurve(w.scan, [pa, w.at(to)])
      const share = insideShare(w, read, region, straight.points)
      if (share < CUT_INSIDE) {
        failed.push(`a straight cut ${Math.round(share * 100)} % inside it`)
        continue
      }
    }
    if (to === a || w.curves.some((c) => (c.from === a && c.to === to) || (c.from === to && c.to === a))) {
      failed.push(to === a ? 'the loops touch there' : 'a curve already joins them there')
      continue
    }
    w.curve(a, to, via, false)
    w.cuts++
    w.chosen.add(a)
    w.chosen.add(to)
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
