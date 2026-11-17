// SPDX-License-Identifier: AGPL-3.0-only
// Another scan of the same part made one mesh with this one: the underside,
// scanned on its own, added to the top. The other scan is placed first
// (src/core/deviation/overlap.ts); here its triangles are added after the
// scan's, carried into the scan's frame. Where it only scans again what the
// scan has already — the band the two share — its triangles can be left out
// (every corner within `dropWithin` of the scan), so the surface is not there
// twice; what is left meets the scan along a seam that Fill holes or a Wrap
// closes. The scan's own vertices keep their order and come first, as every
// edit's do (edit.ts).

import { emptyHit, type NominalSurface } from '../../../src/core/deviation/surface'
import { rigidApply, type Rigid } from '../../../src/core/deviation/rigid'
import { compactEdit, type EditedMesh } from './edit'

export interface MergeReport {
  /** The other scan's triangles added. */
  added: number
  /** Its triangles left out because they lay on the scan already. */
  doubled: number
  /** Vertices the mesh has now, and had before. */
  vertices: number
  verticesBefore: number
}

export interface OtherScan {
  positions: Float32Array
  indices: Uint32Array
}

export function mergeScan(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  other: OtherScan,
  transform: Rigid,
  dropWithin: number | null,
  surface: (() => NominalSurface) | null,
): EditedMesh & { report: MergeReport } {
  const otherCount = other.positions.length / 3
  const all = new Float32Array((vertexCount + otherCount) * 3)
  all.set(positions.subarray(0, vertexCount * 3))
  const p = new Float64Array(3)
  for (let v = 0; v < otherCount; v++) {
    rigidApply(transform, other.positions[v * 3], other.positions[v * 3 + 1], other.positions[v * 3 + 2], p)
    const o = (vertexCount + v) * 3
    all[o] = p[0]
    all[o + 1] = p[1]
    all[o + 2] = p[2]
  }

  // Which of the other scan's vertices lie on the scan already.
  let onScan: Uint8Array | null = null
  if (dropWithin !== null && dropWithin > 0 && surface) {
    const s = surface()
    const hit = emptyHit()
    onScan = new Uint8Array(otherCount)
    for (let v = 0; v < otherCount; v++) {
      const o = (vertexCount + v) * 3
      if (s.closest(all[o], all[o + 1], all[o + 2], hit, dropWithin)) onScan[v] = 1
    }
  }

  const kept: number[] = []
  let doubled = 0
  for (let t = 0; t < other.indices.length; t += 3) {
    const a = other.indices[t], b = other.indices[t + 1], c = other.indices[t + 2]
    if (onScan && onScan[a] && onScan[b] && onScan[c]) {
      doubled++
      continue
    }
    kept.push(a + vertexCount, b + vertexCount, c + vertexCount)
  }
  const merged = new Uint32Array(indices.length + kept.length)
  merged.set(indices)
  merged.set(kept, indices.length)
  const edit = compactEdit(all, merged, vertexCount)
  return {
    ...edit,
    report: { added: kept.length / 3, doubled, vertices: edit.positions.length / 3, verticesBefore: vertexCount },
  }
}
