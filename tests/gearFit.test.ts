// SPDX-License-Identifier: AGPL-3.0-only
// An involute gear's geometry and its reading off cuts: the numbers a
// standard gear makes (reference and base circles, tooth thickness, the
// turn a helix gives), the outline closed tooth by tooth on the true
// involute, the numbers refused; then the gear read back off cuts of its
// own outline — a spur gear with a profile shift, a helical one, one off
// the axis given, one with a tooth broken, and one a standard module does
// not name.
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../src/core/fit/ransac'
import { gearGeometry, gearOutline, gearProblem, halfToothAt, inv, rootCorner, type GearPiece, type GearSpec, type Vec2 } from '../src/core/geometry/gear'
import { fitGear, flankRmsOf, type GearCut } from '../src/core/geometry/gearFit'
import { circumcentre, sampleOutline } from './gearKit'

const deg = Math.PI / 180

/** Cuts of a gear at heights along its axis: each its outline turned by
 *  the helix, moved by `off`, jittered by `noise` mm, as one closed chain;
 *  `edit` changes the points of a cut before they are laid out. */
function cutsOf(g: GearSpec, phase: number, heights: number[], opts: { noise?: number; off?: Vec2; edit?: (p: Vec2, h: number) => Vec2 | null } = {}): GearCut[] {
  const geo = gearGeometry(g)
  const rand = mulberry32(11)
  return heights.map((h) => {
    const pts = sampleOutline(gearOutline(g, phase + geo.twistPerMm * h))
    const chain: number[] = []
    for (const p0 of [...pts, pts[0]]) {
      const p = opts.edit ? opts.edit(p0, h) : p0
      if (!p) continue
      chain.push(p[0] + (opts.off?.[0] ?? 0) + (rand() * 2 - 1) * (opts.noise ?? 0), p[1] + (opts.off?.[1] ?? 0) + (rand() * 2 - 1) * (opts.noise ?? 0))
    }
    return { h, chains: [chain] }
  })
}

const standard = (teeth: number, module: number, extra: Partial<GearSpec> = {}): GearSpec => {
  const g: GearSpec = { teeth, module, pressureDeg: 20, helixDeg: 0, shift: 0, tipDiameter: 0, rootDiameter: 0, ...extra }
  const d = (teeth * module) / Math.cos(g.helixDeg * deg)
  return { ...g, tipDiameter: extra.tipDiameter ?? d + 2 * module * (1 + g.shift), rootDiameter: extra.rootDiameter ?? d - 2 * module * (1.25 - g.shift) }
}

describe('an involute gear’s geometry', () => {
  it('gives a standard spur gear’s circles and a tooth half the pitch at the reference circle', () => {
    const geo = gearGeometry(standard(20, 2))
    expect(geo.pitchRadius).toBeCloseTo(20, 9)
    expect(geo.baseRadius).toBeCloseTo(20 * Math.cos(20 * deg), 9)
    expect(geo.halfToothAtPitch).toBeCloseTo(Math.PI / 40, 9)
    expect(halfToothAt(geo, geo.pitchRadius)).toBeCloseTo(Math.PI / 40, 9)
    expect(geo.twistPerMm).toBe(0)
    expect(geo.lead).toBe(Infinity)
  })

  it('gives a helical gear its transverse module and pressure angle, and the turn per mm along the axis', () => {
    const geo = gearGeometry(standard(30, 2, { helixDeg: 20 }))
    expect(geo.transverseModule).toBeCloseTo(2 / Math.cos(20 * deg), 9)
    expect(geo.transversePressure).toBeCloseTo(Math.atan(Math.tan(20 * deg) / Math.cos(20 * deg)), 9)
    expect(geo.twistPerMm).toBeCloseTo(Math.tan(20 * deg) / geo.pitchRadius, 12)
    expect(geo.lead).toBeCloseTo((2 * Math.PI * geo.pitchRadius) / Math.tan(20 * deg), 6)
    // A left hand turns the other way.
    expect(gearGeometry(standard(30, 2, { helixDeg: -20 })).twistPerMm).toBeCloseTo(-geo.twistPerMm, 12)
  })

  it('draws the outline closed, tooth by tooth, its flanks on the involute', () => {
    const g = standard(24, 2, { shift: 0.2 })
    const pieces = gearOutline(g, 0.1)
    // Root below the base circle: a foot, a flank, the tip, a flank, a foot, the root.
    expect(pieces).toHaveLength(24 * 6)
    const ends = (p: GearPiece): [Vec2, Vec2] => (p.kind === 'spline' ? [p.poles[0], p.poles[p.poles.length - 1]] : [p.a, p.b])
    for (let i = 0; i < pieces.length; i++) {
      const [, b] = ends(pieces[i])
      const [a] = ends(pieces[(i + 1) % pieces.length])
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-9)
    }
    // Every point of the flanks lies on the involute: its angle from the
    // tooth's middle is the half tooth at its radius.
    const geo = gearGeometry(g)
    let worst = 0
    for (const p of sampleOutline(pieces, 0.02)) {
      const r = Math.hypot(p[0], p[1])
      if (r < geo.baseRadius + 0.05 || r > geo.tipRadius - 0.05) continue
      const pitch = (2 * Math.PI) / 24
      const u = ((((Math.atan2(p[1], p[0]) - 0.1 + pitch / 2) % pitch) + pitch) % pitch) - pitch / 2
      worst = Math.max(worst, r * Math.abs(Math.abs(u) - halfToothAt(geo, r)))
    }
    expect(worst).toBeLessThan(5e-4)
  })

  it('refuses numbers that make no gear, saying why', () => {
    expect(gearProblem(standard(20, 2))).toBeNull()
    expect(gearProblem({ ...standard(20, 2), teeth: 2.5 })).toMatch(/whole number/)
    expect(gearProblem({ ...standard(20, 2), module: 0 })).toMatch(/module/)
    expect(gearProblem({ ...standard(20, 2), tipDiameter: 30, rootDiameter: 35 })).toMatch(/tip diameter/)
    expect(gearProblem({ ...standard(20, 2), tipDiameter: 37 })).toMatch(/inside the base circle/)
    expect(gearProblem({ ...standard(20, 2), tipDiameter: 60 })).toMatch(/come to a point/)
    expect(inv(20 * deg)).toBeCloseTo(0.014904, 6)
  })

  it('rounds the root with a fillet tangent to the root circle and the flank, or the foot where the base circle lies above the root', () => {
    const ends = (p: GearPiece): [Vec2, Vec2] => (p.kind === 'spline' ? [p.poles[0], p.poles[p.poles.length - 1]] : [p.a, p.b])
    // A helical gear whose involute meets the root (the Artec gear's numbers), and a spur gear with a radial foot.
    const helical: GearSpec = { teeth: 34, module: 2.3004, pressureDeg: 20, helixDeg: 30.04, shift: 0.496, tipDiameter: 97.4266, rootDiameter: 84.4083 }
    const spur = standard(20, 2)
    for (const [g, alongFoot] of [[helical, false], [spur, true]] as const) {
      const geo = gearGeometry(g)
      const rho = 0.25 * g.module
      const sharp = gearOutline(g, 0.2)
      const pieces = gearOutline({ ...g, rootFillet: rho }, 0.2)
      expect(pieces.length).toBe(g.teeth * (alongFoot ? 8 : 6))
      // Closed, piece to piece.
      for (let i = 0; i < pieces.length; i++) {
        const [, b] = ends(pieces[i])
        const [a] = ends(pieces[(i + 1) % pieces.length])
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-9)
      }
      const corner = rootCorner(geo, g.teeth, rho)
      expect(corner?.alongFoot).toBe(alongFoot)
      // Each fillet: its centre rho off the root circle, outside it, and rho off the flank or foot it meets, never nearer.
      const fillet = pieces[0]
      if (fillet.kind !== 'arc') throw new Error('the first piece is the fillet')
      const c = circumcentre(fillet.a, fillet.m, fillet.b)
      expect(Math.hypot(fillet.a[0] - c[0], fillet.a[1] - c[1])).toBeCloseTo(rho, 9)
      expect(Math.hypot(c[0], c[1])).toBeCloseTo(geo.rootRadius + rho, 9)
      const side = sampleOutline(pieces.slice(1, alongFoot ? 3 : 2), 0.005)
      const nearest = Math.min(...side.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])))
      expect(nearest).toBeGreaterThan(rho - 1e-4)
      expect(nearest).toBeLessThan(rho + 1e-3)
      // The outline with fillets has more material at the root than the sharp one, and only there.
      const area = (pts: Vec2[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0) / 2
      const added = area(sampleOutline(pieces, 0.002)) - area(sampleOutline(sharp, 0.002))
      // Each of the 2 × teeth corners gains about (1 − π/4) ρ² — less, the corner being wider than square.
      expect(added).toBeGreaterThan(0)
      expect(added).toBeLessThan(2 * g.teeth * (1 - Math.PI / 4) * rho * rho * 1.05)
    }
    // None, and 0, are the sharp corner exactly.
    expect(gearOutline({ ...spur, rootFillet: 0 }, 0.2)).toEqual(gearOutline(spur, 0.2))
    // One too large for the gap is refused, with the largest that fits.
    expect(gearProblem({ ...spur, rootFillet: 3 })).toMatch(/root fillet does not fit between the teeth: at most [\d.]+ modules/)
    expect(gearProblem({ ...spur, rootFillet: -1 })).toMatch(/radius of 0 or more/)
    expect(gearProblem({ ...helical, rootFillet: 0.33 * 2.3004 })).toBeNull()
    expect(gearProblem({ ...helical, rootFillet: 0.34 * 2.3004 })).toMatch(/at most 0.334 modules/)
  })
})

describe('a gear read off cuts', () => {
  it('reads a spur gear: 24 teeth, module 2 at 20°, a shift of 0.2, the circles, the flanks', () => {
    const g = standard(24, 2, { shift: 0.2 })
    const r = fitGear(cutsOf(g, 5 * deg, [2, 4, 6, 8, 10], { noise: 0.01 }), 24)
    if ('refused' in r) throw new Error(r.refused)
    expect(r.standard?.name).toBe('m 2, 20°')
    expect(r.spec.module).toBe(2)
    expect(r.spec.pressureDeg).toBe(20)
    expect(r.spec.helixDeg).toBe(0)
    expect(r.spec.shift).toBeCloseTo(0.2, 1)
    expect(r.spec.tipDiameter).toBeCloseTo(g.tipDiameter, 1)
    expect(r.spec.rootDiameter).toBeCloseTo(g.rootDiameter, 1)
    expect(r.baseDiameter).toBeCloseTo(2 * gearGeometry(g).baseRadius, 1)
    expect(r.flankRms).toBeLessThan(0.02)
    expect(Math.abs((((r.phase - 5 * deg) / deg + 7.5) % 15) - 7.5)).toBeLessThan(0.05)
    expect(r.teethRead.filter((t) => t.broken)).toEqual([])
    // The flanks of the gear named lie on the cuts as closely.
    expect(flankRmsOf(cutsOf(g, 5 * deg, [5]), r.spec, r.phase)).toBeLessThan(0.02)
  })

  it('reads a helical gear: its hand, its helix angle from the turn along the axis', () => {
    for (const helixDeg of [15, -22]) {
      const g = standard(34, 2.25, { helixDeg })
      const r = fitGear(cutsOf(g, 0, [0, 3, 6, 9, 12], { noise: 0.01 }), 34)
      if ('refused' in r) throw new Error(r.refused)
      expect(r.spec.module).toBe(2.25)
      expect(r.spec.pressureDeg).toBe(20)
      expect(r.spec.helixDeg).toBeCloseTo(helixDeg, 1)
      expect(r.twistPerMm).toBeCloseTo(gearGeometry(g).twistPerMm, 4)
      expect(Math.abs(r.spec.shift)).toBeLessThan(0.05)
      expect(r.flankRms).toBeLessThan(0.02)
      expect(r.helixRms).toBeLessThan(0.05)
    }
  })

  it('finds the teeth’s own centre where the axis given is off it', () => {
    const g = standard(30, 1.5)
    const r = fitGear(cutsOf(g, 0, [1, 2, 3, 4], { off: [0.3, -0.2], noise: 0.005 }), 30)
    if ('refused' in r) throw new Error(r.refused)
    expect(Math.abs(r.centre[0] - 0.3)).toBeLessThan(0.01)
    expect(Math.abs(r.centre[1] + 0.2)).toBeLessThan(0.01)
    expect(r.spec.module).toBe(1.5)
    expect(r.flankRms).toBeLessThan(0.02)
  })

  it('names a broken tooth and reads the gear off the rest', () => {
    const g = standard(20, 3)
    const geo = gearGeometry(g)
    const pitch = (2 * Math.PI) / 20
    // Tooth 7 broken off half way up.
    const cut = (p: Vec2): Vec2 => {
      const r = Math.hypot(p[0], p[1])
      const a = Math.atan2(p[1], p[0])
      const k = ((Math.round(a / pitch) % 20) + 20) % 20
      const top = geo.rootRadius + 0.5 * (geo.tipRadius - geo.rootRadius)
      return k === 7 && r > top ? [(top * p[0]) / r, (top * p[1]) / r] : p
    }
    const r = fitGear(cutsOf(g, 0, [1, 3, 5, 7], { edit: cut }), 20)
    if ('refused' in r) throw new Error(r.refused)
    expect(r.teethRead.filter((t) => t.broken).map((t) => t.index)).toEqual([7])
    expect(r.spec.module).toBe(3)
    expect(r.spec.tipDiameter).toBeCloseTo(g.tipDiameter, 1)
  })

  it('takes the module as measured where no standard one lies close, at 20°', () => {
    const g = standard(26, 2.37)
    const r = fitGear(cutsOf(g, 0, [1, 2, 3]), 26)
    if ('refused' in r) throw new Error(r.refused)
    expect(r.standard).toBeNull()
    expect(r.spec.pressureDeg).toBe(20)
    expect(r.spec.module).toBeCloseTo(2.37, 2)
    expect(r.flankRms).toBeLessThan(0.02)
  })

  it('names no standard that wants a shift gears are not cut with, and the gear as measured has the same flanks', () => {
    // The Artec gear's numbers: m 2.25 at 14.5°, 16° and 17.5° all come as close.
    const g = standard(34, 2.25, { helixDeg: 29.2, pressureDeg: 16, shift: 1.3, tipDiameter: 97.43, rootDiameter: 84.41 })
    const r = fitGear(cutsOf(g, 0, [0, 3, 6, 9], { noise: 0.05 }), 34)
    if ('refused' in r) throw new Error(r.refused)
    expect(r.standard).toBeNull()
    expect(r.spec.pressureDeg).toBe(20)
    expect(Math.abs(r.spec.shift)).toBeLessThan(1)
    expect(flankRmsOf(cutsOf(g, 0, [5]), r.spec, r.phase)).toBeLessThan(0.02)
  })

  it('refuses a round outline and too few cuts', () => {
    const ring = Array.from({ length: 721 }, (_, i) => [20 * Math.cos((i / 720) * 2 * Math.PI), 20 * Math.sin((i / 720) * 2 * Math.PI)]).flat()
    expect(fitGear([{ h: 0, chains: [ring] }, { h: 1, chains: [ring] }], 20)).toHaveProperty('refused')
    expect(fitGear(cutsOf(standard(20, 2), 0, [1]), 20)).toHaveProperty('refused')
  })
})
