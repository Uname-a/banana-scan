// SPDX-License-Identifier: AGPL-3.0-only
// Unrolling a scanned cylinder or cone: the surface on a fitted element laid
// out flat by the element's own geometry rather than by a solve — the arc
// length round the axis becomes x and the height along it y, so an outline
// and the holes in it come out the size they are on the part. A cone
// unrolls to its sector, the apex its centre: a point's distance from the
// apex along the cone becomes its radius on the pattern, and its angle round
// the axis is shrunk by the sine of the half-angle.
//
// Each point is taken at the nominal surface — the arc at the fitted
// radius, not at the point's own — so the scan's scatter does not stretch
// the pattern; how far the region strays from the surface is reported
// instead. `offset` lays the surface out that far outside the fitted one
// (inside, negative): sheet metal is cut to its neutral fibre, not its
// skin.
//
// A region that wraps right round the axis is cut along a seam, at the
// widest gap in it — where nothing is cut — or, round a closed tube, between
// two columns of its vertices: the triangles across the seam get their
// corners on the far side a second time, a turn on, so the pattern has the
// seam as two straight edges of its outline.

import type { Vec3 } from '../../../src/core/types'
import { distortionOf, patternOf, regionPatch, type Distortion, type FlatPattern, type Patch, type PatternFigures } from './flatPattern'

export type UnrollSurface =
  | { kind: 'cylinder'; center: Vec3; axis: Vec3; radius: number }
  /** The radius at `center`, growing along `axis`; the half-angle in
   *  degrees. */
  | { kind: 'cone'; center: Vec3; axis: Vec3; radius: number; halfAngle: number }

export interface UnrollReport {
  surface: 'cylinder' | 'cone'
  /** The patch laid out: its vertices and triangles, and what of the
   *  region was left out (core/flatPattern). */
  vertices: number
  triangles: number
  leftOut: { triangles: number; pieces: number }
  /** Degrees of arc round the axis the region covers; 360 when it wraps
   *  right round and was cut along a seam. */
  coverage: number
  /** Where the seam was cut, degrees round the axis from the frame's first
   *  direction (frameOf). */
  seam: number
  /** The radius the arc was measured at: the cylinder's, plus the offset. */
  radius?: number
  /** A cone's sector: its apex on the pattern, the sector's angle in
   *  degrees, and the radii of the pattern's nearest and furthest points
   *  from the apex, mm. */
  sector?: { apex: [number, number]; angle: number; innerRadius: number; outerRadius: number }
  /** How far the region's vertices lie from the fitted surface, mm: the
   *  RMS and the furthest — what the pattern's truth rests on. */
  residual: { rms: number; max: number }
  /** How far laying the patch out stretched its triangles — near zero for
   *  a region that is the surface, more where it takes in something that
   *  is not (core/flatPattern). */
  distortion: Distortion
  figures: PatternFigures
}

export interface UnrollResult {
  pattern: FlatPattern
  report: UnrollReport
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  if (!(l > 0)) throw new Error('The element has no axis.')
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Two directions square to the axis and to each other — e2 = axis × e1 —
 *  the first along whichever world axis is furthest from it. */
export function frameOf(axis: Vec3): { e1: Vec3; e2: Vec3 } {
  const a = norm(axis)
  const abs = a.map(Math.abs)
  const pick: Vec3 = abs[0] <= abs[1] && abs[0] <= abs[2] ? [1, 0, 0] : abs[1] <= abs[2] ? [0, 1, 0] : [0, 0, 1]
  const d = pick[0] * a[0] + pick[1] * a[1] + pick[2] * a[2]
  const e1 = norm([pick[0] - d * a[0], pick[1] - d * a[1], pick[2] - d * a[2]])
  const e2: Vec3 = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]]
  return { e1, e2 }
}

/** The geometry a surface is laid out by: its axis frame, and for a cone
 *  the apex and the half-angle's sine and cosine. */
interface Frame {
  origin: Vec3
  a: Vec3
  e1: Vec3
  e2: Vec3
  cone: { sin: number; cos: number } | null
  radius: number
}

/** A cone this close to a cylinder is unrolled as one — its apex is too far
 *  off for the sector to mean anything. */
const CONE_MIN_HALF_ANGLE = 1e-6

function frameFor(surface: UnrollSurface, offset: number): Frame {
  const a = norm(surface.axis)
  const { e1, e2 } = frameOf(a)
  if (surface.kind === 'cone' && (surface.halfAngle * Math.PI) / 180 > CONE_MIN_HALF_ANGLE) {
    const phi = (surface.halfAngle * Math.PI) / 180
    if (!(phi < Math.PI / 2)) throw new Error('The cone’s half-angle must be under 90°.')
    const sin = Math.sin(phi)
    const cos = Math.cos(phi)
    // The apex: back along the axis from the centre until the radius is
    // nought, then — for a surface offset outward — further back, as the
    // offset cone's apex lies.
    const back = surface.radius / Math.tan(phi) + offset / sin
    const c = surface.center
    return { origin: [c[0] - a[0] * back, c[1] - a[1] * back, c[2] - a[2] * back], a, e1, e2, cone: { sin, cos }, radius: surface.radius }
  }
  return { origin: surface.center, a, e1, e2, cone: null, radius: surface.radius + offset }
}

/** A point in the frame: along the axis, out from it, and the angle round
 *  it in (−π, π]. */
function cylindrical(f: Frame, x: number, y: number, z: number): { h: number; rho: number; theta: number } {
  const dx = x - f.origin[0]
  const dy = y - f.origin[1]
  const dz = z - f.origin[2]
  const h = dx * f.a[0] + dy * f.a[1] + dz * f.a[2]
  const px = dx - h * f.a[0]
  const py = dy - h * f.a[1]
  const pz = dz - h * f.a[2]
  const c1 = px * f.e1[0] + py * f.e1[1] + pz * f.e1[2]
  const c2 = px * f.e2[0] + py * f.e2[1] + pz * f.e2[2]
  return { h, rho: Math.hypot(c1, c2), theta: Math.atan2(c2, c1) }
}

/** A point's signed distance from the surface, outward positive. */
function offSurface(f: Frame, h: number, rho: number): number {
  return f.cone ? rho * f.cone.cos - h * f.cone.sin : rho - f.radius
}

/**
 * The vertices that lie on the surface: within `band` of it, their normal
 * within `turnDeg` of the surface's, either way out — the region an
 * unroll takes when none is named. On an open sheet the inside skin a
 * thickness away is outside the band; a flange off a tube faces another
 * way.
 */
export function surfaceRegion(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  vertexCount: number,
  surface: UnrollSurface,
  band: number,
  turnDeg = 30,
): Uint32Array {
  const f = frameFor(surface, 0)
  const cosTurn = Math.cos((turnDeg * Math.PI) / 180)
  const out: number[] = []
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3]
    const y = positions[v * 3 + 1]
    const z = positions[v * 3 + 2]
    const { h, rho } = cylindrical(f, x, y, z)
    if (f.cone && h <= 0) continue
    if (Math.abs(offSurface(f, h, rho)) > band || !(rho > 0)) continue
    // The surface's normal here: out from the axis, and for a cone tipped
    // back towards the apex by the half-angle.
    const dx = x - f.origin[0] - h * f.a[0]
    const dy = y - f.origin[1] - h * f.a[1]
    const dz = z - f.origin[2] - h * f.a[2]
    let nx = dx / rho
    let ny = dy / rho
    let nz = dz / rho
    if (f.cone) {
      nx = nx * f.cone.cos - f.a[0] * f.cone.sin
      ny = ny * f.cone.cos - f.a[1] * f.cone.sin
      nz = nz * f.cone.cos - f.a[2] * f.cone.sin
    }
    const nl = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2])
    if (!(nl > 0)) continue
    const dot = (normals[v * 3] * nx + normals[v * 3 + 1] * ny + normals[v * 3 + 2] * nz) / nl
    if (Math.abs(dot) >= cosTurn) out.push(v)
  }
  return Uint32Array.from(out)
}

/** The patch laid out on the surface: u,v per vertex — the seam's
 *  triangles given second corners a turn on — and what the layout found. */
export function unrollPatch(patch: Patch, surface: UnrollSurface, offset = 0) {
  const f = frameFor(surface, offset)
  const n = patch.vertexCount
  if (n < 3) throw new Error('The region holds no triangle on the surface.')
  const h = new Float64Array(n)
  const theta = new Float64Array(n)
  let sq = 0
  let worst = 0
  for (let v = 0; v < n; v++) {
    const c = cylindrical(f, patch.positions[v * 3], patch.positions[v * 3 + 1], patch.positions[v * 3 + 2])
    h[v] = c.h
    theta[v] = c.theta
    // From the fitted surface, not the offset one the frame is of.
    const d = offSurface(f, c.h, c.rho) + offset
    sq += d * d
    worst = Math.max(worst, Math.abs(d))
    if (f.cone && c.h <= 0) throw new Error('The region reaches past the cone’s apex — name a region on the cone itself.')
  }
  // The seam: the middle of the widest gap between the angles the vertices
  // stand at.
  const sorted = Float64Array.from(theta).sort()
  let gap = sorted[0] + 2 * Math.PI - sorted[n - 1]
  let seam = sorted[n - 1] + gap / 2
  for (let i = 1; i < n; i++) {
    const g = sorted[i] - sorted[i - 1]
    if (g > gap) {
      gap = g
      seam = sorted[i - 1] + g / 2
    }
  }
  const turn = 2 * Math.PI
  const t = new Float64Array(n)
  for (let v = 0; v < n; v++) t[v] = (((theta[v] - seam) % turn) + turn) % turn

  // Triangles across the seam: their corners just past it are taken a turn
  // on, as vertices of their own.
  const indices = Uint32Array.from(patch.indices)
  const extra: number[] = []
  const twin = new Int32Array(n).fill(-1)
  let crossed = 0
  for (let k = 0; k < indices.length; k += 3) {
    const a = t[indices[k]]
    const b = t[indices[k + 1]]
    const c = t[indices[k + 2]]
    if (Math.max(a, b, c) - Math.min(a, b, c) <= Math.PI) continue
    crossed++
    for (let j = 0; j < 3; j++) {
      const v = indices[k + j]
      if (v >= n || t[v] >= Math.PI) continue
      if (twin[v] < 0) {
        twin[v] = n + extra.length
        extra.push(v)
      }
      indices[k + j] = twin[v]
    }
  }
  const total = n + extra.length
  const positions = new Float64Array(total * 3)
  positions.set(patch.positions)
  const angle = new Float64Array(total)
  const along = new Float64Array(total)
  angle.set(t)
  along.set(h)
  extra.forEach((v, i) => {
    positions.set(patch.positions.subarray(v * 3, v * 3 + 3), (n + i) * 3)
    angle[n + i] = t[v] + turn
    along[n + i] = h[v]
  })

  const uv = new Float64Array(total * 2)
  let sector: UnrollReport['sector']
  if (f.cone) {
    const { sin, cos } = f.cone
    // Each point's distance from the apex along the cone, at its nearest
    // point on it, and its angle round the sector. The sector opens upward,
    // its middle on +y; seen from outside, a turn on round the axis is a
    // turn clockwise round the apex.
    let lo = Infinity
    let hi = -Infinity
    const rad = new Float64Array(total)
    for (let v = 0; v < total; v++) {
      const c = cylindrical(f, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
      rad[v] = c.h * cos + c.rho * sin
      lo = Math.min(lo, angle[v])
      hi = Math.max(hi, angle[v])
    }
    const mid = ((lo + hi) / 2) * sin
    let inner = Infinity
    let outer = 0
    for (let v = 0; v < total; v++) {
      const alpha = Math.PI / 2 - (angle[v] * sin - mid)
      uv[v * 2] = rad[v] * Math.cos(alpha)
      uv[v * 2 + 1] = rad[v] * Math.sin(alpha)
      inner = Math.min(inner, rad[v])
      outer = Math.max(outer, rad[v])
    }
    sector = { apex: [0, 0], angle: ((hi - lo) * sin * 180) / Math.PI, innerRadius: inner, outerRadius: outer }
  } else {
    for (let v = 0; v < total; v++) {
      uv[v * 2] = f.radius * angle[v]
      uv[v * 2 + 1] = along[v]
    }
  }
  const coverage = crossed > 0 ? 360 : ((turn - gap) * 180) / Math.PI
  const seamDeg = ((((seam * 180) / Math.PI) % 360) + 360) % 360
  return {
    uv,
    positions,
    indices,
    vertexCount: total,
    coverage,
    seam: seamDeg,
    sector,
    radius: f.cone ? undefined : f.radius,
    residual: { rms: Math.sqrt(sq / n), max: worst },
  }
}

/**
 * The flat pattern of a region of the mesh on a cylinder or a cone. The
 * region is the vertices named; its largest connected piece is laid out.
 */
export function unroll(
  positions: ArrayLike<number>,
  indices: Uint32Array,
  vertexCount: number,
  region: ArrayLike<number>,
  surface: UnrollSurface,
  offset = 0,
): UnrollResult {
  const patch = regionPatch(positions, indices, vertexCount, region)
  if (patch.indices.length === 0) throw new Error('The region holds no whole triangle — name a larger one.')
  const laid = unrollPatch(patch, surface, offset)
  const { pattern, figures, shift } = patternOf(laid.uv, laid.indices, laid.vertexCount)
  const distortion = distortionOf(laid.positions, laid.uv, laid.indices)
  const sector = laid.sector ? { ...laid.sector, apex: [shift[0], shift[1]] as [number, number] } : undefined
  return {
    pattern,
    report: {
      surface: surface.kind === 'cone' && laid.sector ? 'cone' : 'cylinder',
      vertices: patch.vertexCount,
      triangles: patch.indices.length / 3,
      leftOut: patch.leftOut,
      coverage: laid.coverage,
      seam: laid.seam,
      ...(laid.radius !== undefined ? { radius: laid.radius } : {}),
      ...(sector ? { sector } : {}),
      residual: laid.residual,
      distortion,
      figures,
    },
  }
}
