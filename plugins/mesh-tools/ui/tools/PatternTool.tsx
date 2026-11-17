// SPDX-License-Identifier: AGPL-3.0-only
// Unroll / flatten: a flat pattern of a region of the scan, beside it —
// a cylinder or cone unrolled by the element fitted to it, or a bent sheet
// flattened with the least distortion — drawn here and saved as a DXF or an
// SVG. See core/unroll, core/flatten.

import { useShallow } from 'zustand/react/shallow'
import { useLength } from '../../../../src/app/useUnits'
import { useMark } from '../../../../src/state/markStore'
import { useStore } from '../../../../src/state/store'
import { InfoDot } from '../../../../src/ui/InfoDot'
import { MarkTools } from '../../../../src/ui/MarkTools'
import { NumberField } from '../../../../src/ui/NumberField'
import { pct, unrollable } from '../../app/flatPatterns'
import { patternMarks, usePattern, type PatternMade, type PatternMode, type PatternScope } from '../../state/patternStore'
import { count } from '../meshFormat'

/** The pattern drawn small: its outline filled, the holes cut out of it. */
function PatternPreview({ made }: { made: PatternMade }) {
  const { points, offsets } = made
  const f = made.report.figures
  const pad = 0.03 * Math.max(f.width, f.height, 1e-6)
  const d: string[] = []
  for (let k = 0; k + 1 < offsets.length; k++) {
    const parts: string[] = []
    for (let i = offsets[k]; i < offsets[k + 1]; i++) {
      // y up on the pattern, down in the picture.
      parts.push(`${(points[i * 2]).toFixed(3)},${(f.height - points[i * 2 + 1]).toFixed(3)}`)
    }
    d.push(`M${parts.join('L')}Z`)
  }
  return (
    <svg
      className="pattern-preview"
      data-test="pattern-preview"
      viewBox={`${-pad} ${-pad} ${f.width + 2 * pad} ${f.height + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="The flat pattern"
    >
      <path d={d.join('')} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function PatternTool({
  ready,
  busy,
  onMake,
  onExport,
  onClear,
}: {
  ready: boolean
  busy: boolean
  onMake: () => void
  onExport: (format: 'dxf' | 'svg') => void
  onClear: () => void
}) {
  const p = usePattern(
    useShallow((s) => ({
      mode: s.mode,
      scope: s.scope,
      element: s.element,
      offset: s.offset,
      running: s.running,
      message: s.message,
      made: s.made,
      setMode: s.setMode,
      setScope: s.setScope,
      setElement: s.setElement,
      setOffset: s.setOffset,
    })),
  )
  const elements = useStore((s) => s.elements)
  const marked = useMark((s) => s.count)
  const len = useLength()
  const options = unrollable(elements)
  const chosen = options.find((e) => e.id === p.element) ?? (options.length === 1 ? options[0] : undefined)
  const marks = patternMarks(p)
  const unroll = p.mode === 'unroll'
  const blocked = !ready || busy || (unroll && !chosen) || (marks && marked === 0)
  const made = p.made

  return (
    <div className="group" data-test="pattern-tool">
      <div className="sec-head">
        Unroll / flatten
        <InfoDot title="Flat patterns">
          <p>
            A flat pattern of a region of the scan, to cut it from sheet: drawn here and saved as a
            DXF or an SVG, true to size. It is made beside the scan, not an edit of it.
          </p>
          <p>
            <b>Unroll</b> lays a cylinder or a cone out by the element fitted to it in 3D Measure:
            the arc round the axis becomes the width and the height along it the height, so an
            outline and the holes in it come out the size they are on the part. A cone unrolls to
            its sector. Each point is taken at the fitted surface, so the scatter does not stretch
            it; <b>Offset</b> lays out a surface that far outside it (inside, negative) — half the
            sheet's thickness, for its neutral fibre. Without a marking it takes the scan lying on
            the element, facing off it.
          </p>
          <p>
            <b>Flatten</b> lays a marked sheet out with the least distortion — a bent sheet-metal
            part flattens to its blank — and says how far it had to stretch the surface: near
            nothing for a sheet bent without stretching, more for a dished or drawn one, which no
            flat blank makes exactly.
          </p>
        </InfoDot>
      </div>

      <div className="field">
        <span>Make</span>
        <div className="moderow" role="radiogroup" aria-label="How to lay it out">
          {(['unroll', 'flatten'] as PatternMode[]).map((mode) => (
            <button
              key={mode}
              role="radio"
              aria-checked={p.mode === mode}
              className={p.mode === mode ? 'on' : undefined}
              data-test={`pattern-mode-${mode}`}
              disabled={busy}
              onClick={() => p.setMode(mode)}
              title={mode === 'unroll' ? 'Lay a cylinder or a cone out by the element fitted to it' : 'Lay a marked sheet out flat with the least distortion'}
            >
              {mode === 'unroll' ? 'Unroll' : 'Flatten'}
            </button>
          ))}
        </div>
      </div>

      {unroll && (
        <>
          <label className="field">
            <span>By</span>
            <select
              data-test="pattern-element"
              disabled={busy || options.length === 0}
              value={chosen ? String(chosen.id) : ''}
              onChange={(e) => p.setElement(e.target.value ? Number(e.target.value) : null)}
            >
              {!chosen && <option value="">{options.length === 0 ? 'No cylinder or cone' : 'Pick one'}</option>}
              {options.map((el) => (
                <option key={el.id} value={String(el.id)}>
                  {el.name}
                </option>
              ))}
            </select>
          </label>
          {options.length === 0 && <p className="hint">Fit a cylinder or a cone on the part in 3D Measure first.</p>}
          <div className="field">
            <span>Region</span>
            <div className="moderow" role="radiogroup" aria-label="What to unroll">
              {(['surface', 'marked'] as PatternScope[]).map((scope) => (
                <button
                  key={scope}
                  role="radio"
                  aria-checked={p.scope === scope}
                  className={p.scope === scope ? 'on' : undefined}
                  data-test={`pattern-scope-${scope}`}
                  disabled={busy}
                  onClick={() => p.setScope(scope)}
                  title={scope === 'surface' ? 'The scan lying on the element, facing off it' : 'Only a region you mark on the part'}
                >
                  {scope === 'surface' ? 'On the element' : 'Marked region'}
                </button>
              ))}
            </div>
          </div>
          <NumberField
            label="Offset"
            testId="pattern-offset"
            value={p.offset}
            step={0.1}
            min={-1000}
            kind="length"
            disabled={busy}
            onCommit={p.setOffset}
            hint="Lay out the surface this far outside the fitted one, or inside it when negative — half the sheet's thickness, to the inside of a part scanned from outside, for the neutral fibre a blank is cut to."
          />
        </>
      )}
      {marks && <MarkTools escapeNote="The marking stays until it is cleared." onClear={onClear} />}

      <button className="primary block" data-test="pattern-run" disabled={blocked} onClick={onMake}>
        {p.running ? (
          <>
            <span className="spinner" />
            {unroll ? 'Unrolling…' : 'Flattening…'}
          </>
        ) : unroll ? (
          `Unroll ${chosen ? chosen.name : ''}${marks ? ', the marked region' : ''}`
        ) : (
          'Flatten the marked region'
        )}
      </button>
      {marks && marked === 0 && <p className="hint">Mark the surface to lay out — pick Window, Brush or Lasso above.</p>}
      {p.message && (
        <p className="alarmtext" data-test="pattern-message">
          {p.message}
        </p>
      )}

      {made && (
        <div className="group" data-test="pattern-result">
          <PatternPreview made={made} />
          <div className="kv" data-test="pattern-size">
            <span className="name">{made.mode === 'unroll' ? `${made.source}, unrolled` : 'Flattened'}</span>
            <b>
              {len.fmt(made.report.figures.width, 2)} × {len.fmt(made.report.figures.height, 2)}
            </b>
          </div>
          <div className="kv">
            <span className="name">Area</span>
            <b>{len.area(made.report.figures.area, 1)}</b>
          </div>
          <div className="kv">
            <span className="name">Holes</span>
            <b>{count(made.report.figures.holes.length)}</b>
          </div>
          {made.report.figures.holes.slice(0, 8).map((h, i) => (
            <div key={i} className="kv">
              <span className="name dim">
                at {len.fmt(h.center[0], 1, { bare: true })}, {len.fmt(h.center[1], 1, { bare: true })}
              </span>
              <b>
                {len.fmt(h.width, 2, { bare: true })} × {len.fmt(h.height, 2)}
              </b>
            </div>
          ))}
          {made.mode === 'unroll' && made.report.sector && (
            <div className="kv">
              <span className="name">Sector</span>
              <b>
                {made.report.sector.angle.toFixed(2)}° · {len.fmt(made.report.sector.innerRadius, 2, { bare: true })}–{len.fmt(made.report.sector.outerRadius, 2)}
              </b>
            </div>
          )}
          {made.mode === 'unroll' && made.report.radius !== undefined && (
            <div className="kv">
              <span className="name">At radius</span>
              <b>{len.fmt(made.report.radius, 3)}</b>
            </div>
          )}
          {made.mode === 'unroll' && (
            <div className="kv">
              <span className="name" title={`How far the region lies off the fitted ${made.report.surface}: RMS, and the most`}>
                Off surface
              </span>
              <b>
                {len.fmt(made.report.residual.rms, 3, { bare: true })} <span className="dim">· {len.fmt(made.report.residual.max, 3)} most</span>
              </b>
            </div>
          )}
          <div className="kv" data-test="pattern-stretch">
            <span className="name">
              Stretch, mean
              <InfoDot title="How true the pattern is">
                <p>
                  How far laying the surface out stretched or shrank it, triangle by triangle: a
                  length on the pattern against the same length on the scan, in the direction it
                  changed most — the most anywhere, and on average over the surface. The area
                  changed {pct(made.report.distortion.area.mean)} on average,{' '}
                  {pct(made.report.distortion.area.max)} at most; the whole pattern's area is{' '}
                  {pct(Math.abs(made.report.distortion.totalArea))} {made.report.distortion.totalArea >= 0 ? 'more' : 'less'} than the scan's.
                </p>
              </InfoDot>
            </span>
            <b>{pct(made.report.distortion.length.mean)}</b>
          </div>
          <div className="kv">
            <span className="name">Stretch, most</span>
            <b>{pct(made.report.distortion.length.max)}</b>
          </div>
          {made.report.distortion.flipped > 0 && (
            <p className="warnnote">{count(made.report.distortion.flipped)} triangles came out turned over — the pattern overlaps itself there.</p>
          )}
          {made.report.leftOut.triangles > 0 && (
            <p className="hint">
              {count(made.report.leftOut.triangles)} triangles in {count(made.report.leftOut.pieces)} piece{made.report.leftOut.pieces === 1 ? '' : 's'} apart from
              the rest were left out.
            </p>
          )}
          <div className="toolrow">
            <button data-test="pattern-export-dxf" disabled={busy} onClick={() => onExport('dxf')} title="Save the pattern as a DXF, in the display units, for CAD or a laser">
              Export DXF
            </button>
            <button data-test="pattern-export-svg" disabled={busy} onClick={() => onExport('svg')} title="Save the pattern as an SVG at true scale, for a vector editor or a cutter">
              Export SVG
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
