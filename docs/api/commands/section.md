<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `section.*` commands

3 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`section.cut`](#section_cut) — Cut a section
- [`section.get`](#section_get) — Read a section’s polylines
- [`section.render`](#section_render) — Picture a section

<a id="section_cut"></a>
### `section.cut`

**Cut a section** · change — one undo step  
MCP tool `section_cut` — adds `wait`, `timings`

Cut the scan with a plane and keep the cut as a section, put on the 2D sheet. across: an element with a direction (plane, cylinder, cone, line, circle) by id or name; "XY", "YZ" or "XZ" through the part’s centre; or { axis, angleDeg }, a plane through an axis turned angleDeg about it — a half section of a turned part. offset slides the plane along its normal, mm (a coordinate plane: the coordinate itself). kind "shadow" keeps the scan’s shadow instead: the whole part projected onto the plane, its outer boundary as loops read as lines and arcs (tolerance, play, smoothDeg), stood up as a block for export.step (extrude). Trap: a shadow takes no offset. Returns the section: its plane and chain count — a shadow also its loops, area and band. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `across` | integer \| string \| { axis, angleDeg } | ✓ | An element with a direction, a coordinate plane, or { axis, angleDeg }. |
| `across.axis` | integer \| string | ✓ | A cylinder, cone, line or circle, or a coordinate axis "X", "Y", "Z". (form 3: { axis, angleDeg }) |
| `across.angleDeg` | number | ✓ | Degrees about the axis. (form 3: { axis, angleDeg }) |
| `offset` | number |  | Along the normal, mm. A cut’s only. |
| `name` | string |  | A name; otherwise numbered — "Section 2". |
| `kind` | "cut" \| "shadow" |  | cut (the default), or shadow: the whole scan projected onto the plane. |
| `play` | number |  | Shadow: clearance outside the part, mm; 1 by default, negative a press fit. |
| `tolerance` | number |  | Shadow: lines and arcs read to this, mm; 0.1 by default. (*> 0*) |
| `smoothDeg` | number |  | Shadow: corners turning less than this are rounded, degrees; 30 by default, 0 keeps all sharp. (*≥ 0*, *≤ 180*) |
| `extrude` | boolean |  | Shadow: stood up as a block through the part, for export.step; true by default. |

<a id="section_get"></a>
### `section.get`

**Read a section’s polylines** · read-only  
MCP tool `section_get`

A section’s cut as polylines: each chain’s points in order — [u, v] mm on the sheet, what flat.fit and a sketch on the section take, or with space "world" or "both" [x, y, z] in the current frame — with the plane (origin, normal, basisU, basisV) and per chain closed, length, points, bounds. Trap: at most limit points over all chains (4000 by default, 50000 at most); past it every k-th point is kept and step says k. chains picks chains by index; skin "outer" or "inner" reads one skin of a thin wall alone, facing the points whose way out lies within withinDeg of dir, each chain then coming back as runs. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `section` | integer \| string | ✓ | The section, by id or name. |
| `chains` | integer[] |  | Which chains; every one by default. (*at least 1 item*) |
| `space` | "sheet" \| "world" \| "both" |  | sheet (the default): [u, v]; world: [x, y, z]; both. |
| `limit` | integer |  | Points at most over every chain; 4000 by default, 50000 at most. (*≥ 2*, *≤ 50000*) |
| `skin` | "outer" \| "inner" |  | One skin of a thin wall alone. |
| `facing` | object |  | Only the points whose way out of the material lies within withinDeg of dir. |
| `facing.dir` | number[2] | ✓ | [u, v] on the sheet. |
| `facing.withinDeg` | number |  | Degrees; 60 by default. (*> 0*, *≤ 180*) |

<a id="section_render"></a>
### `section.render`

**Picture a section** · read-only · returns a picture · returns a file  
MCP tool `section_render` — adds `path`, `inline`

A picture of a section as a PNG, for checking a slice against what was built on it: the scan’s cut as points on the sheet ([u, v] mm, +u right, +v up), a mm grid with values in the margins, a scale bar, and the workspaces’ layers over it (a model’s cut as outlines, a sketch’s pieces). Scan points within ten tolerances of an outline are read against it: on it (grey) or off it (red). Needs section, or plane to cut the scan for the picture alone ({ origin, normal }, "XY"/"YZ"/"XZ", an element, or { sketch }). Returns gap { points, read, over, outside, inside, max, rms, overBox }, layers, axes, sheet (origin, normal, basisU, basisV) and map (pixel (c, r) is [left + c·unitsPerPx, top − r·unitsPerPx]). Trap: a plane’s sheet has its zero at the world origin’s foot, a section’s at the part’s centre — read sheet. 800 px by default, up to 2048. Needs the browser. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `section` | integer \| string |  | The section, by id or name. |
| `plane` | { origin, normal } \| integer \| string \| { sketch } |  | A plane to cut the scan by for the picture alone, in place of a section. |
| `plane.origin` | number[3] | ✓ | A point on the plane, mm. (form 1: { origin, normal }) |
| `plane.normal` | number[3] | ✓ | Its normal. (form 1: { origin, normal }) |
| `plane.sketch` | integer \| string | ✓ | A sketch’s id or name. (form 4: { sketch }) |
| `offsets` | number[] |  | Several parallel cuts in one picture: mm along the normal — on a coordinate plane by name, from the world’s zero, so "XY" with [0, 5] cuts at Z 0 and Z 5. (*2–9 items*) |
| `up` | "x" \| "y" \| "z" |  | The world axis that runs up the picture; the sheet as it lies by default. |
| `frame` | object |  | Look at a square of the sheet: { at, size }, or { world: { min, max } } (or { min, max }). |
| `frame.at` | number[] |  | The middle: [u, v] mm on the sheet, or [x, y, z] mm in the world. (*2–3 items*) |
| `frame.size` | number |  | The side of the square looked at, mm. (*> 0*) |
| `frame.world` | object |  | A world box, in place of at and size. |
| `frame.world.min` | number[3] | ✓ | Lowest corner, [x, y, z] mm. |
| `frame.world.max` | number[3] | ✓ | Highest corner, [x, y, z] mm. |
| `frame.min` | number[3] |  | With max: the world box written as view.render’s frame takes one — the same as world: { min, max }. |
| `frame.max` | number[3] |  | With min. |
| `tolerance` | number |  | ± mm a scan point may lie off an outline and still be on it; the Deviation workspace’s by default. (*> 0*) |
| `layers` | string[] |  | The layers to draw, by key; every one by default, [] for the scan alone. |
| `width` | integer |  | Pixels across, 64 to 2048. (*≥ 64*, *≤ 2048*) |
| `height` | integer |  | Pixels down, 64 to 2048. (*≥ 64*, *≤ 2048*) |
