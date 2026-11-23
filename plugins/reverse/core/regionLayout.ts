// SPDX-License-Identifier: AGPL-3.0-only
// A patch network laid out over a region of the scan (regionMesh.ts) so that
// it closes. The automatic layout of a whole part (networkAuto.ts) goes by
// the part's creases, and closes where they do; a region without a tidy
// crease graph — a moulded arm, a tooth, a blob — is laid out by its shape
// alone:
//
// - The region runs from one end to another: from its largest rim to the
//   rim furthest from it, or, with one rim, to a pole — the middle of its far
//   end — or, with none, between two poles. Between them it is a tube,
//   mapped onto a cylinder one to one (regionTube.ts).
// - Lines along (θ constant), four or eight, and rings across (H constant)
//   cut the tube into four-sided cells. A pole's last ring is the edge of
//   one four-sided patch over it (four, round a node, in a ring of eight),
//   drawn a little square, so that its corners turn. A ring goes where the
//   surface folds across the tube's length — the edge of a flat end — as a
//   crease; the rest are spread so that a cell is about as long as it is
//   wide. The lines are turned to lie along the folds that run the length of
//   the tube, where it has them.
// - Each rim is a crease, its skirt a band of cells and its cap one or four.
// - A branch — an arm off the side of a channel, a boss on a cheek — comes
//   out squeezed into a speck of the cell it stands in. Such a cell is laid
//   out again as a tube of its own, from its own four sides to a pole in the
//   branch: its sides and corners stay, so its neighbours do not change. A
//   cell of that squeezed still is laid out again in turn.
//
// Every curve is between two cells, so the network closes by its
// construction; how well the patches follow the scan is the fit's to say.
// Only a ball is laid out so (genus 0): a region with a handle through it is
// refused.

import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import type { NetworkFeature, NetworkNode } from './features'
import type { CellOutcome, NetworkReading } from './network'
import { fitProvisional } from './networkCurve'
import { fitNetwork, type PatchInput } from './networkFit'
import { type CellMap, type CellMesh, cellMesh, mapCell } from './networkMap'
import { pointAtUv } from './networkSplit'
import { OF_CAP, type RegionMesh, type RegionRim } from './regionMesh'
import { area, at3, dist, edgeKey, nearTurn, peakFrom, Places, type Tube, tubeBetween, without } from './regionTube'

export interface RegionLayout {
  nodes: NetworkNode[]
  curves: LaidCurve[]
  cells: LaidCell[]
  /** Bands of cells along the region, and the folds among their rings. */
  bands: number
  folds: number
  lines: number
  /** Cells laid out again as tubes of their own. */
  branches: number
}

/** A curve as the run of points it was drawn through. */
export interface LaidCurve {
  id: number
  from: number
  to: number
  points: Vec3[]
  crease: boolean
}

/** A cell: its corners and sides with it on the left, and its points with
 *  where they lie on its square. */
export interface LaidCell {
  seed: Vec3
  corners: number[]
  /** Each side's curve, and whether forwards. */
  sides: [number, boolean][]
  xyz: Float64Array
  uv: Float64Array
}

export interface RegionLayoutOptions {
  /** How many cells along for each one the shape asks for (1). */
  density?: number
  /** How many lines along (4). */
  lines?: 4 | 8
}

/** The samples of the (θ, H) map the layout is read from. */
const ROUND = 96
const ALONG = 160
/** A fold: the surface turns by more than this across a ring (or a line)
 *  over a few samples, on the average round it, degrees. */
const FOLD_DEG = 28
/** A cell's length against its width: about square. */
const ASPECT = 1.25
const BANDS_MAX = 12
/** The least an end's pole patch takes of the way to the next ring, in the
 *  mesh's edges; and how deep it may be against its ring's radius. */
const POLE_EDGES = 5
const POLE_DEEP = 1.2
/** How square a pole's ring is drawn: each corner's two sides meet at about
 *  120°, what three patches meeting there want. */
const SQUARE = 0.577
/** The points a curve between two nodes is drawn through. */
const RUN = 64
/** A cell is squeezed where SQUEEZED_AREA of its area comes on less than
 *  this much of its square; it is laid out again if it has the triangles,
 *  and no deeper than this. */
const SQUEEZED_AREA = 0.15
const SQUEEZED_SHARE = 0.02
const BRANCH_TRIANGLES = 120
const BRANCH_DEEP = 4

const DEG = 180 / Math.PI

/** The layout, or why there is none. */
export function regionLayout(m: RegionMesh, opts: RegionLayoutOptions = {}): RegionLayout | string {
  if (m.genus !== 0) return `The region has ${m.genus} handle${m.genus === 1 ? '' : 's'} through it (a hole, a ring): it is laid out from one end to the other, which takes a piece without. Cut it by planes into such pieces.`
  const perCap = new Map<number, number>()
  for (const r of m.rims) perCap.set(r.cap, (perCap.get(r.cap) ?? 0) + 1)
  if ([...perCap.values()].some((n) => n > 1)) return 'A plane cuts the region in one loop inside another (a wall all round a hollow): its cap has a hole. Cut it where it is in one loop.'
  const p = m.positions
  const rims = [...m.rims].sort((a, b) => loopLength(p, b.loop) - loopLength(p, a.loop))
  const base = rims[0] ?? null
  const end = rims.length > 1 ? rims.slice(1).reduce((a, b) => (apart(m, base!, b) > apart(m, base!, a) ? b : a)) : null
  // The triangles between: all but the two ends' skirts and caps. A third
  // rim's are surface like the rest.
  const gone = new Set<number>([...(base ? [base.cap] : []), ...(end ? [end.cap] : [])])
  let triangles: number[] = []
  for (let t = 0; t < m.of.length; t++) if (m.cap[t] < 0 || !gone.has(m.cap[t])) triangles.push(m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2])
  const pole = (at: number) => {
    const cut = without(triangles, at)
    triangles = cut.rest
    return { pole: at, cut: cut.cut, ring: cut.ring }
  }
  let low: End
  let high: End
  if (base) {
    low = { rim: base, ring: base.loop }
    high = end ? { rim: end, ring: end.loop } : pole(peakFrom(p, triangles, base.loop))
  } else {
    const a = peakFrom(p, triangles, [peakFrom(p, triangles, [triangles[0]])])
    const b = peakFrom(p, triangles, [a])
    low = pole(a)
    high = pole(b)
  }
  const tube = tubeBetween(p, triangles, low.ring, high.ring)
  if (typeof tube === 'string') return tube
  return new Drawing(m, opts).whole(tube, low, high)
}

/** An end of a tube: a rim of the region, a pole with its ring of triangles
 *  cut out — or, of a cell laid out again, its own sides. */
interface End {
  ring: number[]
  rim?: RegionRim
  pole?: number
  cut?: number[]
  given?: { nodes: number[]; sides: [number, boolean][]; lines: number[] }
}

function loopLength(p: ArrayLike<number>, loop: readonly number[]): number {
  let s = 0
  for (let i = 0; i < loop.length; i++) s += dist(at3(p, loop[i]), at3(p, loop[(i + 1) % loop.length]))
  return s
}

function middle(p: ArrayLike<number>, loop: readonly number[]): Vec3 {
  const c: Vec3 = [0, 0, 0]
  for (const v of loop) for (let k = 0; k < 3; k++) c[k] += p[v * 3 + k] / loop.length
  return c
}

const apart = (m: RegionMesh, a: RegionRim, b: RegionRim) => dist(middle(m.positions, a.loop), middle(m.positions, b.loop))

/** A ring of the layout: which row of the sample it lies on, whether the
 *  surface folds there, and how H runs along it. */
interface Ring {
  row: number
  fold: boolean
  /** Drawn square, its corners out from the pole: −1 down, +1 up, 0 not. */
  square: number
}

/** A cell not yet mapped: its triangles, and the tube's own (u, v) for a
 *  vertex, where it is of a tube. */
interface RawCell {
  seed: Vec3
  corners: number[]
  sides: [number, boolean][]
  triangles: Uint32Array
  uv?: (v: number) => [number, number]
}

class Drawing {
  private readonly nodes: NetworkNode[] = []
  private readonly curves: LaidCurve[] = []
  private readonly cells: LaidCell[] = []
  private readonly placeOf = new Map<number, Vec3>()
  private readonly p: Float32Array
  private id = 1
  private branches = 0

  constructor(
    private readonly m: RegionMesh,
    private readonly opts: RegionLayoutOptions,
  ) {
    this.p = m.positions
  }

  private node(at: Vec3): number {
    this.nodes.push({ id: this.id, at: [...at] })
    this.placeOf.set(this.id, [...at])
    return this.id++
  }

  private curve(from: number, to: number, points: Vec3[], crease: boolean): number {
    this.curves.push({ id: this.id, from, to, points, crease })
    return this.id++
  }

  whole(t: Tube, low: End, high: End): RegionLayout | string {
    const laid = this.tube(t, low, high, this.opts.lines ?? 4, 0)
    if (typeof laid === 'string') return laid
    return { nodes: this.nodes, curves: this.curves, cells: this.cells, ...laid, lines: this.opts.lines ?? 4, branches: this.branches }
  }

  /** A tube's curves and cells drawn, and its ends closed; or why not. */
  private tube(t: Tube, low: End, high: End, L: number, deep: number): Pick<RegionLayout, 'bands' | 'folds'> | string {
    const places = new Places(t)
    const grid = sampled(places, t.top)
    if (!grid) return 'The region does not map onto a tube: it is cut into pieces, or folds through itself.'
    const p = this.p
    const rings = ringsAlong(grid, t, low, high, this.opts.density ?? 1)
    if (!rings) return 'The region is too small for its points to be laid out.'
    const last = rings.length - 1
    const lines = low.given?.lines ?? linesAlong(grid, rings.map((r) => Math.round(r.row)), L)
    const lineAfter = (k: number) => (k + 1 < L ? lines[k + 1] : lines[0] + 2 * Math.PI)
    // A pole's square has its corners at every line of four, and at the odd
    // ones of eight.
    const squareAt = L === 4 ? lines : [1, 3, 5, 7].map((k) => lines[k])
    /** H of a ring at θ; a pole's own ring stands out at the corners of the
     *  four-sided patch over the pole. */
    const heightOf = (r: Ring, theta: number): number => {
      const own = (t.top * r.row) / ALONG
      if (r.square === 0) return own
      for (let c = 0; c < 4; c++) {
        const a = squareAt[c]
        const b = c < 3 ? squareAt[c + 1] : squareAt[0] + 2 * Math.PI
        const x = nearTurn(theta, (a + b) / 2)
        if (x >= a - 1e-9 && x <= b + 1e-9) return own + r.square * SQUARE * Math.log(1 / Math.cos(((x - a) / (b - a) - 0.5) * (Math.PI / 2)))
      }
      return own
    }
    const endOf = (j: number): End | null => (j === 0 ? low : j === last ? high : null)
    // On a rim the curves run along the mesh's own edges, from vertex to
    // vertex, so that what is cut off there is the skirt exactly.
    const rimCorners = rings.map((_, j) => {
      const rim = endOf(j)?.rim
      if (!rim) return null
      const out: number[] = []
      for (const x of lines) {
        const q = places.at(x, j === 0 ? 0 : t.top)
        let best = -1
        if (q) rim.loop.forEach((v, i) => {
          if (!out.includes(i) && (best < 0 || dist(at3(p, v), q) < dist(at3(p, rim.loop[best]), q))) best = i
        })
        out.push(best)
      }
      return out
    })
    if (rimCorners.some((c, j) => c && (c.includes(-1) || !inOrder(c, endOf(j)!.rim!.loop.length)))) return 'A rim of the region has too few points to take its lines.'
    const ringNodes = rings.map((r, j) => {
      const given = endOf(j)?.given
      if (given) return given.nodes
      const own = rimCorners[j]
      return lines.map((x, k) => this.node(own ? at3(p, endOf(j)!.rim!.loop[own[k]]) : (places.at(x, heightOf(r, x)) ?? grid[Math.round(r.row)][0])))
    })
    const place = (n: number) => this.placeOf.get(n)!
    /** A curve between two nodes through the map's points at `at`. */
    const through = (from: number, to: number, at: (f: number) => [number, number], crease: boolean): number => {
      const pts: Vec3[] = [place(from)]
      for (let i = 1; i < RUN; i++) {
        const q = places.at(...at(i / RUN))
        if (q) pts.push(q)
      }
      return this.curve(from, to, [...pts, place(to)], crease)
    }
    const ringSides = rings.map((r, j): [number, boolean][] => {
      const given = endOf(j)?.given
      if (given) return given.sides
      const own = rimCorners[j]
      return lines.map((x, k) => {
        const from = ringNodes[j][k]
        const to = ringNodes[j][(k + 1) % L]
        if (own) return [this.curve(from, to, runOf(endOf(j)!.rim!.loop, own, k).map((v) => at3(p, v)), true), true]
        return [through(from, to, (f) => [x + (lineAfter(k) - x) * f, heightOf(r, x + (lineAfter(k) - x) * f)], r.fold), true]
      })
    })
    const back = (s: [number, boolean]): [number, boolean] => [s[0], !s[1]]
    const lineCurves = rings.slice(1).map((r, j) =>
      lines.map((x, k) => {
        const lo = heightOf(rings[j], x)
        const hi = heightOf(r, x)
        return through(ringNodes[j][k], ringNodes[j + 1][k], (f) => [x, lo + (hi - lo) * f], alongFold(grid, rings, j, x, t.edge))
      }),
    )

    // The cells: the tube's triangles by where their middles lie.
    const inCell: number[][] = Array.from({ length: last * L }, () => [])
    const inPole: [number[], number[]] = [[], []]
    const thetaOf = new Map<number, number>()
    for (let i = 0; i < t.triangles.length / 3; i++) {
      for (let k = 0; k < 3; k++) thetaOf.set(t.triangles[i * 3 + k], t.theta[i * 3 + k])
      const th = (t.theta[i * 3] + t.theta[i * 3 + 1] + t.theta[i * 3 + 2]) / 3
      const hh = (t.h[t.triangles[i * 3]] + t.h[t.triangles[i * 3 + 1]] + t.h[t.triangles[i * 3 + 2]]) / 3
      const x = th - 2 * Math.PI * Math.floor((th - lines[0]) / (2 * Math.PI))
      let k = L - 1
      while (k > 0 && lines[k] > x) k--
      if (low.pole !== undefined && hh < heightOf(rings[0], th)) inPole[0].push(i)
      else if (high.pole !== undefined && hh >= heightOf(rings[last], th)) inPole[1].push(i)
      else {
        let j = 0
        while (j + 1 < last && hh >= heightOf(rings[j + 1], th)) j++
        inCell[j * L + k].push(i)
      }
    }
    const tri = (list: readonly number[]) => {
      const out = new Uint32Array(list.length * 3)
      list.forEach((i, x) => out.set(t.triangles.subarray(i * 3, i * 3 + 3), x * 3))
      return out
    }
    for (let j = 0; j < last; j++) for (let k = 0; k < L; k++) {
      const k2 = (k + 1) % L
      const a = lines[k]
      const b = lineAfter(k)
      const mid = (a + b) / 2
      this.cell(
        {
          seed: places.at(mid, (heightOf(rings[j], mid) + heightOf(rings[j + 1], mid)) / 2) ?? place(ringNodes[j][k]),
          corners: [ringNodes[j][k], ringNodes[j][k2], ringNodes[j + 1][k2], ringNodes[j + 1][k]],
          sides: [ringSides[j][k], [lineCurves[j][k2], true], back(ringSides[j + 1][k]), [lineCurves[j][k], false]],
          triangles: tri(inCell[j * L + k]),
          uv: (v) => {
            const x = nearTurn(thetaOf.get(v) ?? mid, mid)
            const lo = heightOf(rings[j], x)
            return [(x - a) / (b - a), (t.h[v] - lo) / (heightOf(rings[j + 1], x) - lo || 1)]
          },
        },
        deep,
      )
    }
    for (const j of [0, last]) {
      const e = endOf(j)!
      const onLeft = j === last
      if (e.pole !== undefined) {
        // Its triangles, with the pole's own ring the tube leaves out.
        const said = this.disk(Uint32Array.from([...tri(inPole[onLeft ? 1 : 0]), ...e.cut!]), at3(p, e.pole), ringSides[j], ringNodes[j], onLeft, false, deep)
        if (said) return said
      }
      if (!e.rim) continue
      const said = this.closeRim(e.rim, rimCorners[j]!, ringSides[j], ringNodes[j], onLeft)
      if (said) return said
    }
    return { bands: last, folds: rings.filter((r) => r.fold).length }
  }

  /** A rim's skirt, a cell to each of its curves, and its cap. */
  private closeRim(rim: RegionRim, own: readonly number[], edge: [number, boolean][], ids: readonly number[], onLeft: boolean): string | null {
    const p = this.p
    const L = own.length
    let round = edge
    let nodes = ids
    if (rim.rows > 0) {
      const feet = own.map((i) => this.node(at3(p, rim.foot[i])))
      const foot = own.map((_, k): [number, boolean] => [this.curve(feet[k], feet[(k + 1) % L], runOf(rim.foot, own, k).map((v) => at3(p, v)), true), true])
      const uprights = own.map((i, k) => this.curve(ids[k], feet[k], Array.from({ length: 9 }, (_, r) => between(at3(p, rim.loop[i]), at3(p, rim.foot[i]), r / 8)), true))
      for (let k = 0; k < L; k++) {
        const k2 = (k + 1) % L
        const top = runOf(rim.loop, own, k).map((v) => at3(p, v))
        const bottom = runOf(rim.foot, own, k).map((v) => at3(p, v))
        // A straight wall: points of it, at their own lengths along.
        const xyz: number[] = []
        const uv: number[] = []
        const at = [0]
        for (let i = 1; i < top.length; i++) at.push(at[i - 1] + dist(top[i], top[i - 1]))
        for (let i = 1; i + 1 < top.length; i++) for (let r = 1; r < 6; r++) {
          xyz.push(...between(top[i], bottom[i], r / 6))
          uv.push(at[i] / at[at.length - 1], onLeft ? r / 6 : 1 - r / 6)
        }
        this.cells.push({
          seed: between(top[top.length >> 1], bottom[top.length >> 1], 0.5),
          corners: onLeft ? [ids[k], ids[k2], feet[k2], feet[k]] : [feet[k], feet[k2], ids[k2], ids[k]],
          sides: onLeft ? [edge[k], [uprights[k2], true], [foot[k][0], false], [uprights[k], false]] : [foot[k], [uprights[k2], false], [edge[k][0], !edge[k][1]], [uprights[k], true]],
          xyz: Float64Array.from(xyz),
          uv: Float64Array.from(uv),
        })
      }
      round = foot
      nodes = feet
    }
    const cap: number[] = []
    for (let x = 0; x < this.m.cap.length; x++) if (this.m.cap[x] === rim.cap && this.m.of[x] === OF_CAP) cap.push(this.m.indices[x * 3], this.m.indices[x * 3 + 1], this.m.indices[x * 3 + 2])
    return this.disk(Uint32Array.from(cap), middle(p, rim.foot), round, nodes, onLeft, true, BRANCH_DEEP)
  }

  /** A pole's patch, or a cap, inside a ring: one cell of four sides, or — in
   *  a ring of eight curves — four, round a node in its middle. */
  private disk(triangles: Uint32Array, seed: Vec3, edge: readonly [number, boolean][], ids: readonly number[], onLeft: boolean, crease: boolean, deep: number): string | null {
    const L = ids.length
    // Round it with it on the left: the ring as it runs, or backwards.
    const nodes = onLeft ? [...ids] : ids.map((_, k) => ids[(L - k) % L])
    const sides = onLeft ? [...edge] : edge.map((_, k): [number, boolean] => [edge[L - 1 - k][0], !edge[L - 1 - k][1]])
    if (L === 4) {
      this.cell({ seed, corners: nodes, sides, triangles }, deep)
      return null
    }
    // Mapped onto the square, its corners the odd nodes, and cut from its
    // middle to the even ones.
    const got = this.mapped(triangles, [1, 3, 5, 7].map((k) => nodes[k]))
    if (typeof got === 'string') return `An end of the region is not one face: ${got}.`
    const { mesh, map } = got
    const uvOf = (n: number): [number, number] => {
      const q = this.placeOf.get(n)!
      let best = mesh.loop[0]
      for (const v of mesh.loop) if (dist(at3(mesh.positions, v), q) < dist(at3(mesh.positions, best), q)) best = v
      return [map.uv[best * 2], map.uv[best * 2 + 1]]
    }
    const mid = this.node(pointAtUv(mesh, map, 0.5, 0.5) ?? seed)
    const evens = [0, 2, 4, 6].map((k) => nodes[k])
    const evenUv = evens.map(uvOf)
    const spokes = evens.map((n, c) => {
      const pts: Vec3[] = [this.placeOf.get(mid)!]
      for (let i = 1; i < 32; i++) {
        const q = pointAtUv(mesh, map, 0.5 + ((evenUv[c][0] - 0.5) * i) / 32, 0.5 + ((evenUv[c][1] - 0.5) * i) / 32)
        if (q) pts.push(q)
      }
      return this.curve(mid, n, [...pts, this.placeOf.get(n)!], crease)
    })
    const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    for (let c = 0; c < 4; c++) {
      const c2 = (c + 1) % 4
      const quad: [number, number][] = [[0.5, 0.5], evenUv[c], square[c], evenUv[c2]]
      const mine: number[] = []
      const inside = (f: number) => {
        let u = 0
        let v = 0
        for (let k = 0; k < 3; k++) {
          u += map.uv[mesh.triangles[f * 3 + k] * 2] / 3
          v += map.uv[mesh.triangles[f * 3 + k] * 2 + 1] / 3
        }
        return inQuad(quad, u, v) !== null
      }
      for (let f = 0; f < mesh.triangles.length / 3; f++) {
        const vs = [0, 1, 2].map((k) => mesh.scanVertex[mesh.triangles[f * 3 + k]])
        if (vs.every((v) => v >= 0) && inside(f)) mine.push(...vs)
      }
      const at = (k: 0 | 1) => quad.reduce((x, q) => x + q[k] / 4, 0)
      this.cell({ seed: pointAtUv(mesh, map, at(0), at(1)) ?? seed, corners: [mid, evens[c], nodes[2 * c + 1], evens[c2]], sides: [[spokes[c], true], sides[2 * c], sides[2 * c + 1], [spokes[c2], false]], triangles: Uint32Array.from(mine) }, deep)
    }
    return null
  }

  /** The triangles as one disk, mapped onto the square by four nodes. */
  private mapped(triangles: Uint32Array, corners: readonly number[], uv?: (v: number) => [number, number]): { mesh: CellMesh; map: CellMap } | string {
    const tris = tidied(triangles, this.p)
    if (tris.length < 6) return 'it has too few of the scan’s points'
    const mesh = cellMesh({ indices: tris, positions: this.p } as ScanPaths, Uint32Array.from({ length: tris.length / 3 }, (_, i) => i), [], corners.map((n) => this.placeOf.get(n)!))
    if (typeof mesh === 'string') return mesh
    // Started from the tube's own map.
    const start = uv ? new Float64Array(mesh.scanVertex.length * 2).fill(0.5) : undefined
    if (start) mesh.scanVertex.forEach((v, i) => {
      if (v >= 0) start.set(uv!(v).map((x) => Math.max(0, Math.min(1, x))), i * 2)
    })
    const map = mapCell(mesh, start, true)
    return typeof map === 'string' ? map : { mesh, map }
  }

  /** A cell taken: its points mapped onto its square — or, squeezed, the cell
   *  laid out again as a tube of its own. */
  private cell(c: RawCell, deep: number): void {
    const got = this.mapped(c.triangles, c.corners, c.uv)
    const xyz: number[] = []
    const uv: number[] = []
    if (typeof got !== 'string') {
      const { mesh, map } = got
      if (deep < BRANCH_DEEP && mesh.triangles.length / 3 >= BRANCH_TRIANGLES && squeezed(mesh, map) && this.branch(c, mesh, deep)) return
      const onLoop = new Uint8Array(mesh.scanVertex.length)
      for (const v of mesh.loop) onLoop[v] = 1
      for (let v = 0; v < mesh.scanVertex.length; v++) {
        if (mesh.scanVertex[v] < 0 || onLoop[v]) continue
        xyz.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
        uv.push(map.uv[v * 2], map.uv[v * 2 + 1])
      }
    } else if (c.uv) {
      // Where it is no disk, the tube's own map.
      for (const v of new Set(c.triangles)) {
        const [a, b] = c.uv(v)
        if (!(a > 0.001 && a < 0.999 && b > 0.001 && b < 0.999)) continue
        xyz.push(this.p[v * 3], this.p[v * 3 + 1], this.p[v * 3 + 2])
        uv.push(a, b)
      }
    }
    this.cells.push({ seed: c.seed, corners: c.corners, sides: c.sides, xyz: Float64Array.from(xyz), uv: Float64Array.from(uv) })
  }

  /** A cell laid out again, from its own sides to a pole in it. False where
   *  it does not come: it stays the cell it was, nothing drawn. */
  private branch(c: RawCell, mesh: CellMesh, deep: number): boolean {
    const triangles = [...mesh.triangles].map((i) => mesh.scanVertex[i])
    if (triangles.some((v) => v < 0)) return false
    const loop = mesh.loop.map((i) => mesh.scanVertex[i])
    const had = { nodes: this.nodes.length, curves: this.curves.length, cells: this.cells.length, id: this.id, branches: this.branches }
    const undo = () => {
      for (const n of this.nodes.splice(had.nodes)) this.placeOf.delete(n.id)
      this.curves.length = had.curves
      this.cells.length = had.cells
      this.id = had.id
      this.branches = had.branches
      return false
    }
    // On the cell's own vertices alone: the solver's work is by the vertex.
    const at = new Map<number, number>()
    const local: number[] = []
    const own: number[] = []
    for (const v of triangles) {
      let i = at.get(v)
      if (i === undefined) {
        i = local.length
        at.set(v, i)
        local.push(v)
      }
      own.push(i)
    }
    const q = new Float32Array(local.length * 3)
    local.forEach((v, i) => q.set(this.p.subarray(v * 3, v * 3 + 3), i * 3))
    const low = loop.map((v) => at.get(v)!)
    const pole = peakFrom(q, own, low)
    if (low.includes(pole)) return false
    const cut = without(own, pole)
    const made = tubeBetween(q, cut.rest, low, cut.ring)
    if (typeof made === 'string') return false
    // Its lines start at its own corners.
    const theta = new Map<number, number>()
    for (let i = 0; i < made.triangles.length; i++) if (!theta.has(made.triangles[i])) theta.set(made.triangles[i], made.theta[i])
    const lines: number[] = []
    for (const k of mesh.cornerAt) {
      const x = theta.get(low[k])
      if (x === undefined) return false
      lines.push(x)
    }
    for (let k = 0; k < 4; k++) lines[k] = k === 0 ? lines[0] - 2 * Math.PI * Math.floor(lines[0] / (2 * Math.PI)) : lines[k] - 2 * Math.PI * Math.floor((lines[k] - lines[k - 1]) / (2 * Math.PI))
    if (!(lines[3] - lines[0] < 2 * Math.PI - 1e-3) || lines.some((x, k) => k > 0 && x - lines[k - 1] < 1e-3)) return false
    // Back in the region's own vertices.
    const h = new Float64Array(this.p.length / 3)
    local.forEach((v, i) => (h[v] = made.h[i]))
    const back = (list: ArrayLike<number>) => Uint32Array.from(list, (i) => local[i])
    const t: Tube = { ...made, positions: this.p, triangles: back(made.triangles), h }
    this.branches++
    const said = this.tube(t, { ring: loop, given: { nodes: c.corners, sides: c.sides, lines } }, { ring: [...back(cut.ring)], pole: local[pole], cut: [...back(cut.cut)] }, 4, deep + 1)
    return typeof said === 'string' ? undo() : true
  }
}

/** Whether a share of the cell's surface comes on a speck of its square. */
function squeezed(mesh: CellMesh, map: CellMap): boolean {
  const n = mesh.triangles.length / 3
  const list: { a: number; s: number }[] = []
  let total = 0
  let square = 0
  for (let f = 0; f < n; f++) {
    const [x, y, z] = [0, 1, 2].map((k) => mesh.triangles[f * 3 + k])
    const a = area(mesh.positions, x, y, z)
    const s = Math.abs((map.uv[y * 2] - map.uv[x * 2]) * (map.uv[z * 2 + 1] - map.uv[x * 2 + 1]) - (map.uv[z * 2] - map.uv[x * 2]) * (map.uv[y * 2 + 1] - map.uv[x * 2 + 1])) / 2
    list.push({ a, s })
    total += a
    square += s
  }
  list.sort((x, y) => x.s * y.a - y.s * x.a)
  let a = 0
  let s = 0
  for (const t of list) {
    a += t.a
    s += t.s
    if (a >= SQUEEZED_AREA * total) break
  }
  return s < SQUEEZED_SHARE * square
}

/** The rings of a tube, from end to end; null where it is too short. */
function ringsAlong(grid: readonly Vec3[][], t: Tube, low: End, high: End, density: number): Ring[] | null {
  // The lengths along (mean over the rounds) and round, at each row.
  const s = [0]
  for (let j = 1; j <= ALONG; j++) {
    let d = 0
    for (let i = 0; i < ROUND; i++) d += dist(grid[j][i], grid[j - 1][i]) / ROUND
    s.push(s[j - 1] + d)
  }
  const length = s[ALONG]
  const round = grid.map((row) => row.reduce((sum, q, i) => sum + dist(q, row[(i + 1) % ROUND]), 0))
  const rowAt = (want: number): number => {
    let j = 0
    while (j < ALONG - 1 && s[j + 1] < want) j++
    return j + (s[j + 1] > s[j] ? Math.max(0, Math.min(1, (want - s[j]) / (s[j + 1] - s[j]))) : 0)
  }
  const roundAt = (want: number) => round[Math.round(rowAt(want))]
  const folds = foldsAcross(grid, s, Math.max(3 * t.edge, length / 80), rowAt)
  const least = POLE_EDGES * t.edge
  // A pole's ring: the furthest from it that the patch over it stays shallow
  // at, up to where the rings have opened out; at a fold where one is nearer.
  const poleRing = (fromTop: boolean): number => {
    const away = (j: number) => (fromTop ? length - s[j] : s[j])
    const deep = (j: number) => away(j) > POLE_DEEP * (round[j] / (2 * Math.PI)) && away(j) > least
    const widest = Math.max(...round)
    const step = fromTop ? -1 : 1
    let j = fromTop ? ALONG : 0
    for (;;) {
      const next = j + step
      if (next <= 0 || next >= ALONG || away(next) > 0.5 * length) break
      if (away(j) >= least && (deep(next) || (round[j] > 0.55 * widest && !folds.some((f) => away(f) > away(j) && away(f) < 1.6 * away(j) && !deep(f))))) break
      j = next
      if (folds.includes(j) && away(j) >= least) break
    }
    return j
  }
  const lowRow = low.pole !== undefined ? poleRing(false) : 0
  const highRow = high.pole !== undefined ? poleRing(true) : ALONG
  if (highRow - lowRow < 2) return null
  // The rings between: each fold's, and the rest so that a band is about as
  // long as its cells are wide.
  const inner = folds.filter((j) => j > lowRow + 1 && j < highRow - 1 && s[j] - s[lowRow] > least && s[highRow] - s[j] > least)
  const stops = [lowRow, ...inner, highRow]
  const rings: Ring[] = [{ row: lowRow, fold: low.pole !== undefined && folds.includes(lowRow), square: low.pole !== undefined && !folds.includes(lowRow) ? 1 : 0 }]
  for (let k = 1; k < stops.length; k++) {
    const a = s[stops[k - 1]]
    const b = s[stops[k]]
    // How many cells a place takes is the sum of 1 / (a cell's length).
    const steps = 200
    const sum = [0]
    for (let i = 1; i <= steps; i++) sum.push(sum[i - 1] + (density * ((b - a) / steps)) / (ASPECT * Math.max(roundAt(a + ((b - a) * (i - 0.5)) / steps) / 4, 2 * least)))
    const count = Math.max(1, Math.min(BANDS_MAX, Math.round(sum[steps])))
    for (let i = 1; i < count; i++) {
      const want = (sum[steps] * i) / count
      const x = sum.findIndex((v) => v >= want)
      rings.push({ row: rowAt(a + ((b - a) * x) / steps), fold: false, square: 0 })
    }
    rings.push({ row: stops[k], fold: folds.includes(stops[k]), square: 0 })
  }
  const last = rings[rings.length - 1]
  if (high.pole !== undefined && !last.fold) last.square = -1
  return rings
}

/** A sample of the map: the surface at ROUND × (ALONG + 1) places. */
function sampled(places: Places, top: number): Vec3[][] | null {
  const out: Vec3[][] = []
  for (let j = 0; j <= ALONG; j++) {
    const row: Vec3[] = []
    for (let i = 0; i < ROUND; i++) {
      const p = places.at((2 * Math.PI * i) / ROUND, (top * j) / ALONG)
      if (!p) return null
      row.push(p)
    }
    out.push(row)
  }
  return out
}

/** How far the way a → b → c turns, degrees; 0 where a step is nothing. */
function turned(a: Vec3, b: Vec3, c: Vec3): number {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]
  const l = Math.hypot(...u) * Math.hypot(...v)
  if (l < 1e-12) return 0
  return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / l))) * DEG
}

const between = (a: Vec3, b: Vec3, f: number) => [0, 1, 2].map((x) => a[x] + f * (b[x] - a[x])) as Vec3

/** Whether the corners come once round a loop of n, either way. */
function inOrder(corners: readonly number[], n: number): boolean {
  let up = 0
  let down = 0
  for (let k = 0; k < corners.length; k++) {
    const d = (corners[(k + 1) % corners.length] - corners[k] + n) % n
    up += d
    down += n - d
  }
  return up === n || down === n
}

/** The rows of the sample the surface folds at across the tube's length: it
 *  turns by more than FOLD_DEG there, over a reach either side, on the
 *  average round it, and the most of the rows near. */
function foldsAcross(grid: readonly Vec3[][], s: readonly number[], reach: number, rowAt: (want: number) => number): number[] {
  const length = s[ALONG]
  const turn = grid.map((row, j) => {
    if (s[j] < reach || s[j] > length - reach) return 0
    const a = grid[Math.round(rowAt(s[j] - reach))]
    const b = grid[Math.round(rowAt(s[j] + reach))]
    return row.reduce((sum, q, i) => sum + turned(a[i], q, b[i]), 0) / ROUND
  })
  const out: number[] = []
  for (let j = 1; j < ALONG; j++) {
    if (turn[j] < FOLD_DEG) continue
    let top = true
    for (let k = j - 1; k >= 0 && s[j] - s[k] < 2 * reach; k--) if (turn[k] > turn[j]) top = false
    for (let k = j + 1; k <= ALONG && s[k] - s[j] < 2 * reach; k++) if (turn[k] >= turn[j]) top = false
    if (top) out.push(j)
  }
  return out
}

/** Whether the surface folds across a line along, between two rings. */
function alongFold(grid: readonly Vec3[][], rings: readonly Ring[], j: number, x: number, edge: number): boolean {
  let sum = 0
  let n = 0
  for (let q = 0.2; q <= 0.81; q += 0.1) {
    const row = grid[Math.round(rings[j].row + (rings[j + 1].row - rings[j].row) * q)]
    const step = row.reduce((total, p, i) => total + dist(p, row[(i + 1) % ROUND]), 0) / ROUND
    const k = Math.max(1, Math.round((2.5 * edge) / Math.max(step, 1e-9)))
    if (k > ROUND / 12) return false
    const i = Math.round((x / (2 * Math.PI)) * ROUND)
    const at = (o: number) => row[(((i + o) % ROUND) + ROUND) % ROUND]
    sum += Math.max(...[-1, 0, 1].map((o) => turned(at(o - k), at(o), at(o + k))))
    n++
  }
  return n > 0 && sum / n > FOLD_DEG + 12
}

/** `count` θ, rising, for the lines along: where the rings turn most on the
 *  average, and the rest in the widest gaps — and on a round region, where
 *  nothing stands out, evenly. */
function linesAlong(grid: readonly Vec3[][], rows: readonly number[], count: number): number[] {
  const low = Math.min(...rows)
  const high = Math.max(...rows)
  const turnAt = new Float64Array(ROUND)
  const lengthAt = new Float64Array(ROUND)
  for (let j = low; j <= high; j++) {
    const row = grid[j]
    const total = row.reduce((s, q, i) => s + dist(q, row[(i + 1) % ROUND]), 0) || 1
    for (let i = 0; i < ROUND; i++) {
      turnAt[i] += turned(row[(i + ROUND - 2) % ROUND], row[i], row[(i + 2) % ROUND]) / (high - low + 1)
      lengthAt[i] += dist(row[i], row[(i + 1) % ROUND]) / total / (high - low + 1)
    }
  }
  const at = [0]
  for (let i = 0; i < ROUND; i++) at.push(at[i] + lengthAt[i])
  const thetaAt = (share: number): number => {
    const want = share - Math.floor(share)
    let i = 0
    while (i + 1 < ROUND && at[i + 1] <= want) i++
    const f = at[i + 1] > at[i] ? (want - at[i]) / (at[i + 1] - at[i]) : 0
    return ((i + Math.max(0, Math.min(1, f))) / ROUND) * 2 * Math.PI
  }
  const mean = turnAt.reduce((a, b) => a + b, 0) / ROUND
  const peaks = [...Array(ROUND).keys()].filter((i) => turnAt[i] > 2 * mean && [-3, -2, -1, 1, 2, 3].every((o) => turnAt[(i + o + ROUND) % ROUND] <= turnAt[i])).sort((a, b) => turnAt[b] - turnAt[a])
  const gap = (a: number, b: number) => {
    const d = Math.abs(at[a] - at[b])
    return Math.min(d, 1 - d)
  }
  const chosen: number[] = []
  for (const i of peaks) if (chosen.length < count && chosen.every((c) => gap(c, i) > 0.4 / count)) chosen.push(i)
  let start = 0
  for (let i = 1; i < ROUND; i++) if (turnAt[i] > turnAt[start]) start = i
  if (chosen.length < 2) return Array.from({ length: count }, (_, k) => thetaAt(at[start] + k / count)).sort((a, b) => a - b)
  const shares = chosen.map((i) => at[i]).sort((a, b) => a - b)
  while (shares.length < count) {
    let best = 0
    let wide = -1
    shares.forEach((a, i) => {
      const b = i + 1 < shares.length ? shares[i + 1] : shares[0] + 1
      if (b - a > wide) [wide, best] = [b - a, i]
    })
    shares.push((shares[best] + wide / 2) % 1)
    shares.sort((a, b) => a - b)
  }
  return shares.map(thetaAt).sort((a, b) => a - b)
}

/** The vertices of a loop from corner k to the next, the way the corners
 *  come round it. */
function runOf(loop: readonly number[], corners: readonly number[], k: number): number[] {
  const n = loop.length
  const L = corners.length
  const forward = corners.reduce((sum, c, x) => sum + ((corners[(x + 1) % L] - c + n) % n), 0) === n
  const i = corners[k]
  const j = corners[(k + 1) % L]
  const count = forward ? (j - i + n) % n : (i - j + n) % n
  return Array.from({ length: count + 1 }, (_, x) => loop[(i + (forward ? x : -x) + 2 * n) % n])
}

/** (s, t) of a point in a convex quad — corners (0, 0), (1, 0), (1, 1),
 *  (0, 1) — or null outside it. */
function inQuad(q: readonly (readonly [number, number])[], x: number, y: number): [number, number] | null {
  let s = 0.5
  let t = 0.5
  for (let i = 0; i < 12; i++) {
    const f = (k: 0 | 1) => (1 - s) * (1 - t) * q[0][k] + s * (1 - t) * q[1][k] + s * t * q[2][k] + (1 - s) * t * q[3][k]
    const ds = (k: 0 | 1) => (1 - t) * (q[1][k] - q[0][k]) + t * (q[2][k] - q[3][k])
    const dt = (k: 0 | 1) => (1 - s) * (q[3][k] - q[0][k]) + s * (q[2][k] - q[1][k])
    const ex = x - f(0)
    const ey = y - f(1)
    const det = ds(0) * dt(1) - dt(0) * ds(1)
    if (Math.abs(det) < 1e-12) return null
    s += (ex * dt(1) - dt(0) * ey) / det
    t += (ds(0) * ey - ex * ds(1)) / det
  }
  return s > 0.002 && s < 0.998 && t > 0.002 && t < 0.998 ? [s, t] : null
}

/** A cell's triangles with no vertex two of its fans meet at: the smaller
 *  fan goes, and what that cuts off. */
function tidied(t: Uint32Array, p: Float32Array): Uint32Array {
  let own = largestPiece(t)
  for (let round = 0; round < 8; round++) {
    const around = new Map<number, number[]>()
    for (let i = 0; i < own.length; i++) {
      const list = around.get(own[i])
      if (list) list.push(Math.floor(i / 3))
      else around.set(own[i], [Math.floor(i / 3)])
    }
    const gone = new Set<number>()
    for (const [v, tris] of around) {
      const left = new Set(tris)
      const fans: number[][] = []
      while (left.size > 0) {
        const fan = [left.values().next().value as number]
        left.delete(fan[0])
        for (let k = 0; k < fan.length; k++) {
          const mine = [0, 1, 2].map((x) => own[fan[k] * 3 + x]).filter((x) => x !== v)
          for (const o of left) if (mine.some((x) => own[o * 3] === x || own[o * 3 + 1] === x || own[o * 3 + 2] === x)) {
            left.delete(o)
            fan.push(o)
          }
        }
        fans.push(fan)
      }
      if (fans.length < 2) continue
      const size = (f: readonly number[]) => f.reduce((sum, i) => sum + area(p, own[i * 3], own[i * 3 + 1], own[i * 3 + 2]), 0)
      const keep = fans.reduce((a, b) => (size(b) > size(a) ? b : a))
      for (const f of fans) if (f !== keep) for (const i of f) gone.add(i)
    }
    if (gone.size === 0) break
    const next: number[] = []
    for (let i = 0; i < own.length / 3; i++) if (!gone.has(i)) next.push(own[i * 3], own[i * 3 + 1], own[i * 3 + 2])
    own = largestPiece(Uint32Array.from(next))
  }
  return own
}

/** The largest piece of the triangles joined by their edges. */
function largestPiece(t: Uint32Array): Uint32Array {
  const n = t.length / 3
  const byEdge = new Map<number, number[]>()
  for (let i = 0; i < t.length; i++) {
    const tri = i - (i % 3)
    const e = edgeKey(t[i], t[tri + ((i + 1) % 3)])
    const list = byEdge.get(e)
    if (list) list.push(tri / 3)
    else byEdge.set(e, [tri / 3])
  }
  const label = new Int32Array(n).fill(-1)
  let best: number[] = []
  for (let s = 0; s < n; s++) {
    if (label[s] >= 0) continue
    const piece = [s]
    label[s] = s
    for (let q = 0; q < piece.length; q++) for (let k = 0; k < 3; k++) for (const o of byEdge.get(edgeKey(t[piece[q] * 3 + k], t[piece[q] * 3 + ((k + 1) % 3)]))!) if (label[o] < 0) {
      label[o] = s
      piece.push(o)
    }
    if (piece.length > best.length) best = piece
  }
  const out = new Uint32Array(best.length * 3)
  best.forEach((i, x) => out.set(t.subarray(i * 3, i * 3 + 3), x * 3))
  return out
}

// ---- read for the build --------------------------------------------------------

/** A laid-out region read as the build reads a network drawn on the scan
 *  (network.ts readNetwork), from the layout itself: no curve is traced and
 *  no cell flooded again, so none crosses or leaks. */
export function regionReading(m: RegionMesh, l: RegionLayout, f: Pick<NetworkFeature, 'spans' | 'fit'>): NetworkReading {
  const t0 = performance.now()
  const curves = l.curves.map((c) => {
    const n = c.points.length
    const points = new Float32Array(n * 3)
    const s = new Float64Array(n)
    c.points.forEach((q, i) => {
      points.set(q, i * 3)
      if (i > 0) s[i] = s[i - 1] + dist(q, c.points[i - 1])
    })
    const trace = { points, at: s, length: s[n - 1], on: new Int32Array(n * 2).fill(-1), grips: [0, n - 1], runs: [] }
    return { id: c.id, from: c.from, to: c.to, trace, fit: fitProvisional(trace, m.edge), crease: c.crease }
  })
  const t1 = performance.now()
  const outcomes: CellOutcome[] = l.cells.map((c, i) => ({ seed: c.seed, sides: 4, patch: i, patches: [i] }))
  const patches: PatchInput[] = l.cells.map((c) => ({ sides: c.sides.map(([curve, forward]) => ({ edges: [{ curve, forward }] })), corners: c.corners, xyz: c.xyz, uv: c.uv, seed: c.seed, bends: true }))
  const fit = fitNetwork({ patches, curves, nodes: l.nodes, spans: f.spans, smoothness: f.fit.smoothness, robust: f.fit.robust, tolerance: f.fit.tolerance, ...(f.fit.continuity === 'g2' ? { g2: true } : {}), spacing: m.edge, bodySides: [] })
  return { traced: { nodes: l.nodes, curves, lost: [] }, cells: { faces: [], cells: [], unfilled: [] }, outcomes, fit, split: null, ms: { trace: t1 - t0, cells: 0, map: 0, fit: performance.now() - t1 } }
}
