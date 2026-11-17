// SPDX-License-Identifier: AGPL-3.0-only
// Curvature shading: the scan coloured by how it bends — convex, flat,
// concave — read off a quadric fitted round every vertex over a radius the
// user sets (see core/geometry/principalCurvature). A way of looking, like
// the curvature comb: held for the session, off when the app opens, never
// saved, no step of the history. The reading is the mesh worker's, made
// when the shading is first switched on and again whenever the radius or
// the scan changes; what it is shown as — which curvature, the colour range,
// where flat ends — is applied here at once, without the worker.

import { create } from 'zustand'
import { curvatureValues, type CurvatureQuantity } from '../core/geometry/principalCurvature'

/** The neighbourhood radius, mm, the controls offer. */
export const CURVATURE_RADIUS_MIN = 0.05
export const CURVATURE_RADIUS_MAX = 100

/** Unless one is set, a surface is flat where it bends less than its
 *  scatter reads at the radius — by this much over the noise floor, so
 *  that the scatter on a flat face does not read as bends — and never less
 *  than a round this large, mm. */
const FLAT_OVER_NOISE = 1.5
const FLAT_RADIUS_MOST = 1000

/** One reading of the scan: both principal curvatures at every vertex, each
 *  vertex's share of the area, and what it was read at. */
export interface CurvatureReading {
  k1: Float32Array
  k2: Float32Array
  area: Float32Array
  /** The neighbourhood radius read at, mm. */
  radius: number
  /** The radius that was asked for: null for the default. */
  asked: number | null
  /** The scan's median edge length, mm. */
  spacing: number
  /** The scan's scatter, mm, and the curvature it reads on a flat at
   *  this radius, 1/mm (see principalCurvature curvatureNoise). */
  noise: number
  noiseFloor: number
  /** The colour range the reading takes by itself, 1/mm. */
  autoRange: number
  /** The worker's scan version it was read off (see MeshWorkerClient
   *  scanVersion): another scan put in place makes it stale. */
  scanVersion: number
}

export type CurvatureStatus = 'idle' | 'running' | 'ready' | 'error'

interface CurvatureState {
  on: boolean
  quantity: CurvatureQuantity
  /** The neighbourhood radius asked for, mm; null for a few edge lengths. */
  radius: number | null
  /** The colour range, 1/mm, the ramp's ends at ±range (±range² for the
   *  Gaussian); null for the reading's own. */
  range: number | null
  /** Under the curvature of a round this large, mm, a surface is flat;
   *  null for what the scan's scatter allows (see flatBelow). */
  flatRadius: number | null
  status: CurvatureStatus
  message: string | null
  reading: CurvatureReading | null
  /** The reading as the quantity shown, NaN where there is none. */
  values: Float32Array | null
  /** Bumped whenever `values` changes, so the view repaints. */
  version: number
  setOn: (on: boolean) => void
  setQuantity: (q: CurvatureQuantity) => void
  setRadius: (mm: number | null) => void
  setRange: (perMm: number | null) => void
  setFlatRadius: (mm: number | null) => void
  begin: () => void
  land: (reading: CurvatureReading) => void
  fail: (message: string) => void
  /** Drop the reading: the scan it was read off is gone. */
  clear: () => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const useCurvature = create<CurvatureState>((set, get) => ({
  on: false,
  quantity: 'principal',
  radius: null,
  range: null,
  flatRadius: null,
  status: 'idle',
  message: null,
  reading: null,
  values: null,
  version: 0,
  setOn: (on) => set({ on }),
  setQuantity: (quantity) => {
    const { reading, version } = get()
    set({ quantity, values: reading ? curvatureValues(reading.k1, reading.k2, quantity) : null, version: version + 1 })
  },
  setRadius: (mm) => {
    if (mm !== null && !Number.isFinite(mm)) return
    const radius = mm === null ? null : clamp(mm, CURVATURE_RADIUS_MIN, CURVATURE_RADIUS_MAX)
    if (radius === get().radius) return
    // A reading at another radius is another reading: the old one stays on
    // screen until the new one lands, and is asked for by whoever watches.
    set({ radius })
  },
  setRange: (perMm) => {
    if (perMm !== null && !(Number.isFinite(perMm) && perMm > 0)) return
    set({ range: perMm })
  },
  setFlatRadius: (mm) => {
    if (mm === null || (Number.isFinite(mm) && mm > 0)) set({ flatRadius: mm })
  },
  begin: () => set({ status: 'running', message: null }),
  land: (reading) => {
    set((s) => ({
      reading,
      values: curvatureValues(reading.k1, reading.k2, s.quantity),
      status: 'ready',
      message: null,
      version: s.version + 1,
    }))
  },
  fail: (message) => set({ status: 'error', message }),
  clear: () => set((s) => ({ reading: null, values: null, status: 'idle', message: null, version: s.version + 1 })),
}))

/** Whether the reading held answers the radius asked for now. */
export function readingFits(reading: CurvatureReading | null, radius: number | null, scanVersion: number): boolean {
  return reading !== null && reading.scanVersion === scanVersion && reading.asked === radius
}

/** The curvature under which a surface is flat, 1/mm: the one set, or
 *  what the reading's scatter allows. */
export function flatBelow(flatRadius: number | null, reading: CurvatureReading | null): number {
  if (flatRadius !== null) return 1 / flatRadius
  return Math.max(1 / FLAT_RADIUS_MOST, FLAT_OVER_NOISE * (reading?.noiseFloor ?? 0))
}
