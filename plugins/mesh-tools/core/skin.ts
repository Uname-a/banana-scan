// SPDX-License-Identifier: AGPL-3.0-only
// One skin of a bent sheet, found from a point on it: the surface grown
// across the mesh, triangle by triangle, from the one nearest the point for
// as long as it bends no tighter than a radius. A bend in a sheet is a
// curve — its outer skin turns a quarter turn over a millimetre or more — so
// the growth crosses it and goes on along the next flange; the sheet's edge
// is a corner, a quarter turn within the scanner's blur, so it stops there
// and never reaches the other skin. That is the region a flat pattern is
// made of: one whole skin, which a box or a ball drawn round a bent part
// cannot name.
//
// The turn is read between the triangles' own normals, not the vertices':
// a vertex on a corner takes a normal between its two faces — lopsided where
// the mesh is ragged, round a hole or at the end of a scan — and a chain of
// such vertices walks round a corner in steps each small enough to pass for
// a bend. A triangle's normal is its face's, either side of the corner.
//
// Where the edge is scanned soft enough to pass for a bend, the thickness,
// when given, keeps the other skin out: a triangle facing against one already
// taken, and lying behind it within the thickness, is on the far skin.

import type { Vec3 } from '../../../src/core/types'

/** The tightest bend the growth crosses, by default, mm: a sheet's outer skin
 *  bends at its inside radius and the thickness, rarely under this. */
export const SKIN_MIN_RADIUS = 0.6

/** The most the surface may turn from one triangle to the next and still be
 *  followed, degrees, however far apart their middles: a corner is a quarter
 *  turn, a bend a few degrees a triangle. */
export const SKIN_MAX_STEP_TURN_DEG = 30

export interface SkinSettings {
  /** A point on the skin, mm; the triangle nearest it is where it grows from. */
  at: Vec3
  /** The tightest bend followed, mm: the turn from a triangle to the next,
   *  over the distance between their middles, at most one over it. */
  minRadius?: number
  /** The sheet's thickness, mm: with it, a triangle facing against one
   *  taken and behind it within 1.5 times this is on the far skin. */
  thickness?: number
}

/** The vertices of the skin: the corners of the triangles it grew over, in the order it reached them. */
export function skinVertices(positions: ArrayLike<number>, _normals: ArrayLike<number>, indices: Uint32Array, vertexCount: number, settings: SkinSettings): Uint32Array {
  const { at } = settings
  const minRadius = settings.minRadius ?? SKIN_MIN_RADIUS
  if (!(minRadius > 0)) throw new Error('The tightest bend must be a radius more than zero.')
  const thickness = settings.thickness
  if (thickness !== undefined && !(thickness > 0)) throw new Error('The thickness must be more than zero.')
  const count = Math.floor(indices.length / 3)
  if (vertexCount === 0 || count === 0) throw new Error('The mesh has no triangles to grow a skin over.')
  // Each triangle's middle and unit normal; one with no area is never taken.
  const mid = new Float64Array(count * 3)
  const nrm = new Float64Array(count * 3)
  const has = new Uint8Array(count)
  for (let t = 0; t < count; t++) {
    const a = indices[t * 3] * 3
    const b = indices[t * 3 + 1] * 3
    const c = indices[t * 3 + 2] * 3
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]]
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const l = Math.hypot(n[0], n[1], n[2])
    for (let k = 0; k < 3; k++) mid[t * 3 + k] = (positions[a + k] + positions[b + k] + positions[c + k]) / 3
    if (l > 0) {
      has[t] = 1
      for (let k = 0; k < 3; k++) nrm[t * 3 + k] = n[k] / l
    }
  }
  // The triangles either side of each edge, through each vertex's triangles.
  const start = new Uint32Array(vertexCount + 1)
  for (let i = 0; i < count * 3; i++) start[indices[i] + 1]++
  for (let v = 0; v < vertexCount; v++) start[v + 1] += start[v]
  const fill = start.slice(0, vertexCount)
  const round = new Uint32Array(count * 3)
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) round[fill[indices[t * 3 + k]]++] = t
  const across = (t: number, a: number, b: number): number[] => {
    const out: number[] = []
    for (let i = start[a]; i < start[a + 1]; i++) {
      const u = round[i]
      if (u === t) continue
      if (indices[u * 3] === b || indices[u * 3 + 1] === b || indices[u * 3 + 2] === b) out.push(u)
    }
    return out
  }
  let seed = -1
  let best = Infinity
  for (let t = 0; t < count; t++) {
    if (!has[t]) continue
    const d = (mid[t * 3] - at[0]) ** 2 + (mid[t * 3 + 1] - at[1]) ** 2 + (mid[t * 3 + 2] - at[2]) ** 2
    if (d < best) {
      best = d
      seed = t
    }
  }
  if (seed < 0) throw new Error('The mesh has no triangles to grow a skin over.')
  const maxCurvature = 1 / minRadius
  const maxTurn = (SKIN_MAX_STEP_TURN_DEG * Math.PI) / 180
  // The triangles taken, in cells a thickness wide, for the far-skin check.
  const cell = thickness ?? 1
  const cells = new Map<string, number[]>()
  const cellOf = (t: number) => [0, 1, 2].map((k) => Math.floor(mid[t * 3 + k] / cell))
  const reach = 1.5 * (thickness ?? 0)
  const farSkin = (w: number): boolean => {
    if (thickness === undefined) return false
    const [cx, cy, cz] = cellOf(w)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (const u of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const e = [0, 1, 2].map((k) => mid[w * 3 + k] - mid[u * 3 + k])
            if (e[0] * e[0] + e[1] * e[1] + e[2] * e[2] > reach * reach) continue
            const facing = nrm[u * 3] * nrm[w * 3] + nrm[u * 3 + 1] * nrm[w * 3 + 1] + nrm[u * 3 + 2] * nrm[w * 3 + 2]
            const behind = e[0] * nrm[u * 3] + e[1] * nrm[u * 3 + 1] + e[2] * nrm[u * 3 + 2]
            if (facing < -0.5 && behind < 0) return true
          }
        }
      }
    }
    return false
  }
  const take = (t: number) => {
    if (thickness === undefined) return
    const k = cellOf(t).join(',')
    const list = cells.get(k)
    if (list) list.push(t)
    else cells.set(k, [t])
  }
  const taken = new Uint8Array(count)
  const order: number[] = [seed]
  taken[seed] = 1
  take(seed)
  for (let i = 0; i < order.length; i++) {
    const t = order[i]
    for (let k = 0; k < 3; k++) {
      for (const w of across(t, indices[t * 3 + k], indices[t * 3 + ((k + 1) % 3)])) {
        if (taken[w] || !has[w]) continue
        const len = Math.hypot(mid[w * 3] - mid[t * 3], mid[w * 3 + 1] - mid[t * 3 + 1], mid[w * 3 + 2] - mid[t * 3 + 2])
        const cos = nrm[t * 3] * nrm[w * 3] + nrm[t * 3 + 1] * nrm[w * 3 + 1] + nrm[t * 3 + 2] * nrm[w * 3 + 2]
        // The turn from one face to the next, as a curvature no tighter than the radius, and short of a corner's.
        const turn = Math.acos(Math.min(1, Math.max(-1, cos)))
        if (turn > maxCurvature * len || turn > maxTurn) continue
        if (farSkin(w)) continue
        taken[w] = 1
        order.push(w)
        take(w)
      }
    }
  }
  const seen = new Uint8Array(vertexCount)
  const out: number[] = []
  for (const t of order) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]
      if (!seen[v]) {
        seen[v] = 1
        out.push(v)
      }
    }
  }
  return Uint32Array.from(out)
}
