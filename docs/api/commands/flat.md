<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `flat.*` commands

15 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`flat.calibrate`](#flat_calibrate) — Calibrate the image
- [`flat.curvature`](#flat_curvature) — Read how an edge bends
- [`flat.detect_edges`](#flat_detect_edges) — Detect the image’s edges
- [`flat.dimension_add`](#flat_dimension_add) — Add a 2D dimension
- [`flat.edges`](#flat_edges) — List the detected edges
- [`flat.edit`](#flat_edit) — Change a 2D element, dimension, note or count
- [`flat.fit`](#flat_fit) — Fit a 2D element
- [`flat.note_add`](#flat_note_add) — Write a note on the sheet
- [`flat.objects`](#flat_objects) — Find the parts on the image
- [`flat.open_image`](#flat_open_image) — Open a flatbed image
- [`flat.profile`](#flat_profile) — Profile an outline and count its peaks
- [`flat.remove`](#flat_remove) — Remove from the 2D sheet
- [`flat.render`](#flat_render) — Picture the sheet
- [`flat.report`](#flat_report) — Get the 2D report
- [`flat.set_alignment`](#flat_set_alignment) — Align the sheet

<a id="flat_calibrate"></a>
### `flat.calibrate`

**Calibrate the image** · change — one undo step  
MCP tool `flat_calibrate` — adds `wait`, `timings`

Set the image’s scale against a known length, as the Calibrate tool does: distance takes two places a known distance apart, diameter three or more on a circle of known diameter; mm is that length. Every measurement follows the new scale, and the edges are found again (their chain numbers change). Returns the calibration. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `mode` | "distance" \| "diameter" | ✓ | distance (two places) or diameter (three or more on a circle). |
| `points` | number[2][] | ✓ | The places, in the sheet’s units as they are now. (*at least 2 items*) |
| `mm` | number | ✓ | The true length, mm. (*> 0*) |

<a id="flat_curvature"></a>
### `flat.curvature`

**Read how an edge bends** · read-only  
MCP tool `flat_curvature`

The curvature along detected edges (chains, by number as flat.edges lists them) or along a fitted arc, circle or spline (element) — what the curvature comb draws — told as stretches in order: straight, arc (with the radius its middle reading gives, and the least and most read — how near to one radius it holds; on a section, whether it is convex, a round, or concave, a fillet’s hollow) or the transition between. from and to are the arc length along the chain, in the sheet’s units. A chain is read smoothed over window (the comb’s Smoothing, 2 by default), which leaves one window off each end of an open chain and turns a sudden change into a ramp about a window long, the change in its middle — so a fillet’s tangent point is the middle of the transition before it; a transition much longer than the window is a blend that is no arc. A fitted curve is read exactly. straightBelow is the curvature (1/unit) under which an edge is straight — by default four times the chain’s own scatter; tolerance how far as a share an arc’s readings may stray from its middle one (0.1). step adds the readings every step along it (2000 at most), curvature signed: positive turning left as the chain runs. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `chains` | integer[] |  | Chains to read, by number. (*at least 1 item*) |
| `element` | integer \| string |  | An arc, circle or spline on the sheet to read instead. |
| `window` | number |  | The smoothing window for chains, in the sheet’s units. (*≥ 0.2*, *≤ 20*) |
| `straightBelow` | number |  | Curvature under this, 1/unit, is straight. (*> 0*) |
| `tolerance` | number |  | How far an arc’s readings may stray from its middle one, as a share — 0.1. (*> 0*, *≤ 1*) |
| `step` | number |  | Add the readings this far apart. (*> 0*) |

<a id="flat_detect_edges"></a>
### `flat.detect_edges`

**Detect the image’s edges** · change — one undo step  
MCP tool `flat_detect_edges` — adds `wait`, `timings`

Find the edges in the image again at a sensitivity from 0 (only the strongest) to 1 (every faint one) — what the edge methods of flat.fit and the snapping of every place follow. The chains are numbered afresh. Needs the browser. Returns how many edge chains were found.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `sensitivity` | number |  | 0 to 1. (*≥ 0*, *≤ 1*) |

<a id="flat_dimension_add"></a>
### `flat.dimension_add`

**Add a 2D dimension** · change — one undo step  
MCP tool `flat_dimension_add` — adds `wait`, `timings`

Measure between two 2D elements: flat-dist-point-point (point, point), flat-dist-point-line (point, line), flat-dist-line-line (line, line), flat-angle-line-line (line, line). Points, circles and arcs count as their point (centre), lines as lines. Without type, the first that takes the two elements in the order given. Returns the dimensions on the sheet. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `refs` | (integer \| string)[2] | ✓ | The two elements. |
| `type` | "flat-dist-point-point" \| "flat-dist-point-line" \| "flat-dist-line-line" \| "flat-angle-line-line" |  | The dimension type. |
| `name` | string |  | A name for it. |

<a id="flat_edges"></a>
### `flat.edges`

**List the detected edges** · read-only  
MCP tool `flat_edges`

The edge chains detected on the sheet, by number — what flat.fit takes as chains. Each with its length, whether it closes, its point count and box, in the sheet’s units; the longest first, or with near the nearest first (each with its nearest point and distance; within reach only, when given). box keeps the chains that enter it, minLength the long ones. tolerance adds each chain’s polyline thinned to that (5000 points at most over all). limit chains at most, 50 by default. Trap: the numbers change when the edges are found again. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `box` | object |  | Only chains with a point in this box. |
| `box.min` | number[2] | ✓ | The lowest corner. |
| `box.max` | number[2] | ✓ | The highest corner. |
| `near` | number[2] |  | Nearest this place first. |
| `reach` | number |  | With near: only chains this close. (*> 0*) |
| `minLength` | number |  | Only chains at least this long. (*≥ 0*) |
| `tolerance` | number |  | Add each chain’s polyline, thinned to this. (*> 0*) |
| `limit` | integer |  | Chains at most — 50 by default. (*≥ 1*, *≤ 2000*) |

<a id="flat_edit"></a>
### `flat.edit`

**Change a 2D element, dimension, note or count** · change — one undo step  
MCP tool `flat_edit` — adds `wait`, `timings`

Change one thing on the 2D sheet, by id or name: an element, a dimension or a count takes a new name; a note new text or a new place (at, its lower-left corner); any of them visible: false to leave it out of the stage, the picture and the exports. Returns the 2D state. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `element` | integer \| string |  | A 2D element. |
| `dimension` | integer \| string |  | A 2D dimension. |
| `note` | integer |  | A note, by its id. (*≥ 1*) |
| `count` | integer \| string |  | A count (tally). |
| `name` | string |  | The new name. |
| `text` | string |  | A note’s new text. |
| `at` | number[2] |  | A note’s new lower-left corner. |
| `visible` | boolean |  | Shown, or left out. |

<a id="flat_fit"></a>
### `flat.fit`

**Fit a 2D element** · change — one undo step  
MCP tool `flat_fit` — adds `wait`, `timings`

Make a 2D element on the sheet as its tool does — kind point, line, circle, arc or spline, by a method of that kind: point: flat-point-pick (pick), flat-point-midpoint (construct), flat-point-intersect (construct), flat-point-center (construct); line: flat-line-pick (pick), flat-line-seed (seed), flat-line-edge (edge); circle: flat-circle-pick (pick), flat-circle-seed (seed), flat-circle-edge (edge), flat-circle-centers (construct); arc: flat-arc-pick (pick), flat-arc-edge (edge); spline: flat-spline-pick (pick). A pick method takes points, the places clicked (snapped to the nearest edge within reach unless snap: false; picks says where each landed); a seed method one place on an edge and grows along it; an edge method a place on an edge taken whole, or chains and box; a construct method refs, other 2D elements. Returns the element with its fit. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `kind` | "point" \| "line" \| "circle" \| "arc" \| "spline" | ✓ | What to make. |
| `method` | string |  | The method — see the description; the kind’s first pick method by default. |
| `points` | number[2][] |  | The places, in the sheet’s units. (*at least 1 item*) |
| `chains` | integer[] |  | Edge chains by number, taken whole (edge or seed methods). (*at least 1 item*) |
| `box` | object |  | Edge points inside this box, sheet units (edge or seed methods). |
| `box.min` | number[2] | ✓ | The lowest corner. |
| `box.max` | number[2] | ✓ | The highest corner. |
| `refs` | (integer \| string)[] |  | construct: the source elements. |
| `name` | string |  | A name for it. |
| `snap` | boolean |  | Picks snap to the nearest edge within reach; true by default. |
| `reach` | number |  | How far a place reaches for an edge, sheet units; ten image pixels by default. (*> 0*) |

<a id="flat_note_add"></a>
### `flat.note_add`

**Write a note on the sheet** · change — one undo step  
MCP tool `flat_note_add` — adds `wait`, `timings`

Write a text note on the 2D sheet, as the Text tool does — one line, a line break written as " / "; at is its lower-left corner, sheet units. It is drawn on the stage and in flat.render, written into the SVG and DXF exports and listed in the report. Returns the note with its id. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `text` | string | ✓ | What it says. |
| `at` | number[2] | ✓ | Its lower-left corner. |

<a id="flat_objects"></a>
### `flat.objects`

**Find the parts on the image** · read-only  
MCP tool `flat_objects`

The separate parts on the flatbed image, parted from the background by a grey level (Otsu’s unless threshold is given) and numbered in reading order — what flat.profile takes by number. Returns each with area, holes, box, centroid, equivalentDiameter, feret (largest and smallest caliper widths with their directions), axisAngle, chains (the edge chains along its outline) and, with outline, its polygon. Trap: minArea drops smaller ones, 1 mm² by default. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `threshold` | integer |  | Grey level, 0 to 255. (*≥ 0*, *≤ 255*) |
| `dark` | boolean |  | The parts are darker than the background. |
| `minArea` | number |  | The smallest part, in the sheet’s units squared. (*≥ 0*) |
| `outline` | number |  | Add each outline, thinned to this, in the sheet’s units. (*> 0*) |
| `limit` | integer |  | Parts at most — 100 by default. (*≥ 1*, *≤ 1000*) |

<a id="flat_open_image"></a>
### `flat.open_image`

**Open a flatbed image** · change — one undo step  
MCP tool `flat_open_image` — takes `path` in place of `bytes` — adds `wait`, `timings`

Open a flatbed scan of a part — PNG or JPEG, at the highest optical resolution — on the 2D sheet, in place of the image there was. The scale it declares about itself is taken until it is calibrated. Needs the browser. Returns the 2D state. Not undoable: a new image starts a new history.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `bytes` | bytes | ✓ | The file’s contents. |
| `name` | string | ✓ | The file's name with its extension — "part.png". |

<a id="flat_profile"></a>
### `flat.profile`

**Profile an outline and count its peaks** · change — one undo step  
MCP tool `flat_profile` — adds `wait`, `timings`

An outline read against a centre (radial, the default: a part seen from above) or along an axis (axial: a part lying on its side, each side apart), and its peaks counted — the teeth of a knurl or a gear. The outline is an object of the last flat.objects by number, or edge chains by number; about is the element it is read about, else the outline’s own centre or long axis. Returns per side the count, pitch, envelope (max, min, mean peak, mean valley; radial also as diameters) and every peak’s position; points adds the sampled profile. Trap: a peak must stand prominence above the higher valley either side (0.3 of the profile’s spread by default). mark: true puts a count on the sheet — one undo step; otherwise nothing changes.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `object` | integer |  | An object of the last flat.objects, by number. (*≥ 1*) |
| `chains` | integer[] |  | Edge chains by number, as one outline. (*at least 1 item*) |
| `about` | integer \| string |  | A circle, arc or point (radial), or a line (axial). |
| `axis` | "radial" \| "axial" |  | Without about: radial about the outline’s centre (the default), or axial along its long axis. |
| `samples` | integer |  | Bins round the turn or along the axis; from the point count by default. (*≥ 16*, *≤ 20000*) |
| `prominence` | number |  | How far a peak must stand out, sheet units. (*> 0*) |
| `mark` | boolean |  | Put a count on every peak. |
| `points` | boolean |  | Add the sampled profile. |

<a id="flat_remove"></a>
### `flat.remove`

**Remove from the 2D sheet** · change — one undo step  
MCP tool `flat_remove` — adds `wait`, `timings`

Remove elements, dimensions, notes and counts from the 2D sheet, each by id or name (a note by id) — all of them or none. An element built on a removed one stays and says it has lost its source, a dimension on one turns invalid; the answer names them. Returns what is left. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `elements` | (integer \| string)[] |  |  |
| `dimensions` | (integer \| string)[] |  | Dimensions, by id or name. |
| `notes` | integer[] |  | Notes, by id. |
| `counts` | (integer \| string)[] |  | Counts, by id or name. |

<a id="flat_render"></a>
### `flat.render`

**Picture the sheet** · read-only · returns a picture · returns a file  
MCP tool `flat_render` — adds `path`, `inline`

A picture of the 2D sheet as a PNG, as the sheet lies in its own units — +X right, +Y up, whatever the alignment or turns — with a grid and its values along the top and left edges. map says where it lies: picture pixel (column c, row r from the top) is the sheet place [left + c·unitsPerPx, top − r·unitsPerPx]. frame zooms in on a box. show puts layers in or out: image, edges (the detected chains), chains (their numbers), elements (with counts and the alignment), dimensions, notes, labels, grid. 800 px on the long side by default, up to 2048. Needs the browser.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `frame` | { min, max } \| { at, size } |  | What to picture, in the sheet’s units — the whole sheet by default. |
| `frame.min` | number[2] | ✓ | The lowest corner. (form 1: { min, max }) |
| `frame.max` | number[2] | ✓ | The highest corner. (form 1: { min, max }) |
| `frame.at` | number[2] | ✓ | Its centre. (form 2: { at, size }) |
| `frame.size` | number \| number[2] | ✓ | Its side, or [width, height]. (form 2: { at, size }) |
| `width` | integer |  | Pixels across, 64 to 2048. (*≥ 64*, *≤ 2048*) |
| `height` | integer |  | Pixels down, 64 to 2048. (*≥ 64*, *≤ 2048*) |
| `show` | object |  | Layers in (true) or out (false). |
| `show.image` | boolean |  |  |
| `show.edges` | boolean |  |  |
| `show.chains` | boolean |  |  |
| `show.elements` | boolean |  |  |
| `show.dimensions` | boolean |  |  |
| `show.notes` | boolean |  |  |
| `show.labels` | boolean |  |  |
| `show.grid` | boolean |  |  |

<a id="flat_report"></a>
### `flat.report`

**Get the 2D report** · read-only  
MCP tool `flat_report`

The 2D Measure report as its Copy button gives it: the image or section, the scale it rests on, the alignment, every element, dimension, count and note.

*No input.*

<a id="flat_set_alignment"></a>
### `flat.set_alignment`

**Align the sheet** · change — one undo step  
MCP tool `flat_set_alignment` — adds `wait`, `timings`

Put the part’s zero point at origin and its X axis through xAxis, as the Align tool’s two clicks do: the report, the panel and the exports then read in that frame. Places given to the commands stay the sheet’s own. clear: true takes the alignment off. Returns the 2D state. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `origin` | number[2] |  | The zero point, in the sheet’s units. |
| `xAxis` | number[2] |  | A place on the +X axis. |
| `clear` | boolean |  | Take the alignment off instead. |
