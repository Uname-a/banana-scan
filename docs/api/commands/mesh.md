<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `mesh.*` commands

32 commands, from the [`mesh-tools`](../../../plugins/mesh-tools/) plugin, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`mesh.apply_reduced`](#mesh_apply_reduced) — Apply the reduced mesh
- [`mesh.apply_wrap`](#mesh_apply_wrap) — Apply the wrap
- [`mesh.boolean`](#mesh_boolean) — Boolean with solids
- [`mesh.cut`](#mesh_cut) — Cut the mesh
- [`mesh.cut_preview`](#mesh_cut_preview) — Preview a cut
- [`mesh.delete_marked`](#mesh_delete_marked) — Delete surface
- [`mesh.densify`](#mesh_densify) — Densify the mesh
- [`mesh.discard_edited`](#mesh_discard_edited) — Discard the edits
- [`mesh.export`](#mesh_export) — Export a part as a mesh
- [`mesh.export_pattern`](#mesh_export_pattern) — Export the flat pattern
- [`mesh.fill_holes`](#mesh_fill_holes) — Fill holes
- [`mesh.flatten`](#mesh_flatten) — Flatten a curved sheet
- [`mesh.flip_normals`](#mesh_flip_normals) — Flip normals
- [`mesh.inspect`](#mesh_inspect) — Inspect the mesh
- [`mesh.mark`](#mesh_mark) — Mark surface on the part
- [`mesh.merge`](#mesh_merge) — Merge the other scan into the mesh
- [`mesh.merge_clear`](#mesh_merge_clear) — Let the other scan go
- [`mesh.merge_open`](#mesh_merge_open) — Open another scan to merge
- [`mesh.merge_place`](#mesh_merge_place) — Place the other scan on the mesh
- [`mesh.mirror`](#mesh_mirror) — Mirror the mesh
- [`mesh.offset`](#mesh_offset) — Shrink or expand
- [`mesh.parts`](#mesh_parts) — List the parts
- [`mesh.pattern_points`](#mesh_pattern_points) — Place points on the flat pattern
- [`mesh.reduce`](#mesh_reduce) — Reduce the mesh
- [`mesh.remove_islands`](#mesh_remove_islands) — Remove islands
- [`mesh.shell`](#mesh_shell) — Hollow or thicken
- [`mesh.show`](#mesh_show) — Show or hide parts
- [`mesh.smooth`](#mesh_smooth) — Smooth the mesh
- [`mesh.trim`](#mesh_trim) — Trim a body to the scan
- [`mesh.unroll`](#mesh_unroll) — Unroll a cylinder or cone
- [`mesh.use_edited`](#mesh_use_edited) — Use the edited mesh for analysis
- [`mesh.wrap`](#mesh_wrap) — Wrap the mesh

<a id="mesh_apply_reduced"></a>
### `mesh.apply_reduced`

**Apply the reduced mesh** · change — one undo step  
MCP tool `mesh_apply_reduced` — adds `wait`, `timings`

Make the reduced mesh on hand the edited copy, the panel’s Apply: the tools work on it from here, mesh.use_edited takes it into every workspace, and mesh.inspect { deviation: true } measures it against the scan in use, at its own vertices only — the triangles between them can stray further, as the figures of mesh.reduce say. Fitted elements have only the vertices the reduction left to go on once it is in use. One undo step, which puts the mesh it was made of back; reduce again from there if it came out too coarse. Returns the edit and the mesh.

*No input.*

<a id="mesh_apply_wrap"></a>
### `mesh.apply_wrap`

**Apply the wrap** · change — one undo step  
MCP tool `mesh_apply_wrap` — adds `wait`, `timings`

Make the wrap on hand the edited copy, the panel’s Apply: the tools work on it from here, and mesh.use_edited takes it into every workspace. None of the mesh’s vertices is kept, so the copy’s deviation reads nothing of the scan and a marking made before it goes. One undo step, which puts the mesh it was made of back. Returns the edit and the mesh.

*No input.*

<a id="mesh_boolean"></a>
### `mesh.boolean`

**Boolean with solids** · change — one undo step  
MCP tool `mesh_boolean` — adds `wait`, `timings`

Make the mesh and solids one: subtract them from it, add them to it, or intersect (keep what both hold). The solids are those on offer (mesh.parts lists them by key and name): the cylinders, cones and spheres measured in 3D Measure as drawn there — at their assumed Ø and as far as they were extended — and the bodies modelled in the Reverse engineer workspace. Several go as one, their union. The mesh must be closed (mesh.inspect; mesh.fill_holes first). For a bore the scanner could not see to the bottom of: fit a cylinder to its wall in 3D Measure, extend it past the bottom and out through the surface, and subtract it. Edits the copy. One undo step. Returns the edit (the volume change) and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `op` | "subtract" \| "add" \| "intersect" | ✓ | subtract, add or intersect. |
| `solids` | string[] | ✓ | The solids, by key or name. (*at least 1 item*) |

<a id="mesh_cut"></a>
### `mesh.cut`

**Cut the mesh** · change — one undo step  
MCP tool `mesh_cut` — adds `wait`, `timings`

Cut the mesh with a plane and take one side off — the base or table the part stood on, a flat bottom for a print, one half of a part. cap closes the part flat wherever the plane goes all the way round it (on to start), bridging a hole in the wall that sits right at the cut, so a closed part stays closed; where the scan is open across the plane the cut stays open. mesh.cut_preview says what it would do. Edits the copy. One undo step. Returns the edit and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `plane` | string \| integer | ✓ | What to cut across: a coordinate plane — after a datum alignment, the datum’s — or an element with a direction (a plane’s normal, a cylinder’s, cone’s or line’s axis, a circle’s normal). |
| `offset` | number | ✓ | Where the plane lies, mm: for a coordinate plane its coordinate along the axis square to it (Z for XY — 0.5 is half a millimetre above the face a datum alignment set the part on); for an element, how far along its direction from it. |
| `keep` | "plus" \| "minus" | ✓ | Which side stays: plus the side the plane’s direction points to — above XY (Z past the offset), +X of YZ, +Y of XZ, along an element’s direction — minus the other. |
| `cap` | boolean |  | Close the part flat where the plane crosses it. |

<a id="mesh_cut_preview"></a>
### `mesh.cut_preview`

**Preview a cut** · read-only  
MCP tool `mesh_cut_preview`

What mesh.cut at this plane would do, without cutting: whether the plane has mesh on both sides of it, how many faces it would close flat, how many holes at the cut it would bridge, and how many stretches of the cut would stay open (where the scan is open across the plane). Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `plane` | string \| integer | ✓ | What to cut across: a coordinate plane — after a datum alignment, the datum’s — or an element with a direction (a plane’s normal, a cylinder’s, cone’s or line’s axis, a circle’s normal). |
| `offset` | number | ✓ | Where the plane lies, mm: for a coordinate plane its coordinate along the axis square to it (Z for XY — 0.5 is half a millimetre above the face a datum alignment set the part on); for an element, how far along its direction from it. |
| `keep` | "plus" \| "minus" |  | Which side stays: plus the side the plane’s direction points to — above XY (Z past the offset), +X of YZ, +Y of XZ, along an element’s direction — minus the other. |

<a id="mesh_delete_marked"></a>
### `mesh.delete_marked`

**Delete surface** · change — one undo step  
MCP tool `mesh_delete_marked` — adds `wait`, `timings`

Delete the surface a region holds — what is not the part: the clamp that held it, the fixture it sat in, a patch of the table. A triangle goes when all three of its corners are in the region; the hole it leaves stays open (mesh.fill_holes closes it). To take off everything past a plane, mesh.cut is the better tool. Edits the copy. One undo step. Returns the edit and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `region` | "marked" \| { box, sphere, vertices, skin, facing, angleDeg } | ✓ | The surface to delete. |
| `region.box` | object |  | The vertices inside an axis-aligned box, its sides included. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.box.min` | number[3] | ✓ | The low corner, mm. |
| `region.box.max` | number[3] | ✓ | The high corner, mm. |
| `region.sphere` | object |  | The vertices within a radius of a point. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.sphere.center` | number[3] | ✓ | The centre, mm. |
| `region.sphere.radius` | number | ✓ | mm. (*> 0*) |
| `region.vertices` | integer[] |  | The vertices by number — the edited copy’s while there is one, else the scan’s. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *at least 1 item*) |
| `region.skin` | object |  | One skin of a bent sheet: the surface grown from a point on it across its bends, as long as it bends no tighter than minRadius, and no further — a sheet’s edge is a corner, so the other skin is never reached. What mesh.flatten wants, which a box round a bent part cannot name. Not with facing. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.skin.at` | number[3] | ✓ | A point on the skin, mm — the middle of a flange, not near its edge; the vertex nearest it is where the skin grows from. |
| `region.skin.minRadius` | number |  | The tightest bend the skin is followed round, mm — 0.6 to start: pick the outer skin, whose bends are the inside radius and the thickness, and lower it for a tight bend on the inner one. (*> 0*) |
| `region.skin.thickness` | number |  | The sheet’s thickness, mm — with it, a vertex facing against the skin and behind it within 1.5 times this is the far skin, kept out where an edge was scanned soft. (*> 0*) |
| `region.facing` | number[3] |  | Of those, only the vertices whose normal points within angleDeg of this direction — [0, 0, 1] for the faces looking up. Narrows a box to one face of the part. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.angleDeg` | number |  | How far a normal may turn from facing and still face it, degrees — 30 to start. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *> 0*, *≤ 180*) |

<a id="mesh_densify"></a>
### `mesh.densify`

**Densify the mesh** · change — one undo step  
MCP tool `mesh_densify` — adds `wait`, `timings`

Cut the triangles until no edge is longer than maxEdge, the surface unchanged: every new vertex is an edge’s middle, on the facet it was cut from, and the mesh stays as closed as it was. For an STL exported from CAD, whose vertices lie only on its edges and rims (scan.qa’s tessellation.sparse): a segmentation, a seeded fit or a section fit finds points inside its faces only after it — scan.qa’s densifyTo is the length to give. A scan needs none. maxEdge defaults to the panel’s, a hundredth of the part to start. Edits the copy. One undo step. Returns the edit (maxEdge, the vertices added, the triangles now) and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `maxEdge` | number |  | No edge longer than this, mm. (*> 0*) |

<a id="mesh_discard_edited"></a>
### `mesh.discard_edited`

**Discard the edits** · change — one undo step  
MCP tool `mesh_discard_edited` — adds `wait`, `timings`

Throw the edited copy and the edits waiting on it away: the tools work on the scan in use again. One undo step, which brings them back. Returns the mesh the workspace works on.

*No input.*

<a id="mesh_export"></a>
### `mesh.export`

**Export a part as a mesh** · read-only · returns a file  
MCP tool `mesh_export` — adds `path`

A part of the workspace as a binary STL in millimetres — or, format 3mf, a 3MF, which says its units — in the pose the part is shown in — an alignment, and a best fit onto the reference, included: edited (the edited copy as it stands), reduced (the reduced mesh on screen) or piece (the piece Trim to scan made). The reduced mesh and the piece need the viewport. Returns the file’s bytes and the name the panel would save it under.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `part` | "edited" \| "reduced" \| "piece" | ✓ | Which part. |
| `format` | "stl" \| "3mf" |  | stl (the default) or 3mf. |

<a id="mesh_export_pattern"></a>
### `mesh.export_pattern`

**Export the flat pattern** · read-only · returns a file  
MCP tool `mesh_export_pattern` — adds `path`

The flat pattern mesh.unroll or mesh.flatten made last, as a DXF (the default) or an SVG, in millimetres, the pattern’s low corner at the origin and y up in the DXF: its outline and its holes as closed polylines on the edges layer, the DXF’s thinned to within 0.01 mm. Returns the file’s bytes and the name the panel would save it under.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `format` | "dxf" \| "svg" |  | dxf (the default) or svg. |

<a id="mesh_fill_holes"></a>
### `mesh.fill_holes`

**Fill holes** · change — one undo step  
MCP tool `mesh_fill_holes` — adds `wait`, `timings`

Close the holes in the mesh smaller across than size — where the scanner could not see — or, with at, only the one of them whose middle is nearest that point (mesh.inspect lists them). A patch is triangulated to bend least, refined to the density around it and faired: curved continues the surface’s bending across the hole, flat lays the tightest patch across it. The scan’s own vertices do not move. size defaults to the panel’s, a twentieth of the part’s size to start — well short of the opening a part scanned standing on its base leaves. Edits the copy. One undo step. Returns the edit and the mesh after it — closed tells whether it is now closed.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `size` | number |  | A rim whose longest span is less than this is a hole, mm. (*> 0*) |
| `patch` | "curved" \| "flat" |  | curved (to start) or flat. |
| `at` | number[3] |  | Fill only the hole whose middle is nearest this point, mm. |

<a id="mesh_flatten"></a>
### `mesh.flatten`

**Flatten a curved sheet** · change — one undo step  
MCP tool `mesh_flatten` — adds `wait`, `timings`

A flat pattern of a region of the scan that is a bent sheet — developable, or nearly — laid out flat with the least distortion: a conformal layout (least-squares conformal maps) refined as rigid as possible, so a sheet bent without stretching flattens to its blank, its lengths kept. Name one skin of the sheet, not both: the region is a surface, and only its largest connected piece is laid out. Made beside the scan, not an edit of it, and shown in the Mesh Tools panel (Unroll/flatten); mesh.export_pattern writes it as a DXF or an SVG. Returns the pattern’s size (width, height, area, perimeter, mm; the holes with their centres and sizes; turned so the smallest rectangle round it lies along x and y, its long side along x, its low corner the origin) and its distortion, per cent: lengthPercent — a length on the pattern against the same length on the scan, in the direction each triangle changed most — and areaPercent, each as the most anywhere, the mean and the 95th percentile over the surface; totalAreaPercent, the whole pattern’s area against the scan’s; flipped, triangles turned over (the pattern overlapping itself). A sheet bent from flat reads a fraction of a per cent; a dished or drawn one, which no blank makes exactly, several. Also the rounds the layout took and whether it settled.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `region` | "marked" \| { box, sphere, vertices, skin, facing, angleDeg } | ✓ | The sheet to flatten — one skin of it. |
| `region.box` | object |  | The vertices inside an axis-aligned box, its sides included. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.box.min` | number[3] | ✓ | The low corner, mm. |
| `region.box.max` | number[3] | ✓ | The high corner, mm. |
| `region.sphere` | object |  | The vertices within a radius of a point. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.sphere.center` | number[3] | ✓ | The centre, mm. |
| `region.sphere.radius` | number | ✓ | mm. (*> 0*) |
| `region.vertices` | integer[] |  | The vertices by number — the edited copy’s while there is one, else the scan’s. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *at least 1 item*) |
| `region.skin` | object |  | One skin of a bent sheet: the surface grown from a point on it across its bends, as long as it bends no tighter than minRadius, and no further — a sheet’s edge is a corner, so the other skin is never reached. What mesh.flatten wants, which a box round a bent part cannot name. Not with facing. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.skin.at` | number[3] | ✓ | A point on the skin, mm — the middle of a flange, not near its edge; the vertex nearest it is where the skin grows from. |
| `region.skin.minRadius` | number |  | The tightest bend the skin is followed round, mm — 0.6 to start: pick the outer skin, whose bends are the inside radius and the thickness, and lower it for a tight bend on the inner one. (*> 0*) |
| `region.skin.thickness` | number |  | The sheet’s thickness, mm — with it, a vertex facing against the skin and behind it within 1.5 times this is the far skin, kept out where an edge was scanned soft. (*> 0*) |
| `region.facing` | number[3] |  | Of those, only the vertices whose normal points within angleDeg of this direction — [0, 0, 1] for the faces looking up. Narrows a box to one face of the part. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.angleDeg` | number |  | How far a normal may turn from facing and still face it, degrees — 30 to start. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *> 0*, *≤ 180*) |
| `iterations` | integer |  | Rounds of the as-rigid-as-possible refinement at most — 60 to start; it usually settles in a few. (*≥ 0*, *≤ 1000*) |

<a id="mesh_flip_normals"></a>
### `mesh.flip_normals`

**Flip normals** · change — one undo step  
MCP tool `mesh_flip_normals` — adds `wait`, `timings`

Turn triangles over so they face the other way — every one, or with region those with all three corners in it. For a part exported inside-out (a closed one is turned outward when opened; an open scan or a sheet is left as wound), or patches of a scan that face in. A closed mesh flipped whole encloses a negative volume (mesh.inspect). Nothing moves. Edits the copy. One undo step. Returns the edit and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `region` | "marked" \| { box, sphere, vertices, skin, facing, angleDeg } |  | Flip only this surface; absent, the whole mesh. |
| `region.box` | object |  | The vertices inside an axis-aligned box, its sides included. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.box.min` | number[3] | ✓ | The low corner, mm. |
| `region.box.max` | number[3] | ✓ | The high corner, mm. |
| `region.sphere` | object |  | The vertices within a radius of a point. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.sphere.center` | number[3] | ✓ | The centre, mm. |
| `region.sphere.radius` | number | ✓ | mm. (*> 0*) |
| `region.vertices` | integer[] |  | The vertices by number — the edited copy’s while there is one, else the scan’s. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *at least 1 item*) |
| `region.skin` | object |  | One skin of a bent sheet: the surface grown from a point on it across its bends, as long as it bends no tighter than minRadius, and no further — a sheet’s edge is a corner, so the other skin is never reached. What mesh.flatten wants, which a box round a bent part cannot name. Not with facing. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.skin.at` | number[3] | ✓ | A point on the skin, mm — the middle of a flange, not near its edge; the vertex nearest it is where the skin grows from. |
| `region.skin.minRadius` | number |  | The tightest bend the skin is followed round, mm — 0.6 to start: pick the outer skin, whose bends are the inside radius and the thickness, and lower it for a tight bend on the inner one. (*> 0*) |
| `region.skin.thickness` | number |  | The sheet’s thickness, mm — with it, a vertex facing against the skin and behind it within 1.5 times this is the far skin, kept out where an edge was scanned soft. (*> 0*) |
| `region.facing` | number[3] |  | Of those, only the vertices whose normal points within angleDeg of this direction — [0, 0, 1] for the faces looking up. Narrows a box to one face of the part. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.angleDeg` | number |  | How far a normal may turn from facing and still face it, degrees — 30 to start. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *> 0*, *≤ 180*) |

<a id="mesh_inspect"></a>
### `mesh.inspect`

**Inspect the mesh** · read-only · long (runs as a job)  
MCP tool `mesh_inspect` — adds `wait`

What the tools would find on the mesh the workspace works on — the edited copy, or the scan while there is none — without changing it: its vertices, triangles and bounds; whether it is closed (open edges, and edges more than two triangles share — mesh.boolean and a hollow need none) and the volume it then encloses, mm³; its connected pieces and the islands among them smaller than pieceSize across (the middle of each), its open rims and the holes among them smaller than holeSize across (the middle of each, for mesh.fill_holes { at }). Sizes default to the panel’s, which start sized to the part. deviation: true also measures the edited copy against the scan in use — the furthest, the RMS, and the share of it an edit made.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `pieceSize` | number |  | A piece smaller than this across is an island, mm. (*> 0*) |
| `holeSize` | number |  | A rim whose longest span is less than this is a hole, mm. (*> 0*) |
| `deviation` | boolean |  | Measure the edited copy against the scan in use. |

<a id="mesh_mark"></a>
### `mesh.mark`

**Mark surface on the part** · read-only  
MCP tool `mesh_mark`

Mark a region on the part, as the window, brush and lasso do — in place of whatever is marked — with the tool that is to work on it in hand: delete (orange, the default), flip (amber), smooth or offset (a marked region, blue or violet). Then look at it (view.render) and run that tool with region: "marked", or let the person at the screen put the marking right first. Not a step of the history. Needs the viewport. Returns how many vertices are marked.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `region` | "marked" \| { box, sphere, vertices, skin, facing, angleDeg } | ✓ | The surface to mark. |
| `region.box` | object |  | The vertices inside an axis-aligned box, its sides included. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.box.min` | number[3] | ✓ | The low corner, mm. |
| `region.box.max` | number[3] | ✓ | The high corner, mm. |
| `region.sphere` | object |  | The vertices within a radius of a point. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.sphere.center` | number[3] | ✓ | The centre, mm. |
| `region.sphere.radius` | number | ✓ | mm. (*> 0*) |
| `region.vertices` | integer[] |  | The vertices by number — the edited copy’s while there is one, else the scan’s. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *at least 1 item*) |
| `region.skin` | object |  | One skin of a bent sheet: the surface grown from a point on it across its bends, as long as it bends no tighter than minRadius, and no further — a sheet’s edge is a corner, so the other skin is never reached. What mesh.flatten wants, which a box round a bent part cannot name. Not with facing. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.skin.at` | number[3] | ✓ | A point on the skin, mm — the middle of a flange, not near its edge; the vertex nearest it is where the skin grows from. |
| `region.skin.minRadius` | number |  | The tightest bend the skin is followed round, mm — 0.6 to start: pick the outer skin, whose bends are the inside radius and the thickness, and lower it for a tight bend on the inner one. (*> 0*) |
| `region.skin.thickness` | number |  | The sheet’s thickness, mm — with it, a vertex facing against the skin and behind it within 1.5 times this is the far skin, kept out where an edge was scanned soft. (*> 0*) |
| `region.facing` | number[3] |  | Of those, only the vertices whose normal points within angleDeg of this direction — [0, 0, 1] for the faces looking up. Narrows a box to one face of the part. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.angleDeg` | number |  | How far a normal may turn from facing and still face it, degrees — 30 to start. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *> 0*, *≤ 180*) |
| `for` | "delete" \| "flip" \| "smooth" \| "offset" |  | The tool the marking is for. |

<a id="mesh_merge"></a>
### `mesh.merge`

**Merge the other scan into the mesh** · change — one undo step  
MCP tool `mesh_merge` — adds `wait`, `timings`

Add the other scan, as placed (mesh.merge_place), to the mesh: its triangles carried into the mesh’s frame. dropDoubled (true to start) leaves out its triangles that only scan again what the mesh has — every corner within the placement’s gate — so the shared band is not there twice; what is left meets the mesh along a seam, which mesh.fill_holes closes, or mesh.wrap makes one skin of the two. Lets the other scan go once merged. Edits the copy. One undo step. Returns the edit (triangles added and left out) and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `dropDoubled` | boolean |  | Leave out what only scans the mesh again — true to start. |

<a id="mesh_merge_clear"></a>
### `mesh.merge_clear`

**Let the other scan go** · change — one undo step  
MCP tool `mesh_merge_clear` — adds `wait`, `timings`

Close the other scan opened to merge (mesh.merge_open), without merging it. Changes nothing on the mesh.

*No input.*

<a id="mesh_merge_open"></a>
### `mesh.merge_open`

**Open another scan to merge** · change — one undo step  
MCP tool `mesh_merge_open` — takes `path` in place of `bytes` — adds `wait`, `timings`

Open another scan of the same part — its other side, scanned on its own — beside the mesh, to be placed on it (mesh.merge_place) and merged into it (mesh.merge). STL, PLY, OBJ or 3MF. Opening another lets the last one go. Changes nothing on the mesh. Returns its size.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `bytes` | bytes | ✓ | The file’s contents. |
| `name` | string | ✓ | The file's name with its extension — "bracket underside.ply". |
| `units` | "mm" \| "cm" \| "m" \| "in" |  | The file’s units: mm (the default), cm, m or in. Everything is measured in mm once read. |

<a id="mesh_merge_place"></a>
### `mesh.merge_place`

**Place the other scan on the mesh** · change — one undo step  
MCP tool `mesh_merge_place` — adds `wait`, `timings`

Place the other scan (mesh.merge_open) on the mesh where the two share surface — fitted on that overlap alone, so a scan that shares only a band round the middle places as well as one that shares most. With no pairs, by itself: its file’s own frame first, then a search for the shape the two have in common. With three or more pairs of the same place on each (on the other scan as its file has it, and on the mesh, mm), from them. Shown in orange. Returns the placement: source (frame, auto or points); overlap, the share of the other scan lying on the mesh, 0–1; rms over it, mm; gate, mm, how close a point must lie to count as on the mesh, and what mesh.merge leaves out within; ambiguous, another placement fitted nearly as well — look at it, or give pairs. A search that finds nothing fitting closely says so: give pairs then. Changes nothing on the mesh.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `pairs` | object[] |  | Three or more places on both, spread over the part (not along a line). (*at least 3 items*) |
| `pairs[].other` | number[3] | ✓ | On the other scan, in its file’s coordinates, mm. |
| `pairs[].mesh` | number[3] | ✓ | The same place on the mesh, mm. |

<a id="mesh_mirror"></a>
### `mesh.mirror`

**Mirror the mesh** · change — one undo step  
MCP tool `mesh_mirror` — adds `wait`, `timings`

Reflect the mesh across a plane. mode whole (to start) reflects all of it — the left-hand version of a right-hand part. symmetric keeps the side keep names (plus to start) and reflects it onto the other side, which it replaces — a symmetric part scanned well on one side only, or damaged on one side; the halves join along the plane, so a closed part stays closed, and faces lying in the plane (the cap of an earlier cut there) are dropped. A part wholly on the kept side gets its mirror image beside it. offset left out puts the plane through the middle of the part. Edits the copy. One undo step. Returns the edit and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `plane` | string \| integer | ✓ | What to mirror across: a coordinate plane — after a datum alignment, the datum’s — or an element with a direction (a plane’s normal, a cylinder’s, cone’s or line’s axis, a circle’s normal). |
| `offset` | number |  | Where the plane lies, mm: for a coordinate plane its coordinate along the axis square to it (X for YZ); for an element, how far along its direction from it. Left out: through the middle of the part. |
| `mode` | "whole" \| "symmetric" |  | whole (to start): the whole part reflected. symmetric: the side kept reflected onto the other. |
| `keep` | "plus" \| "minus" |  | For symmetric, the side kept: plus the side the plane’s direction points to — +X of YZ, +Y of XZ, above XY, along an element’s direction — minus the other. |

<a id="mesh_offset"></a>
### `mesh.offset`

**Shrink or expand** · change — one undo step  
MCP tool `mesh_offset` — adds `wait`, `timings`

Move the surface along its normal by distance: expand (the part grows) or shrink. Not a scale — a 20 mm ball expanded 0.5 mm is 21 mm across and a bore comes out a millimetre narrower; for the thickness a scanning spray laid on, a clearance, a print that came out fat. Faces end the distance from where they were and edges stay sharp. With region only that surface moves, as a step: its rim slides along a face that runs along the move, or a wall joins it to the surface. Edits the copy. One undo step. Returns the edit and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `direction` | "expand" \| "shrink" | ✓ | expand or shrink. |
| `distance` | number | ✓ | How far, mm. (*> 0*) |
| `region` | "marked" \| { box, sphere, vertices, skin, facing, angleDeg } |  | Move only this surface; absent, the whole mesh. |
| `region.box` | object |  | The vertices inside an axis-aligned box, its sides included. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.box.min` | number[3] | ✓ | The low corner, mm. |
| `region.box.max` | number[3] | ✓ | The high corner, mm. |
| `region.sphere` | object |  | The vertices within a radius of a point. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.sphere.center` | number[3] | ✓ | The centre, mm. |
| `region.sphere.radius` | number | ✓ | mm. (*> 0*) |
| `region.vertices` | integer[] |  | The vertices by number — the edited copy’s while there is one, else the scan’s. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *at least 1 item*) |
| `region.skin` | object |  | One skin of a bent sheet: the surface grown from a point on it across its bends, as long as it bends no tighter than minRadius, and no further — a sheet’s edge is a corner, so the other skin is never reached. What mesh.flatten wants, which a box round a bent part cannot name. Not with facing. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.skin.at` | number[3] | ✓ | A point on the skin, mm — the middle of a flange, not near its edge; the vertex nearest it is where the skin grows from. |
| `region.skin.minRadius` | number |  | The tightest bend the skin is followed round, mm — 0.6 to start: pick the outer skin, whose bends are the inside radius and the thickness, and lower it for a tight bend on the inner one. (*> 0*) |
| `region.skin.thickness` | number |  | The sheet’s thickness, mm — with it, a vertex facing against the skin and behind it within 1.5 times this is the far skin, kept out where an edge was scanned soft. (*> 0*) |
| `region.facing` | number[3] |  | Of those, only the vertices whose normal points within angleDeg of this direction — [0, 0, 1] for the faces looking up. Narrows a box to one face of the part. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.angleDeg` | number |  | How far a normal may turn from facing and still face it, degrees — 30 to start. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *> 0*, *≤ 180*) |

<a id="mesh_parts"></a>
### `mesh.parts`

**List the parts** · read-only  
MCP tool `mesh_parts`

What is in the Mesh Tools workspace: the scan (its edits taken into use), the edited copy the tools work on and the edits waiting on it, the reduced mesh and the piece Trim to scan made with their figures, the solids on offer to mesh.boolean and mesh.trim by key and name, and what the parts list shows. Changes nothing.

*No input.*

<a id="mesh_pattern_points"></a>
### `mesh.pattern_points`

**Place points on the flat pattern** · read-only  
MCP tool `mesh_pattern_points`

Points of the sheet mesh.flatten laid out last, placed on its pattern: where each lies there, [u, v] mm in the pattern’s own frame (as mesh.export_pattern draws it, its low corner the origin), from the vertices of the region nearest it — or null for a point further than 2 mm from the sheet. With off, how far each stood off it, mm. For lines to draw on the blank — a bend’s centre line, read off its round in 3D, a hole’s centre — where they fall once it is flat. A pattern unrolled by a cylinder or cone is laid out by the element instead, and is refused.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `points` | number[3][] | ✓ | The points, in the frame the part is measured in now. (*1–2000 items*) |

<a id="mesh_reduce"></a>
### `mesh.reduce`

**Reduce the mesh** · change — one undo step  
MCP tool `mesh_reduce` — adds `wait`, `timings`

Reduce the mesh the workspace works on to a light one for CAD, held within tolerance of it — 99.9 % of each side within it, measured both ways, not trusted — and never more than maxTriangles (when the tolerance needs more, it is reduced to the limit and says how far it then strays). Made where the part stands: align it first if it should land in CAD on its datums, and take islands off first. Defaults are the panel’s: a tolerance sized to the part (0.05 mm a hand’s width across), 50,000 triangles. The reduced mesh is made beside the scan, not an edit of it — a preview: reduce again with other figures and it starts over from the mesh as it stands. mesh.export { part: "reduced" } writes it; mesh.apply_reduced makes it the edited copy. Returns its figures.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `tolerance` | number |  | How far the reduced mesh may stray from the scan, either side, mm. (*> 0*) |
| `maxTriangles` | integer |  | Never more triangles than this — what the CAD system takes. (*≥ 4*) |

<a id="mesh_remove_islands"></a>
### `mesh.remove_islands`

**Remove islands** · change — one undo step  
MCP tool `mesh_remove_islands` — adds `wait`, `timings`

Delete every connected piece of the mesh smaller across than size — the specks floating off a scan, a patch of the turntable — keeping every larger piece (a ball bar’s two balls and its rod all stay). size defaults to the panel’s, which starts at a hundredth of the part’s size; mesh.inspect counts the islands at a size first. Edits the copy (made by the first edit; every other workspace measures the scan until mesh.use_edited). One undo step. Returns the edit, the worker’s report and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `size` | number |  | A piece smaller than this across — its bounding box — is an island, mm. (*> 0*) |

<a id="mesh_shell"></a>
### `mesh.shell`

**Hollow or thicken** · change — one undo step  
MCP tool `mesh_shell` — adds `wait`, `timings`

A closed part is hollowed: its outside stays as scanned and an inner wall thickness in from it seals a cavity (where the part is thinner than twice the wall it stays solid). An open surface — one side of a part, a sheet — is thickened into a solid: a second skin thickness from it, side in (the scanned surface stays the outside), out or both, and a wall round every rim. A part closed but for holes smaller than the Fill holes size is refused: fill them (mesh.fill_holes) to hollow it, or pass mode: "thicken" to thicken it as it is. thickness defaults to the panel’s, a 125th of the part’s diagonal to start. Edits the copy. One undo step. Returns the edit and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `thickness` | number |  | The wall a hollow leaves, or the thickness a surface is given, mm. (*> 0*) |
| `side` | "in" \| "out" \| "both" |  | For a surface: which way the wall grows from it — in to start. |
| `mode` | "hollow" \| "thicken" |  | What to do; absent, what the mesh calls for. |

<a id="mesh_show"></a>
### `mesh.show`

**Show or hide parts** · read-only  
MCP tool `mesh_show`

Say what the viewport shows, as the parts list’s eyes do — for a view.render picture of it. Puts Mesh Tools on screen (from whatever workspace was) and the tool in hand away, so the list says what is shown: view.render then pictures these parts — the scan or its edited copy, the reduced mesh, the piece, the lent bodies see-through — and not another workspace’s view, until workspace.set puts that one back (the answer’s back says which). The scan and the reduced mesh lie on one surface and are shown one at a time: showing one hides the other. bodies are the bodies other workspaces lend, by key or name, drawn see-through — the list given is all that is shown. deviation colours the edited copy by its signed distance from the scan in use. Not a step of the history. Returns what is shown, workspace (mesh), and when it changed the screen, back: the workspace it took the place of.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `scan` | boolean |  | The scan — the edited copy in its place, while there is one. |
| `reduced` | boolean |  | The reduced mesh. |
| `piece` | boolean |  | The piece Trim to scan made. |
| `bodies` | string[] |  | The bodies to show, by key or name; [] for none. |
| `deviation` | boolean |  | Colour the edited copy by how far it is from the scan in use, grey where an edit made surface the scan never had. |

<a id="mesh_smooth"></a>
### `mesh.smooth`

**Smooth the mesh** · change — one undo step  
MCP tool `mesh_smooth` — adds `wait`, `timings`

Smooth a scan’s scatter out: each point moved along its normal onto a surface fitted to the scan around it over a patch size across — bumps smaller than size go, the shape larger than it (faces, bores, fillets) stays. No point moves further than limit. keepEdges fits each side of an edge sharper than 30° on its own and leaves the edge as scanned (on to start). With region only that surface moves, fading out to its edge. Sizes default to the panel’s, sized to the part. Edits the copy. One undo step. Returns the edit (how far it moved the surface) and the mesh after it.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `size` | number |  | Bumps smaller than this across are smoothed out, mm. (*> 0*) |
| `limit` | number |  | No point moves further than this, mm. (*> 0*) |
| `keepEdges` | boolean |  | Keep sharp edges as scanned. |
| `region` | "marked" \| { box, sphere, vertices, skin, facing, angleDeg } |  | Smooth only this surface; absent, the whole mesh. |
| `region.box` | object |  | The vertices inside an axis-aligned box, its sides included. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.box.min` | number[3] | ✓ | The low corner, mm. |
| `region.box.max` | number[3] | ✓ | The high corner, mm. |
| `region.sphere` | object |  | The vertices within a radius of a point. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.sphere.center` | number[3] | ✓ | The centre, mm. |
| `region.sphere.radius` | number | ✓ | mm. (*> 0*) |
| `region.vertices` | integer[] |  | The vertices by number — the edited copy’s while there is one, else the scan’s. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *at least 1 item*) |
| `region.skin` | object |  | One skin of a bent sheet: the surface grown from a point on it across its bends, as long as it bends no tighter than minRadius, and no further — a sheet’s edge is a corner, so the other skin is never reached. What mesh.flatten wants, which a box round a bent part cannot name. Not with facing. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.skin.at` | number[3] | ✓ | A point on the skin, mm — the middle of a flange, not near its edge; the vertex nearest it is where the skin grows from. |
| `region.skin.minRadius` | number |  | The tightest bend the skin is followed round, mm — 0.6 to start: pick the outer skin, whose bends are the inside radius and the thickness, and lower it for a tight bend on the inner one. (*> 0*) |
| `region.skin.thickness` | number |  | The sheet’s thickness, mm — with it, a vertex facing against the skin and behind it within 1.5 times this is the far skin, kept out where an edge was scanned soft. (*> 0*) |
| `region.facing` | number[3] |  | Of those, only the vertices whose normal points within angleDeg of this direction — [0, 0, 1] for the faces looking up. Narrows a box to one face of the part. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.angleDeg` | number |  | How far a normal may turn from facing and still face it, degrees — 30 to start. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *> 0*, *≤ 180*) |

<a id="mesh_trim"></a>
### `mesh.trim`

**Trim a body to the scan** · change — one undo step  
MCP tool `mesh_trim` — adds `wait`, `timings`

Mend a broken part: cut a body — the missing piece modelled in the Reverse engineer workspace to the part’s nominal shape and a few millimetres too long at the break — with the scanned fracture, to print and glue in. The break is where the scan lies deeper in the body than depth (0.3 mm to start; the part’s own skins dip in only by the scatter and the difference in size); region names it instead (or "marked", as the person put it right on screen). offset sets the mating face back from the break (0 cuts on it, a tenth or two leaves room for glue); flip keeps the other side. The piece is made beside the scan, not an edit of it; mesh.export { part: "piece" } writes it. Returns the piece: its volume, mating face, and how far that face is from the part.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `body` | string | ✓ | The body, by key or name (mesh.parts lists them). |
| `offset` | number |  | How far the mating face sits back from the break, mm. (*≥ 0*) |
| `depth` | number |  | How much deeper in the body than its surface the scan must lie to be break, mm. (*> 0*) |
| `flip` | boolean |  | Keep what is on the other side of the break. |
| `region` | "marked" \| { box, sphere, vertices, skin, facing, angleDeg } |  | The break; absent, the break as found. |
| `region.box` | object |  | The vertices inside an axis-aligned box, its sides included. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.box.min` | number[3] | ✓ | The low corner, mm. |
| `region.box.max` | number[3] | ✓ | The high corner, mm. |
| `region.sphere` | object |  | The vertices within a radius of a point. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.sphere.center` | number[3] | ✓ | The centre, mm. |
| `region.sphere.radius` | number | ✓ | mm. (*> 0*) |
| `region.vertices` | integer[] |  | The vertices by number — the edited copy’s while there is one, else the scan’s. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *at least 1 item*) |
| `region.skin` | object |  | One skin of a bent sheet: the surface grown from a point on it across its bends, as long as it bends no tighter than minRadius, and no further — a sheet’s edge is a corner, so the other skin is never reached. What mesh.flatten wants, which a box round a bent part cannot name. Not with facing. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.skin.at` | number[3] | ✓ | A point on the skin, mm — the middle of a flange, not near its edge; the vertex nearest it is where the skin grows from. |
| `region.skin.minRadius` | number |  | The tightest bend the skin is followed round, mm — 0.6 to start: pick the outer skin, whose bends are the inside radius and the thickness, and lower it for a tight bend on the inner one. (*> 0*) |
| `region.skin.thickness` | number |  | The sheet’s thickness, mm — with it, a vertex facing against the skin and behind it within 1.5 times this is the far skin, kept out where an edge was scanned soft. (*> 0*) |
| `region.facing` | number[3] |  | Of those, only the vertices whose normal points within angleDeg of this direction — [0, 0, 1] for the faces looking up. Narrows a box to one face of the part. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.angleDeg` | number |  | How far a normal may turn from facing and still face it, degrees — 30 to start. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *> 0*, *≤ 180*) |

<a id="mesh_unroll"></a>
### `mesh.unroll`

**Unroll a cylinder or cone** · change — one undo step  
MCP tool `mesh_unroll` — adds `wait`, `timings`

A flat pattern of the scan on a cylinder or cone, laid out by the element fitted to it: the arc round the axis becomes x and the height along it y, so an outline and the holes in it come out true to size; a cone unrolls to its sector about its apex. Each point is taken at the fitted surface — the scatter does not stretch the pattern — and offset lays out a surface that far outside it (inside, negative): half the thickness, for a sheet’s neutral fibre. A region wrapping right round the axis is cut along a seam at the widest gap in it, or between two columns of vertices round a closed tube. Without region, the scan within band of the surface (four times the fit’s scatter, at least 0.2 mm) with its normal within 30° of the surface’s, either way; with one, that region. Only the largest connected piece is laid out. Made beside the scan, not an edit of it, and shown in the Mesh Tools panel (Unroll/flatten); mesh.export_pattern writes it as a DXF or an SVG. Returns the pattern’s size (width, height, area, perimeter, mm; the holes with their centres and sizes; x and y on the pattern, its low corner the origin), how far the region lies off the surface (residual: RMS and most), the arc covered and where the seam was cut, degrees, a cone’s sector (its angle, its apex on the pattern, the radii), and the stretch laying it out took (distortion, per cent — near zero when the region is the surface, more where it takes in something that is not).

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `element` | string \| integer | ✓ | A fitted cylinder or cone. |
| `region` | "marked" \| { box, sphere, vertices, skin, facing, angleDeg } |  | The surface to unroll; absent, the scan lying on the element. |
| `region.box` | object |  | The vertices inside an axis-aligned box, its sides included. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.box.min` | number[3] | ✓ | The low corner, mm. |
| `region.box.max` | number[3] | ✓ | The high corner, mm. |
| `region.sphere` | object |  | The vertices within a radius of a point. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.sphere.center` | number[3] | ✓ | The centre, mm. |
| `region.sphere.radius` | number | ✓ | mm. (*> 0*) |
| `region.vertices` | integer[] |  | The vertices by number — the edited copy’s while there is one, else the scan’s. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *at least 1 item*) |
| `region.skin` | object |  | One skin of a bent sheet: the surface grown from a point on it across its bends, as long as it bends no tighter than minRadius, and no further — a sheet’s edge is a corner, so the other skin is never reached. What mesh.flatten wants, which a box round a bent part cannot name. Not with facing. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.skin.at` | number[3] | ✓ | A point on the skin, mm — the middle of a flange, not near its edge; the vertex nearest it is where the skin grows from. |
| `region.skin.minRadius` | number |  | The tightest bend the skin is followed round, mm — 0.6 to start: pick the outer skin, whose bends are the inside radius and the thickness, and lower it for a tight bend on the inner one. (*> 0*) |
| `region.skin.thickness` | number |  | The sheet’s thickness, mm — with it, a vertex facing against the skin and behind it within 1.5 times this is the far skin, kept out where an edge was scanned soft. (*> 0*) |
| `region.facing` | number[3] |  | Of those, only the vertices whose normal points within angleDeg of this direction — [0, 0, 1] for the faces looking up. Narrows a box to one face of the part. (form 2: { box, sphere, vertices, skin, facing, angleDeg }) |
| `region.angleDeg` | number |  | How far a normal may turn from facing and still face it, degrees — 30 to start. (form 2: { box, sphere, vertices, skin, facing, angleDeg }, *> 0*, *≤ 180*) |
| `band` | number |  | How far off the element’s surface the scan may lie and be taken, mm — without a region only. (*> 0*) |
| `offset` | number |  | Lay out the surface this far outside the fitted one, mm; inside when negative. |

<a id="mesh_use_edited"></a>
### `mesh.use_edited`

**Use the edited mesh for analysis** · change — one undo step  
MCP tool `mesh_use_edited` — adds `wait`, `timings`

Take the edited copy into use: it becomes the scan every workspace measures, loaded in place of it under everything measured on it — the elements fitted again on it, the sections cut again, the maps and a reduction measured again. The edits move to the scan’s list; the next edit makes a new copy. One undo step, which goes back to the scan before. Returns the scan in use.

*No input.*

<a id="mesh_wrap"></a>
### `mesh.wrap`

**Wrap the mesh** · change — one undo step  
MCP tool `mesh_wrap` — adds `wait`, `timings`

One closed skin round the mesh the workspace works on — the edited copy, or the scan — for a mesh that is a mess inside: an assembly exported as one file, channels and bosses inside a casting, overlapping or flipped shells, a scan with cracks. Any triangles do: only the distance to them is used. A ball of diameter gap is rolled round the mesh from outside; the wrap lies on the part where the ball touched it (its vertices moved onto the part’s triangles) and bridges every opening narrower than gap — a groove narrower than it is closed over too, so keep it small. Everything inside is dropped, internal shells and cavities made solid. grow (0 to start, at most gap) stands the wrap off the part all round: an open sheet wraps to nothing at 0, and to a slab 2 × grow thick. edges: sharp (to start) rebuilds the part’s sharp edges and corners where the wrap lies on the part (sharpEdges and sharpCorners say how many points it put back; a grown wrap’s edges are rounds), smooth leaves them rounded by the grid, a sixth of the gap. tolerance: how far the wrap’s reduction may stray, mm — a sixteenth of the grid’s cell to start. Made beside the mesh, not an edit — a preview: mesh.apply_wrap makes it the edited copy, or preview: false applies it at once, one undo step. Returns the wrap: shells, triangles (and fromTriangles), dropped (input triangles inside it), bridgedArea (mm², where it bridges rather than lies on the part), volumeBefore (null when the mesh is open) and volume (mm³), cell (the grid, mm; coarsened when the part’s size made it coarser than a sixth of the gap, and fullGap the smallest gap it closes as exactly then), and stages (ms each).

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `gap` | number | ✓ | Openings narrower than this are bridged, mm. (*> 0*) |
| `grow` | number |  | How far the wrap stands off the part, mm: 0 to start, at most gap. (*≥ 0*) |
| `edges` | "sharp" \| "smooth" |  | sharp (to start) or smooth. |
| `tolerance` | number |  | How far the wrap’s reduction may stray from it, mm. (*> 0*) |
| `preview` | boolean |  | false applies the wrap at once as the edited copy; true (to start) leaves it a preview for mesh.apply_wrap. |
