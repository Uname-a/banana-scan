// SPDX-License-Identifier: AGPL-3.0-only
// scan.gear: the involute gears on a scan about an axis, read off it — each
// toothed band's tooth count, module, pressure angle, helix, profile shift,
// tip and root diameters and face width, the teeth's own centre, how close
// the flanks lie to true involutes, and the teeth that are broken. See
// core/geometry/gearFit.ts for the reading.
//
// The bands are found by cutting square to the axis at even steps along the
// scan and counting the repeats round it in each cut (rotationalRepeat): a
// run of cuts with the same count of six or more is a band of teeth, its
// ends then found closer by halving the step between a cut with the teeth
// and one without. Each band is read on cuts clear of its ends, where a
// chamfer or a burr would show as a thinner tooth.

import { fitGear, type GearCut, type GearReading } from '../../core/geometry/gearFit'
import { gearGeometry } from '../../core/geometry/gear'
import { rotationalRepeat } from '../../core/geometry/rotationalRepeat'
import { roundTo } from '../../core/round'
import { radialFrame } from '../../core/section/frame'
import { projectCut } from '../../core/section/slice'
import { EDGE_MIN_FEATURE_MM } from '../../core/flat/edges'
import type { Vec3 } from '../../core/types'
import { commandHost } from '../host'
import { elementRefSchema, requireScan } from '../refs'
import { int, num, obj, oneOf, vec3 } from '../schema'
import { CommandError, type Command } from '../types'
import { axisLine, type AxisIn } from './scan'

/** Cuts the search takes along the scan, at most, and their closest step. */
const SEARCH_CUTS = 60
const SEARCH_STEP_MIN = 0.25
/** Halvings of the step at each end of a band. */
const END_HALVINGS = 3
/** A cut's repeat is a gear's teeth at this score and count. */
const TEETH_SCORE = 0.6
const TEETH_MIN = 6
const TEETH_MAX = 120
/** Cuts a band is read on, and the share of its width kept clear at each end. */
const READ_CUTS = 9
const READ_CLEAR = 0.12
/** A band needs this many search cuts in a row. */
const BAND_CUTS = 2

type Client = NonNullable<ReturnType<typeof commandHost>['session']['clientRef']['current']>

interface Line { origin: Vec3; dir: Vec3 }

const at = (line: Line, h: number): Vec3 => [line.origin[0] + h * line.dir[0], line.origin[1] + h * line.dir[1], line.origin[2] + h * line.dir[2]]

/** A cut square to the axis at height h, laid flat with the axis at [0, 0]:
 *  its chains, and the count of the repeats round the axis in it. */
async function cutAt(client: Client, line: Line, zero: Vec3, quarter: Vec3, h: number, radius?: { min?: number; max?: number }) {
  const origin = at(line, h)
  const cut = await client.section(origin, line.dir, EDGE_MIN_FEATURE_MM)
  const flat = projectCut(cut, { origin, normal: line.dir, basisU: zero, basisV: quarter })
  const r = rotationalRepeat(flat, { ...(radius?.min !== undefined ? { minRadius: radius.min } : {}), ...(radius?.max !== undefined ? { maxRadius: radius.max } : {}), maxCount: TEETH_MAX })
  const chains: Float32Array[] = []
  for (let c = 0; c + 1 < flat.offsets.length; c++) {
    const chain = flat.points.subarray(flat.offsets[c] * 2, flat.offsets[c + 1] * 2)
    if (radius?.min === undefined && radius?.max === undefined) {
      chains.push(chain)
      continue
    }
    // Only the outline within the radii, each run of it a chain.
    let run: number[] = []
    for (let i = 0; i + 1 < chain.length; i += 2) {
      const d = Math.hypot(chain[i], chain[i + 1])
      if ((radius.min === undefined || d >= radius.min) && (radius.max === undefined || d <= radius.max)) run.push(chain[i], chain[i + 1])
      else if (run.length) {
        chains.push(Float32Array.from(run))
        run = []
      }
    }
    if (run.length) chains.push(Float32Array.from(run))
  }
  const teeth = r.count >= TEETH_MIN && r.score >= TEETH_SCORE ? r.count : 0
  return { h, chains, teeth, score: r.score }
}

const v6 = (v: readonly number[]) => v.map((x) => roundTo(x, 6) + 0) as Vec3
const r4 = (x: number) => roundTo(x, 4)

export const gear: Command<{ axis: AxisIn; from?: number; to?: number; radius?: { min?: number; max?: number }; teeth?: number }> = {
  name: 'gear',
  title: 'Read the gears round an axis',
  description: `The involute gears on the scan about an axis, read off it: needs axis — a cylinder, cone, line or circle element, "X", "Y", "Z", or { origin, dir } (the bore's cylinder is best). Cuts square to the axis along the scan find each band of teeth (a run of cuts with the same count, six or more), or give from and to (mm along the axis) for one; radius keeps the cut to the teeth where another feature shares their height. Returns per gear: from and to (its face width along the axis), axis { origin (moved onto the teeth's own centre), dir, zeroDir } and centreOff (mm), teeth, module (normal), pressureDeg, helixDeg (plus a right hand, minus a left, 0 spur), shift (profile shift, modules), tipDiameter, rootDiameter, baseDiameter, leadMm, phaseDeg (tooth 0's middle at height 0 on the axis, from zeroDir), standard (the module and pressure angle named, or null where the flanks name none, or only one wanting a shift over 1: 20° and the module as measured — the same flanks, not the drawing's numbers), flankRms (mm: the gear named against the scan's flanks), measuredFlankRms (the closest true involutes'), helixRms (degrees: how far the teeth stray from one helix along the face) and broken (each tooth well off the others or short of the tip: index, angleDeg, rms, tipShort). A gear with a flankRms well over the scan's noise is not an involute (a sprocket, a spline, a worn gear). reverse_feature_add { kind: "gear" } builds what it reads. Changes nothing.`,
  input: obj(
    {
      axis: oneOf(
        [
          elementRefSchema('A cylinder, cone, line or circle element, or a coordinate axis "X", "Y", "Z".'),
          obj({ origin: vec3('A point on the axis, mm.'), dir: vec3('Its direction, any length.') }, ['origin', 'dir']),
        ],
        'The axis the gear turns on.',
      ),
      from: num('mm along the axis: where one band of teeth starts. With to; absent, the bands are found.'),
      to: num('mm along the axis: where it ends.'),
      radius: obj({ min: num('mm', { minimum: 0 }), max: num('mm', { exclusiveMinimum: 0 }) }, [], 'Only the cut between these distances from the axis.'),
      teeth: int('The tooth count, where the cuts cannot count it (a gear with teeth missing).', { minimum: TEETH_MIN, maximum: TEETH_MAX }),
    },
    ['axis'],
  ),
  readOnly: true,
  // Some 70 cuts of the scan: on a large one past the server's answer limit.
  long: true,
  run: async ({ axis, from, to, radius, teeth }) => {
    requireScan()
    const client = commandHost().session.clientRef.current
    if (!client) throw new CommandError('unavailable', 'The mesh worker is not running.')
    if ((from === undefined) !== (to === undefined)) throw new CommandError('invalid_input', 'Give from and to together, or neither.')
    if (from !== undefined && to !== undefined && !(to > from)) throw new CommandError('invalid_input', 'to must lie beyond from.')
    if (radius?.min !== undefined && radius.max !== undefined && !(radius.min < radius.max)) throw new CommandError('invalid_input', 'radius.min must lie below radius.max.')
    const line = axisLine(axis)
    const zero = radialFrame(line, 0)!.basisU
    const quarter = radialFrame(line, 90)!.basisU
    const cutOf = (h: number) => cutAt(client, line, zero, quarter, h, radius)
    let bands: { from: number; to: number; teeth: number }[] = []
    if (from !== undefined && to !== undefined) {
      const mid = await cutOf((from + to) / 2)
      const n = teeth ?? mid.teeth
      if (!n) throw new CommandError('invalid_input', `No teeth counted at ${roundTo((from + to) / 2, 3)} mm along the axis${mid.score > 0 ? ` (the best repeat scored ${roundTo(mid.score, 2)})` : ''}: give teeth, or check the axis and the heights.`)
      bands = [{ from, to, teeth: n }]
    } else {
      // The scan's run along the axis.
      const sample = (await client.query({ min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity], limit: 20_000 })).positions
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i + 2 < sample.length; i += 3) {
        const h = sample[i] * line.dir[0] + sample[i + 1] * line.dir[1] + sample[i + 2] * line.dir[2]
        lo = Math.min(lo, h)
        hi = Math.max(hi, h)
      }
      if (!Number.isFinite(lo)) throw new CommandError('invalid_state', 'The scan has no vertices to cut.')
      const step = Math.max(SEARCH_STEP_MIN, (hi - lo) / SEARCH_CUTS)
      const found: { h: number; teeth: number }[] = []
      for (let h = lo + step / 2; h < hi; h += step) {
        const c = await cutOf(h)
        found.push({ h, teeth: teeth && c.teeth ? teeth : c.teeth })
      }
      // One cut that misses the count between two that agree is a flaw in
      // the scan there (a pit, a burr, a hole the wrap bridged), not the
      // end of the teeth: on the Artec gear one cut at 14.5 mm parted its
      // 13 mm face in two.
      for (let i = 1; i + 1 < found.length; i++) if (found[i].teeth !== found[i - 1].teeth && found[i - 1].teeth && found[i - 1].teeth === found[i + 1].teeth) found[i] = { ...found[i], teeth: found[i - 1].teeth }
      // Runs of the same count; each end found closer by halving.
      const edge = async (inside: number, outside: number, n: number) => {
        for (let i = 0; i < END_HALVINGS; i++) {
          const m = (inside + outside) / 2
          const c = await cutOf(m)
          if (c.teeth === n || (teeth && c.teeth)) inside = m
          else outside = m
        }
        return (inside + outside) / 2
      }
      for (let i = 0; i < found.length; ) {
        let j = i
        while (j + 1 < found.length && found[j + 1].teeth === found[i].teeth) j++
        if (found[i].teeth && j - i + 1 >= BAND_CUTS) {
          const start = i > 0 ? await edge(found[i].h, found[i - 1].h, found[i].teeth) : Math.max(lo, found[i].h - step / 2)
          const end = j + 1 < found.length ? await edge(found[j].h, found[j + 1].h, found[i].teeth) : Math.min(hi, found[j].h + step / 2)
          bands.push({ from: start, to: end, teeth: found[i].teeth })
        }
        i = j + 1
      }
    }
    const gears = []
    const refused: { from: number; to: number; teeth: number; why: string }[] = []
    for (const band of bands) {
      const clear = READ_CLEAR * (band.to - band.from)
      const cuts: GearCut[] = []
      for (let i = 0; i < READ_CUTS; i++) {
        const h = band.from + clear + ((i + 0.5) / READ_CUTS) * (band.to - band.from - 2 * clear)
        cuts.push(await cutOf(h))
      }
      const r = fitGear(cuts, band.teeth)
      if ('refused' in r) {
        refused.push({ from: r4(band.from), to: r4(band.to), teeth: band.teeth, why: r.refused })
        continue
      }
      gears.push(gearAnswer(r, band, line, zero, quarter))
    }
    return {
      axis: { ...(line.name ? { name: line.name } : {}), origin: v6(line.origin), dir: v6(line.dir), zeroDir: v6(zero) },
      gears,
      ...(refused.length ? { refused } : {}),
      ...(bands.length === 0 ? { note: 'No band of teeth found along the axis: no run of cuts with six or more repeats round it. Check the axis is the gear’s, or give from, to and teeth.' } : {}),
    }
  },
}

/** A gear read, as scan.gear answers it: on the teeth's own axis, heights
 *  and phase about it. */
function gearAnswer(r: GearReading, band: { from: number; to: number }, line: Line, zero: Vec3, quarter: Vec3) {
  const off: Vec3 = [zero[0] * r.centre[0] + quarter[0] * r.centre[1], zero[1] * r.centre[0] + quarter[1] * r.centre[1], zero[2] * r.centre[0] + quarter[2] * r.centre[1]]
  const origin: Vec3 = [line.origin[0] + off[0], line.origin[1] + off[1], line.origin[2] + off[2]]
  const geo = gearGeometry(r.spec)
  const deg = (x: number) => roundTo((((x * 180) / Math.PI) % 360 + 360) % 360, 4)
  return {
    from: r4(band.from),
    to: r4(band.to),
    axis: { origin: v6(origin), dir: v6(line.dir), zeroDir: v6(zero) },
    centreOff: r4(Math.hypot(r.centre[0], r.centre[1])),
    teeth: r.spec.teeth,
    module: roundTo(r.spec.module, 5),
    pressureDeg: r.spec.pressureDeg,
    helixDeg: roundTo(r.spec.helixDeg, 4),
    shift: roundTo(r.spec.shift, 4),
    tipDiameter: r4(r.spec.tipDiameter),
    rootDiameter: r4(r.spec.rootDiameter),
    baseDiameter: r4(r.baseDiameter),
    leadMm: Number.isFinite(geo.lead) ? roundTo(geo.lead, 2) : null,
    phaseDeg: deg(r.phase),
    standard: r.standard ? { module: r.standard.module, pressureDeg: r.standard.pressureDeg, name: r.standard.name } : null,
    flankRms: r4(r.flankRms),
    measuredFlankRms: r4(r.measuredFlankRms),
    flankPoints: r.flankPoints,
    helixRms: r4(r.helixRms),
    broken: r.teethRead.filter((t) => t.broken).map((t) => ({ index: t.index, angleDeg: roundTo(t.angleDeg, 2), rms: r4(t.rms), tipShort: r4(t.tipShort) })),
  }
}
