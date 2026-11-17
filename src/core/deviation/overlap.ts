// SPDX-License-Identifier: AGPL-3.0-only
// One partial scan placed on another of the same part: the underside scanned
// separately and brought onto the top, say, to be merged into one mesh.
//
// The best fits in align.ts measure every point of the scan against the
// reference and so assume the scan lies wholly on it — true of a part and its
// CAD, false of two sides of a part, whose shared surface may be a narrow band
// round the middle. There, a fit that counts every point is pulled off by the
// half of the other scan that has nothing under it: from three hand-picked
// pairs it drifts away, and its automatic start (the principal axes) is
// meaningless for a half. Here only the overlap counts:
//
// - The refinement is the local fit's ICP over the whole of the other scan,
//   every pair beyond a gate refused, the gate closing in three steps from a
//   twentieth of the part's size to a two-hundredth — what lies off the
//   overlap simply finds nothing and does not vote.
// - The automatic start is a search for the overlap itself: each scan
//   thinned to a few thousand points, each point described by its Fast
//   Point Feature Histogram (Rusu, Blodow and Beetz, "Fast Point Feature
//   Histograms (FPFH) for 3D Registration", ICRA 2009) — how the normals
//   round it turn — and the descriptors matched across; random triples of
//   matches whose lengths agree give poses, scored by how many matches they
//   bring together. The best few, and the frame the files came in, are
//   refined and the one that overlaps most is kept.
//
// The answer carries the other scan's coordinates into this one's, and says
// how much of the other scan the overlap is — the figure that tells a right
// placement (a band of shared surface) from a wrong one (a sliver).

import { absoluteOrientation } from './absoluteOrientation'
import type { PointPair } from './align'
import { icp, sampleScan, type ScanSamples } from './icp'
import { mulberry32 } from '../fit/ransac'
import { identityRigid, rigidApply, rigidDisagreement, type Rigid } from './rigid'
import { emptyHit, type NominalSurface } from './surface'
import type { Vec3 } from '../types'

export type OverlapSource = 'auto' | 'frame' | 'points'

export interface OverlapResult {
  /** Carries the other scan's coordinates into this one's. */
  transform: Rigid
  /** auto: found by the search; frame: the files' own frame was right
   *  already; points: from picked pairs. */
  source: OverlapSource
  /** RMS of the point-to-plane residuals over the overlap, mm. */
  rms: number
  /** The share of the other scan that lies on this one, 0–1. */
  overlap: number
  matched: number
  sampled: number
  /** The final gate: how close a point had to come to count, mm. */
  gate: number
  /** Set when a materially different placement overlapped nearly as much:
   *  a symmetric part can sit two ways. */
  ambiguous: boolean
}

export interface OverlapOptions {
  onProgress?: (text: string) => void
  /** RANSAC draws for the automatic search. */
  iterations?: number
  seed?: number
}

/** The gates the refinement closes through, as shares of the part's
 *  diagonal. The last is the overlap's definition: a point within it lies on
 *  the other scan. */
const GATES = [0.05, 0.015, 0.005]
/** Points the refinement samples from the other scan, each pass. */
const FINE_SAMPLES = 20_000
/** A placement overlapping at least this share of the best one's is a
 *  rival: the part may sit either way. */
const RIVAL = 0.85
/** Below this share of the other scan lying on this one, a placement is a
 *  sliver found by chance, not the two scans' shared surface. */
const MIN_OVERLAP = 0.05
const NOT_PLACED = 'The other scan could not be placed on this one by itself — too little of the two looks alike. Pick three points on each that are the same place.'

/** How close a point must lie to count as lying on the other scan when
 *  placements are compared: three times the noise the best of them fits to,
 *  between these shares of the part's diagonal. A placement that lays one
 *  side of a nearly symmetric part over the other — the underside of a
 *  dome over its top — can bring more of it within the overlap's gate than
 *  the right one does, and still lie a few tenths off all over; the right
 *  one lies on it to the scanner's noise. */
const TIGHT_MIN = 0.0003
const TIGHT_MAX = 0.002
/** The most a right placement's residual over the overlap may be, as a
 *  share of the part's diagonal, and at least this many millimetres: a
 *  scanner's noise is well under either, and a placement that only lays a
 *  look-alike surface over this one — all that is left when the two scans
 *  share too little to be matched — lies a few tenths off. */
const LOOSE = 0.0015
const LOOSE_MM = 0.15 // units-ok: a scanner's noise, in the worker's millimetres
/** How many distinct placements are refined in full. */
const FINALS = 3

/** The share of the samples that lie within `gate` of the surface at `pose`. */
function lyingOn(surface: NominalSurface, samples: ScanSamples, pose: Rigid, gate: number): number {
  const hit = emptyHit()
  const p = new Float64Array(3)
  let on = 0
  for (let i = 0; i < samples.count; i++) {
    rigidApply(pose, samples.xyz[i * 3], samples.xyz[i * 3 + 1], samples.xyz[i * 3 + 2], p)
    if (surface.closest(p[0], p[1], p[2], hit, gate)) on++
  }
  return on / Math.max(1, samples.count)
}

/** The gates for a part of this size, mm. */
export function overlapGates(surface: NominalSurface): number[] {
  return GATES.map((g) => g * surface.bboxDiagonal)
}

/** How a refinement runs: the samples it draws and the passes it allows at
 *  each gate. The full one decides; the screen only sorts the candidates. */
interface Effort {
  samples: number
  iterations: number
}
const FULL: Effort = { samples: FINE_SAMPLES, iterations: 60 }
const SCREEN: Effort = { samples: 3000, iterations: 12 }

/**
 * The fit from a pose roughly right, on the overlap only: ICP over the other
 * scan with every pair beyond the gate refused, the gate closing in steps —
 * the local fit's settings (align.ts alignLocal), over every point of the
 * other scan rather than a marked patch. Null when nothing of the other scan
 * came within a gate.
 */
export function refineOverlap(
  surface: NominalSurface,
  positions: Float32Array,
  normals: Float32Array | null,
  start: Rigid,
  source: OverlapSource,
  options: OverlapOptions = {},
  effort: Effort = FULL,
): OverlapResult | null {
  const gates = overlapGates(surface)
  const samples = sampleScan(positions, normals, effort.samples)
  let pose = start
  let last: ReturnType<typeof icp> | null = null
  for (const gate of gates) {
    last = icp(surface, samples, pose, {
      maxIterations: effort.iterations,
      rejectMedianFactor: 3,
      minNormalDot: 0.5,
      facingSearch: true,
      maxPairDistance: gate,
      scoreCap: gate,
      // units-ok: built in the worker, which holds no display units
      onIteration: options.onProgress ? (i, d) => options.onProgress?.(`Placing the other scan — pass ${i}, mean distance ${d.toFixed(4)} mm…`) : undefined,
    })
    if (last.matched === 0) return null
    pose = last.transform
  }
  if (!last) return null
  return {
    transform: pose,
    source,
    rms: last.rms,
    overlap: last.matched / Math.max(1, last.sampled),
    matched: last.matched,
    sampled: last.sampled,
    gate: gates[gates.length - 1],
    ambiguous: false,
  }
}

/** Under this the picked points lie too nearly on a line to fix the turn
 *  about it — as align.ts holds a picked fit to. */
const MIN_CONDITIONING = 0.01

/** The other scan placed from three or more picked pairs (on it, `scan`; on
 *  this one, `nominal`), then refined on the overlap. */
export function overlapFromPairs(
  surface: NominalSurface,
  positions: Float32Array,
  normals: Float32Array | null,
  pairs: PointPair[],
  options: OverlapOptions = {},
): OverlapResult {
  if (pairs.length < 3) throw new Error('Pick at least three pairs of points: each on the other scan and the same place on this one.')
  const ao = absoluteOrientation(
    pairs.map((p) => p.scan),
    pairs.map((p) => p.nominal),
  )
  if (!ao || ao.conditioning < MIN_CONDITIONING) {
    throw new Error('The picked points lie nearly on a line, which leaves the turn about it free — pick them spread over the part.')
  }
  const r = refineOverlap(surface, positions, normals, ao.transform, 'points', options)
  if (!r) throw new Error('From the picked points the other scan does not reach this one — check each pair is the same place on both.')
  return r
}

// ---- the automatic search

/** A scan thinned to one point per cell of a grid, the cell's mean, with its
 *  mean normal. */
interface Cloud {
  xyz: Float64Array
  nrm: Float64Array
  count: number
}

function thin(positions: Float32Array, normals: Float32Array, cell: number): Cloud {
  const cells = new Map<string, number>()
  const sum: number[] = []
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v], y = positions[v + 1], z = positions[v + 2]
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
    let i = cells.get(key)
    if (i === undefined) {
      i = sum.length / 7
      cells.set(key, i)
      sum.push(0, 0, 0, 0, 0, 0, 0)
    }
    const o = i * 7
    sum[o] += x; sum[o + 1] += y; sum[o + 2] += z
    sum[o + 3] += normals[v]; sum[o + 4] += normals[v + 1]; sum[o + 5] += normals[v + 2]
    sum[o + 6]++
  }
  const count = sum.length / 7
  const xyz = new Float64Array(count * 3)
  const nrm = new Float64Array(count * 3)
  let kept = 0
  for (let i = 0; i < count; i++) {
    const o = i * 7
    const n = sum[o + 6]
    const l = Math.hypot(sum[o + 3], sum[o + 4], sum[o + 5])
    // A cell whose normals cancel is an edge seen from both sides, or noise:
    // it has no one facing to describe.
    if (l < 0.3 * n) continue
    xyz[kept * 3] = sum[o] / n; xyz[kept * 3 + 1] = sum[o + 1] / n; xyz[kept * 3 + 2] = sum[o + 2] / n
    nrm[kept * 3] = sum[o + 3] / l; nrm[kept * 3 + 1] = sum[o + 4] / l; nrm[kept * 3 + 2] = sum[o + 5] / l
    kept++
  }
  return { xyz: xyz.subarray(0, kept * 3), nrm: nrm.subarray(0, kept * 3), count: kept }
}

/** Each point's neighbours within `radius`, through a grid of that size. */
function neighbours(c: Cloud, radius: number): { offsets: Uint32Array; list: Uint32Array; dist: Float32Array } {
  const grid = new Map<string, number[]>()
  const keyOf = (x: number, y: number, z: number) => `${Math.floor(x / radius)},${Math.floor(y / radius)},${Math.floor(z / radius)}`
  for (let i = 0; i < c.count; i++) {
    const k = keyOf(c.xyz[i * 3], c.xyz[i * 3 + 1], c.xyz[i * 3 + 2])
    const b = grid.get(k)
    if (b) b.push(i)
    else grid.set(k, [i])
  }
  const offsets = new Uint32Array(c.count + 1)
  const list: number[] = []
  const dist: number[] = []
  const r2 = radius * radius
  for (let i = 0; i < c.count; i++) {
    const x = c.xyz[i * 3], y = c.xyz[i * 3 + 1], z = c.xyz[i * 3 + 2]
    const gx = Math.floor(x / radius), gy = Math.floor(y / radius), gz = Math.floor(z / radius)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const b = grid.get(`${gx + dx},${gy + dy},${gz + dz}`)
          if (!b) continue
          for (const j of b) {
            if (j === i) continue
            const ex = c.xyz[j * 3] - x, ey = c.xyz[j * 3 + 1] - y, ez = c.xyz[j * 3 + 2] - z
            const d2 = ex * ex + ey * ey + ez * ez
            if (d2 <= r2) {
              list.push(j)
              dist.push(Math.sqrt(d2))
            }
          }
        }
    offsets[i + 1] = list.length
  }
  return { offsets, list: Uint32Array.from(list), dist: Float32Array.from(dist) }
}

const BINS = 11
const FEATURE = 3 * BINS

/**
 * Each point's Fast Point Feature Histogram: for every neighbour, the three
 * angles of a Darboux frame on the pair — how the neighbour's normal turns
 * against the point's, seen along the line between them — binned eleven
 * ways each (its SPFH); then each point's own histogram plus its
 * neighbours', weighted by nearness.
 */
function fpfh(c: Cloud, nb: ReturnType<typeof neighbours>): Float32Array {
  const spfh = new Float32Array(c.count * FEATURE)
  for (let i = 0; i < c.count; i++) {
    const px = c.xyz[i * 3], py = c.xyz[i * 3 + 1], pz = c.xyz[i * 3 + 2]
    const ux = c.nrm[i * 3], uy = c.nrm[i * 3 + 1], uz = c.nrm[i * 3 + 2]
    const from = nb.offsets[i], to = nb.offsets[i + 1]
    if (to === from) continue
    const h = i * FEATURE
    for (let k = from; k < to; k++) {
      const j = nb.list[k]
      const d = nb.dist[k]
      const ex = (c.xyz[j * 3] - px) / d, ey = (c.xyz[j * 3 + 1] - py) / d, ez = (c.xyz[j * 3 + 2] - pz) / d
      // v = u × e, w = u × v
      let vx = uy * ez - uz * ey, vy = uz * ex - ux * ez, vz = ux * ey - uy * ex
      const vl = Math.hypot(vx, vy, vz)
      if (vl < 1e-9) continue
      vx /= vl; vy /= vl; vz /= vl
      const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx
      const nx = c.nrm[j * 3], ny = c.nrm[j * 3 + 1], nz = c.nrm[j * 3 + 2]
      const alpha = vx * nx + vy * ny + vz * nz
      const phi = ux * ex + uy * ey + uz * ez
      const theta = Math.atan2(wx * nx + wy * ny + wz * nz, ux * nx + uy * ny + uz * nz)
      const bin = (v: number, lo: number, hi: number) => Math.min(BINS - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * BINS)))
      spfh[h + bin(alpha, -1, 1)]++
      spfh[h + BINS + bin(phi, -1, 1)]++
      spfh[h + 2 * BINS + bin(theta, -Math.PI, Math.PI)]++
    }
    const n = to - from
    for (let b = 0; b < FEATURE; b++) spfh[h + b] = (spfh[h + b] * 100) / n
  }
  const out = new Float32Array(c.count * FEATURE)
  for (let i = 0; i < c.count; i++) {
    const h = i * FEATURE
    for (let b = 0; b < FEATURE; b++) out[h + b] = spfh[h + b]
    const from = nb.offsets[i], to = nb.offsets[i + 1]
    const k = to - from
    if (k === 0) continue
    for (let q = from; q < to; q++) {
      const j = nb.list[q] * FEATURE
      const w = 1 / (k * Math.max(nb.dist[q], 1e-9))
      for (let b = 0; b < FEATURE; b++) out[h + b] += w * spfh[j + b]
    }
    // Each of the three histograms back to a share of 100.
    for (let part = 0; part < 3; part++) {
      let s = 0
      for (let b = 0; b < BINS; b++) s += out[h + part * BINS + b]
      if (s > 0) for (let b = 0; b < BINS; b++) out[h + part * BINS + b] *= 100 / s
    }
  }
  return out
}

/** For each point of `b`, the point of `a` whose histogram is nearest. */
function matchFeatures(fa: Float32Array, na: number, fb: Float32Array, nb: number): Uint32Array {
  const match = new Uint32Array(nb)
  for (let i = 0; i < nb; i++) {
    let best = Infinity
    let at = 0
    const hi = i * FEATURE
    for (let j = 0; j < na; j++) {
      const hj = j * FEATURE
      let d = 0
      for (let b = 0; b < FEATURE && d < best; b++) {
        const e = fb[hi + b] - fa[hj + b]
        d += e * e
      }
      if (d < best) {
        best = d
        at = j
      }
    }
    match[i] = at
  }
  return match
}

const pt = (c: Cloud, i: number): Vec3 => [c.xyz[i * 3], c.xyz[i * 3 + 1], c.xyz[i * 3 + 2]]

/** Poses from random triples of matches whose lengths agree, best first by
 *  how many matches each brings within `near`; distinct ones only. */
function ransac(a: Cloud, b: Cloud, match: Uint32Array, near: number, minSide: number, iterations: number, seed: number, center: Vec3, radius: number): Rigid[] {
  const rand = mulberry32(seed)
  const n = b.count
  const out = new Float64Array(3)
  const found: { pose: Rigid; score: number }[] = []
  const near2 = near * near
  const lenB = (i: number, j: number) => Math.hypot(b.xyz[i * 3] - b.xyz[j * 3], b.xyz[i * 3 + 1] - b.xyz[j * 3 + 1], b.xyz[i * 3 + 2] - b.xyz[j * 3 + 2])
  const lenA = (i: number, j: number) => Math.hypot(a.xyz[i * 3] - a.xyz[j * 3], a.xyz[i * 3 + 1] - a.xyz[j * 3 + 1], a.xyz[i * 3 + 2] - a.xyz[j * 3 + 2])
  for (let it = 0; it < iterations; it++) {
    const i = Math.floor(rand() * n), j = Math.floor(rand() * n), k = Math.floor(rand() * n)
    if (i === j || j === k || i === k) continue
    const ai = match[i], aj = match[j], ak = match[k]
    // The triangle the three make must be the same size on both scans, and
    // not so small that a millimetre's error swings the pose.
    let ok = true
    for (const [p, q, r, s] of [[i, j, ai, aj], [j, k, aj, ak], [i, k, ai, ak]]) {
      const lb = lenB(p, q)
      const la = lenA(r, s)
      if (lb < minSide || Math.abs(lb - la) > 0.1 * lb) ok = false
    }
    if (!ok) continue
    const ao = absoluteOrientation([pt(b, i), pt(b, j), pt(b, k)], [pt(a, ai), pt(a, aj), pt(a, ak)])
    if (!ao || ao.conditioning < MIN_CONDITIONING) continue
    let score = 0
    for (let m = 0; m < n; m++) {
      rigidApply(ao.transform, b.xyz[m * 3], b.xyz[m * 3 + 1], b.xyz[m * 3 + 2], out)
      const t = match[m]
      const dx = out[0] - a.xyz[t * 3], dy = out[1] - a.xyz[t * 3 + 1], dz = out[2] - a.xyz[t * 3 + 2]
      if (dx * dx + dy * dy + dz * dz < near2) score++
    }
    if (score < 3) continue
    // Keep the best few that differ from each other.
    const same = found.find((f) => rigidDisagreement(f.pose, ao.transform, center, radius) < 4 * near)
    if (same) {
      if (score > same.score) {
        same.pose = ao.transform
        same.score = score
      }
    } else found.push({ pose: ao.transform, score })
    if (found.length > 64) {
      found.sort((x, y) => y.score - x.score)
      found.length = 32
    }
  }
  found.sort((x, y) => y.score - x.score)
  return found.slice(0, 6).map((f) => f.pose)
}

/**
 * The other scan placed on this one with no help: the frame the files came
 * in, and the poses the feature search finds, each refined on the overlap;
 * the one that overlaps most is kept. `normals` are the other scan's;
 * `ownNormals` this one's, vertex by vertex of `surface`.
 */
export function overlapAuto(
  surface: NominalSurface,
  ownNormals: Float32Array,
  positions: Float32Array,
  normals: Float32Array,
  options: OverlapOptions = {},
): OverlapResult {
  const progress = options.onProgress
  const diag = surface.bboxDiagonal
  const cell = diag / 60
  const radius = 5 * cell
  progress?.('Placing the other scan — thinning both scans…')
  const a = thin(surface.positions, ownNormals, cell)
  const b = thin(positions, normals, cell)
  if (a.count < 10 || b.count < 10) throw new Error('One of the scans is too small to place the other by.')
  progress?.('Placing the other scan — describing their surface…')
  const fa = fpfh(a, neighbours(a, radius))
  const fb = fpfh(b, neighbours(b, radius))
  progress?.('Placing the other scan — matching the two…')
  const match = matchFeatures(fa, a.count, fb, b.count)
  const center: Vec3 = [
    (surface.bboxMin[0] + surface.bboxMax[0]) / 2,
    (surface.bboxMin[1] + surface.bboxMax[1]) / 2,
    (surface.bboxMin[2] + surface.bboxMax[2]) / 2,
  ]
  const starts = ransac(a, b, match, 2 * cell, 3 * cell, options.iterations ?? 40_000, options.seed ?? 0x5eed, center, diag / 2)

  // Every start screened cheaply, through the same gates — a placement that
  // only overlaps loosely sorts below one that lies on it — and the best two
  // refined in full. The frame the files came in is always refined: two
  // scans exported in one frame are placed already.
  const candidates: { start: Rigid; source: OverlapSource }[] = [
    { start: identityRigid(), source: 'frame' },
    ...starts.map((start) => ({ start, source: 'auto' as const })),
  ]
  const screened: { source: OverlapSource; r: OverlapResult }[] = []
  candidates.forEach((c, i) => {
    progress?.(`Placing the other scan — trying placement ${i + 1} of ${candidates.length}…`)
    const r = refineOverlap(surface, positions, normals, c.start, c.source, {}, SCREEN)
    if (r) screened.push({ source: c.source, r })
  })
  screened.sort((x, y) => y.r.overlap - x.r.overlap)
  // Starts that the screen brought to the same placement count once.
  const distinct: typeof screened = []
  for (const c of screened) {
    if (!distinct.some((d) => rigidDisagreement(d.r.transform, c.r.transform, center, diag / 2) < diag / 50)) distinct.push(c)
  }
  const finals = distinct.slice(0, FINALS)
  const own = distinct.find((c) => c.source === 'frame')
  if (own && !finals.includes(own)) finals.push(own)
  progress?.('Placing the other scan — refining the best placement…')
  const tried = finals
    .map((c) => refineOverlap(surface, positions, normals, c.r.transform, c.source))
    .filter((r): r is OverlapResult => r !== null)
  if (!tried.length) throw new Error(NOT_PLACED)
  const noise = Math.min(...tried.map((r) => r.rms))
  const tight = Math.min(TIGHT_MAX * diag, Math.max(TIGHT_MIN * diag, 3 * noise))
  const judge = sampleScan(positions, normals, 4000, 0x7e57)
  const onScore = new Map<OverlapResult, number>()
  const on = (r: OverlapResult) => {
    let v = onScore.get(r)
    if (v === undefined) onScore.set(r, (v = lyingOn(surface, judge, r.transform, tight)))
    return v
  }
  tried.sort((x, y) => on(y) - on(x))
  // The files' own frame wins a near tie: a search that does as well found
  // the same placement.
  const best = tried.find((r) => r.source === 'frame' && on(r) >= 0.98 * on(tried[0])) ?? tried[0]
  if (on(best) < MIN_OVERLAP || best.rms > Math.max(LOOSE * diag, LOOSE_MM)) throw new Error(NOT_PLACED)
  // A rival: another placement, a twentieth of the part away or more, that
  // lies on this scan nearly as closely over nearly as much.
  best.ambiguous = tried.some((r) => r !== best && on(r) >= RIVAL * on(best) && rigidDisagreement(r.transform, best.transform, center, diag / 2) > diag / 20)
  return best
}
