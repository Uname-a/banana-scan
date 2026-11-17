<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Flat patterns: unrolling and flattening a scan

Guiding principle: **a flat pattern is only as true as the surface it was laid out from — say what it rests on, and how far the layout had to stretch it.**

Two ways to lay a scanned surface out flat, both in the Mesh Tools workspace, both made beside the scan (never an edit of it, never a step of the history):

- **Unroll** (`mesh_unroll`) — a cylinder or a cone, by the element fitted to it. Exact by construction: the arc round the axis becomes x, the height along it y; a cone becomes its sector about the apex. For a tube, a pipe, a rolled shell, a cone's flat blank, a label or a pattern of holes round a bore.
- **Flatten** (`mesh_flatten`) — any sheet that was bent from flat, or nearly: a bent bracket, a formed panel, a duct. Solved for the least distortion; the answer says how much stretch was left.

Both write their pattern with `mesh_export_pattern` as a DXF or an SVG, in millimetres.

## 1. Before laying out

- **Read the measure guide's setup first** (`guide_read { topic: "measure" }`): the scan open, its bounds read from `session_state`, the part aligned if the pattern's frame matters.
- **One skin, not two.** A sheet scanned from both sides has an outer and an inner skin a thickness apart. Lay out one. For sheet metal the blank is cut to the neutral fibre, about half the thickness in from either skin: unroll with `offset` −t/2 from the outer skin (or +t/2 from the inner); a flattening has no offset — lay out the skin on the inside of the bends for the shortest blank, the outside for the longest, and say which.
- **Clean first.** Islands, spikes and folds the scanner left stretch a flattening; `mesh_inspect`, then `mesh_remove_islands` and `mesh_smooth` as the measure guide says. Small holes are fine — they are holes in the pattern too.

## 2. Unroll a cylinder or cone

1. Fit the element: `element_fit { kind: "cylinder", at: … }` (or `"cone"`) in the middle of the surface, as for any fit. Read its radius, `coverage` and form error; a fit over less than about 90° of arc has an uncertain axis, which bends the pattern.
2. `mesh_unroll { element }`. Without `region` it takes the scan lying on the element: within `band` of it (four times the fit's scatter, at least 0.2 mm) and facing off it — a flange or an end face is left out. Name a `region` (a box, a sphere, vertices, or `"marked"`) to take only part of it, or more of it than the band does.
3. Read the answer:
   - `pattern` — `width` (the arc), `height` (along the axis), `area`, `perimeter`, and each hole's `center`, `width` and `height` on the pattern. The origin is the pattern's low corner.
   - `residual` — how far the region lies off the fitted surface. It should be the fit's scatter; much more means the region took in something that is not the surface.
   - `distortion` — near zero for an unroll of the surface itself; a few per cent means the region is not on the element.
   - `coverage` and `seam` — how much of the turn the region covers, and where it was cut. A closed tube (`coverage` 360) is cut along a seam between two columns of its vertices, and the pattern's two side edges are that seam; its width is the circumference.
   - A cone: `sector` — the sector's `angle` in degrees, its `apex` on the pattern, and its `innerRadius` and `outerRadius`. The sector opens upward, its middle on the pattern's vertical centre line.
4. `offset` lays out a surface that far outside the fitted one (inside, negative), at the radius plus the offset — the neutral fibre. `radius` in the answer is the radius the arc was measured at.

## 3. Flatten a bent sheet

1. Name the sheet: `mesh_flatten { region }` with a box round the part and `facing` to keep one skin (`{ box, facing: [0, 0, 1], angleDeg: 80 }` keeps what faces up, not what faces down), or `"marked"` for what the person marked. Only the largest connected piece is laid out; `leftOut` counts the rest.
2. Read `distortion`, per cent:
   - `lengthPercent` — a length on the pattern against the same length on the scan, in the direction each triangle changed most: `max`, `mean` and `p95` over the surface, by area.
   - `areaPercent` — the same for area; `totalAreaPercent` for the whole pattern.
   - `flipped` — triangles turned over: the pattern overlaps itself. Anything but 0 and the pattern is wrong — the region is not a sheet (a closed tube, both skins, a fold the scanner made).
3. Judge it: a sheet bent from flat reads a mean of a fraction of a per cent, the max a little more where the scan is rough. A dished, drawn or stretched part — which no flat blank makes exactly — reads several per cent; say so, and that the blank is an estimate. A closed tube or a band right round a part cannot be flattened without cutting it: unroll it by its cylinder instead.
4. The pattern is turned so the smallest rectangle round it lies along x and y, its long side along x. A flattening says nothing about where the bend lines were; read those off the 3D part (sections across the bends) if they are needed.

## 4. The files

- `mesh_export_pattern { format: "dxf" }` — the outline and holes as closed LWPOLYLINEs on the `edges` layer, in millimetres, y up, thinned to within 0.01 mm. `format: "svg"` — the same at one unit a millimetre, y down, every point kept.
- The pattern is seen from outside the part (the side the scan's normals face), never mirrored: cut it as drawn for a part seen from outside.
- A pattern lasts until another is made or the scan changes; export it before moving on.

## 5. Reporting

Say, with the numbers: the element or region laid out and which skin; the offset, and why; the pattern's size and holes; the residual (unroll) or the distortion (flatten), and what it means for the blank's accuracy. A flat pattern's sizes are no truer than the scan's scale and the fit under it.

## Red flags

- `flipped` above 0, or `lengthPercent.max` in the tens: the region is not one sheet.
- An unroll's `residual.max` many times the fit's scatter: the region reaches past the surface — name a region, or narrow the `band`.
- `leftOut` large: the region is in pieces; the pattern is of the largest only.
- A pattern far wider than the part's circumference: the element's radius or axis is wrong — check the fit.
