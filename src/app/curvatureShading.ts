// SPDX-License-Identifier: AGPL-3.0-only
// Curvature shading's reading, asked of the mesh worker — by the shading
// switched on in the Measure panel, and by scan.curvature — once per scan
// and radius: two callers asking for the same reading at once share one
// pass over the scan. And how the reading is shown: which ramp, at which
// range, where flat ends.

import { useEffect, type RefObject } from 'react'
import type { Colormap, FieldScale } from '../core/field/colormap'
import { autoCurvatureRange, type CurvatureQuantity } from '../core/geometry/principalCurvature'
import type { MeshWorkerClient } from '../core/workerClient'
import { readingFits, useCurvature, type CurvatureReading } from '../state/curvatureStore'
import { useShell } from '../state/shellStore'
import { useStore } from '../state/store'

let inflight: { key: string; promise: Promise<CurvatureReading> } | null = null

/** The reading at the radius set now, made if the one held is for another
 *  radius or another scan. Rejects when the worker cannot read it. */
export function ensureCurvature(client: MeshWorkerClient): Promise<CurvatureReading> {
  const store = useCurvature.getState()
  const { radius } = store
  const scanVersion = client.scanVersion
  if (store.reading && readingFits(store.reading, radius, scanVersion)) return Promise.resolve(store.reading)
  const key = `${scanVersion}|${radius ?? 'auto'}`
  if (inflight?.key === key) return inflight.promise
  store.begin()
  useStore.getState().setStatus('Reading the curvature…')
  const promise = client.principalCurvature(radius).then(
    (r) => {
      useStore.getState().setStatus('Curvature read.')
      const reading: CurvatureReading = { ...r, asked: radius, scanVersion, autoRange: autoCurvatureRange(r.k1, r.k2, useStore.getState().modelSize) }
      // A reading asked before another scan or radius took its place is
      // not the one wanted now: it is handed to whoever asked, not kept.
      const now = useCurvature.getState()
      if (client.scanVersion === scanVersion && now.radius === radius) now.land(reading)
      if (inflight?.promise === promise) inflight = null
      return reading
    },
    (e: unknown) => {
      if (inflight?.promise === promise) inflight = null
      useStore.getState().setStatus('')
      const message = e instanceof Error ? e.message : String(e)
      useCurvature.getState().fail(message)
      throw e
    },
  )
  inflight = { key, promise }
  return promise
}

/** Keep the reading in step while the shading is on: read when it is
 *  switched on, when the radius moves, when another scan comes in; drop
 *  it when the scan goes. */
export function useCurvatureShading({ clientRef }: { clientRef: RefObject<MeshWorkerClient | null> }): void {
  const on = useCurvature((s) => s.on)
  const radius = useCurvature((s) => s.radius)
  const onMeasure = useShell((s) => s.workspace === 'elements')
  const fileName = useStore((s) => s.fileName)
  const triangleCount = useStore((s) => s.triangleCount)
  const modelSize = useStore((s) => s.modelSize)
  useEffect(() => {
    if (!fileName) useCurvature.getState().clear()
  }, [fileName])
  useEffect(() => {
    const client = clientRef.current
    if (!on || !onMeasure || !fileName || !client) return
    // A failure is in the store for the panel to say; nothing more to do.
    ensureCurvature(client).catch(() => {})
  }, [on, onMeasure, radius, fileName, triangleCount, modelSize, clientRef])
}

/** The ramp a curvature map is painted in: blue in a hollow, a pale neutral
 *  on the flats, red on a convex round — the diverging map a bend is read
 *  on whatever ramp the deviation maps are set to, since its middle is the
 *  reading that matters most and a rainbow's middle is a colour like any
 *  other. Sharper than the range, darker still: an edge drawn dark is an
 *  edge found. */
export const CURVATURE_COLORMAP: Colormap = {
  id: 'diverging',
  label: 'Diverging',
  hint: 'Blue through a pale neutral to red, for a signed reading about zero',
  stops: Uint8Array.from([33, 102, 172, 103, 169, 207, 209, 229, 240, 228, 228, 222, 253, 219, 199, 239, 138, 98, 178, 24, 43]),
  under: [10, 30, 90],
  over: [90, 0, 10],
}

/** The power of a length the quantity is in: a curvature per length, the
 *  Gaussian per area. */
export function quantityPower(q: CurvatureQuantity): 1 | 2 {
  return q === 'gaussian' ? 2 : 1
}

/** The range in effect, 1/mm: the one set, or the reading's own. */
export function rangeShown(range: number | null, reading: CurvatureReading | null): number {
  return range ?? reading?.autoRange ?? 0.1
}

/** How the map is read as colour, in 1/mm (1/mm² for the Gaussian): zero
 *  in the middle, ±range at the ends, the rim of no reading bare. */
export function curvatureMapScale(q: CurvatureQuantity, range: number): FieldScale {
  const end = range ** quantityPower(q)
  return { low: -end, high: end, bands: null, validMin: -Infinity, validMax: Infinity }
}

/** A reading as the hover says it: the radius of the round that bends as
 *  much, and which way, or flat (under `flat`, 1/mm); the Gaussian as the
 *  figure it is, per the unit squared. */
export function describeCurvature(
  value: number,
  quantity: CurvatureQuantity,
  flat: number,
  len: { fmt: (mm: number, d?: number) => string; toDisplay: (mm: number) => number; word: (p?: 1 | 2 | 3) => string },
): string {
  if (quantity === 'gaussian') {
    // Per mm² held, per unit² shown: a length's conversion, squared and
    // turned over.
    const perUnit2 = value / len.toDisplay(1) ** 2
    if (Math.abs(value) < flat ** 2) return `flat (${perUnit2.toPrecision(3)} /${len.word(2)})`
    return `${value > 0 ? 'dome' : 'saddle'} ${perUnit2.toPrecision(3)} /${len.word(2)}`
  }
  if (Math.abs(value) < flat) return 'flat'
  return `R ${len.fmt(1 / Math.abs(value), 2)} ${value > 0 ? 'convex' : 'concave'}`
}
