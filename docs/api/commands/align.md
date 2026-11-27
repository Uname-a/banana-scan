<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `align.*` commands

4 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`align.auto`](#align_auto) — Auto-align the part
- [`align.clear`](#align_clear) — Reset the alignment
- [`align.datum`](#align_datum) — Align the part to datums
- [`align.symmetry`](#align_symmetry) — Align the part on its symmetry plane

<a id="align_auto"></a>
### `align.auto`

**Auto-align the part** · change — one undo step  
MCP tool `align_auto` — adds `wait`, `timings`

Read a coordinate system off the scan and apply it, as Auto-align then Confirm alignment do: the directions most faces are square to and the axis round walls run along, the part standing on its base, its long side along X. level: settled (the default) lays all the faces on the axes at once, by area; largest squares the largest flat face exactly and settles the rest about its normal. Returns what the pose was read from, the transform, how many elements moved, and square — how square it came out: largest (the largest flat face’s axis, area, tiltDeg) and per axis the faces square to it with their tilts; largestInside when that face looks into the part (the scan stands in front of it: a rib’s wall, not a mating face — level on the mating face with align.datum). Trap: a drafted wall reads as its draft, not as an alignment error. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `level` | "settled" \| "largest" |  | settled (the default): all faces at once, by area. largest: the largest flat face exactly, the rest settled about its normal. |
| `detail` | "brief" \| "full" |  | brief (the default): the transform and how many elements moved. full: every element where it now is. |

<a id="align_clear"></a>
### `align.clear`

**Reset the alignment** · change — one undo step  
MCP tool `align_clear` — adds `wait`, `timings`

Put the part back in the coordinates the scanner delivered it in, with everything measured on it. Returns how many elements moved with it. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `detail` | "brief" \| "full" |  | brief (the default): the transform and how many elements moved. full: every element where it now is. |

<a id="align_datum"></a>
### `align.datum`

**Align the part to datums** · change — one undo step  
MCP tool `align_datum` — adds `wait`, `timings`

A 3-2-1 alignment, as the panel’s alignment box sets it up: primary levels the part — a plane (or 3 points, or plane { origin, normal }: a level’s plane from scan.heightmap { levels: true }) whose outward normal becomes primaryAxis (default z-); secondary turns it — a line or axis (or 2 points) laid along secondaryAxis (default x+), or a plane; origin is the zero point — a point, sphere or circle (or 1 point). Elements by id or name, or points in mm used as given, not snapped. Trap: a plane as secondary puts its outward NORMAL on secondaryAxis, not its face along it. Each datum zeroes the coordinates it owns, the origin only those left open; an origin alone moves without turning. On a first alignment the coordinates nothing sets are centred on the scan’s box (keepFree: true leaves them). Returns the transform applied, how many elements moved, centred, origin { set, at, note } and parallelFace when a face parallel to the levelling plane, 0.3 to 5 mm off it (further on a noisy scan), holds more of the scan. Trap: on an embossed or warped sheet a plane fitted to the outermost faces lies on the bead crowns or the high spots, not the sheet — level on the largest level’s plane instead. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `primary` | { element } \| { points } \| { plane } |  | Levelling: an element, 3 points on the scan, or a plane { origin, normal }. |
| `primary.element` | integer \| string | ✓ | An element for levelling. (form 1: { element }) |
| `primary.points` | number[3][3] | ✓ | 3 points, mm — they span the face. (form 2: { points }) |
| `primary.plane` | object | ✓ | A plane as given — a level’s plane from scan.heightmap { levels: true }. (form 3: { plane }) |
| `primary.plane.origin` | number[3] | ✓ | A point on the plane, mm; it lands on 0 along primaryAxis. |
| `primary.plane.normal` | number[3] | ✓ | Its outward normal: out of the face, away from the material. |
| `primaryAxis` | "x+" \| "x-" \| "y+" \| "y-" \| "z+" \| "z-" |  | The axis the primary’s outward normal becomes; default z-. |
| `secondary` | { element } \| { points } |  | Rotation: an element, or 2 points on the scan. |
| `secondary.element` | integer \| string | ✓ | An element for rotation. (form 1: { element }) |
| `secondary.points` | number[3][2] | ✓ | 2 points, mm — they run along the edge. (form 2: { points }) |
| `secondaryAxis` | "x+" \| "x-" \| "y+" \| "y-" \| "z+" \| "z-" |  | The axis the secondary runs along (a plane: its normal); default x+. |
| `origin` | { element } \| { point } |  | The zero point: an element, or a point on the scan. |
| `origin.element` | integer \| string | ✓ | An element for the zero point. (form 1: { element }) |
| `origin.point` | number[3] | ✓ | A point for the zero point, mm. (form 2: { point }) |
| `keepFree` | boolean |  | First alignment: leave the coordinates nothing sets where they are instead of centring. |
| `detail` | "brief" \| "full" |  | brief (the default): the transform and how many elements moved. full: every element where it now is. |

<a id="align_symmetry"></a>
### `align.symmetry`

**Align the part on its symmetry plane** · change — one undo step  
MCP tool `align_symmetry` — adds `wait`, `timings`

Settle the part’s pose on its mirror plane and apply it, as Use symmetry then Confirm alignment do: the pose is Auto-align’s, the mirror plane a measured symmetry plane or one searched for on the scan; the axis nearest its normal is turned onto it and the zero point put on it. Refuses when the scan has no symmetry plane. Returns the note on what it settled on, the transform and how many elements moved. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `detail` | "brief" \| "full" |  | brief (the default): the transform and how many elements moved. full: every element where it now is. |
