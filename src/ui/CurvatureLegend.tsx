// SPDX-License-Identifier: AGPL-3.0-only
// The scale beside curvature shading: the diverging ramp it is painted in,
// its figures per unit length (per unit area for the Gaussian), the flat
// band marked on it, and the same range as the radius of a round, which is
// how a bend is pictured. Either end can be retyped to set the range.

import { CURVATURE_COLORMAP, curvatureMapScale, quantityPower, rangeShown } from '../app/curvatureShading'
import { useLength } from '../app/useUnits'
import { flatBelow, useCurvature } from '../state/curvatureStore'
import { MapLegend } from './MapLegend'

export function CurvatureLegend() {
  const on = useCurvature((s) => s.on)
  const values = useCurvature((s) => s.values)
  const quantity = useCurvature((s) => s.quantity)
  const range = useCurvature((s) => s.range)
  const reading = useCurvature((s) => s.reading)
  const flatRadius = useCurvature((s) => s.flatRadius)
  const len = useLength()
  if (!on || !values || !reading) return null
  const power = quantityPower(quantity)
  // Held per mm (per mm²), shown per unit: a millimetre is toDisplay(1)
  // units, so a figure per mm is 1/toDisplay(1) of itself per unit.
  const perUnit = 1 / len.toDisplay(1) ** power
  const shownRange = rangeShown(range, reading)
  const held = curvatureMapScale(quantity, shownRange)
  const scale = { ...held, low: held.low * perUnit, high: held.high * perUnit }
  const flatAt = flatBelow(flatRadius, reading)
  const flat = flatAt ** power * perUnit
  const unit = `1/${len.word(power === 2 ? 2 : 1)}`
  return (
    <MapLegend
      id="curvature"
      unit={unit}
      scale={scale}
      colormap={CURVATURE_COLORMAP}
      format={(v) => v.toPrecision(2)}
      histogram={null}
      showHistogram={false}
      zeroAt={0}
      ends={
        quantity === 'gaussian'
          ? { high: 'a dome or a dish', low: 'a saddle' }
          : { high: 'convex — a round', low: 'concave — a hollow' }
      }
      marks={flat < scale.high ? [{ value: -flat, to: flat, label: 'flat', title: `Flat: gentler than a round of R ${len.fmt(1 / flatAt, 1)}` }] : []}
      stats={[
        { label: 'full colour at', value: `R ${len.fmt(1 / shownRange, 2)}`, wide: true },
        { label: 'read over', value: `R ${len.fmt(reading.radius, 2)}`, wide: true },
      ]}
      // A figure typed at either end is per unit shown; the range is held
      // as a curvature per mm, so the Gaussian's is its square root.
      onLimit={(_end, v) => {
        const perMm = v / perUnit
        useCurvature.getState().setRange(power === 2 ? Math.sqrt(perMm) : perMm)
      }}
    />
  )
}
