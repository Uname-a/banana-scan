// SPDX-License-Identifier: AGPL-3.0-only
// Flattening a curved sheet: a region of the scan that is a bent sheet —
// developable, or nearly — laid out flat with the least distortion, for the
// blank it was bent from.
//
// Two classic steps, both written here. Least-squares conformal maps (Lévy
// et al. 2002, in the form of Mullen et al. 2008: the Dirichlet energy less
// the area, two rim points pinned) give a layout that keeps angles but may
// drift in scale; as-rigid-as-possible (Liu et al. 2008) then takes it as
// its start and alternates between the rotation that best carries each
// triangle onto its place in the layout and the layout that best keeps
// every triangle that rotation of its true shape — so a developable sheet
// comes out with its lengths, not only its angles. Both reduce to a sparse
// symmetric positive-definite solve, done by conjugate gradients over a
// Cholesky factor of the matrix (core/sparse): with only the diagonal to
// precondition them they take thousands of steps on a scan's patch, with
// the factor one or two — and as-rigid-as-possible's matrix is the same
// every round, so it is factored once.
//
// How far the result stretched the surface is measured, triangle by
// triangle (core/flatPattern): near zero for a sheet bent without
// stretching it, more for a dished or drawn one, which no flat blank makes
// exactly.

import { boundaryLoops } from './boundary'
import { cholesky, choleskySolver, csrOf, dissect, solve, type Csr, type Preconditioner } from './sparse'
import { distortionOf, patternOf, regionPatch, type Distortion, type FlatPattern, type Patch, type PatternFigures } from './flatPattern'

export interface FlattenSettings {
  /** As-rigid-as-possible rounds at most — the layout usually settles in a
   *  few dozen. */
  iterations?: number
}

export interface FlattenReport {
  vertices: number
  triangles: number
  leftOut: { triangles: number; pieces: number }
  /** The rounds the layout took, and whether it settled. */
  iterations: number
  converged: boolean
  distortion: Distortion
  figures: PatternFigures
}

export interface FlattenResult {
  pattern: FlatPattern
  report: FlattenReport
}

export const FLATTEN_ITERATIONS = 60

/** The layout has settled when a round lowers the energy by less than
 *  this share of it, or when what strain is left is less than a
 *  ten-thousandth of a per cent on average. */
const SETTLED = 1e-6
const STRAIN_SETTLED = 1e-6

/** The factor of a matrix in the order nested dissection gives it, as a
 *  preconditioner; `points` are its unknowns' places, x,y,z each. */
function factored(a: Csr, points: Float64Array): Preconditioner {
  return choleskySolver(cholesky(a, dissect(a, points)))
}

// ---- the triangles in their own planes ------------------------------------------------

/** Each triangle drawn in its own plane — corner 0 at the origin, corner 1
 *  on +x — and the cotangent of each corner's angle, which weighs the edge
 *  across from it. */
function localTriangles(patch: Patch) {
  const { positions: p, indices } = patch
  const m = indices.length / 3
  const xy = new Float64Array(m * 6)
  const cot = new Float64Array(m * 3)
  let areaSum = 0
  const areas = new Float64Array(m)
  for (let t = 0; t < m; t++) {
    const i0 = indices[t * 3]
    const i1 = indices[t * 3 + 1]
    const i2 = indices[t * 3 + 2]
    const ax = p[i1 * 3] - p[i0 * 3]
    const ay = p[i1 * 3 + 1] - p[i0 * 3 + 1]
    const az = p[i1 * 3 + 2] - p[i0 * 3 + 2]
    const bx = p[i2 * 3] - p[i0 * 3]
    const by = p[i2 * 3 + 1] - p[i0 * 3 + 1]
    const bz = p[i2 * 3 + 2] - p[i0 * 3 + 2]
    const la = Math.hypot(ax, ay, az)
    const twice = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
    areas[t] = twice / 2
    areaSum += twice / 2
    if (!(la > 0)) continue
    xy[t * 6 + 2] = la
    xy[t * 6 + 4] = (ax * bx + ay * by + az * bz) / la
    xy[t * 6 + 5] = twice / la
  }
  // A sliver's cotangents run off to infinity while what it adds to the
  // energy runs to nothing: it is left out of the weighing.
  const tiny = (areaSum / Math.max(1, m)) * 1e-8
  for (let t = 0; t < m; t++) {
    if (!(areas[t] > tiny)) continue
    const x = xy.subarray(t * 6, t * 6 + 6)
    for (let k = 0; k < 3; k++) {
      // The angle at corner k, between the edges to the other two.
      const o = k * 2
      const a = ((k + 1) % 3) * 2
      const b = ((k + 2) % 3) * 2
      const ux = x[a] - x[o]
      const uy = x[a + 1] - x[o + 1]
      const vx = x[b] - x[o]
      const vy = x[b + 1] - x[o + 1]
      cot[t * 3 + k] = (ux * vx + uy * vy) / Math.abs(ux * vy - uy * vx)
    }
  }
  return { xy, cot }
}

// ---- the conformal start --------------------------------------------------------------

/** Two rim vertices far apart: the furthest from any one, and the furthest
 *  from that. */
function farPair(patch: Patch, rim: Uint32Array): [number, number] {
  const p = patch.positions
  const furthest = (from: number): number => {
    let best = rim[0]
    let bd = -1
    for (const v of rim) {
      const d = (p[v * 3] - p[from * 3]) ** 2 + (p[v * 3 + 1] - p[from * 3 + 1]) ** 2 + (p[v * 3 + 2] - p[from * 3 + 2]) ** 2
      if (d > bd) {
        bd = d
        best = v
      }
    }
    return best
  }
  const a = furthest(rim[0])
  return [a, furthest(a)]
}

function conformal(patch: Patch, cot: Float64Array, rims: Uint32Array[], pins: [number, number]): Float64Array {
  const n = patch.vertexCount
  const { indices, positions: p } = patch
  const rows: number[] = []
  const cols: number[] = []
  const vals: number[] = []
  const add = (r: number, c: number, v: number) => {
    rows.push(r)
    cols.push(c)
    vals.push(v)
  }
  // Dirichlet energy, u and v alike: ½ Σ w_ij (Δ)², w = ½ Σ cot.
  for (let t = 0; t < indices.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const i = indices[t * 3 + ((k + 1) % 3)]
      const j = indices[t * 3 + ((k + 2) % 3)]
      const w = cot[t * 3 + k] / 2
      if (w === 0) continue
      for (const s of [0, 1]) {
        add(2 * i + s, 2 * i + s, w)
        add(2 * j + s, 2 * j + s, w)
        add(2 * i + s, 2 * j + s, -w)
        add(2 * j + s, 2 * i + s, -w)
      }
    }
  }
  // Less the signed area, ½ Σ over the rims' edges (u_i v_j − u_j v_i).
  for (const rim of rims) {
    for (let k = 0; k < rim.length; k++) {
      const i = rim[k]
      const j = rim[(k + 1) % rim.length]
      add(2 * i, 2 * j + 1, -0.5)
      add(2 * j + 1, 2 * i, -0.5)
      add(2 * j, 2 * i + 1, 0.5)
      add(2 * i + 1, 2 * j, 0.5)
    }
  }
  // Pin two rim points their true distance apart, on x.
  const [p0, p1] = pins
  const dist = Math.hypot(p[p1 * 3] - p[p0 * 3], p[p1 * 3 + 1] - p[p0 * 3 + 1], p[p1 * 3 + 2] - p[p0 * 3 + 2])
  const fixed = new Map<number, number>([
    [2 * p0, 0],
    [2 * p0 + 1, 0],
    [2 * p1, dist],
    [2 * p1 + 1, 0],
  ])
  // The free unknowns: every u first, then every v.
  const freeVertex = new Int32Array(n).fill(-1)
  let nv = 0
  for (let v = 0; v < n; v++) if (v !== p0 && v !== p1) freeVertex[v] = nv++
  const nf = 2 * nv
  const free = new Int32Array(2 * n).fill(-1)
  for (let v = 0; v < n; v++) {
    if (freeVertex[v] < 0) continue
    free[2 * v] = freeVertex[v]
    free[2 * v + 1] = nv + freeVertex[v]
  }
  const fr: number[] = []
  const fc: number[] = []
  const fv: number[] = []
  const rhs = new Float64Array(nf)
  for (let k = 0; k < rows.length; k++) {
    const r = free[rows[k]]
    if (r < 0) continue
    const c = free[cols[k]]
    if (c >= 0) {
      fr.push(r)
      fc.push(c)
      fv.push(vals[k])
    } else {
      rhs[r] -= vals[k] * fixed.get(cols[k])!
    }
  }
  const a = csrOf(nf, fr, fc, fv)
  const points = new Float64Array(nv * 3)
  for (let v = 0; v < n; v++) if (freeVertex[v] >= 0) points.set(p.subarray(v * 3, v * 3 + 3), freeVertex[v] * 3)
  // v's unknowns stand where u's do.
  const precondition = factored(a, Float64Array.from([...points, ...points]))
  const x = new Float64Array(nf)
  // Start from the points as they stand, seen square to their best plane's
  // normal — near the answer for a sheet only gently bent.
  const start = planarStart(patch, p0, p1)
  for (let d = 0; d < 2 * n; d++) if (free[d] >= 0) x[free[d]] = start[d]
  solve(a, rhs, x, 1e-10, 500, precondition)
  const uv = new Float64Array(2 * n)
  for (let d = 0; d < 2 * n; d++) uv[d] = free[d] >= 0 ? x[free[d]] : fixed.get(d)!
  return uv
}

/** The points projected on the plane through the first pin square to the
 *  patch's mean normal, x towards the second pin. */
function planarStart(patch: Patch, p0: number, p1: number): Float64Array {
  const { positions: p, indices } = patch
  let nx = 0
  let ny = 0
  let nz = 0
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3
    const i1 = indices[t + 1] * 3
    const i2 = indices[t + 2] * 3
    const ax = p[i1] - p[i0]
    const ay = p[i1 + 1] - p[i0 + 1]
    const az = p[i1 + 2] - p[i0 + 2]
    const bx = p[i2] - p[i0]
    const by = p[i2 + 1] - p[i0 + 1]
    const bz = p[i2 + 2] - p[i0 + 2]
    nx += ay * bz - az * by
    ny += az * bx - ax * bz
    nz += ax * by - ay * bx
  }
  const nl = Math.hypot(nx, ny, nz) || 1
  nx /= nl
  ny /= nl
  nz /= nl
  let ex = p[p1 * 3] - p[p0 * 3]
  let ey = p[p1 * 3 + 1] - p[p0 * 3 + 1]
  let ez = p[p1 * 3 + 2] - p[p0 * 3 + 2]
  const dn = ex * nx + ey * ny + ez * nz
  ex -= dn * nx
  ey -= dn * ny
  ez -= dn * nz
  const el = Math.hypot(ex, ey, ez) || 1
  ex /= el
  ey /= el
  ez /= el
  const fx = ny * ez - nz * ey
  const fy = nz * ex - nx * ez
  const fz = nx * ey - ny * ex
  const out = new Float64Array(patch.vertexCount * 2)
  for (let v = 0; v < patch.vertexCount; v++) {
    const dx = p[v * 3] - p[p0 * 3]
    const dy = p[v * 3 + 1] - p[p0 * 3 + 1]
    const dz = p[v * 3 + 2] - p[p0 * 3 + 2]
    out[v * 2] = dx * ex + dy * ey + dz * ez
    out[v * 2 + 1] = dx * fx + dy * fy + dz * fz
  }
  return out
}

// ---- as rigid as possible -------------------------------------------------------------

function rigid(patch: Patch, xy: Float64Array, cot: Float64Array, uv: Float64Array, pin: number, maxRounds: number, progress?: (round: number) => void) {
  const n = patch.vertexCount
  const { indices } = patch
  const m = indices.length / 3
  // The layout's own matrix: the cotangent Laplacian, one vertex pinned.
  const free = new Int32Array(n).fill(-1)
  let nf = 0
  for (let v = 0; v < n; v++) if (v !== pin) free[v] = nf++
  const rows: number[] = []
  const cols: number[] = []
  const vals: number[] = []
  for (let t = 0; t < m; t++) {
    for (let k = 0; k < 3; k++) {
      const w = cot[t * 3 + k]
      if (w === 0) continue
      const i = free[indices[t * 3 + ((k + 1) % 3)]]
      const j = free[indices[t * 3 + ((k + 2) % 3)]]
      if (i >= 0) {
        rows.push(i)
        cols.push(i)
        vals.push(w)
      }
      if (j >= 0) {
        rows.push(j)
        cols.push(j)
        vals.push(w)
      }
      if (i >= 0 && j >= 0) {
        rows.push(i, j)
        cols.push(j, i)
        vals.push(-w, -w)
      }
    }
  }
  const a = csrOf(nf, rows, cols, vals)
  const points = new Float64Array(nf * 3)
  for (let v = 0; v < n; v++) if (free[v] >= 0) points.set(patch.positions.subarray(v * 3, v * 3 + 3), free[v] * 3)
  // The matrix is the same every round: factored once, each round's solve
  // is two passes over the factor.
  const precondition = factored(a, points)
  const pu = uv[pin * 2]
  const pv = uv[pin * 2 + 1]
  const xu = new Float64Array(nf)
  const xv = new Float64Array(nf)
  for (let v = 0; v < n; v++) {
    if (free[v] < 0) continue
    xu[free[v]] = uv[v * 2]
    xv[free[v]] = uv[v * 2 + 1]
  }
  const bu = new Float64Array(nf)
  const bv = new Float64Array(nf)
  const rot = new Float64Array(m * 2)
  const at = (v: number, s: 0 | 1) => (free[v] < 0 ? (s ? pv : pu) : s ? xv[free[v]] : xu[free[v]])
  // The energy is Σ 2·area·|J − R|² over the triangles, J the layout's
  // map of each: against twice the area, the mean squared strain.
  let surface = 0
  for (let t = 0; t < m; t++) surface += (xy[t * 6 + 2] * xy[t * 6 + 5]) / 2
  const still = 2 * surface * STRAIN_SETTLED ** 2
  let last = Infinity
  let rounds = 0
  let converged = false
  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1
    // Each triangle's best rotation onto the layout, and the energy left.
    let energy = 0
    for (let t = 0; t < m; t++) {
      let s00 = 0
      let s01 = 0
      let s10 = 0
      let s11 = 0
      for (let k = 0; k < 3; k++) {
        const w = cot[t * 3 + k]
        if (w === 0) continue
        const a1 = (k + 1) % 3
        const a2 = (k + 2) % 3
        const i = indices[t * 3 + a1]
        const j = indices[t * 3 + a2]
        const du = at(i, 0) - at(j, 0)
        const dv = at(i, 1) - at(j, 1)
        const dx = xy[t * 6 + a1 * 2] - xy[t * 6 + a2 * 2]
        const dy = xy[t * 6 + a1 * 2 + 1] - xy[t * 6 + a2 * 2 + 1]
        s00 += w * du * dx
        s01 += w * du * dy
        s10 += w * dv * dx
        s11 += w * dv * dy
      }
      const angle = Math.atan2(s10 - s01, s00 + s11)
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      rot[t * 2] = c
      rot[t * 2 + 1] = s
      for (let k = 0; k < 3; k++) {
        const w = cot[t * 3 + k]
        if (w === 0) continue
        const a1 = (k + 1) % 3
        const a2 = (k + 2) % 3
        const i = indices[t * 3 + a1]
        const j = indices[t * 3 + a2]
        const dx = xy[t * 6 + a1 * 2] - xy[t * 6 + a2 * 2]
        const dy = xy[t * 6 + a1 * 2 + 1] - xy[t * 6 + a2 * 2 + 1]
        const eu = at(i, 0) - at(j, 0) - (c * dx - s * dy)
        const ev = at(i, 1) - at(j, 1) - (s * dx + c * dy)
        energy += w * (eu * eu + ev * ev)
      }
    }
    if (Math.abs(last - energy) <= SETTLED * energy || energy <= still) {
      converged = true
      break
    }
    last = energy
    progress?.(rounds)
    // The layout that best keeps every triangle its rotated shape.
    bu.fill(0)
    bv.fill(0)
    for (let t = 0; t < m; t++) {
      const c = rot[t * 2]
      const s = rot[t * 2 + 1]
      for (let k = 0; k < 3; k++) {
        const w = cot[t * 3 + k]
        if (w === 0) continue
        const a1 = (k + 1) % 3
        const a2 = (k + 2) % 3
        const i = indices[t * 3 + a1]
        const j = indices[t * 3 + a2]
        const dx = xy[t * 6 + a1 * 2] - xy[t * 6 + a2 * 2]
        const dy = xy[t * 6 + a1 * 2 + 1] - xy[t * 6 + a2 * 2 + 1]
        const ru = w * (c * dx - s * dy)
        const rv = w * (s * dx + c * dy)
        const fi = free[i]
        const fj = free[j]
        if (fi >= 0) {
          bu[fi] += ru
          bv[fi] += rv
          if (fj < 0) {
            bu[fi] += w * pu
            bv[fi] += w * pv
          }
        }
        if (fj >= 0) {
          bu[fj] -= ru
          bv[fj] -= rv
          if (fi < 0) {
            bu[fj] += w * pu
            bv[fj] += w * pv
          }
        }
      }
    }
    solve(a, bu, xu, 1e-12, 50, precondition)
    solve(a, bv, xv, 1e-12, 50, precondition)
  }
  const out = new Float64Array(n * 2)
  for (let v = 0; v < n; v++) {
    out[v * 2] = at(v, 0)
    out[v * 2 + 1] = at(v, 1)
  }
  return { uv: out, rounds, converged }
}

/** The layout turned square: the smallest rectangle round its outline
 *  (rotating calipers over the outline's hull) lying along x and y, its
 *  long side along x — a blank comes out square to its own edges, whatever
 *  holes it has or wherever its vertices crowd. Turned, never mirrored. */
function squared(uv: Float64Array, rim: Uint32Array): Float64Array {
  const pts = Array.from(rim, (v) => [uv[v * 2], uv[v * 2 + 1]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  let best = { area: Infinity, angle: 0, long: true }
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of hull) {
      const x = c * p[0] + s * p[1]
      const y = -s * p[0] + c * p[1]
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    const area = (x1 - x0) * (y1 - y0)
    if (area < best.area - 1e-9 * area) best = { area, angle, long: x1 - x0 >= y1 - y0 }
  }
  // Turn by −angle, and a quarter turn more when the rectangle's long side
  // would stand along y.
  const turn = -best.angle + (best.long ? 0 : Math.PI / 2)
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const out = new Float64Array(uv.length)
  for (let v = 0; v < uv.length / 2; v++) {
    out[v * 2] = c * uv[v * 2] - s * uv[v * 2 + 1]
    out[v * 2 + 1] = s * uv[v * 2] + c * uv[v * 2 + 1]
  }
  return out
}

/** A patch flattened: conformal first, then as rigid as possible. */
export function flattenPatch(patch: Patch, settings: FlattenSettings = {}, progress?: (round: number) => void) {
  if (patch.indices.length === 0) throw new Error('The region holds no whole triangle — name a larger one.')
  const { loops } = boundaryOf(patch)
  if (loops.length === 0) throw new Error('The region is a closed surface, with no rim to open it out from — name part of it, or cut it open first.')
  const { xy, cot } = localTriangles(patch)
  // The longest rim is the outline the pins go on.
  const rim = loops.reduce((a, b) => (b.length > a.length ? b : a))
  const pins = farPair(patch, rim)
  const start = conformal(patch, cot, loops, pins)
  const done = rigid(patch, xy, cot, start, pins[0], settings.iterations ?? FLATTEN_ITERATIONS, progress)
  return { uv: squared(done.uv, rim), iterations: done.rounds, converged: done.converged }
}

function boundaryOf(patch: Patch): { loops: Uint32Array[] } {
  return { loops: boundaryLoops(patch.indices, patch.vertexCount).loops.map((l) => l.vertices) }
}

/** The flat pattern of a region of the mesh flattened. */
export function flatten(
  positions: ArrayLike<number>,
  indices: Uint32Array,
  vertexCount: number,
  region: ArrayLike<number>,
  settings: FlattenSettings = {},
  progress?: (round: number) => void,
): FlattenResult {
  const patch = regionPatch(positions, indices, vertexCount, region)
  const laid = flattenPatch(patch, settings, progress)
  const { pattern, figures } = patternOf(laid.uv, patch.indices, patch.vertexCount)
  return {
    pattern,
    report: {
      vertices: patch.vertexCount,
      triangles: patch.indices.length / 3,
      leftOut: patch.leftOut,
      iterations: laid.iterations,
      converged: laid.converged,
      distortion: distortionOf(patch.positions, laid.uv, patch.indices),
      figures,
    },
  }
}
