// SPDX-License-Identifier: AGPL-3.0-only
// Merge scans (core/merge): another scan of the part, placed on this one,
// added to it — less what only scans this one again, when asked.
import { describe, expect, it } from 'vitest'
import { mergeScan } from '../core/merge'
import { NominalSurface, emptyHit } from '../../../src/core/deviation/surface'
import { identityRigid, rigidApply, rigidFromAxisAngle, rigidInvert } from '../../../src/core/deviation/rigid'
import { icosphere } from '../../../tests/helpers'

type Mesh = { positions: Float32Array; indices: Uint32Array }

/** The triangles whose middle is where `keep` says, compacted. */
function half(m: Mesh, keep: (z: number) => boolean): Mesh {
  const map = new Int32Array(m.positions.length / 3).fill(-1)
  const pos: number[] = []
  const idx: number[] = []
  for (let t = 0; t < m.indices.length; t += 3) {
    const c = [m.indices[t], m.indices[t + 1], m.indices[t + 2]]
    const z = c.reduce((s, v) => s + m.positions[v * 3 + 2], 0) / 3
    if (!keep(z)) continue
    for (const v of c) {
      if (map[v] < 0) {
        map[v] = pos.length / 3
        pos.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
      }
      idx.push(map[v])
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }
}

function sphere(): Mesh {
  const s = icosphere(4, 10)
  return { positions: s.positions, indices: s.indices }
}

describe('Merge scans', () => {
  it('adds the other scan where it was placed, the scan’s own vertices first and unmoved', () => {
    const whole = sphere()
    const top = half(whole, (z) => z > -2)
    const under = half(whole, (z) => z < 2)
    // The underside as its scanner left it, and the pose that brings it back.
    const pose = rigidFromAxisAngle([1, 0, 0], Math.PI)
    pose.t[2] = 40
    const moved = new Float32Array(under.positions.length)
    const p = new Float64Array(3)
    for (let i = 0; i < moved.length; i += 3) {
      rigidApply(pose, under.positions[i], under.positions[i + 1], under.positions[i + 2], p)
      moved.set(p, i)
    }
    const n = top.positions.length / 3
    const r = mergeScan(top.positions, top.indices, n, { positions: moved, indices: under.indices }, rigidInvert(pose), null, null)
    expect(r.report.added).toBe(under.indices.length / 3)
    expect(r.report.doubled).toBe(0)
    expect(r.indices.length).toBe(top.indices.length + under.indices.length)
    expect(Array.from(r.vertexMap)).toEqual(Array.from({ length: n }, (_, i) => i))
    expect(Array.from(r.positions.subarray(0, n * 3))).toEqual(Array.from(top.positions))
    // Every vertex of the underside back on the sphere it came off.
    for (let v = n; v < r.positions.length / 3; v++) {
      expect(Math.hypot(r.positions[v * 3], r.positions[v * 3 + 1], r.positions[v * 3 + 2])).toBeCloseTo(10, 3)
    }
  })

  it('leaves out what only scans the mesh again, so the shared band is there once', () => {
    const whole = sphere()
    const top = half(whole, (z) => z > -3)
    const under = half(whole, (z) => z < 3)
    const n = top.positions.length / 3
    const surface = new NominalSurface(top.positions, top.indices)
    const r = mergeScan(top.positions, top.indices, n, under, identityRigid(), 0.01, () => surface)
    expect(r.report.doubled).toBeGreaterThan(0)
    expect(r.report.added + r.report.doubled).toBe(under.indices.length / 3)
    // No triangle the underside added lies wholly on the top.
    const hit = emptyHit()
    for (let t = top.indices.length; t < r.indices.length; t += 3) {
      const on = [0, 1, 2].every((k) => {
        const v = r.indices[t + k] * 3
        return surface.closest(r.positions[v], r.positions[v + 1], r.positions[v + 2], hit, 0.01)
      })
      expect(on).toBe(false)
    }
    // And the vertices only the dropped triangles used are gone.
    expect(r.report.vertices).toBeLessThan(n + under.positions.length / 3)
  })
})
