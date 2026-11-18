// SPDX-License-Identifier: AGPL-3.0-only
// The principal curvatures at every vertex of a scan, for curvature shading:
// where a flat turns into a round, how tight the round is, and which way it
// bends — convex, concave or a saddle — read off the surface at a scale the
// user sets.
//
// The one-ring cotangent reading (geometry/curvature) is the mesh's own, and
// on a scan it is mostly noise: 0.02 mm of scatter on 0.3 mm triangles bends
// the surface more, triangle to triangle, than a 2 mm round does. Averaging
// it afterwards brings the shape back but leaves the scale it is read at to
// the triangle size. Here each vertex instead gets a quadric height surface,
// h = a + b·u + c·v + d·u² + e·u·v + f·v² over its tangent plane, fitted by
// weighted least squares to the scan within a radius of it — a ball the user
// sets in millimetres, whatever the triangles — and the curvatures are that
// surface's. Scatter well under the radius averages out of six coefficients
// fitted to dozens of points; a round larger than the radius reads true, one
// smaller reads as a sharp edge spread over the radius. The linear terms let
// the fitted surface tilt, so a vertex normal thrown by the noise does not
// throw the reading.
//
// Points are found through a grid over the scan rather than by walking the
// mesh, so a hole or a sliver does not cut the neighbourhood short. A point
// whose normal faces away (the far wall of a thin part, the other side of a
// sheet) is left out: it is in the ball, but not on this surface. A ball
// holding many more points than six coefficients need is read off an even
// share of them, so a large radius costs about what a small one does.

/** What the fit reads: the scan's vertices, their outward normals, and its
 *  triangles (for the spacing and each vertex's share of the area). */
export interface CurvatureMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  vertexCount: number
  /** The mesh's vertex adjacency (see geometry/adjacency), which lets a
   *  large ball be fitted at a share of the vertices and the rest filled
   *  in; without it every vertex is fitted. */
  adjOffsets?: Uint32Array
  adjList?: Uint32Array
}

/** The curvatures at every vertex, 1/mm, convex positive: `k1` the larger
 *  and `k2` the smaller (so a convex round has k1 > 0, a concave fillet
 *  k2 < 0). NaN where there were too few points to fit. */
export interface PrincipalCurvatures {
  k1: Float32Array
  k2: Float32Array
  /** Each vertex's share of the surface (a third of each triangle it is a
   *  corner of), mm², for shares of the area. */
  area: Float32Array
  /** The neighbourhood radius read at, mm. */
  radius: number
  /** The scan's median edge length, mm. */
  spacing: number
  /** The scan's scatter the reading was read against (rms off a small
   *  plane, mm; 0 when none was given). */
  noise: number
  /** The curvature that scatter alone reads at this radius on a flat,
   *  1/mm — nine vertices in ten under it: under this a surface cannot be
   *  told from flat. */
  noiseFloor: number
}

/** The fewest edge lengths the neighbourhood radius is by default: some
 *  two hundred vertices in the ball on an even mesh. Four would do for
 *  white scatter, but a scan's is not white — a scanner leaves bumps a
 *  few triangles across that no estimate of its scatter can tell from
 *  shape, and that read as bends over a smaller ball (the sample bracket's
 *  faces did, at four). A fillet narrower than this reads as an edge;
 *  set the radius to read one. */
export const DEFAULT_RADIUS_EDGES = 8

/** The most edge lengths a default radius grows to on a noisy scan. */
const MAX_RADIUS_EDGES = 24

/** How much of a round as tight as the radius the scatter may read, at
 *  the default radius: a twentieth, so a round the radius picks out
 *  stands well clear of the noise. */
const NOISE_SHARE = 0.05

/** The curvature `noise` mm of scatter reads on a flat when it is fitted
 *  over `radius`, 1/mm, nine vertices in ten under it: measured on noisy
 *  sheets (tests/principalCurvature.test.ts), it falls as the square of
 *  the radius and the root of the points the fit is made from. */
export function curvatureNoise(radius: number, spacing: number, noise: number): number {
  const points = Math.min(ballCount(radius, spacing), SAMPLES_PER_BALL)
  return (NOISE_CONSTANT * noise) / (radius * radius * Math.sqrt(Math.max(points, 1)))
}
const NOISE_CONSTANT = 40

/** The radius a scan is read at unless one is set: the smallest, from a
 *  few edge lengths up, at which its scatter reads under a twentieth of
 *  the curvature of a round that size. */
export function noiseRadius(spacing: number, noise: number): number {
  let r = DEFAULT_RADIUS_EDGES * spacing
  const most = MAX_RADIUS_EDGES * spacing
  while (r < most && curvatureNoise(r, spacing, noise) * r > NOISE_SHARE) r *= 1.05
  return Math.min(r, most)
}

/** Points a ball is read off, at most: past this an even share is taken.
 *  Two hundred put a quadric's curvature within a few per cent on a scan's
 *  scatter; more cost time and add little. */
const SAMPLES_PER_BALL = 200

/** Fewest points a fit is made from: twice the coefficients. */
const MIN_POINTS = 12

/** A neighbour whose normal is turned further than this from the vertex's
 *  (cosine) is on another surface: the far wall of a thin part (−1), not a
 *  face meeting this one at a sharp edge (0 at a right angle), which belongs
 *  in the reading — that is how the edge shows. */
const FACING_COS = -0.3

/** The scan's scatter, mm: the median RMS of the quadric fitted round an
 *  even sample of `sample` vertices at four edge lengths. A quadric takes the part's own shape out — a plane over
 *  two rings of a small round reads the round as scatter — and the median
 *  leaves the edges, which no quadric fits, to the few. */
export function scanScatter(mesh: CurvatureMesh, spacing: number, sample = 1500): number {
  const n = mesh.vertexCount
  if (n === 0 || !(spacing > 0)) return 0
  const fitter = new CurvatureFitter(mesh, 4 * spacing, spacing)
  const step = Math.max(1, Math.floor(n / sample))
  const rms: number[] = []
  for (let v = 0; v < n; v += step) {
    const fit = fitter.fitAt(v)
    if (fit) rms.push(fit.rms)
  }
  if (rms.length === 0) return 0
  rms.sort((a, b) => a - b)
  return rms[Math.floor(rms.length / 2)]
}

/** How far over its median a reading of bumps runs, nine vertices in ten:
 *  the larger of two curvatures of noise, measured on noisy sheets. */
const BUMPS_P90_OVER_MEDIAN = 1.7

/** The curvature the scan's own bumps read at `radius`, 1/mm, nine
 *  vertices in ten under it: at an even sample of vertices, how far the
 *  curvatures read at the radius stray from those read at twice it. The
 *  part's shape reads alike at both — a round, a flat, a ball — and a bump
 *  smaller than the larger ball is gone from it, so what differs is the
 *  bumps, white or not, which the scatter's own figure (curvatureNoise)
 *  under-reads where a scanner leaves them a few triangles wide. The edges
 *  differ too; the median leaves them to the few. */
export function bumpCurvature(mesh: CurvatureMesh, spacing: number, radius: number, sample = 1500): number {
  const n = mesh.vertexCount
  if (n === 0 || !(radius > 0)) return 0
  const near = new CurvatureFitter(mesh, radius, spacing)
  const far = new CurvatureFitter(mesh, 2 * radius, spacing)
  const step = Math.max(1, Math.floor(n / sample))
  const a = new Float64Array(2)
  const b = new Float64Array(2)
  const off: number[] = []
  for (let v = 0; v < n; v += step) {
    if (!near.pairAt(v, a) || !far.pairAt(v, b)) continue
    off.push(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])))
  }
  if (off.length === 0) return 0
  off.sort((x, y) => x - y)
  return BUMPS_P90_OVER_MEDIAN * off[Math.floor(off.length / 2)]
}

/** The radius the neighbourhood is read at unless one is set: a few edge
 *  lengths, more on a noisy scan (see noiseRadius). */
export function defaultCurvatureRadius(spacing: number, noise = 0): number {
  return noiseRadius(spacing, noise)
}

/** The median edge length of a mesh, mm, from up to `sample` triangles
 *  spread through it. */
export function meshSpacing(positions: Float32Array, indices: Uint32Array, sample = 50_000): number {
  const triangles = Math.floor(indices.length / 3)
  if (triangles === 0) return 0
  const step = Math.max(1, Math.floor(triangles / sample))
  const lengths: number[] = []
  for (let t = 0; t < triangles; t += step) {
    const a = indices[t * 3] * 3
    const b = indices[t * 3 + 1] * 3
    const c = indices[t * 3 + 2] * 3
    lengths.push(dist(positions, a, b), dist(positions, b, c), dist(positions, c, a))
  }
  lengths.sort((x, y) => x - y)
  return lengths[Math.floor(lengths.length / 2)]
}

function dist(p: Float32Array, a: number, b: number): number {
  return Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2])
}

/** Each vertex's share of the surface, mm²: a third of every triangle it is
 *  a corner of. */
export function vertexAreas(positions: Float32Array, indices: Uint32Array, vertexCount: number): Float32Array {
  const area = new Float32Array(vertexCount)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const third = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6
    area[indices[t]] += third
    area[indices[t + 1]] += third
    area[indices[t + 2]] += third
  }
  return area
}

/** A small integer hash, for picking an even, repeatable share of the
 *  vertices — the same share every time the same scan is read. */
function hash01(v: number): number {
  let x = (v + 0x9e3779b9) | 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** The vertices a ball is read off, bucketed in cubes of the radius. */
class SampleGrid {
  readonly cell: number
  /** Where each bucket's run of `items` starts; the next one's start ends it. */
  readonly start: Uint32Array
  readonly items: Uint32Array
  private readonly mask: number
  private readonly ox: number
  private readonly oy: number
  private readonly oz: number

  constructor(positions: Float32Array, samples: Uint32Array, cell: number) {
    this.cell = cell
    let ox = Infinity, oy = Infinity, oz = Infinity
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i] * 3
      if (positions[p] < ox) ox = positions[p]
      if (positions[p + 1] < oy) oy = positions[p + 1]
      if (positions[p + 2] < oz) oz = positions[p + 2]
    }
    this.ox = ox
    this.oy = oy
    this.oz = oz
    // An open hash of the cells: two cells in one bucket only cost a few
    // distance checks more, since every point is checked anyway.
    let size = 1024
    while (size < samples.length * 2) size *= 2
    this.mask = size - 1
    const count = new Uint32Array(size + 1)
    const bucket = new Uint32Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i] * 3
      const h = this.bucketOf(this.ix(positions[p]), this.iy(positions[p + 1]), this.iz(positions[p + 2]))
      bucket[i] = h
      count[h + 1]++
    }
    for (let h = 0; h < size; h++) count[h + 1] += count[h]
    this.start = count.slice()
    const fill = count.slice(0, size)
    this.items = new Uint32Array(samples.length)
    for (let i = 0; i < samples.length; i++) this.items[fill[bucket[i]]++] = samples[i]
  }

  ix(x: number): number {
    return Math.floor((x - this.ox) / this.cell)
  }
  iy(y: number): number {
    return Math.floor((y - this.oy) / this.cell)
  }
  iz(z: number): number {
    return Math.floor((z - this.oz) / this.cell)
  }

  bucketOf(i: number, j: number, k: number): number {
    return (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) & this.mask
  }
}

/** The fit at one vertex, in full: its curvatures, the directions they bend
 *  in, and how well the quadric held. */
export interface CurvatureFit {
  /** The larger curvature and the smaller, 1/mm, convex positive. */
  k1: number
  k2: number
  /** Their tangent directions on the scan, unit length. */
  dir1: [number, number, number]
  dir2: [number, number, number]
  /** Points the fit was made from. */
  points: number
  /** The weighted RMS of the scan about the fitted surface, mm. */
  rms: number
}

/** A reusable fitter over one mesh at one radius: the grid of sampled
 *  vertices and the scratch every fit shares. */
export class CurvatureFitter {
  readonly radius: number
  private readonly mesh: CurvatureMesh
  private readonly grid: SampleGrid
  private readonly gather: Uint32Array
  private readonly ata = new Float64Array(36)
  private readonly atb = new Float64Array(6)
  private readonly seen = new Int32Array(27)

  constructor(mesh: CurvatureMesh, radius: number, spacing: number) {
    this.mesh = mesh
    this.radius = radius
    const { positions, vertexCount } = mesh
    // How many vertices a ball holds, and the share of them to read it off.
    const inBall = ballCount(radius, spacing)
    const share = Math.min(1, SAMPLES_PER_BALL / Math.max(inBall, 1))
    let samples: Uint32Array
    if (share >= 1) {
      samples = new Uint32Array(vertexCount)
      for (let v = 0; v < vertexCount; v++) samples[v] = v
    } else {
      const kept: number[] = []
      for (let v = 0; v < vertexCount; v++) if (hash01(v) < share) kept.push(v)
      samples = Uint32Array.from(kept)
    }
    this.grid = new SampleGrid(positions, samples, radius)
    // Room for every point a ball can hold, and more for a crumpled one.
    this.gather = new Uint32Array(Math.max(256, Math.ceil(inBall * share * 8)))
  }

  /** The curvatures at vertex `v`, written to k1[v] and k2[v]; NaN for a
   *  vertex with no normal or too few points around it. */
  fitInto(v: number, k1: Float32Array, k2: Float32Array): void {
    if (!this.solve(v)) {
      k1[v] = NaN
      k2[v] = NaN
      return
    }
    const { kMean, kGauss } = this
    const disc = Math.sqrt(Math.max(0, kMean * kMean - kGauss))
    k1[v] = kMean + disc
    k2[v] = kMean - disc
  }

  /** The curvatures at vertex `v` into `out` (k1, k2); false where there
   *  is no fit. */
  pairAt(v: number, out: Float64Array): boolean {
    if (!this.solve(v)) return false
    const disc = Math.sqrt(Math.max(0, this.kMean * this.kMean - this.kGauss))
    out[0] = this.kMean + disc
    out[1] = this.kMean - disc
    return true
  }

  /** The fit at vertex `v`, with its directions and residual; null where
   *  there is none. */
  fitAt(v: number): CurvatureFit | null {
    if (!this.solve(v, true)) return null
    const fr = this.frame
    const t1 = [fr[0], fr[1], fr[2]]
    const t2 = [fr[3], fr[4], fr[5]]
    const n = [fr[6], fr[7], fr[8]]
    const r = this.radius
    const b = this.coef[1], c = this.coef[2], d = this.coef[3] / r, e = this.coef[4] / r, f = this.coef[5] / r
    const { points, rms } = this
    // The shape operator S = I⁻¹·II of the Monge patch at its origin, in
    // (u, v); turned to convex-positive, as kMean and kGauss are.
    const W = Math.sqrt(1 + b * b + c * c)
    const E = 1 + b * b, F = b * c, G = 1 + c * c
    const L = -(2 * d) / W, M = -e / W, N = -(2 * f) / W
    const det = E * G - F * F
    const s11 = (G * L - F * M) / det, s12 = (G * M - F * N) / det
    const s21 = (E * M - F * L) / det, s22 = (E * N - F * M) / det
    const tr = s11 + s22
    const dt = s11 * s22 - s12 * s21
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - dt))
    const ka = tr / 2 + disc
    const kb = tr / 2 - disc
    const xu: [number, number, number] = [t1[0] + b * n[0], t1[1] + b * n[1], t1[2] + b * n[2]]
    const xv: [number, number, number] = [t2[0] + c * n[0], t2[1] + c * n[1], t2[2] + c * n[2]]
    const along = (k: number, other: number): [number, number, number] => {
      // An eigenvector of S for k; on an umbilic (a ball, a plane) any
      // direction is one, and the first tangent stands for it.
      let p: [number, number]
      if (Math.abs(s12) > 1e-12 || Math.abs(s21) > 1e-12) {
        p = Math.abs(s12) >= Math.abs(s21) ? [s12, k - s11] : [k - s22, s21]
      } else p = Math.abs(s11 - k) <= Math.abs(s22 - k) && k !== other ? [1, 0] : [0, 1]
      const x = xu[0] * p[0] + xv[0] * p[1]
      const y = xu[1] * p[0] + xv[1] * p[1]
      const z = xu[2] * p[0] + xv[2] * p[1]
      const l = Math.hypot(x, y, z) || 1
      return [x / l, y / l, z / l]
    }
    const dir1 = ka - kb < 1e-12 ? [t1[0], t1[1], t1[2]] as [number, number, number] : along(ka, kb)
    // The second square to the first in the tangent plane.
    const nx = xu[1] * xv[2] - xu[2] * xv[1]
    const ny = xu[2] * xv[0] - xu[0] * xv[2]
    const nz = xu[0] * xv[1] - xu[1] * xv[0]
    const nl = Math.hypot(nx, ny, nz) || 1
    const tn = [nx / nl, ny / nl, nz / nl]
    const d2x = tn[1] * dir1[2] - tn[2] * dir1[1]
    const d2y = tn[2] * dir1[0] - tn[0] * dir1[2]
    const d2z = tn[0] * dir1[1] - tn[1] * dir1[0]
    const d2l = Math.hypot(d2x, d2y, d2z) || 1
    return { k1: ka, k2: kb, dir1, dir2: [d2x / d2l, d2y / d2l, d2z / d2l], points, rms }
  }

  // The last fit's frame and coefficients, read by fitAt: kept on the fitter
  // rather than returned, so the fit at every vertex makes no garbage.
  private kMean = 0
  private kGauss = 0
  private points = 0
  private rms = 0
  private readonly frame = new Float64Array(9)
  private readonly coef = new Float64Array(6)

  /** Fit at vertex `v`: false where there is none. The result is left in
   *  kMean, kGauss and, with `full`, the frame, coefficients and RMS. */
  private solve(v: number, full = false): boolean {
    const P = this.mesh.positions
    const Nn = this.mesh.normals
    const r = this.radius
    const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2]
    let nx = Nn[v * 3], ny = Nn[v * 3 + 1], nz = Nn[v * 3 + 2]
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (!(nl > 1e-12)) return false
    nx /= nl
    ny /= nl
    nz /= nl
    // A tangent frame: the axis the normal is least along, crossed with it.
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
    let t1x = 0, t1y = 0, t1z = 0
    if (ax <= ay && ax <= az) {
      t1y = -nz
      t1z = ny
    } else if (ay <= az) {
      t1x = nz
      t1z = -nx
    } else {
      t1x = -ny
      t1y = nx
    }
    const tl = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z)
    t1x /= tl
    t1y /= tl
    t1z /= tl
    const t2x = ny * t1z - nz * t1y
    const t2y = nz * t1x - nx * t1z
    const t2z = nx * t1y - ny * t1x

    // The points in the ball facing this way.
    const grid = this.grid
    const start = grid.start
    const items = grid.items
    const i0 = grid.ix(px), j0 = grid.iy(py), k0 = grid.iz(pz)
    const r2 = r * r
    const facing2 = FACING_COS * FACING_COS
    const gather = this.gather
    const cap = gather.length
    let count = 0
    let self = false
    // Two of the 27 cells can hash to one bucket; read each bucket once, or
    // its points would count twice.
    const seen = this.seen
    let seenCount = 0
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (let dk = -1; dk <= 1; dk++) {
          const bucket = grid.bucketOf(i0 + di, j0 + dj, k0 + dk)
          let repeat = false
          for (let i = 0; i < seenCount; i++)
            if (seen[i] === bucket) {
              repeat = true
              break
            }
          if (repeat) continue
          seen[seenCount++] = bucket
          const e = start[bucket + 1]
          for (let q = start[bucket]; q < e; q++) {
            const w = items[q]
            const o = w * 3
            const dx = P[o] - px, dy = P[o + 1] - py, dz = P[o + 2] - pz
            if (dx * dx + dy * dy + dz * dz > r2) continue
            const mx = Nn[o], my = Nn[o + 1], mz = Nn[o + 2]
            const dot = mx * nx + my * ny + mz * nz
            if (dot < 0 && dot * dot > facing2 * (mx * mx + my * my + mz * mz)) continue
            if (w === v) self = true
            if (count < cap) gather[count++] = w
          }
        }
    // The vertex itself, when the sampling passed it over: the reading is
    // about it, and it is on the surface for certain.
    if (!self && count < cap) gather[count++] = v
    if (count < MIN_POINTS) return false

    // Weighted normal equations in (u, w) scaled by the radius, for a
    // well-conditioned 6 × 6: the 21 sums of the upper triangle by name.
    const ir = 1 / r
    const ir2 = 1 / r2
    let s00 = 0, s01 = 0, s02 = 0, s03 = 0, s04 = 0, s05 = 0
    let s11 = 0, s12 = 0, s13 = 0, s14 = 0, s15 = 0
    let s22 = 0, s23 = 0, s24 = 0, s25 = 0
    let s33 = 0, s34 = 0, s35 = 0
    let s44 = 0, s45 = 0
    let s55 = 0
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0
    for (let i = 0; i < count; i++) {
      const o = gather[i] * 3
      const dx = P[o] - px, dy = P[o + 1] - py, dz = P[o + 2] - pz
      const u = (dx * t1x + dy * t1y + dz * t1z) * ir
      const w = (dx * t2x + dy * t2y + dz * t2z) * ir
      const h = (dx * nx + dy * ny + dz * nz) * ir
      const q = 1 - (dx * dx + dy * dy + dz * dz) * ir2
      // Nearer counts for more, falling smoothly to nothing at the radius,
      // so a point stepping across the edge of the ball moves nothing.
      const k = q * q + 1e-6
      const uu = u * u, uw = u * w, ww = w * w
      const ku = k * u, kw = k * w, kuu = k * uu, kuw = k * uw, kww = k * ww
      s00 += k
      s01 += ku
      s02 += kw
      s03 += kuu
      s04 += kuw
      s05 += kww
      s11 += ku * u
      s12 += ku * w
      s13 += ku * uu
      s14 += ku * uw
      s15 += ku * ww
      s22 += kw * w
      s23 += kw * uu
      s24 += kw * uw
      s25 += kw * ww
      s33 += kuu * uu
      s34 += kuu * uw
      s35 += kuu * ww
      s44 += kuw * uw
      s45 += kuw * ww
      s55 += kww * ww
      b0 += k * h
      b1 += ku * h
      b2 += kw * h
      b3 += kuu * h
      b4 += kuw * h
      b5 += kww * h
    }
    const m = this.ata
    m[0] = s00; m[1] = s01; m[2] = s02; m[3] = s03; m[4] = s04; m[5] = s05
    m[6] = s01; m[7] = s11; m[8] = s12; m[9] = s13; m[10] = s14; m[11] = s15
    m[12] = s02; m[13] = s12; m[14] = s22; m[15] = s23; m[16] = s24; m[17] = s25
    m[18] = s03; m[19] = s13; m[20] = s23; m[21] = s33; m[22] = s34; m[23] = s35
    m[24] = s04; m[25] = s14; m[26] = s24; m[27] = s34; m[28] = s44; m[29] = s45
    m[30] = s05; m[31] = s15; m[32] = s25; m[33] = s35; m[34] = s45; m[35] = s55
    const y = this.atb
    y[0] = b0; y[1] = b1; y[2] = b2; y[3] = b3; y[4] = b4; y[5] = b5
    const x = this.coef
    if (!solve6(m, y, x)) return false
    // Back from the scaled frame: h/r = Σ x·(u/r)^k, so a linear term is
    // as it is, a quadratic one over r.
    const b = x[1], c = x[2], d = x[3] * ir, e = x[4] * ir, f = x[5] * ir
    // Mean and Gaussian curvature of the patch at its origin; the outward
    // normal is +h, so a convex surface bends towards −h and its d, f are
    // negative — the mean's sign turned for convex positive.
    const W = Math.sqrt(1 + b * b + c * c)
    const E = 1 + b * b, F = b * c, G = 1 + c * c
    const L = (2 * d) / W, M = e / W, N = (2 * f) / W
    const det = E * G - F * F
    const kGauss = (L * N - M * M) / det
    const kMean = -(E * N - 2 * F * M + G * L) / (2 * det)
    if (!Number.isFinite(kMean) || !Number.isFinite(kGauss)) return false
    this.kMean = kMean
    this.kGauss = kGauss
    this.points = count
    if (!full) return true
    const fr = this.frame
    fr[0] = t1x; fr[1] = t1y; fr[2] = t1z
    fr[3] = t2x; fr[4] = t2y; fr[5] = t2z
    fr[6] = nx; fr[7] = ny; fr[8] = nz
    let res = 0
    for (let i = 0; i < count; i++) {
      const o = gather[i] * 3
      const dx = P[o] - px, dy = P[o + 1] - py, dz = P[o + 2] - pz
      const u = (dx * t1x + dy * t1y + dz * t1z) * ir
      const w = (dx * t2x + dy * t2y + dz * t2z) * ir
      const h = (dx * nx + dy * ny + dz * nz) * ir
      const q = 1 - (dx * dx + dy * dy + dz * dz) * ir2
      const fit = x[0] + x[1] * u + x[2] * w + x[3] * u * u + x[4] * u * w + x[5] * w * w
      res += (q * q + 1e-6) * (h - fit) ** 2
    }
    this.rms = Math.sqrt(res / s00) * r
    return true
  }
}

/** Solve a symmetric 6 × 6 by Gaussian elimination with partial pivoting,
 *  in place, into `x`; false when it is singular (the points on a line, or
 *  all at one spot). */
function solve6(m: Float64Array, y: Float64Array, x: Float64Array): boolean {
  let scale = 0
  for (let i = 0; i < 6; i++) scale = Math.max(scale, Math.abs(m[i * 6 + i]))
  const tiny = Math.max(scale, 1e-300) * 1e-12
  for (let col = 0; col < 6; col++) {
    let piv = col
    for (let r = col + 1; r < 6; r++) if (Math.abs(m[r * 6 + col]) > Math.abs(m[piv * 6 + col])) piv = r
    if (!(Math.abs(m[piv * 6 + col]) > tiny)) return false
    if (piv !== col) {
      for (let k = 0; k < 6; k++) {
        const t = m[col * 6 + k]
        m[col * 6 + k] = m[piv * 6 + k]
        m[piv * 6 + k] = t
      }
      const t = y[col]
      y[col] = y[piv]
      y[piv] = t
    }
    const inv = 1 / m[col * 6 + col]
    for (let r = col + 1; r < 6; r++) {
      const f = m[r * 6 + col] * inv
      if (f === 0) continue
      for (let k = col; k < 6; k++) m[r * 6 + k] -= f * m[col * 6 + k]
      y[r] -= f * y[col]
    }
  }
  for (let r = 5; r >= 0; r--) {
    let s = y[r]
    for (let k = r + 1; k < 6; k++) s -= m[r * 6 + k] * x[k]
    x[r] = s / m[r * 6 + r]
  }
  return true
}

/** The principal curvatures at every vertex, read over a ball of `radius`
 *  mm — by default a few edge lengths, more where the scan's scatter asks
 *  for it (`noise`, mm; read off the scan by scanScatter when not given).
 *  `progress` hears the share done now and then. */
export function principalCurvatures(
  mesh: CurvatureMesh,
  options: { radius?: number | null; noise?: number; progress?: (done: number) => void } = {},
): PrincipalCurvatures {
  const spacing = meshSpacing(mesh.positions, mesh.indices)
  const noise = options.noise !== undefined ? Math.max(0, options.noise) : scanScatter(mesh, spacing)
  const radius = options.radius && options.radius > 0 ? options.radius : defaultCurvatureRadius(spacing, noise)
  // The scatter's own figure, or the bumps the scan reads, whichever is
  // more: a scanner's bumps a few triangles wide read more than its
  // scatter accounts for.
  const noiseFloor = radius > 0 ? Math.max(curvatureNoise(radius, spacing, noise), bumpCurvature(mesh, spacing, radius)) : 0
  const n = mesh.vertexCount
  const k1 = new Float32Array(n)
  const k2 = new Float32Array(n)
  const area = vertexAreas(mesh.positions, mesh.indices, n)
  if (n === 0 || !(radius > 0)) return { k1, k2, area, radius, spacing, noise, noiseFloor }
  const fitter = new CurvatureFitter(mesh, radius, spacing)
  // A ball many vertices across reads a curvature that changes over the
  // ball, not from vertex to vertex: it is fitted at an even share of the
  // vertices, some CENTRES_PER_BALL to a ball, and the vertices between
  // take their neighbours' readings. Without the mesh's adjacency to carry
  // them, every vertex is fitted.
  const share = mesh.adjOffsets && mesh.adjList ? Math.min(1, CENTRES_PER_BALL / ballCount(radius, spacing)) : 1
  const every = Math.max(1, Math.floor(n / 50))
  const fitted = share < 1 ? new Uint8Array(n) : null
  for (let v = 0; v < n; v++) {
    if (fitted && hash01(v ^ 0x5bd1e995) >= share) continue
    fitter.fitInto(v, k1, k2)
    if (fitted) fitted[v] = 1
    if (options.progress && v % every === 0) options.progress(v / n)
  }
  if (fitted) fillBetween(mesh.adjOffsets!, mesh.adjList!, fitted, k1, k2, (v) => fitter.fitInto(v, k1, k2))
  return { k1, k2, area, radius, spacing, noise, noiseFloor }
}

/** Fitted centres per ball, when not every vertex is fitted. */
const CENTRES_PER_BALL = 60

/** How many vertices a ball of `radius` holds on an even mesh of this
 *  spacing: an equilateral triangle's vertex owns √3/2 of an edge squared. */
function ballCount(radius: number, spacing: number): number {
  return (Math.PI * radius * radius) / (Math.max(spacing, 1e-9) ** 2 * (Math.sqrt(3) / 2))
}

/** Give every vertex not fitted the mean of its neighbours' readings, ring
 *  by ring out from the fitted ones; a vertex no fitted one reaches (a
 *  shard of the scan with no centre on it) is fitted itself. */
function fillBetween(
  adjOffsets: Uint32Array,
  adjList: Uint32Array,
  done: Uint8Array,
  k1: Float32Array,
  k2: Float32Array,
  fit: (v: number) => void,
): void {
  const n = done.length
  let frontier: number[] = []
  for (let v = 0; v < n; v++) if (done[v]) frontier.push(v)
  // A ring is marked 2 while it is read, so its readings come only from
  // the rings inside it.
  while (frontier.length > 0) {
    const ring: number[] = []
    for (const v of frontier)
      for (let k = adjOffsets[v]; k < adjOffsets[v + 1]; k++) {
        const w = adjList[k]
        if (done[w]) continue
        done[w] = 2
        ring.push(w)
      }
    for (const w of ring) {
      let a = 0, b = 0, m = 0
      for (let k = adjOffsets[w]; k < adjOffsets[w + 1]; k++) {
        const u = adjList[k]
        if (done[u] !== 1 || Number.isNaN(k1[u])) continue
        a += k1[u]
        b += k2[u]
        m++
      }
      k1[w] = m > 0 ? a / m : NaN
      k2[w] = m > 0 ? b / m : NaN
    }
    for (const w of ring) done[w] = 1
    frontier = ring
  }
  for (let v = 0; v < n; v++) if (!done[v]) fit(v)
}

/** Which reading of the two curvatures a map shows. `principal`: the one
 *  that bends harder, signed — 1/R on a ball and on a cylinder alike, so
 *  a round reads as its radius however it is shaped; `mean`, their average;
 *  `gaussian`, their product (1/mm²), positive on a dome either way,
 *  negative on a saddle, nothing on a cylinder or a flat. */
export type CurvatureQuantity = 'principal' | 'mean' | 'gaussian'
export const CURVATURE_QUANTITIES: readonly CurvatureQuantity[] = ['principal', 'mean', 'gaussian']

/** One reading of the pair. */
export function curvatureOf(k1: number, k2: number, quantity: CurvatureQuantity): number {
  if (quantity === 'mean') return (k1 + k2) / 2
  if (quantity === 'gaussian') return k1 * k2
  return Math.abs(k1) >= Math.abs(k2) ? k1 : k2
}

/** The reading at every vertex, NaN where there is none. */
export function curvatureValues(k1: Float32Array, k2: Float32Array, quantity: CurvatureQuantity): Float32Array {
  const out = new Float32Array(k1.length)
  for (let v = 0; v < k1.length; v++) out[v] = curvatureOf(k1[v], k2[v], quantity)
  return out
}

/** The colour range a map is read at by itself, 1/mm: the stronger
 *  curvature nine vertices in ten stay under, so the flats and the gentle
 *  blends spread over the ramp and the sharp edges run into the caps —
 *  never under that of a round as large as the part (`size`, its
 *  diagonal), which on a block of flats would stretch the noise over it. */
export function autoCurvatureRange(k1: Float32Array, k2: Float32Array, size: number): number {
  const step = Math.max(1, Math.floor(k1.length / 50_000))
  const sample: number[] = []
  for (let v = 0; v < k1.length; v += step) {
    const x = Math.max(Math.abs(k1[v]), Math.abs(k2[v]))
    if (!Number.isNaN(x)) sample.push(x)
  }
  const floor = size > 0 ? 2 / size : 1e-3
  if (sample.length === 0) return floor
  sample.sort((a, b) => a - b)
  return Math.max(floor, sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.9))])
}

/** How the surface splits, by area: flat where both curvatures are under
 *  `flatBelow` (1/mm); convex where it bends outward and nowhere inward
 *  past that, concave the other way; a saddle where it bends both ways;
 *  unread where there was no fit. Shares of the area read, 0…1. */
export interface CurvatureShares {
  flat: number
  convex: number
  concave: number
  saddle: number
  /** The share of the whole surface with no reading. */
  unread: number
}

export type CurvatureClass = 'flat' | 'convex' | 'concave' | 'saddle'

export function classifyCurvature(k1: number, k2: number, flatBelow: number): CurvatureClass | null {
  if (Number.isNaN(k1) || Number.isNaN(k2)) return null
  const out = k1 >= flatBelow
  const into = k2 <= -flatBelow
  if (out && into) return 'saddle'
  if (out) return 'convex'
  if (into) return 'concave'
  return 'flat'
}

export function curvatureShares(k1: Float32Array, k2: Float32Array, area: Float32Array, flatBelow: number): CurvatureShares {
  const sums = { flat: 0, convex: 0, concave: 0, saddle: 0 }
  let unread = 0
  let total = 0
  for (let v = 0; v < k1.length; v++) {
    const a = area[v]
    total += a
    const c = classifyCurvature(k1[v], k2[v], flatBelow)
    if (c) sums[c] += a
    else unread += a
  }
  const read = total - unread
  const share = (x: number) => (read > 0 ? x / read : 0)
  return {
    flat: share(sums.flat),
    convex: share(sums.convex),
    concave: share(sums.concave),
    saddle: share(sums.saddle),
    unread: total > 0 ? unread / total : 0,
  }
}
