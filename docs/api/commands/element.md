<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `element.*` commands

7 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`element.construct`](#element_construct) — Construct an element
- [`element.fit`](#element_fit) — Fit an element
- [`element.fit_marked`](#element_fit_marked) — Fit an element to a marked surface
- [`element.remove`](#element_remove) — Delete an element
- [`element.rename`](#element_rename) — Rename an element
- [`element.set_visible`](#element_set_visible) — Show or hide elements
- [`element.unlink`](#element_unlink) — Unlink a construction from its sources

<a id="element_construct"></a>
### `element.construct`

**Construct an element** · change — one undo step  
MCP tool `element_construct` — adds `wait`, `timings`

Construct an element from others and typed-in numbers, as the panel’s creation methods do — point: point-coords, point-centroid, point-midpoint, point-line-plane, point-center (of a sphere, circle or torus), point-three-planes, point-line-line (params gap: the most two measured lines may pass apart and be taken to cross, 0.1 mm by default; skew past it is refused), point-project (a point onto a plane); line: line-two-points, line-axis (of a cylinder, cone, torus or circle), line-plane-plane, line-plane-point (square to a plane through a point), line-project (a line or axis onto a plane), line-coords (dx, dy, dz, px, py, pz, length); plane: plane-three-points, plane-offset, plane-offset-point (parallel through a point), plane-midplane, plane-line-point (normal to a line through a point), plane-angle (refs axis, zero-angle plane; params angle in degrees, right-handed about the axis), plane-line-plane (through a line, square to a plane), plane-two-lines (params gap as for point-line-line), plane-tangent-sphere, plane-tangent-cylinder (refs the feature, a point on the side to touch), plane-coords, plane-symmetry; circle: circle-plane-cylinder, circle-plane-sphere, circle-coords. Constructions stay linked to their sources, rebuilt when one changes; element.unlink freezes one where it stands. refs fill the slots in order, by id or name (a section stands in a plane’s slot as its cut plane; "XY", "YZ", "XZ" become plane elements, listed under made); params are the numbers in order or by key. point-centroid and plane-symmetry measure the scan (vertices confines them, seed starts the symmetry search), plane-symmetry answering symmetry { rms, matched, sampled }. Returns the element. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `kind` | "point" \| "line" \| "plane" \| "sphere" \| "cylinder" \| "cone" \| "circle" \| "torus" | ✓ | What to construct. |
| `method` | string | ✓ | The creation method — see the description. |
| `refs` | (integer \| string)[] |  | The method’s source elements, slot by slot. |
| `params` | number[] \| { … } |  | The method’s typed-in numbers, mm. |
| `seed` | integer \| string |  | plane-symmetry: the plane the search starts from. |
| `vertices` | integer[] |  | point-centroid, plane-symmetry: only these scan vertices. (*at least 3 items*) |
| `assumed` | number |  | The designed diameter, mm: drawn and exported at it, reported as measured. (*> 0*) |
| `orient` | object |  | Align the direction to a plane, as designed; the measured fit is kept beside it. |
| `orient.to` | integer \| string | ✓ | A plane element, a section, or "XY", "YZ", "XZ". |
| `orient.relation` | "normal" \| "inPlane" |  | normal (the default): the direction is the plane’s normal. inPlane: it lies in the plane. |
| `name` | string |  | A name; else numbered by kind — "Sphere 2". |

<a id="element_fit"></a>
### `element.fit`

**Fit an element** · change — one undo step  
MCP tool `element_fit` — adds `wait`, `timings`

Fit an element on the scan where the panel would take a click: a plane, sphere, cylinder, cone or torus grows its surface from the place (or places) in at and is best-fitted to it; a point is the place itself; a circle goes through three or more places, or round an open rim (rim, numbered by scan.qa). A place is { vertex } or { point: [x, y, z] } (mm, current frame; the nearest vertex is taken). Trap: a seed near an edge can land on the wrong surface — say what is sought with side, radius, axis or within, and surfaces that do not match are passed over; that guide stays with the element, which is fitted with it again when the project reopens. Returns the element with its fit, the seeds used (inRegion, offMm, deg), the region grown (area, box, normalSpreadDeg, fill, sagitta) and a warning when the points look like two surfaces, a bore steps or is closed at an end, or a plane is a bead’s crown — the measure-reference guide (Elements) says how to read each. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `kind` | "plane" \| "sphere" \| "cylinder" \| "cone" \| "torus" \| "point" \| "circle" | ✓ | What to fit. |
| `at` | { vertex } \| { point } \| { screen } \| { candidate } \| ({ vertex } \| { point } \| { screen } \| { candidate })[] |  | Where on the scan. |
| `side` | "inside" \| "outside" |  | Sphere, cylinder, cone: inside (concave, a bore) or outside (convex, a shaft). |
| `radius` | object |  | Sphere, cylinder, cone: the radius range sought. |
| `radius.min` | number |  | mm. (*> 0*) |
| `radius.max` | number |  | mm. (*> 0*) |
| `axis` | number[3] |  | Cylinder, cone: the axis direction, roughly (within 20°). |
| `within` | object |  | The surface stays inside this box. |
| `within.min` | number[3] | ✓ | Lowest corner, mm. |
| `within.max` | number[3] | ✓ | Highest corner, mm. |
| `mark` | boolean |  | Leave the grown region marked for element.fit_marked. |
| `rim` | integer |  | Circle: an open rim of the scan by its scan.qa number, in place of at. (*≥ 0*) |
| `sigma` | 3 \| 2 \| 1 \| 0 |  | Outlier cut-off, sigma: 3 (the default), 2, 1, or 0 for all points. |
| `knownDiameter` | number |  | Sphere: a known diameter held, mm (a gauge ball); the centre alone is fitted. (*> 0*) |
| `assumed` | number |  | The designed diameter, mm: drawn and exported at it, reported as measured. (*> 0*) |
| `orient` | object |  | Align the direction to a plane, as designed; the measured fit is kept beside it. |
| `orient.to` | integer \| string | ✓ | A plane element, a section, or "XY", "YZ", "XZ". |
| `orient.relation` | "normal" \| "inPlane" |  | normal (the default): the direction is the plane’s normal. inPlane: it lies in the plane. |
| `extend` | object |  | Mm a cylinder or plane is drawn and exported past the measured surface. |
| `extend.start` | number |  | Cylinder: mm past the start (negative pulls it in). |
| `extend.end` | number |  | Cylinder: mm past the end. |
| `extend.uMin` | number |  | Plane: mm past the edge along its first axis. |
| `extend.uMax` | number |  | Plane: the opposite edge. |
| `extend.vMin` | number |  | Plane: along its second axis. |
| `extend.vMax` | number |  | Plane: the opposite edge. |
| `name` | string |  | A name; else numbered by kind — "Sphere 2". |

<a id="element_fit_marked"></a>
### `element.fit_marked`

**Fit an element to a marked surface** · change — one undo step  
MCP tool `element_fit_marked` — adds `wait`, `timings`

Fit a plane, sphere, cylinder, cone or torus to exactly the scan vertices given, with no search for the surface — vertices, or marked: true for the points the last element.fit { mark: true }, scan.segment { mark } or scan.query { mark: true } left marked, or box (with normal: only those facing a way) for every vertex inside it. The element keeps the marking as its recipe. Returns the element, and with box how many points it took. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `kind` | "plane" \| "sphere" \| "cylinder" \| "cone" \| "torus" | ✓ | What to fit. |
| `vertices` | integer[] |  | The scan vertices of the surface. (*at least 3 items*) |
| `marked` | boolean |  | The points left marked, in place of vertices. |
| `box` | object |  | The scan inside a box, in place of vertices. |
| `box.min` | number[3] | ✓ | Lowest corner, mm. |
| `box.max` | number[3] | ✓ | Highest corner, mm. |
| `normal` | object |  | With box: only the vertices facing this way. |
| `normal.dir` | number[3] | ✓ | A direction, any length. |
| `normal.withinDeg` | number |  | Degrees; 30 by default. (*> 0*, *≤ 180*) |
| `sigma` | 3 \| 2 \| 1 \| 0 |  | Outlier cut-off, sigma: 3 (the default), 2, 1, or 0 for all points. |
| `knownDiameter` | number |  | Sphere: a known diameter held, mm (a gauge ball); the centre alone is fitted. (*> 0*) |
| `assumed` | number |  | The designed diameter, mm: drawn and exported at it, reported as measured. (*> 0*) |
| `orient` | object |  | Align the direction to a plane, as designed; the measured fit is kept beside it. |
| `orient.to` | integer \| string | ✓ | A plane element, a section, or "XY", "YZ", "XZ". |
| `orient.relation` | "normal" \| "inPlane" |  | normal (the default): the direction is the plane’s normal. inPlane: it lies in the plane. |
| `extend` | object |  | Mm a cylinder or plane is drawn and exported past the measured surface. |
| `extend.start` | number |  | Cylinder: mm past the start (negative pulls it in). |
| `extend.end` | number |  | Cylinder: mm past the end. |
| `extend.uMin` | number |  | Plane: mm past the edge along its first axis. |
| `extend.uMax` | number |  | Plane: the opposite edge. |
| `extend.vMin` | number |  | Plane: along its second axis. |
| `extend.vMax` | number |  | Plane: the opposite edge. |
| `name` | string |  | A name; else numbered by kind — "Sphere 2". |

<a id="element_remove"></a>
### `element.remove`

**Delete an element** · change — one undo step  
MCP tool `element_remove` — adds `wait`, `timings`

Delete an element — and with it every construction built on it and every dimension on any of them. Returns what went. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `element` | integer \| string | ✓ | The element. |

<a id="element_rename"></a>
### `element.rename`

**Rename an element** · change — one undo step  
MCP tool `element_rename` — adds `wait`, `timings`

Give an element another name; dimensions and constructions on it keep pointing at it. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `element` | integer \| string | ✓ | The element. |
| `name` | string | ✓ | Its new name. |

<a id="element_set_visible"></a>
### `element.set_visible`

**Show or hide elements** · change — one undo step  
MCP tool `element_set_visible` — adds `wait`, `timings`

Show or hide one element, or all of them with all: true. A hidden element still measures; only its drawing and surface tint go. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `element` | integer \| string |  | The element. |
| `all` | boolean |  | Every element. |
| `visible` | boolean | ✓ | Shown (true) or hidden (false). |

<a id="element_unlink"></a>
### `element.unlink`

**Unlink a construction from its sources** · change — one undo step  
MCP tool `element_unlink` — adds `wait`, `timings`

Freeze a constructed element where it stands: its sources give way to coordinates of its own (point-coords, line-coords, plane-coords or circle-coords), so it no longer moves when they do and stays if they are deleted. Refused for an element that is not linked to others. Returns the element. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `element` | integer \| string | ✓ | The constructed element. |
