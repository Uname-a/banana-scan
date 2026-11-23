// SPDX-License-Identifier: AGPL-3.0-only
// A drilled hole's cut is one circle: cut into a facet and an arc, or two
// arcs of a near radius, it is put together again — and what is not round
// (a flat, a keyway, a lens, a slot, a rounded square) is left as it is.
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import type { FlatArcFit, Vec2 } from '../../../src/core/flat/types'
import { segmentChain } from '../core/segment'

/** A closed outline's cut through a mesh: the chords of a fan of irregular facets, each vertex off by the mesh's scatter. */
function cut(radiusAt: (a: number) => number, facets: number, noise: number, rand: () => number): Vec2[] {
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const out: Vec2[] = []
  for (let i = 0; i < facets; i++) {
    const a = ((i + 0.35 * (rand() - 0.5)) / facets) * 2 * Math.PI
    const r = radiusAt(a) + noise * gauss()
    out.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return out
}
const kinds = (pts: Vec2[]) => segmentChain([...pts, pts[0]]).segments.map((s) => s.kind)

describe('a closed cut that is one circle', () => {
  it('comes out as one, at every size and seed', () => {
    let pieces = 0
    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed)
      const r = 1.5 + 4 * rand()
      const facets = Math.max(24, Math.round((2 * Math.PI * r) / 0.17))
      const s = segmentChain(((p) => [...p, p[0]])(cut(() => r, facets, 0.02, rand)))
      pieces += s.segments.length
      if (s.segments.length === 1) {
        const fit = s.segments[0].fit as FlatArcFit
        expect(s.segments[0].kind).toBe('arc')
        expect(Math.abs(fit.radius - r)).toBeLessThan(0.02)
        expect(Math.hypot(fit.center[0], fit.center[1])).toBeLessThan(0.02)
      }
    }
    expect(pieces).toBe(60)
  })

  it('is not made of what is not round', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rand = mulberry32(seed)
      // A shaft with a flat 0.4 mm deep; a lens of two arcs; a hole with a keyway.
      const flat = cut((a) => (Math.cos(a) > 4.6 / 5 ? 4.6 / Math.cos(a) : 5), 180, 0.01, rand)
      expect(kinds(flat).length, `flat, seed ${seed}`).toBeGreaterThan(1)
      const lens: Vec2[] = []
      for (let i = 0; i < 60; i++) lens.push([6 * Math.cos(Math.PI / 4 + (i / 60) * (Math.PI / 2)), 6 * Math.sin(Math.PI / 4 + (i / 60) * (Math.PI / 2)) - 4.2426])
      for (let i = 0; i < 60; i++) lens.push([-6 * Math.cos(Math.PI / 4 + (i / 60) * (Math.PI / 2)), -6 * Math.sin(Math.PI / 4 + (i / 60) * (Math.PI / 2)) + 4.2426])
      expect(kinds(lens).length, 'lens').toBeGreaterThan(1)
      const key = cut((a) => (Math.abs(Math.sin(a)) * 5 < 1 && Math.cos(a) > 0 ? 6 / Math.cos(a) : 5), 200, 0.01, rand)
      expect(kinds(key).length, `keyway, seed ${seed}`).toBeGreaterThan(2)
      // An egg: round at both ends, 0.3 mm longer than it is wide.
      const egg = cut((a) => 5 + 0.15 * Math.cos(2 * a), 180, 0.01, rand)
      const s = segmentChain([...egg, egg[0]])
      if (s.segments.length === 1) expect((s.segments[0].fit as FlatArcFit).sigma).toBeGreaterThan(0.05)
    }
  })
})
