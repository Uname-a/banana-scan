// SPDX-License-Identifier: AGPL-3.0-only
// scan.curvature: curvature shading for an agent — switched on or off, set,
// and read back in numbers: how much of the part is flat, convex, concave
// or a saddle, the tightest rounds it holds, and the curvature at a place.

import { classifyCurvature, curvatureOf, curvatureShares, CURVATURE_QUANTITIES, type CurvatureQuantity } from '../../core/geometry/principalCurvature'
import type { Vec3 } from '../../core/types'
import { ensureCurvature, rangeShown } from '../../app/curvatureShading'
import { CURVATURE_RADIUS_MAX, CURVATURE_RADIUS_MIN, flatBelow, useCurvature } from '../../state/curvatureStore'
import { useShell } from '../../state/shellStore'
import { commandHost } from '../host'
import { publicWorkspace } from '../state'
import { locationSchema, requireScan, resolveLocation, type Location } from '../refs'
import { bool, enumOf, num, obj, oneOf, type JsonSchema } from '../schema'
import { CommandError, type Command } from '../types'
import { showWorkspace } from './common'

const nullable = (schema: JsonSchema, description: string): JsonSchema => oneOf([schema, { type: 'null', description: 'By the scan.' }], description)

/** Six significant digits, as every answer gives them. */
const sig = (x: number): number => (Number.isFinite(x) ? +x.toPrecision(6) : x)
const sigV = (v: readonly number[]): Vec3 => [sig(v[0]), sig(v[1]), sig(v[2])]
/** The radius of a round that bends as much, mm; null where it is flat. */
const radiusOf = (k: number): number | null => (Math.abs(k) > 1e-9 ? sig(1 / Math.abs(k)) : null)

/** The tightest rounds, read off this share at each end of the vertices so
 *  a few noisy ones do not stand for the part. */
const TIGHTEST_SHARE = 0.005

/** The sharpest convex and concave bend on most of the part: the curvature
 *  the tightest half per cent of the vertices bend past, each way; null
 *  for a way the part does not bend past flat. */
function tightest(k1: Float32Array, k2: Float32Array, flatBelow: number): { convex: number | null; concave: number | null } {
  const step = Math.max(1, Math.floor(k1.length / 200_000))
  const out: number[] = []
  const into: number[] = []
  for (let v = 0; v < k1.length; v += step) {
    if (Number.isNaN(k1[v])) continue
    out.push(k1[v])
    into.push(k2[v])
  }
  if (out.length === 0) return { convex: null, concave: null }
  out.sort((a, b) => b - a)
  into.sort((a, b) => a - b)
  const i = Math.min(out.length - 1, Math.floor(out.length * TIGHTEST_SHARE))
  // Gentler than flat is no round at all, only the scan's scatter.
  return { convex: out[i] >= flatBelow ? out[i] : null, concave: into[i] <= -flatBelow ? into[i] : null }
}

export const curvature: Command<{
  show?: boolean
  quantity?: CurvatureQuantity
  radius?: number | null
  rangeRadius?: number | null
  flatRadius?: number | null
  at?: Location
}> = {
  name: 'curvature',
  title: 'Curvature shading',
  description:
    'Colour the scan by how it bends — convex (red), flat (pale), concave (blue), sharper than the range darker — and read it in numbers. Every vertex gets a quadric fitted to the scan within radius mm of it (null, the default: eight edge lengths, more on a noisy scan — till its scatter reads under a twentieth of a round that size), so the reading holds on a scan’s noise; a round smaller than the radius reads as an edge spread over it. show (true by default) switches the shading on in the measure workspace, putting it on screen, or off; quantity is what it is coloured by: principal (the default — the sharper of the two principal curvatures, signed: 1/R on a ball and a cylinder alike), mean or gaussian. rangeRadius is the round that takes full colour (null: the scan’s own range), flatRadius where flat ends: a surface bending more gently than a round that large is flat (null, the default: what the scan’s scatter allows — 1.5 times noiseFloor, the curvature its scatter, noise, reads on a flat at this radius). Returns the radius read at, the range, shares of the area (flat, convex, concave, saddle; unread is the share with too few points round it), the tightest convex and concave rounds on most of the part (radius, mm — the tightest half per cent read past), and with at the curvatures there: k1 ≥ k2 (1/mm, convex positive), their radii, mean, gaussian, shape (flat, convex, concave or saddle), dir1 and dir2 (the directions they bend in), points and rms of the fit. Not a step of the history.',
  input: obj({
    show: bool('Shading on (true, the default) or off.'),
    quantity: enumOf(CURVATURE_QUANTITIES, 'What the scan is coloured by: principal (the default), mean or gaussian.'),
    radius: nullable(num(undefined, { minimum: CURVATURE_RADIUS_MIN, maximum: CURVATURE_RADIUS_MAX }), 'The neighbourhood radius, mm; null for eight edge lengths or more, as the scan’s scatter asks.'),
    rangeRadius: nullable(num(undefined, { exclusiveMinimum: 0 }), 'The radius of the round that takes full colour, mm; null for the scan’s own range.'),
    flatRadius: nullable(num(undefined, { exclusiveMinimum: 0 }), 'Gentler than a round of this radius is flat, mm; null for what the scan’s scatter allows.'),
    at: locationSchema('A place to read the curvature at.'),
  }),
  readOnly: true,
  scene: true,
  long: true,
  run: async ({ show = true, quantity, radius, rangeRadius, flatRadius, at }) => {
    requireScan()
    const client = commandHost().session.clientRef.current
    if (!client) throw new CommandError('unavailable', 'The mesh worker is not running.')
    const store = useCurvature.getState()
    if (quantity !== undefined) store.setQuantity(quantity)
    if (radius !== undefined) store.setRadius(radius)
    if (rangeRadius !== undefined) store.setRange(rangeRadius === null ? null : 1 / rangeRadius)
    if (flatRadius !== undefined) store.setFlatRadius(flatRadius)
    store.setOn(show)
    if (show) showWorkspace('elements')
    // A place is found before the long read, so a bad one is refused at once.
    const spot = at ? await resolveLocation(at) : null
    let reading
    try {
      reading = await ensureCurvature(client)
    } catch (e) {
      throw new CommandError('failed', `The curvature could not be read: ${e instanceof Error ? e.message : String(e)}`)
    }
    const s = useCurvature.getState()
    const flat = flatBelow(s.flatRadius, reading)
    const shares = curvatureShares(reading.k1, reading.k2, reading.area, flat)
    const range = rangeShown(s.range, reading)
    const tight = tightest(reading.k1, reading.k2, flat)
    let place: Record<string, unknown> | undefined
    if (spot) {
      // At the radius the map was read at, the default's included.
      const { fit } = await client.curvatureAt(spot.vertex, reading.radius)
      place = fit
        ? {
            vertex: spot.vertex,
            point: sigV(spot.point),
            k1: sig(fit.k1),
            k2: sig(fit.k2),
            r1: radiusOf(fit.k1),
            r2: radiusOf(fit.k2),
            mean: sig((fit.k1 + fit.k2) / 2),
            gaussian: sig(fit.k1 * fit.k2),
            shown: sig(curvatureOf(fit.k1, fit.k2, s.quantity)),
            shape: classifyCurvature(fit.k1, fit.k2, flat),
            dir1: sigV(fit.dir1),
            dir2: sigV(fit.dir2),
            points: fit.points,
            rms: sig(fit.rms),
          }
        : { vertex: spot.vertex, point: sigV(spot.point), unread: 'Too few scan points round it to fit — a stray vertex, or a radius smaller than the triangles.' }
    }
    return {
      shown: s.on,
      workspace: publicWorkspace(useShell.getState().workspace),
      quantity: s.quantity,
      radius: sig(reading.radius),
      radiusAuto: reading.asked === null,
      spacing: sig(reading.spacing),
      range: { curvature: sig(range), radius: sig(1 / range), auto: s.range === null },
      flatRadius: sig(1 / flat),
      flatAuto: s.flatRadius === null,
      noise: sig(reading.noise),
      noiseFloor: sig(reading.noiseFloor),
      shares: {
        flat: sig(shares.flat),
        convex: sig(shares.convex),
        concave: sig(shares.concave),
        saddle: sig(shares.saddle),
        ...(shares.unread > 0 ? { unread: sig(shares.unread) } : {}),
      },
      tightest: { convexRadius: tight.convex === null ? null : radiusOf(tight.convex), concaveRadius: tight.concave === null ? null : radiusOf(tight.concave) },
      ...(place ? { at: place } : {}),
    }
  },
}
