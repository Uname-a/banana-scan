// SPDX-License-Identifier: AGPL-3.0-only
// Unroll / flatten's part of the app: the cylinder or cone an unroll goes
// by, read off the element fitted to it; the run, in the mesh worker, of
// either; and the pattern it made, written as a DXF or an SVG by the 2D
// sheet's own writers (src/core/flat) — its outline and holes as closed
// polylines on the edges layer, in millimetres, the pattern's low corner
// at the origin.

import { useStore } from '../../../src/state/store'
import type { Element } from '../../../src/state/elementModel'
import { exportStem, textBytes, type BuiltFile } from '../../../src/app/exports'
import { fmtArea, fmtLen, type DisplayUnits } from '../../../src/core/units'
import type { FlatDrawingInput } from '../../../src/core/flat/drawing'
import { buildFlatDxf, DXF_EDGE_TOLERANCE } from '../../../src/core/flat/dxf'
import { buildFlatSvg } from '../../../src/core/flat/svg'
import type { meshToolsOf } from '../core/meshClient'
import type { UnrollSurface } from '../core/unroll'
import { usePattern, type PatternMade } from '../state/patternStore'

type Tools = ReturnType<typeof meshToolsOf>

/** The kinds an unroll goes by. */
export const UNROLL_KINDS = ['cylinder', 'cone'] as const

/** The elements an unroll can go by: the cylinders and cones with a fit. */
export function unrollable(elements: readonly Element[]): Element[] {
  return elements.filter((e) => e.fit && (e.fit.kind === 'cylinder' || e.fit.kind === 'cone'))
}

/** The surface an element is, as an unroll takes it — or why it is none. */
export function surfaceOf(el: Element): UnrollSurface | string {
  const f = el.fit
  if (!f) return `${el.name} has no geometry to unroll by.`
  if (f.kind === 'cylinder') return { kind: 'cylinder', center: f.center, axis: f.axis, radius: f.radius }
  if (f.kind === 'cone') return { kind: 'cone', center: f.center, axis: f.axis, radius: f.radius, halfAngle: f.halfAngle }
  return `${el.name} is a ${f.kind} — an unroll goes by a cylinder or a cone.`
}

/** How far off the element's surface the scan may lie and still be on it,
 *  mm, when no region is marked: four times the fit's scatter, and no less
 *  than a fifth of a millimetre. */
export function bandFor(el: Element): number {
  const sigma = el.fit?.sigma
  return Math.max(0.2, Number.isFinite(sigma) && sigma! > 0 ? 4 * sigma! : 0.2)
}

export type PatternJob =
  | { mode: 'unroll'; element: Element; region: Uint32Array | null; band?: number; offset: number }
  | { mode: 'flatten'; region: Uint32Array; iterations?: number }

/**
 * Make a pattern: the worker lays the region out, the store keeps what came
 * back and the status line says what it is, in `units`. The pattern, or
 * null when it failed — the store and the error line say why — or the mesh
 * changed under it.
 */
export async function makePattern(tools: Tools, job: PatternJob, units: DisplayUnits = 'mm'): Promise<PatternMade | null> {
  const p = usePattern.getState()
  const scanVersion = tools.scanVersion
  const editedVersion = tools.editedVersion
  let surface: UnrollSurface | null = null
  if (job.mode === 'unroll') {
    const s = surfaceOf(job.element)
    if (typeof s === 'string') {
      p.fail(s)
      useStore.getState().setError(s)
      return null
    }
    surface = s
  }
  p.begin()
  useStore.getState().setStatus(job.mode === 'unroll' ? `Unrolling ${job.element.name}…` : 'Flattening the region…')
  try {
    let made: PatternMade
    if (job.mode === 'unroll') {
      const band = job.band ?? bandFor(job.element)
      const r = await tools.unroll(surface!, job.region, band, job.offset)
      made = { mode: 'unroll', points: r.points, offsets: r.offsets, report: r.report, offset: job.offset, source: job.element.name }
    } else {
      const r = await tools.flatten(job.region, job.iterations)
      made = { mode: 'flatten', points: r.points, offsets: r.offsets, report: r.report, source: 'region' }
    }
    if (scanVersion !== tools.scanVersion || editedVersion !== tools.editedVersion) return null
    usePattern.getState().resolve(made)
    useStore.getState().setStatus(patternStatus(made, units))
    return made
  } catch (e) {
    if (scanVersion !== tools.scanVersion || editedVersion !== tools.editedVersion) return null
    const message = e instanceof Error ? e.message : String(e)
    usePattern.getState().fail(message)
    useStore.getState().setError(message)
    useStore.getState().setStatus('')
    return null
  }
}

/** What a pattern is, in a line. */
export function patternStatus(made: PatternMade, units: DisplayUnits): string {
  const f = made.report.figures
  const holes = f.holes.length === 0 ? 'no holes' : `${f.holes.length} hole${f.holes.length === 1 ? '' : 's'}`
  const size = `${fmtLen(f.width, units, 2)} × ${fmtLen(f.height, units, 2)}, ${fmtArea(f.area, units, 1)}, ${holes}`
  const d = made.report.distortion
  if (made.mode === 'unroll') {
    const r = made.report
    // Under half the last place shown, it is on the surface.
    const off = r.residual.max >= 0.0005 ? ` — the region lies within ${fmtLen(r.residual.max, units, 3)} of the ${r.surface}` : ` — the region lies on the ${r.surface}`
    return `Unrolled ${made.source}: ${size}${off}.`
  }
  return `Flattened the region: ${size} — length stretched ${pct(d.length.max)} at most, ${pct(d.length.mean)} on average.`
}

/** A share in per cent, to two significant places past the point where it
 *  is small. */
export const pct = (v: number): string => `${v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4)} %`

/** The pattern as the sheet's writers take it: its loops closed, as edge
 *  chains in millimetres. */
function drawingOf(made: PatternMade, units: DisplayUnits): FlatDrawingInput {
  const { points, offsets } = made
  const loops = offsets.length - 1
  const chain = new Float32Array((points.length / 2 + loops) * 2)
  const chainOffsets = new Uint32Array(loops + 1)
  let at = 0
  for (let k = 0; k < loops; k++) {
    chainOffsets[k] = at
    for (let i = offsets[k]; i < offsets[k + 1]; i++) {
      chain[at * 2] = points[i * 2]
      chain[at * 2 + 1] = points[i * 2 + 1]
      at++
    }
    // Back to its first point: a closed polyline.
    chain[at * 2] = points[offsets[k] * 2]
    chain[at * 2 + 1] = points[offsets[k] * 2 + 1]
    at++
  }
  chainOffsets[loops] = at
  const f = made.report.figures
  const pad = Math.max(1, 0.02 * Math.hypot(f.width, f.height))
  const stem = exportStem()
  const verb = made.mode === 'unroll' ? 'unrolled' : 'flattened'
  return {
    bounds: { min: [-pad, -pad], max: [f.width + pad, f.height + pad] },
    chains: { points: chain, offsets: chainOffsets },
    chainUnit: { x: 1, y: 1 },
    edgesNote: `the flat pattern: its outline, then ${f.holes.length === 1 ? 'the hole' : `the ${f.holes.length} holes`} in it`,
    elements: [],
    alignDir: null,
    turns: 0,
    mirror: false,
    unit: 'mm', // units-ok: the document unit, an id
    title: `Banana Scan flat pattern - ${stem} - ${made.source} ${verb}`,
    scaleNote: scaleNote(made, units),
  }
}

/** What the pattern's sizes rest on, for the file. */
function scaleNote(made: PatternMade, units: DisplayUnits): string {
  if (made.mode === 'unroll') {
    const r = made.report
    if (r.sector) {
      return (
        `Unrolled from the cone ${made.source}: a sector of ${r.sector.angle.toFixed(3)} deg about its apex at ` +
        `(${fmtLen(r.sector.apex[0], units, 3)}, ${fmtLen(r.sector.apex[1], units, 3)}), radii ${fmtLen(r.sector.innerRadius, units, 3)} to ${fmtLen(r.sector.outerRadius, units, 3)}` +
        `${made.offset !== 0 ? `, laid out ${fmtLen(made.offset, units, 3)} off the fitted surface` : ''}; seen from outside`
      )
    }
    return (
      `Unrolled from the cylinder ${made.source} at radius ${fmtLen(r.radius ?? 0, units, 3)}: arc length round the axis along x, ` +
      `height along the axis along y; seen from outside`
    )
  }
  const d = made.report.distortion
  return `Flattened with the least distortion (conformal, then as-rigid-as-possible): length stretched ${pct(d.length.max)} at most, ${pct(d.length.mean)} on average; seen from the side the scan faces`
}

/** The pattern as a DXF — in `units` by declaration, millimetres for the
 *  agent — or an SVG, always millimetres. */
export function buildPatternFile(made: PatternMade, format: 'dxf' | 'svg', units: DisplayUnits = 'mm'): BuiltFile {
  // units-ok: an SVG is always in millimetres, an id
  const input = drawingOf(made, format === 'dxf' ? units : 'mm')
  const verb = made.mode === 'unroll' ? 'unrolled' : 'flattened'
  const source = made.source.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'region'
  const name = `${exportStem()}-${source}-${verb}.${format}`
  const f = made.report.figures
  const what = `${fmtLen(f.width, units, 2)} × ${fmtLen(f.height, units, 2)}, ${f.holes.length} hole${f.holes.length === 1 ? '' : 's'}`
  if (format === 'svg') {
    return { name, mimeType: 'image/svg+xml', bytes: textBytes(buildFlatSvg(input)), status: `Flat pattern exported to ${name} — ${what}.` }
  }
  const dxf = buildFlatDxf({ ...input, origin: null, edgeTolerance: DXF_EDGE_TOLERANCE.mm, units })
  return { name, mimeType: 'application/dxf', bytes: textBytes(dxf), status: `Flat pattern exported to ${name} — ${what}.` }
}
