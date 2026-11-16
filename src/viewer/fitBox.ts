// SPDX-License-Identifier: AGPL-3.0-only
// What a fit frames: everything being shown — the scan where it is held,
// the reference, the datum stage while it is out, and what the layers draw,
// the bodies a part is modelled as among them. A body that runs past the
// scan's end (a part made longer than it was scanned) is framed whole, not
// cut off at the scan's edge.

import * as THREE from 'three'

export interface ShownBoxes {
  /** The scan as held, when it is shown. */
  scan?: THREE.Box3 | null
  /** The reference, when it is shown. */
  reference?: THREE.Box3 | null
  /** The datum stage's half extent, while it is out. */
  stageExtent?: number | null
  /** What each layer draws that is shown, already in world coordinates. */
  layers?: readonly (THREE.Box3 | null | undefined)[]
  /** The scan as held, hidden or not: framed when nothing else is shown. */
  scanAnyway?: THREE.Box3 | null
}

/** The box a fit frames, or null when there is nothing to frame. */
export function fitBoxOf(shown: ShownBoxes): THREE.Box3 | null {
  const box = new THREE.Box3()
  if (shown.scan) box.union(shown.scan)
  if (shown.reference) box.union(shown.reference)
  if (shown.stageExtent && shown.stageExtent > 0) {
    const e = shown.stageExtent
    box.union(new THREE.Box3(new THREE.Vector3(-e, -e, -e), new THREE.Vector3(e, e, e)))
  }
  for (const b of shown.layers ?? []) if (b && !b.isEmpty()) box.union(b)
  // Nothing visible to fit — a hidden scan with no reference beside it: the
  // part is still loaded, so fit that rather than doing nothing at all.
  if (box.isEmpty() && shown.scanAnyway) box.union(shown.scanAnyway)
  return box.isEmpty() ? null : box
}
