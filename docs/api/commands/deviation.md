<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `deviation.*` commands

8 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`deviation.align`](#deviation_align) — Best-fit the scan onto the reference
- [`deviation.export`](#deviation_export) — Export the deviation as data
- [`deviation.hotspots`](#deviation_hotspots) — Where the deviation lies over tolerance
- [`deviation.measure`](#deviation_measure) — Measure the deviation map
- [`deviation.open_reference`](#deviation_open_reference) — Open the reference part
- [`deviation.set_target`](#deviation_set_target) — Measure against an element
- [`deviation.settings`](#deviation_settings) — Set how the deviation is read
- [`deviation.volume`](#deviation_volume) — Volume error

<a id="deviation_align"></a>
### `deviation.align`

**Best-fit the scan onto the reference** · change — one undo step  
MCP tool `deviation_align` — adds `wait`, `timings`

Rigid best fit (no scale) of the scan onto the reference part, then the deviation map under it. mode auto (the default) finds the pose on its own; points starts from three or more pairs of corresponding points (scan and reference, mm) then refines; local refines the fit in hand on a marked surface only (vertices), within searchDistance mm. Returns the alignment (RMS, points matched, transform) and the map’s statistics. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `mode` | "auto" \| "points" \| "local" |  | auto (the default), points or local. |
| `pairs` | object[] |  | points: the corresponding pairs. (*at least 3 items*) |
| `pairs[].scan` | number[3] | ✓ | On the scan, mm. |
| `pairs[].reference` | number[3] | ✓ | The same point on the reference, mm. |
| `vertices` | integer[] |  | local: the surface to refine on, scan vertex numbers. (*at least 3 items*) |
| `searchDistance` | number |  | local: how far a point may lie from the reference to count, mm. (*> 0*) |

<a id="deviation_export"></a>
### `deviation.export`

**Export the deviation as data** · read-only · returns a file  
MCP tool `deviation_export` — adds `path`

The deviation map as a file of readings, for working on it elsewhere: side "scan" (the default) a reading per scan vertex with its signed distance from the reference (or the element measured against), side "reference" a reading per sample on the reference; format ply (the default, binary), npy (N × 4 float32 x, y, z, d) or csv. Returns the file with readings, measured, withinTolerance, withinTolerancePct, tolerance and searchDistance. Trap: the distance is NaN where there is no reading, and a reading past the search distance is kept as it is — |d| ≤ searchDistance says it counts. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `side` | "scan" \| "reference" |  | The readings: per scan vertex (the default), or per sample on the reference. |
| `format` | "ply" \| "npy" \| "csv" |  | ply (the default), npy or csv. |

<a id="deviation_hotspots"></a>
### `deviation.hotspots`

**Where the deviation lies over tolerance** · read-only  
MCP tool `deviation_hotspots`

The deviation map read as patches: the vertices past the tolerance gathered into connected regions, the largest and farthest first — where the part is off, how large each place is and by how much. Needs a map (deviation.align or deviation.set_target). Returns each patch’s centroid, box, area, count, mean, extreme, depth, volume, kind ("feature": material missing or misplaced, to model or name; "texture": roughness), side, the extreme’s point and vertex, a few vertices, and onReference; features, found, over and unmeasured; on: "reference" reads the map on the reference, adding noScan. Trap: read far every time — the vertices past the search distance, which the map draws bare: far.inside is scan deep inside the reference (a hole, pocket or slot the model lacks), far.outside scan standing off it. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `tolerance` | number |  | ± mm; the map’s tolerance by default. (*> 0*) |
| `patches` | integer |  | How many patches to name; 8 by default, 50 at most. (*≥ 1*, *≤ 50*) |
| `grain` | number |  | mm two vertices over tolerance may lie apart and be one patch; three point spacings by default. (*> 0*) |
| `on` | "scan" \| "reference" |  | The map read: on the scan (the default) or on the reference. |

<a id="deviation_measure"></a>
### `deviation.measure`

**Measure the deviation map** · change — one undo step  
MCP tool `deviation_measure` — adds `wait`, `timings`

Measure the deviation map again under the alignment in hand — after a change of facing limit or search distance, say. deviation.align measures it already. Returns the map’s statistics (min, max, mean, RMS, sigma, share within the tolerance, points matched). One undo step.

*No input.*

<a id="deviation_open_reference"></a>
### `deviation.open_reference`

**Open the reference part** · change — one undo step  
MCP tool `deviation_open_reference` — takes `path` in place of `bytes` — adds `wait`, `timings`

Open the nominal part the scan is compared with — STEP from CAD, or STL, PLY, OBJ or 3MF — in place of the one there is; any alignment and map against the old one go, the elements measured on the scan stay. Returns the deviation state. Not undoable: a new reference starts a new history.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `bytes` | bytes | ✓ | The file’s contents. |
| `name` | string | ✓ | The file's name with its extension — "bracket.step". |
| `units` | "mm" \| "cm" \| "m" \| "in" |  | The file’s units: mm (the default), cm, m or in. Everything is measured in mm once read. |

<a id="deviation_set_target"></a>
### `deviation.set_target`

**Measure against an element** · change — one undo step  
MCP tool `deviation_set_target` — adds `wait`, `timings`

Map how far the scan strays from one of its own fitted elements — a plane, cylinder, cone, sphere or torus — instead of from a reference part; null goes back to the reference. side is the material side, read off the scan when the element is chosen (outward: the element’s outer side; inward: a bore or shell) — give it to override. facingDeg limits which surface counts to what faces the element within that many degrees, null for any. Needs the viewport. Returns the map’s statistics. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `element` | integer \| string \| null | ✓ | The element, or null. |
| `side` | "outward" \| "inward" |  | The material side; read off the scan by default. |
| `facingDeg` | number \| null |  | The facing limit, degrees, or null for any. |

<a id="deviation_settings"></a>
### `deviation.settings`

**Set how the deviation is read** · change — one undo step  
MCP tool `deviation_settings` — adds `wait`, `timings`

The deviation map’s reading: range (colour scale, ± mm), maxDistance (search distance, mm), bands, tolerance (± mm the statistics count within), facingDeg (a change measures the map again), colormap (the person’s own choice, kept outside the undo — read settings.colormap for the ramp before judging a picture), on (which surface a map against the reference is painted on; read both sides) and show (the map switch; false leaves the surface bare, the map still measured). Returns the deviation state. Trap: the map paints in the Deviation workspace only — workspace.set deviation brings it back, and view.render says which map it painted (map) or why none (mapWhy). One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `range` | number |  | Colour scale, ± mm. (*> 0*) |
| `maxDistance` | number |  | Search distance, mm. (*> 0*) |
| `bands` | integer \| null |  | Stepped colours, or null for smooth. |
| `tolerance` | number |  | Tolerance, ± mm. (*> 0*) |
| `facingDeg` | number \| null |  | Facing limit, degrees, or null. |
| `colormap` | "jet" \| "viridis" \| "magma" \| "plasma" \| "inferno" \| "cividis" \| "mako" \| "rocket" \| "turbo" |  | jet (blue inside, green on the surface, red outside) or a perceptual ramp. |
| `on` | "scan" \| "reference" |  | The surface the map is painted on; scan by default. |
| `show` | boolean |  | The map painted (true) or the surface left bare (false). |

<a id="deviation_volume"></a>
### `deviation.volume`

**Volume error** · read-only · long (runs as a job)  
MCP tool `deviation_volume` — adds `wait`

The scan and the reference part compared as solids, on a grid of small cells: each cell inside one and not the other is an error, touching cells a region. Read it before the surface patches — it tells how much material is wrong and where, which the nearest-point map cannot: excess is material the reference has and the part has not, missing the other way round, unsure where the scan does not say (never an error). Needs deviation.align. Returns totals (mm³ and % of the reference) and the regions largest first, each with kind, volume, maxDepth, thickness, shape (layer or lump), centroid, deepest, box, evidence and confidence. Trap: nothing thinner than smallestSeen (two cells) is seen — the surface map stays the tool for fine offsets. About 15 s on a 1.5M-triangle scan. Changes nothing kept.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `tolerance` | number |  | ± mm; the map’s tolerance by default. (*> 0*) |
| `cell` | number |  | The cell, mm; by default half the tolerance or a 250th of the reference’s longest side, the larger. (*> 0*) |
| `regions` | integer |  | How many regions to name; 8 by default, 50 at most. (*≥ 1*, *≤ 50*) |
| `within` | object |  | Only this box is looked at, in the reference’s frame. |
| `within.min` | number[3] | ✓ | Lowest corner, mm. |
| `within.max` | number[3] | ✓ | Highest corner, mm. |
| `kinds` | ("excess" \| "missing" \| "unsure")[] |  | Only regions of these kinds named; all by default. The totals are of all. |
