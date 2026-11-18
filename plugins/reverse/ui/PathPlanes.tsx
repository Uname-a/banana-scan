// SPDX-License-Identifier: AGPL-3.0-only
// Planes along a path, in the panel: a sketch's chain or a measured line,
// circle or axis, and planes square to it every so many millimetres or so
// many in all, made plane elements of 3D Measure in one step — for
// sections across a bent part and a sweep's profile. The panel's side of
// reverse.plane.along_path.

import { useState } from 'react'
import { historyAsync } from '../../../src/state/historyStore'
import { useStore } from '../../../src/state/store'
import { useLength } from '../../../src/app/useUnits'
import { errorMessage } from '../../../src/commands/types'
import type { SketchFeature } from '../core/features'
import { makePlaneElements, type PathIn, pathPlanesOf } from '../app/reWrapCommands'
import { useReverse } from '../state/reStore'

type Mode = 'spacing' | 'count'

export function PathPlanes({ onClose }: { onClose: () => void }) {
  const len = useLength()
  const features = useReverse((s) => s.features)
  const elements = useStore((s) => s.elements)
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch')
  const paths = elements.filter((e) => e.fit && (e.fit.kind === 'line' || e.fit.kind === 'circle' || e.fit.kind === 'cylinder' || e.fit.kind === 'cone'))
  const [source, setSource] = useState<string>(() => (sketches.length > 0 ? `sketch:${sketches[sketches.length - 1].id}` : paths.length > 0 ? `element:${paths[0].id}` : ''))
  const [mode, setMode] = useState<Mode>('count')
  const [spacing, setSpacing] = useState(() => len.fromDisplay(len.step(10)))
  const [count, setCount] = useState(5)
  const [name, setName] = useState('Station')
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const pathOf = (): PathIn | null => {
    const [kind, id] = source.split(':')
    if (!id) return null
    return kind === 'sketch' ? { sketch: Number(id) } : { element: Number(id) }
  }
  const make = async () => {
    const path = pathOf()
    if (!path) return
    setBusy(true)
    setSaid(null)
    try {
      let made: { id: number; name: string }[] = []
      let length = 0
      let what = ''
      await historyAsync('Planes along a path', async () => {
        const read = await pathPlanesOf(path, mode === 'count' ? { count } : { spacing, ends: true })
        made = makePlaneElements(read.planes, name.trim() || 'Station')
        what = read.what
        length = read.planes.length > 0 ? read.planes[read.planes.length - 1].s : 0
      })
      setSaid({ ok: true, text: `${made.length} plane${made.length === 1 ? '' : 's'} square to ${what}, the last ${len.fmt(length, 1)} along it: ${made.map((m) => m.name).join(', ')}.` })
    } catch (e) {
      setSaid({ ok: false, text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="group" data-test="path-planes">
      <div className="sec-head">Planes along a path</div>
      <label className="field">
        <span>Path</span>
        <select data-test="path-planes-source" value={source} onChange={(e) => setSource(e.target.value)}>
          {sketches.length + paths.length === 0 && <option value="">Draw a sketch or measure a line, circle or axis first</option>}
          {sketches.length > 0 && (
            <optgroup label="A sketch's chain">
              {sketches.map((s) => (
                <option key={s.id} value={`sketch:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          {paths.length > 0 && (
            <optgroup label="Measured">
              {paths.map((e) => (
                <option key={e.id} value={`element:${e.id}`}>
                  {e.name}
                  {e.fit && (e.fit.kind === 'cylinder' || e.fit.kind === 'cone') ? ' — axis' : ''}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="field">
        <span>Planes</span>
        <select data-test="path-planes-mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="count">So many, end to end</option>
          <option value="spacing">Every so far, from the start</option>
        </select>
      </label>
      {mode === 'count' ? (
        <label className="field">
          <span>Count</span>
          <input data-test="path-planes-count" type="number" min={1} max={200} step={1} value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))))} />
        </label>
      ) : (
        <label className="field">
          <span>Spacing ({len.word()})</span>
          <input data-test="path-planes-spacing" type="number" min={0} step="any" value={len.toDisplay(spacing)} onChange={(e) => setSpacing(Math.max(0, len.fromDisplay(Number(e.target.value) || 0)))} />
        </label>
      )}
      <label className="field">
        <span>Named</span>
        <input data-test="path-planes-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="kindrow">
        <button data-test="path-planes-make" disabled={busy || !pathOf() || (mode === 'spacing' && !(spacing > 0))} onClick={() => void make()}>
          Make planes
        </button>
        <button data-test="path-planes-close" onClick={onClose}>
          Close
        </button>
      </div>
      {said && <p className={said.ok ? 'hint' : 'hint error'}>{said.text}</p>}
      <p className="hint">Each plane stands square to the path, the planes' sheets carried round the bends the same way up — cut sections across them in 3D Measure, or sketch a sweep's profile on the first. A sketch's path is its one chain of lines and arcs.</p>
    </div>
  )
}
