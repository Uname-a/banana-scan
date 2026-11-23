// SPDX-License-Identifier: AGPL-3.0-only
// Pieces nothing ties together are solved apart: a plate's holes, each a
// loop of arcs fitted to a noisy cut, come out as each would alone, all of
// them met, in a fraction of the time one solve over the lot takes — and
// what is tied through a fixed piece alone is apart too.
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import type { Vec2 } from '../../../src/core/flat/types'
import { addConstraint, addEntity, cloneSketch, emptySketch, type Sketch } from '../core/sketch'
import { solveSketch } from '../core/solver'

/** A loop of four arcs, each fitted to its quarter of a noisy circle and started a little off it, joined end to end and tangent. */
function hole(sketch: Sketch, c: Vec2, r: number, rand: () => number): number[] {
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const ids = [0, 1, 2, 3].map((q) => {
    const points = Array.from({ length: 9 }, (_, k): Vec2 => {
      const a = (q + k / 8) * (Math.PI / 2)
      const d = r + 0.03 * gauss()
      return [c[0] + d * Math.cos(a), c[1] + d * Math.sin(a)]
    })
    return addEntity(sketch, { kind: 'arc', c: [c[0] + 0.05 * gauss(), c[1] + 0.05 * gauss()], r: r + 0.08 * gauss(), start: q * (Math.PI / 2), sweep: Math.PI / 2, points, scatter: 0.03 })
  })
  ids.forEach((id, k) => {
    addConstraint(sketch, { kind: 'coincident', p: { entity: id, at: 'b' }, q: { entity: ids[(k + 1) % 4], at: 'a' } })
    addConstraint(sketch, { kind: 'tangent', a: id, b: ids[(k + 1) % 4] })
  })
  return ids
}

/** A plate of holes on a grid, as a section of one is fitted. */
function plate(nx: number, ny: number): { sketch: Sketch; holes: number[][] } {
  const rand = mulberry32(5)
  const sketch = emptySketch()
  const holes: number[][] = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) holes.push(hole(sketch, [8 * i, 8 * j], 2, rand))
  return { sketch, holes }
}

describe('pieces nothing ties together', () => {
  it('solves a hundred and sixty holes, every relation met, as each would alone', () => {
    const { sketch, holes } = plate(16, 10)
    const alone = holes.slice(0, 12).map((ids) => {
      const one = emptySketch()
      one.entities = cloneSketch(sketch).entities.filter((e) => ids.includes(e.id))
      one.constraints = sketch.constraints.filter((c) => c.kind === 'tangent' && ids.includes(c.a) ? true : c.kind === 'coincident' && ids.includes(c.p.entity))
      return { one, report: solveSketch(one) }
    })
    const t = performance.now()
    const report = solveSketch(sketch)
    const took = performance.now() - t
    expect(report.ok, JSON.stringify(report.unmet.slice(0, 4))).toBe(true)
    expect(report.equations).toBe(160 * 12)
    // A closed loop of tangent arcs says one thing twice at most: the same count for each hole.
    expect(report.redundant).toBe(160 * alone[0].report.redundant)
    expect(report.underConstrained).toEqual([])
    for (const { one } of alone) {
      for (const e of one.entities) {
        const f = sketch.entities.find((x) => x.id === e.id)!
        if (e.kind !== 'arc' || f.kind !== 'arc') throw new Error('an arc')
        expect(Math.abs(f.r - e.r)).toBeLessThan(1e-9)
        expect(Math.hypot(f.c[0] - e.c[0], f.c[1] - e.c[1])).toBeLessThan(1e-9)
      }
    }
    // One dense solve over the 3200 parameters had not ended after twelve minutes.
    expect(took).toBeLessThan(4000)
  })

  it('keeps apart what only a fixed piece ties, and together what a relation does', () => {
    const { sketch } = plate(2, 1)
    const base = addEntity(sketch, { kind: 'line', a: [-10, -10], b: [30, -10], fixed: true })
    const free = [addEntity(sketch, { kind: 'line', a: [0, -5], b: [3, -5.2] }), addEntity(sketch, { kind: 'line', a: [10, -5], b: [13, -4.8] })]
    for (const id of free) addConstraint(sketch, { kind: 'parallel', a: base, b: id })
    const both = solveSketch(sketch)
    expect(both.ok).toBe(true)
    const line = (id: number) => {
      const e = sketch.entities.find((x) => x.id === id)!
      if (e.kind !== 'line') throw new Error('a line')
      return e
    }
    for (const id of free) expect(Math.abs(line(id).b[1] - line(id).a[1])).toBeLessThan(1e-6)
    // Neither line is pinned down by its direction alone.
    expect(both.underConstrained.sort((a, b) => a - b)).toEqual(free)
    // Tied to each other, both give way.
    addConstraint(sketch, { kind: 'equal', a: free[0], b: free[1] })
    addConstraint(sketch, { kind: 'length', entity: free[0], value: 5 })
    const tied = solveSketch(sketch)
    expect(tied.ok).toBe(true)
    for (const id of free) expect(Math.hypot(line(id).b[0] - line(id).a[0], line(id).b[1] - line(id).a[1])).toBeCloseTo(5, 5)
    // The same thing said twice is counted in its own group; one that cannot be met is named, the rest met.
    addConstraint(sketch, { kind: 'length', entity: free[1], value: 5 })
    expect(solveSketch(sketch).redundant).toBe(tied.redundant + 1)
    const bad = addConstraint(sketch, { kind: 'length', entity: free[1], value: 9 })
    const report = solveSketch(sketch)
    expect(report.ok).toBe(false)
    expect(report.unmet.some((u) => u.id === bad || u.residual > 1)).toBe(true)
    expect(report.unmet.every((u) => sketch.constraints.find((c) => c.id === u.id)!.kind !== 'tangent')).toBe(true)
  })
})
