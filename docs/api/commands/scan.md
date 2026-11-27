<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `scan.*` commands

13 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`scan.curvature`](#scan_curvature) — Curvature shading
- [`scan.draft`](#scan_draft) — Read the draft against a pull
- [`scan.fit_surface`](#scan_fit_surface) — Fit a sloped or curved patch
- [`scan.gear`](#scan_gear) — Read the gears round an axis
- [`scan.heightmap`](#scan_heightmap) — Map the scan’s heights
- [`scan.nearest`](#scan_nearest) — Find a place on the scan
- [`scan.open`](#scan_open) — Open a scan
- [`scan.outline`](#scan_outline) — Read the scan’s outline
- [`scan.pattern`](#scan_pattern) — Count the repeats round an axis
- [`scan.qa`](#scan_qa) — Check the scan before modelling
- [`scan.query`](#scan_query) — Read the scan’s points
- [`scan.scale`](#scan_scale) — Scale the scan
- [`scan.segment`](#scan_segment) — Find the scan’s flat regions

<a id="scan_curvature"></a>
### `scan.curvature`

**Curvature shading** · read-only · long (runs as a job)  
MCP tool `scan_curvature` — adds `wait`

Colour the scan by how it bends — convex (red), flat (pale), concave (blue), sharper than the range darker — and read it in numbers. Every vertex gets a quadric fitted to the scan within radius mm of it (null, the default: eight edge lengths, more on a noisy scan — till its scatter reads under a twentieth of a round that size), so the reading holds on a scan’s noise; a round smaller than the radius reads as an edge spread over it. show (true by default) switches the shading on in the measure workspace, putting it on screen, or off; quantity is what it is coloured by: principal (the default — the sharper of the two principal curvatures, signed: 1/R on a ball and a cylinder alike), mean or gaussian. rangeRadius is the round that takes full colour (null: the scan’s own range), flatRadius where flat ends: a surface bending more gently than a round that large is flat (null, the default: what the scan’s scatter allows — 1.5 times noiseFloor, the curvature its scatter, noise, reads on a flat at this radius). Returns the radius read at, the range, shares of the area (flat, convex, concave, saddle; unread is the share with too few points round it), the tightest convex and concave rounds on most of the part (radius, mm — the tightest half per cent read past), and with at the curvatures there: k1 ≥ k2 (1/mm, convex positive), their radii, mean, gaussian, shape (flat, convex, concave or saddle), dir1 and dir2 (the directions they bend in), points and rms of the fit. Not a step of the history.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `show` | boolean |  | Shading on (true, the default) or off. |
| `quantity` | "principal" \| "mean" \| "gaussian" |  | What the scan is coloured by: principal (the default), mean or gaussian. |
| `radius` | number \| null |  | The neighbourhood radius, mm; null for eight edge lengths or more, as the scan’s scatter asks. |
| `rangeRadius` | number \| null |  | The radius of the round that takes full colour, mm; null for the scan’s own range. |
| `flatRadius` | number \| null |  | Gentler than a round of this radius is flat, mm; null for what the scan’s scatter allows. |
| `at` | { vertex } \| { point } \| { screen } \| { candidate } |  | A place to read the curvature at. |
| `at.vertex` | integer | ✓ | A scan vertex number. (form 1: { vertex }, *≥ 0*) |
| `at.point` | number[3] | ✓ | [x, y, z] mm in the current frame; the nearest scan vertex is taken. (form 2: { point }) |
| `at.screen` | number[2] | ✓ | A viewport pixel [x, y] (not available yet). (form 3: { screen }) |
| `at.candidate` | integer | ✓ | A feature from scan.candidates (not available yet). (form 4: { candidate }, *≥ 0*) |

<a id="scan_draft"></a>
### `scan.draft`

**Read the draft against a pull** · read-only  
MCP tool `scan_draft`

The scan’s walls that run near a pull direction — the sides a mould opens along — gathered into patches, each with draftDeg, the angle it leans off the pull: positive where the wall faces partly along the pull, negative where it faces back (a back draft, an undercut); with sigmaDeg, spreadDeg, centroid, box, area (mm²), count, facing, turnDeg and round for a boss’s or hole’s round side. Needs pull; box, nearDeg (10), patches (12), minArea (1 mm²) and split (a plane no patch reaches across: "symmetry", a plane element, "XY", "YZ", "XZ" or { point, normal }) narrow it. Trap: read it early on a moulded or cast part, along each direction the tools open — walls that lean half a degree to a few explain fits that miss by the lean. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `pull` | number[3] | ✓ | The pull direction, any length. |
| `box` | object |  | Only the scan inside this box. |
| `box.min` | number[3] | ✓ | Lowest corner, mm. |
| `box.max` | number[3] | ✓ | Highest corner, mm. |
| `nearDeg` | number |  | Degrees; 10 by default. (*> 0*, *≤ 45*) |
| `patches` | integer |  | How many patches; 12 by default. (*≥ 1*, *≤ 50*) |
| `minArea` | number |  | mm²; 1 by default. (*≥ 0*) |
| `split` | string \| integer \| { point, normal } |  | Keep every patch to one side of this plane. |
| `split.point` | number[3] | ✓ | A point on it, mm. (form 3: { point, normal }) |
| `split.normal` | number[3] | ✓ | Its normal, any length. (form 3: { point, normal }) |

<a id="scan_fit_surface"></a>
### `scan.fit_surface`

**Fit a sloped or curved patch** · read-only  
MCP tool `scan_fit_surface`

A patch of the scan measured as a surface — a sloped side, a twisted ruled face, a dome, a saddle — from vertices or a box (normal keeps those facing a way). Returns the patch’s frame (origin, normal, basisU, basisV) and each model as a height over (u, v): plane (a + b·u + c·v), bilinear (+ d·u·v) and quadric (+ d·u² + e·u·v + f·v², with curvature { k1, k2, r1, r2, axis1, axis2, shape }), each with coefficients, rms and worst; model: best (the default) fits every one and names the simplest whose rms is within a tenth of the lowest. Trap: 7 points at least, at most limit (20000) spread evenly. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `vertices` | integer[] |  | The scan vertices of the patch. (*at least 7 items*) |
| `box` | object |  | The scan inside a box, in place of vertices. |
| `box.min` | number[3] | ✓ | Lowest corner, mm. |
| `box.max` | number[3] | ✓ | Highest corner, mm. |
| `normal` | object |  | With box: only the vertices facing this way. |
| `normal.dir` | number[3] | ✓ | A direction, any length. |
| `normal.withinDeg` | number |  | Degrees; 30 by default. (*> 0*, *≤ 180*) |
| `model` | "plane" \| "bilinear" \| "quadric" \| "best" |  | Which surface; best (the default) fits each and names the simplest that holds. |
| `limit` | integer |  | How many points at most; 20000 by default. (*≥ 7*, *≤ 20000*) |

<a id="scan_gear"></a>
### `scan.gear`

**Read the gears round an axis** · read-only · long (runs as a job)  
MCP tool `scan_gear` — adds `wait`

The involute gears on the scan about an axis, read off it: needs axis — a cylinder, cone, line or circle element, "X", "Y", "Z", or { origin, dir } (the bore's cylinder is best). Cuts square to the axis along the scan find each band of teeth (a run of cuts with the same count, six or more), or give from and to (mm along the axis) for one; radius keeps the cut to the teeth where another feature shares their height. Returns per gear: from and to (its face width along the axis), axis { origin (moved onto the teeth's own centre), dir, zeroDir } and centreOff (mm), teeth, module (normal), pressureDeg, helixDeg (plus a right hand, minus a left, 0 spur), shift (profile shift, modules), tipDiameter, rootDiameter, baseDiameter, leadMm, phaseDeg (tooth 0's middle at height 0 on the axis, from zeroDir), standard (the module and pressure angle named, or null where the flanks name none, or only one wanting a shift over 1: 20° and the module as measured — the same flanks, not the drawing's numbers), flankRms (mm: the gear named against the scan's flanks), measuredFlankRms (the closest true involutes'), helixRms (degrees: how far the teeth stray from one helix along the face) and broken (each tooth well off the others or short of the tip: index, angleDeg, rms, tipShort). A gear with a flankRms well over the scan's noise is not an involute (a sprocket, a spline, a worn gear). reverse_feature_add { kind: "gear" } builds what it reads. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `axis` | integer \| string \| { origin, dir } | ✓ | The axis the gear turns on. |
| `axis.origin` | number[3] | ✓ | A point on the axis, mm. (form 2: { origin, dir }) |
| `axis.dir` | number[3] | ✓ | Its direction, any length. (form 2: { origin, dir }) |
| `from` | number |  | mm along the axis: where one band of teeth starts. With to; absent, the bands are found. |
| `to` | number |  | mm along the axis: where it ends. |
| `radius` | object |  | Only the cut between these distances from the axis. |
| `radius.min` | number |  | mm (*≥ 0*) |
| `radius.max` | number |  | mm (*> 0*) |
| `teeth` | integer |  | The tooth count, where the cuts cannot count it (a gear with teeth missing). (*≥ 6*, *≤ 120*) |

<a id="scan_heightmap"></a>
### `scan.heightmap`

**Map the scan’s heights** · read-only · returns a picture · returns a file  
MCP tool `scan_heightmap` — adds `path`, `inline`

Where the scan is first met looking along an axis (axis, -z by default: the top surface from above) or square onto a plane (plane: an element, "XY", "YZ", "XZ", or { origin, normal, u? }), over a grid of cells: pocket floors, ledges, a step's height, a face's tilt, a pad's tiers, an icon on a key in one call. of: height (the default), deviation (the map's reading where each ray lands) or relief (the height less the surface round it, for icons, grooves and lettering). Returns cell, origin [u0, v0], cols, rows, grid (rows of mm from the low v up, null where nothing; grid[r][c] stands at u0 + (c + ½)·cell, v0 + (r + ½)·cell), min, max, hit, valued; with plane also its frame (a cell's point is origin + u·U + v·V + height·normal). levels: true gives the values gathered into levels in place of the grid, largest first — of a height, each holding 5 % of the map or more with its plane { origin, normal } (fitted to its cells, normal towards the viewer), which align.datum { primary: { plane } } levels on: the sheet itself, not its bead crowns; a gentle warp that ran levels together is taken out first and said (warp { rise, bow, note }); picture: true adds the map coloured. Trap: with plane, box is [u, v, height] in the plane's frame (or { world }), and scanLies says where the scan lies when few cells meet it. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `box` | object |  | The part looked at; the scan’s box by default. With plane: [u, v, height], or world: { min, max }. |
| `box.min` | number[3] |  | Lowest corner, mm ([u, v, height] with plane). |
| `box.max` | number[3] |  | Highest corner, mm ([u, v, height] with plane). |
| `box.world` | object |  | A box in the world, in place of min and max. |
| `box.world.min` | number[3] | ✓ | Lowest corner, [x, y, z] mm. |
| `box.world.max` | number[3] | ✓ | Highest corner, [x, y, z] mm. |
| `axis` | "+x" \| "-x" \| "+y" \| "-y" \| "+z" \| "-z" |  | The way looked: -z (the default) from above, +z from below, ±x, ±y. |
| `plane` | integer \| string \| { origin, normal, u } |  | Look square onto this plane instead of along an axis. |
| `plane.origin` | number[3] | ✓ | A point on the plane, mm. (form 2: { origin, normal, u }) |
| `plane.normal` | number[3] | ✓ | Its normal: the side looked from. (form 2: { origin, normal, u }) |
| `plane.u` | number[3] |  | A direction for u, flattened into the plane; a sketch’s by default. (form 2: { origin, normal, u }) |
| `flip` | boolean |  | With plane: look from its other side. |
| `of` | "height" \| "deviation" \| "relief" |  | height (the default), deviation (the map’s, where the ray lands) or relief (height less the surface round it). |
| `smooth` | number |  | relief: the smoothing sigma, mm; three cells by default. (*> 0*) |
| `cell` | number |  | The cell’s side, mm. (*> 0*) |
| `grid` | boolean |  | The grid of numbers (the default unless levels); false returns the picture alone. |
| `levels` | boolean |  | Gather the values into levels, largest first, in place of the grid; of a height, a warp taken out first when it ran two together, and each level of 5 % or more with its plane. |
| `gap` | number |  | levels: the least gap between two levels, mm. (*> 0*) |
| `slopeDeg` | number |  | levels of a height: cells steeper are left out, degrees; 10 by default, 90 keeps every one. (*> 0*, *≤ 90*) |
| `picture` | boolean |  | Add a picture of the map with a scale. |

<a id="scan_nearest"></a>
### `scan.nearest`

**Find a place on the scan** · read-only  
MCP tool `scan_nearest`

Where a place lands on the scan: the vertex (a point snaps to the nearest), its coordinates and outward normal, a triangle it is a corner of, and how far it lies from the point asked about. Use it to check a point lies on the surface before fitting there.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `at` | { vertex } \| { point } \| { screen } \| { candidate } | ✓ | The place on the scan. |
| `at.vertex` | integer | ✓ | A scan vertex number. (form 1: { vertex }, *≥ 0*) |
| `at.point` | number[3] | ✓ | [x, y, z] mm in the current frame; the nearest scan vertex is taken. (form 2: { point }) |
| `at.screen` | number[2] | ✓ | A viewport pixel [x, y] (not available yet). (form 3: { screen }) |
| `at.candidate` | integer | ✓ | A feature from scan.candidates (not available yet). (form 4: { candidate }, *≥ 0*) |

<a id="scan_open"></a>
### `scan.open`

**Open a scan** · change — one undo step  
MCP tool `scan_open` — takes `path` in place of `bytes` — adds `saveTo`, `wait`, `timings`

Open a mesh as the scan to measure — STL, PLY, OBJ or 3MF, a STEP part cut into triangles, or a laser scanner’s PTX (in metres whatever units say; each scan’s grid joined into a surface) — in place of the one there is; everything measured on the old one goes with it, so it refuses while the session holds measurements unless discard is true (the refusal names what is held). A reference part opened from a file stays, its alignment and maps gone (referenceKept); one made from the session’s own work goes (referenceDropped). Returns the scan: name, units, vertex and triangle counts, bounding box, centre and diagonal (size), mm. Not undoable: a new scan starts a new history.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `bytes` | bytes | ✓ | The file’s contents. |
| `name` | string | ✓ | The file's name with its extension — "ballbar.stl". |
| `units` | "mm" \| "cm" \| "m" \| "in" |  | The file’s units: mm (the default), cm, m or in. Everything is measured in mm once read. |
| `discard` | boolean |  | true: replace the session though it holds measurements (lost unless saved as a project first). Refused otherwise when there is work to lose. |

<a id="scan_outline"></a>
### `scan.outline`

**Read the scan’s outline** · read-only  
MCP tool `scan_outline`

The scan’s outline seen along an axis, or square onto a plane, read as a sketch would draw it: a flange’s plan, a bezel’s opening, a gasket’s shape — each loop as the fewest lines and arcs that follow it within tolerance (mm, 0.2 by default), a round loop as one circle. axis, plane, flip and box as scan.heightmap takes them, u, v as it lays them. Returns loops, the largest first (4 by default): hole, area (mm²), box, points ([u, v] corners), rounds { at, radius, center }, arcs { from, radius, center, mid } (from points[from] through mid to the next point: mid says which way it bulges, a slot’s half-round end too) or circle { center, radius, rms }, and worst (mm the trace strays from what is drawn, worstAt when past the tolerance). Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `axis` | "+x" \| "-x" \| "+y" \| "-y" \| "+z" \| "-z" |  | The way looked: -z (the default) from above, and so on. |
| `plane` | integer \| string \| { origin, normal, u } |  | Look square onto this plane instead of along an axis. |
| `plane.origin` | number[3] | ✓ | A point on the plane, mm. (form 2: { origin, normal, u }) |
| `plane.normal` | number[3] | ✓ | Its normal: the side looked from. (form 2: { origin, normal, u }) |
| `plane.u` | number[3] |  | A direction for u, flattened into the plane. (form 2: { origin, normal, u }) |
| `flip` | boolean |  | With plane: look from its other side. |
| `box` | object |  | Only the scan inside it; the whole scan by default. With plane: [u, v, height], or world: { min, max }. |
| `box.min` | number[3] |  | Lowest corner, mm ([u, v, height] with plane). |
| `box.max` | number[3] |  | Highest corner, mm ([u, v, height] with plane). |
| `box.world` | object |  | A box in the world, in place of min and max. |
| `box.world.min` | number[3] | ✓ | Lowest corner, [x, y, z] mm. |
| `box.world.max` | number[3] | ✓ | Highest corner, [x, y, z] mm. |
| `tolerance` | number |  | How closely the sketch follows the outline, mm; 0.2 by default. (*> 0*) |
| `loops` | integer |  | How many loops, the largest first; 4 by default. (*≥ 1*, *≤ 50*) |

<a id="scan_pattern"></a>
### `scan.pattern`

**Count the repeats round an axis** · read-only  
MCP tool `scan_pattern`

Rotational repeats about an axis — a fan's blades, a flange's holes, a wheel's spokes, a gear's teeth — counted from the scan: it is cut square to the axis at each height in at, and each cut (between radius.min and radius.max) is turned against itself. Needs axis: a cylinder, cone, line or circle element, "X", "Y", "Z", or { origin, dir }. Returns per height count, pitchDeg, phaseDeg, betweenDeg (angles as section.cut { across: { axis, angleDeg } } takes them), score (0 to 1; under 0.5 count is 1 and tried says the best), rms, worst, instances (each angleDeg, radius, offDeg, rms, worst, share) and rings (round outlines about the axis: radius, off, towardDeg, rms). Trap: features at different heights and radii need a cut through each, radius kept to one ring. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `axis` | integer \| string \| { origin, dir } | ✓ | The axis the copies repeat round. |
| `axis.origin` | number[3] | ✓ | A point on the axis, mm. (form 2: { origin, dir }) |
| `axis.dir` | number[3] | ✓ | Its direction, any length. (form 2: { origin, dir }) |
| `at` | (number \| number[3])[] |  | Heights to cut at; 6 spread over the scan by default. (*1–12 items*) |
| `radius` | object |  | Only the cut between these distances from the axis. |
| `radius.min` | number |  | mm (*≥ 0*) |
| `radius.max` | number |  | mm (*> 0*) |
| `maxCount` | integer |  | The most copies looked for; 60 by default. (*≥ 2*, *≤ 120*) |
| `instances` | boolean |  | List each copy; true by default. |

<a id="scan_qa"></a>
### `scan.qa`

**Check the scan before modelling** · read-only · long (runs as a job)  
MCP tool `scan_qa` — adds `wait`

One call before modelling, to know what the scan will and will not give. Returns rims (the open edges of its holes: count, total length, the longest few with rim number, centre, size and circle where one fits — element.fit { kind: "circle", rim } makes it an element), noise (the median scatter of small plane fits, mm; 0 on a CAD tessellation), tessellation where the mesh is an STL exported from CAD (cad, its facets exactly flat; sparse where its vertices lie only on edges and rims, too far apart to fit on — densifyTo, the edge length to subdivide it to first, noise.measured the bends between facets that a fit would read), thickness through the part along axis (p5, p50, p95, the main faces’ tiltDeg and faces { topDeg, bottomDeg }), sheet where most of the area has a second skin facing back within reach mm (gauge { p5, p50, p95 }, twoSkins: that share), apart on such a part with flat walls (regions standing over reach mm off every main wall — tabs bent in, ribs, bosses: center, box, area mm², largest first) and notes, what looks wrong, plainly. Traps: a scanned skin with no rims, or only pinholes, is a wrap bridging the holes it did not see through; on a sheet, thickness reads the box across the part — the gauge is sheet.gauge. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `axis` | "x" \| "y" \| "z" \| number[3] |  | The thickness axis. |

<a id="scan_query"></a>
### `scan.query`

**Read the scan’s points** · read-only  
MCP tool `scan_query`

The scan’s vertices inside a box, or within a radius of a point (near), with their outward normals — the points on a face, to measure a dimension or a draft off; normal keeps only those facing a direction. Returns matched, the vertex numbers, points and normals (mm, current frame), the box round them, centroid and mean normal; fields: count, ids or all (the default) says how much. Trap: at most limit come back (1000 by default, 20000 at most), every k-th spread evenly, step saying k — mark: true marks every matching vertex, not the thinned list, for element.fit_marked { marked: true }. Changes nothing on the part.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `box` | object |  | A box in the current frame. |
| `box.min` | number[3] | ✓ | Lowest corner, mm. |
| `box.max` | number[3] | ✓ | Highest corner, mm. |
| `near` | object |  | A ball about a point, in place of box. |
| `near.at` | number[3] | ✓ | The centre, mm. |
| `near.radius` | number | ✓ | mm. (*> 0*) |
| `normal` | object |  | Only the vertices whose outward normal faces this way. |
| `normal.dir` | number[3] | ✓ | A direction, any length. |
| `normal.withinDeg` | number |  | Degrees; 30 by default. (*> 0*, *≤ 180*) |
| `limit` | integer |  | How many vertices at most; 1000 by default, 20000 at most. (*≥ 1*, *≤ 20000*) |
| `mark` | boolean |  | Leave every matching vertex marked, for element.fit_marked { marked: true }. |
| `fields` | "count" \| "ids" \| "all" |  | count: the numbers alone (the default with mark); ids: with the vertices; all: with points and normals (the default). |

<a id="scan_scale"></a>
### `scan.scale`

**Scale the scan** · change — one undo step  
MCP tool `scan_scale` — adds `wait`, `timings`

Scale the scan to its true size — a photogrammetry scan (Meshroom, say) has no size of its own, and session.state says noTrueSize when one looks like it. Give references: lengths measured on the scan with their true lengths from the real part — a length dimension already made (distance or diameter), an element’s diameter (sphere, cylinder, circle), or two points — or a factor outright. Several references are averaged by length; each one’s own factor and how far it is off the average (offPct) come back, so a bad one shows. Best references: long, and between centres (hole to hole, ball to ball) — a centre does not move when the surface sits proud or sunk. The scale is about the frame’s zero point: every coordinate times the factor. Elements, dimensions, sections and the alignment scale with it; the fit to a reference part goes. Refuses while a model, notes or other work is built on the scan at the old size (scale first). dryRun: true returns the factor and the size it would give without scaling. Returns factor, the references, size before and after, and the scan. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `factor` | number |  | Scale by this factor outright, instead of from references — 25.4 for a file in inches read as mm. (*> 0*) |
| `references` | ({ dimension, true } \| { element, true } \| { points, true })[] |  | Lengths to scale from — one or more. (*at least 1 item*) |
| `references[].dimension` | integer \| string | ✓ | A length dimension already measured — a distance or a diameter. (form 1: { dimension, true }) |
| `references[].true` | number | ✓ | Its length on the real part, mm. (form 1: { dimension, true }) |
| `references[].element` | integer \| string | ✓ | A sphere, cylinder or circle; its diameter is the length. (form 2: { element, true }) |
| `references[].true` | number | ✓ | Its diameter on the real part, mm. (form 2: { element, true }) |
| `references[].points` | number[3][2] | ✓ | The two ends of the length. (form 3: { points, true }) |
| `references[].true` | number | ✓ | The distance between them on the real part, mm. (form 3: { points, true }) |
| `dryRun` | boolean |  | Work out the factor and the size it gives, and scale nothing. |

<a id="scan_segment"></a>
### `scan.segment`

**Find the scan’s flat regions** · read-only  
MCP tool `scan_segment`

The scan’s planar regions, found all at once: grown from the flattest places outward within maxDeg (15°) and maxRms (0.05 mm), those smaller than minArea given back. Returns found, considered, claimed, noise and the regions, largest first, at most limit (20): id, normal, point, sigma, area (mm²), box, vertices, neighbours { id, deg, smooth } and, with symmetric, mirror (its twin across that plane). Trap: a round surface comes out as strips that look like facets — such a region says curved { sagitta } and run, and curvedRuns joins them into surfaces with a note saying what to model each as; read the runs before taking regions for faces. mark: a region’s id, or several, leaves their points marked for element.fit_marked { marked: true }. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `kind` | "plane" |  | What to find; plane, the default and for now the only one. |
| `box` | object |  | Only the scan inside this box. |
| `box.min` | number[3] | ✓ | Lowest corner, mm. |
| `box.max` | number[3] | ✓ | Highest corner, mm. |
| `minArea` | number |  | mm²; by default a square 2 % of the scan’s diagonal on a side. (*≥ 0*) |
| `maxRms` | number |  | mm; 0.05 by default. (*> 0*) |
| `maxDeg` | number |  | Degrees; 15 by default. (*> 0*, *≤ 60*) |
| `limit` | integer |  | How many regions are listed; 20 by default. (*≥ 1*, *≤ 200*) |
| `symmetric` | integer \| string |  | Pair regions mirrored across this plane: a plane element, or "XY", "YZ", "XZ". |
| `mark` | integer \| integer[] |  | Leave this region’s points marked, or several regions’. |
| `list` | boolean |  | With mark: the list of regions too. |
