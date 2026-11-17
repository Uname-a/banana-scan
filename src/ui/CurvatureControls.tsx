// SPDX-License-Identifier: AGPL-3.0-only
// Curvature shading's switch and its settings, in the Measure panel under
// the model: which curvature the scan is coloured by, the radius it is read
// over, the colour range and where flat ends — the last two as the radius
// of a round, which is how a bend is pictured. Off when the app opens.

import { useMemo } from 'react'
import { curvatureShares, type CurvatureQuantity } from '../core/geometry/principalCurvature'
import { rangeShown } from '../app/curvatureShading'
import { CURVATURE_RADIUS_MIN, flatBelow, useCurvature } from '../state/curvatureStore'
import { useLength } from '../app/useUnits'
import { InfoDot } from './InfoDot'
import { NumberField } from './NumberField'

const QUANTITY_CHOICES: readonly { id: CurvatureQuantity; label: string }[] = [
  { id: 'principal', label: 'Sharpest bend' },
  { id: 'mean', label: 'Mean' },
  { id: 'gaussian', label: 'Gaussian' },
]

/** A figure for a field: three significant digits, which is what a radius
 *  read off a scan holds. */
const shown = (x: number) => Number(x.toPrecision(3))

const percent = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 1 : 0)} %`

export function CurvatureControls() {
  const on = useCurvature((s) => s.on)
  const quantity = useCurvature((s) => s.quantity)
  const radius = useCurvature((s) => s.radius)
  const range = useCurvature((s) => s.range)
  const flatRadius = useCurvature((s) => s.flatRadius)
  const status = useCurvature((s) => s.status)
  const message = useCurvature((s) => s.message)
  const reading = useCurvature((s) => s.reading)
  const { setOn, setQuantity, setRadius, setRange, setFlatRadius } = useCurvature.getState()
  const len = useLength()
  const shares = useMemo(
    () => (reading ? curvatureShares(reading.k1, reading.k2, reading.area, flatBelow(flatRadius, reading)) : null),
    [reading, flatRadius],
  )
  const fullAt = 1 / rangeShown(range, reading)
  return (
    <>
      <label className="checkrow">
        <input type="checkbox" data-test="curvature-show" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>Curvature shading</span>
        <InfoDot title="Curvature shading">
          <p>
            Colours the scan by how it bends: red where it is convex — a round, the outside of a
            bore’s boss — blue where it is concave — a fillet’s hollow, the inside of a bore — and a
            pale neutral where it is flat. Edges sharper than the range run darker at either end, so
            fillets, edges, flats and free-form blends show at a glance.
          </p>
          <p>
            At every point a smooth surface is fitted to the scan within the <b>Radius</b>, and its
            bend is read there. A larger radius is calmer on a noisy scan and blurs anything smaller
            than itself; a smaller one follows small rounds and shows more of the noise. Left to
            itself, it is a few triangles across, more on a noisy scan.
          </p>
          <p>
            <b>Sharpest bend</b> reads the stronger of the two ways a surface bends — 1/R on a ball
            and on a cylinder alike, so a round reads as its radius. <b>Mean</b> averages the two;{' '}
            <b>Gaussian</b> multiplies them: positive on a dome or a dish, negative on a saddle, zero on a
            cylinder or a flat.
          </p>
          <p>
            The colour range and the line between flat and curved are set as the radius of a round:
            full colour at a round that tight, flat for anything gentler than <b>Flat beyond</b>.
          </p>
        </InfoDot>
      </label>
      {on && (
        <>
          <label className="field">
            <span>Show</span>
            <select data-test="curvature-quantity" value={quantity} onChange={(e) => setQuantity(e.target.value as CurvatureQuantity)}>
              {QUANTITY_CHOICES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Radius"
            testId="curvature-radius"
            value={shown(radius ?? reading?.radius ?? 1)}
            step={0.1}
            min={CURVATURE_RADIUS_MIN}
            kind="length"
            onCommit={setRadius}
            hint="How far round each point the scan is read. Larger is calmer and blurs what is smaller than itself. By itself, a few triangles across, more on a noisy scan."
          />
          <NumberField
            label="Full colour at R"
            testId="curvature-range"
            value={shown(fullAt)}
            step={0.1}
            min={1e-3}
            kind="length"
            onCommit={(r) => setRange(1 / r)}
            hint="The radius of a round that takes the full colour at either end of the scale. Anything tighter runs darker."
          />
          <NumberField
            label="Flat beyond R"
            testId="curvature-flat"
            value={shown(1 / flatBelow(flatRadius, reading))}
            step={1}
            min={1e-3}
            kind="length"
            onCommit={setFlatRadius}
            hint="A surface bending more gently than a round of this radius counts as flat in the shares below. By itself, what the scan's scatter reads at this radius: gentler than that cannot be told from flat."
          />
          {(radius !== null || range !== null || flatRadius !== null) && (
            <button
              type="button"
              className="block"
              data-test="curvature-auto"
              title="The radius, the range and where flat ends back to what the scan's own triangles and scatter give"
              onClick={() => {
                setRadius(null)
                setRange(null)
                setFlatRadius(null)
              }}
            >
              Radius, range and flat by the scan
            </button>
          )}
          {status === 'running' && (
            <p className="hint" data-test="curvature-status">
              <span className="spinner" /> Reading the curvature…
            </p>
          )}
          {status === 'error' && (
            <p className="hint warn" data-test="curvature-status">
              {message ?? 'The curvature could not be read.'}
            </p>
          )}
          {shares && status !== 'running' && (
            <p className="hint" data-test="curvature-shares">
              Flat {percent(shares.flat)} · convex {percent(shares.convex)} · concave {percent(shares.concave)}
              {shares.saddle > 0 && ` · saddle ${percent(shares.saddle)}`}
              {reading && ` — read over R ${len.fmt(reading.radius, 2)}`}
            </p>
          )}
        </>
      )}
    </>
  )
}
