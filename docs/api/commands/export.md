<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `export.*` commands

6 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`export.cloud`](#export_cloud) — Export the scan as a point cloud
- [`export.csv`](#export_csv) — Export the 2D measurements as CSV
- [`export.dxf`](#export_dxf) — Export the 2D sheet as DXF
- [`export.step`](#export_step) — Export the elements as STEP
- [`export.stl`](#export_stl) — Export the scan as a mesh
- [`export.svg`](#export_svg) — Export the 2D sheet as SVG

<a id="export_cloud"></a>
### `export.cloud`

**Export the scan as a point cloud** · read-only · returns a file  
MCP tool `export_cloud` — adds `path`

Every scan vertex with its normal, in the pose it is shown in, as a binary PLY (the default) or an XYZ text file. Needs the viewport. Returns the file’s bytes and the name the panel would save it under.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `format` | "ply" \| "xyz" |  | ply or xyz. |

<a id="export_csv"></a>
### `export.csv`

**Export the 2D measurements as CSV** · read-only · returns a file  
MCP tool `export_csv` — adds `path`

The 2D Measure elements and dimensions as CSV, for a spreadsheet. Returns the file’s bytes and the name the panel would save it under.

*No input.*

<a id="export_dxf"></a>
### `export.dxf`

**Export the 2D sheet as DXF** · read-only · returns a file  
MCP tool `export_dxf` — adds `path`

The 2D sheet as DXF for CAD — millimetres, y up, the origin on the sheet’s alignment, the edges thinned to a sketch’s worth. Needs the browser. Returns the file’s bytes and the name the panel would save it under.

*No input.*

<a id="export_step"></a>
### `export.step`

**Export the elements as STEP** · read-only · returns a file  
MCP tool `export_step` — adds `path`

The measured elements as analytic STEP geometry for CAD — as drawn, extensions and assumed diameters included — and, in a group per section, what was measured on the sections. style: solids (the default: solids and faces) or surfaces (construction surfaces), remembered as the panel’s choice. Returns the file’s bytes and the name the panel would save it under.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `style` | "solids" \| "surfaces" |  | solids or surfaces. |

<a id="export_stl"></a>
### `export.stl`

**Export the scan as a mesh** · read-only · returns a file  
MCP tool `export_stl` — adds `path`

The scan as a binary STL — or, format 3mf, a 3MF in millimetres with the scan’s own colours — in the pose it is shown in, a datum alignment and a best fit onto the reference included. Needs the viewport. Returns the file’s bytes and the name the panel would save it under.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `format` | "stl" \| "3mf" |  | stl (the default) or 3mf. |

<a id="export_svg"></a>
### `export.svg`

**Export the 2D sheet as SVG** · read-only · returns a file  
MCP tool `export_svg` — adds `path`

The 2D sheet at true scale as SVG — the shown edges and the visible elements, aligned and turned as shown — for a vector editor, a laser or a 1:1 print. Needs the browser. Returns the file’s bytes and the name the panel would save it under.

*No input.*
