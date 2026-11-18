// SPDX-License-Identifier: AGPL-3.0-only
// A fit frames everything shown: a body modelled past the scan's end is
// framed whole, not cut off at the scan's edge.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { fitBoxOf } from '../src/viewer/fitBox'

const box = (min: number[], max: number[]) => new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max))

describe('fitBoxOf', () => {
  it('frames a body that runs past the scan, with the scan', () => {
    const scan = box([-48, -14, 0], [48, 14, 20])
    const body = box([-48, -14, 0], [58, 14, 20]) // the arm made 10 mm longer
    const fit = fitBoxOf({ scan, layers: [body] })
    expect(fit?.max.x).toBe(58)
    expect(fit?.min.x).toBe(-48)
  })

  it('frames the scan, the reference and the stage as before', () => {
    const fit = fitBoxOf({ scan: box([0, 0, 0], [1, 1, 1]), reference: box([-2, 0, 0], [1, 1, 1]), stageExtent: 3 })
    expect(fit?.min.toArray()).toEqual([-3, -3, -3])
    expect(fit?.max.toArray()).toEqual([3, 3, 3])
  })

  it('falls back on the hidden scan when nothing is shown, and is null with nothing at all', () => {
    expect(fitBoxOf({ layers: [null, new THREE.Box3()], scanAnyway: box([0, 0, 0], [2, 2, 2]) })?.max.x).toBe(2)
    expect(fitBoxOf({})).toBeNull()
  })
})
