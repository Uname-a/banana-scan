// SPDX-License-Identifier: AGPL-3.0-only
// Merge scans: another scan of the part — its underside, scanned on its own —
// opened beside the mesh, placed where the two share surface
// (src/core/deviation/overlap), shown there in orange, and merged into the
// copy as one edit (core/merge).

import { useRef } from 'react'
import { InfoDot } from '../../../../src/ui/InfoDot'
import { useLength } from '../../../../src/app/useUnits'
import { SCAN_ACCEPT } from '../../../../src/core/formats'
import { useMeshTools } from '../../state/meshStore'
import { count } from '../meshFormat'

export function MergeTool({
  ready,
  busy,
  onOpen,
  onPlace,
  onMerge,
  onClose,
}: {
  ready: boolean
  busy: boolean
  onOpen: (file: File) => void
  onPlace: () => void
  onMerge: () => void
  onClose: () => void
}) {
  const other = useMeshTools((s) => s.other)
  const status = useMeshTools((s) => s.otherStatus)
  const message = useMeshTools((s) => s.otherMessage)
  const drop = useMeshTools((s) => s.mergeDrop)
  const setDrop = useMeshTools((s) => s.setMergeDrop)
  const editing = useMeshTools((s) => s.editing)
  const len = useLength()
  const input = useRef<HTMLInputElement>(null)
  const placing = status === 'running'
  const placed = other?.placed ?? null
  const how = placed?.source === 'frame' ? 'where its file put it' : placed?.source === 'points' ? 'from picked points' : 'by the shape the two share'

  return (
    <div className="group" data-test="merge-tool">
      <div className="sec-head">
        Merge scans
        <InfoDot title="Merging scans">
          <p>
            A part scanned in two goes — its top, then turned over for its underside — comes as two
            files, each with surface the other lacks. <b>Merge scans</b> brings the second onto this
            one and adds it, so the part is whole.
          </p>
          <p>
            It is placed where the two share surface, and only there: a band round the middle that
            both scans saw is enough. Its file's own position is tried first, for two scans exported
            in one frame; then the shape the two have in common is searched for. The scan shows in
            orange where it lands, with how much of it lies on this one.
          </p>
          <p>
            <b>Merge</b> adds it to the edited copy. With <b>Leave out what doubles the scan</b>, its
            triangles that only scan again what is here are left out, so the shared band is not
            there twice; the two then meet along a seam, which <b>Fill holes</b> closes, or a{' '}
            <b>Wrap</b> makes one skin of. <b>Ctrl+Z</b> takes the merge back.
          </p>
          <p>
            Where it cannot tell where the scan goes — two scans that share too little, or a part
            that sits two ways — it says so. An agent can then place it from three points picked on
            each (mesh.merge_place).
          </p>
        </InfoDot>
      </div>

      <input
        ref={input}
        type="file"
        accept={SCAN_ACCEPT}
        hidden
        data-test="merge-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onOpen(f)
        }}
      />

      {other ? (
        <div className="kv" data-test="merge-other">
          <span className="name" title={other.name}>
            {other.name}
          </span>
          <b>{count(other.triangles)} △</b>
        </div>
      ) : (
        <p className="hint">Open the other scan of this part — the side this one does not show.</p>
      )}

      {placing ? (
        <p className="hint" data-test="merge-placing">
          <span className="spinner" /> {message ?? 'Placing it…'}
        </p>
      ) : placed ? (
        <div data-test="merge-placed">
          <div className="kv">
            <span className="name">Lies on this scan</span>
            <b>{Math.round(placed.overlap * 100)} %</b>
          </div>
          <div className="kv">
            <span className="name">RMS there</span>
            <b>{len.fmt(placed.rms, 3)}</b>
          </div>
          <p className="hint">
            Placed {how}.{' '}
            {placed.ambiguous ? 'Another placement fits nearly as well — check it in orange before merging.' : 'Check it in orange before merging.'}
          </p>
        </div>
      ) : message ? (
        <p className="warnnote" data-test="merge-failed">
          {message}
        </p>
      ) : null}

      {other && (
        <label className="checkrow">
          <input type="checkbox" checked={drop} disabled={busy} onChange={(e) => setDrop(e.target.checked)} data-test="merge-drop" />
          <span>Leave out what doubles the scan</span>
        </label>
      )}

      <div className="toolrow">
        <button className={other ? '' : 'primary'} data-test="merge-open" disabled={!ready || busy || placing} onClick={() => input.current?.click()} title="Open the other scan of this part">
          {other ? 'Open another…' : 'Open the other scan…'}
        </button>
        {other && (
          <button data-test="merge-place" disabled={!ready || busy || placing} onClick={onPlace} title="Find again where it lies on this scan">
            Place again
          </button>
        )}
        {other && (
          <button className="primary" data-test="merge-run" disabled={!ready || busy || placing || !placed} onClick={onMerge} title="Add it to the edited copy, as placed">
            {editing ? (
              <>
                <span className="spinner" />
                Merging…
              </>
            ) : (
              'Merge'
            )}
          </button>
        )}
        {other && (
          <button className="ghost" data-test="merge-close" disabled={busy || placing} onClick={onClose} title="Close the other scan without merging it">
            Close
          </button>
        )}
      </div>
    </div>
  )
}
