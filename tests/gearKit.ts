// SPDX-License-Identifier: AGPL-3.0-only
// A gear for the tests: its outline as points, and as a closed mesh, its
// teeth turned along the axis by the helix.
import { gearGeometry, gearOutline, type GearPiece, type GearSpec, type Vec2 } from '../src/core/geometry/gear'

/** A cubic Bézier's point. */
function bezier(p: Vec2[], t: number): Vec2 {
  const u = 1 - t
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return [w.reduce((s, x, i) => s + x * p[i][0], 0), w.reduce((s, x, i) => s + x * p[i][1], 0)]
}

/** An outline's pieces as points about `step` mm apart. */
export function sampleOutline(pieces: GearPiece[], step = 0.05): Vec2[] {
  const out: Vec2[] = []
  for (const p of pieces) {
    if (p.kind === 'line') {
      const k = Math.max(1, Math.ceil(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) / step))
      for (let i = 0; i < k; i++) out.push([p.a[0] + ((p.b[0] - p.a[0]) * i) / k, p.a[1] + ((p.b[1] - p.a[1]) * i) / k])
    } else if (p.kind === 'arc') {
      // The arc through a, m, b about its centre.
      const r = Math.hypot(p.a[0], p.a[1])
      const a0 = Math.atan2(p.a[1], p.a[0])
      let a1 = Math.atan2(p.b[1], p.b[0])
      while (a1 < a0) a1 += 2 * Math.PI
      const k = Math.max(1, Math.ceil((r * (a1 - a0)) / step))
      for (let i = 0; i < k; i++) out.push([r * Math.cos(a0 + ((a1 - a0) * i) / k), r * Math.sin(a0 + ((a1 - a0) * i) / k)])
    } else {
      for (let s = 0; s + 3 < p.poles.length; s += 3) {
        const seg = p.poles.slice(s, s + 4)
        const k = Math.max(2, Math.ceil(Math.hypot(seg[3][0] - seg[0][0], seg[3][1] - seg[0][1]) / step))
        for (let i = 0; i < k; i++) out.push(bezier(seg, i / k))
      }
    }
  }
  return out
}


/**
 * A gear as a closed triangle soup (x, y, z per corner): its outline
 * `step` mm apart, stood from z = `from` to `to` in `layers`, each layer
 * turned by the helix; the ends closed in fans from the axis — or, with a
 * bore, in a strip to it. Normals out of the material.
 */
export function gearSoup(g: GearSpec, phase: number, from: number, to: number, opts: { step?: number; layers?: number; bore?: number } = {}): Float32Array {
  const geo = gearGeometry(g)
  const layers = opts.layers ?? Math.max(1, Math.ceil(Math.abs(geo.twistPerMm * (to - from)) / (1 * (Math.PI / 180))))
  const base = sampleOutline(gearOutline(g, 0), opts.step ?? 0.15)
  const k = base.length
  const ring = (l: number) => {
    const z = from + ((to - from) * l) / layers
    const a = phase + geo.twistPerMm * z
    const c = Math.cos(a)
    const s = Math.sin(a)
    return base.map((p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, z] as [number, number, number])
  }
  const rings = Array.from({ length: layers + 1 }, (_, l) => ring(l))
  const out: number[] = []
  const tri = (a: number[], b: number[], c: number[]) => out.push(...a, ...b, ...c)
  for (let l = 0; l < layers; l++)
    for (let i = 0; i < k; i++) {
      const a = rings[l][i], b = rings[l][(i + 1) % k], c = rings[l + 1][(i + 1) % k], d = rings[l + 1][i]
      tri(a, b, c)
      tri(a, c, d)
    }
  const cap = (r: [number, number, number][], up: boolean) => {
    const z = r[0][2]
    if (opts.bore) {
      const rb = opts.bore / 2
      const inner = r.map((p) => {
        const t = Math.atan2(p[1], p[0])
        return [rb * Math.cos(t), rb * Math.sin(t), z]
      })
      for (let i = 0; i < k; i++) {
        const a = r[i], b = r[(i + 1) % k], c = inner[(i + 1) % k], d = inner[i]
        if (up) {
          tri(a, b, c)
          tri(a, c, d)
        } else {
          tri(a, c, b)
          tri(a, d, c)
        }
      }
      return
    }
    for (let i = 0; i < k; i++) (up ? tri([0, 0, z], r[i], r[(i + 1) % k]) : tri([0, 0, z], r[(i + 1) % k], r[i]))
  }
  cap(rings[layers], true)
  cap(rings[0], false)
  if (opts.bore) {
    // The bore's wall, facing the axis.
    const n = k
    const wall = (l: number) =>
      rings[l].map((p) => {
        const t = Math.atan2(p[1], p[0])
        return [(opts.bore! / 2) * Math.cos(t), (opts.bore! / 2) * Math.sin(t), p[2]]
      })
    const lo = wall(0)
    const hi = wall(layers)
    for (let i = 0; i < n; i++) {
      tri(lo[i], hi[(i + 1) % n], lo[(i + 1) % n])
      tri(lo[i], hi[i], hi[(i + 1) % n])
    }
  }
  return Float32Array.from(out)
}
