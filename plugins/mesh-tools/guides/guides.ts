// SPDX-License-Identifier: AGPL-3.0-only
// The workspace's guides, as guide.read serves them to an agent. Each file
// is loaded when first read, so the page carries none of it until an agent
// asks.

import { registerGuide } from '../../../src/plugins/api'

export function registerMeshGuides(): void {
  registerGuide({
    id: 'flat-patterns',
    title: 'Flat patterns: unrolling and flattening a scan',
    when: 'a flat pattern of a scanned surface as a DXF or SVG: a cylinder or cone unrolled by its fitted element, or a bent sheet flattened to its blank with the distortion read — which skin, the neutral fibre, judging the result, the files',
    with: ['measure'],
    text: () => import('./flat-patterns.md?raw').then((m) => m.default),
  })
}
