<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `dimension.*` commands

4 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`dimension.add`](#dimension_add) — Add a dimension
- [`dimension.remove`](#dimension_remove) — Delete a dimension
- [`dimension.set_basic`](#dimension_set_basic) — Set an angularity’s basic angle
- [`dimension.set_limit`](#dimension_set_limit) — Set a dimension’s limit

<a id="dimension_add"></a>
### `dimension.add`

**Add a dimension** · change — one undo step  
MCP tool `dimension_add` — adds `wait`, `timings`

Measure between elements, or a size or tolerance of one, as the panel’s dimension box does. refs are the elements by id or name, in slot order (a section counts as the plane it was cut on). Without type, the type follows the elements as clicking them does — two planes their distance, a plane and an axis theirs, and so on; with type, one of dist-point-point, dist-point-axis, dist-point-plane, dist-axis-axis, dist-axis-plane, dist-plane-plane, angle-axis-axis, angle-axis-plane, angle-plane-plane, size-diameter, form-flatness, form-cylindricity, form-circularity, form-sphericity, orient-parallelism, orient-perpendicularity, orient-angularity, loc-coaxiality (the measure-reference guide lists each one’s slots). anchor, for two spheres: center (default), gap or span; limit holds the value to a ceiling or a nominal ± band. Returns the dimension with its value (mm or degrees, finer than the panel shows), the formatted value and the verdict. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `refs` | (integer \| string)[] | ✓ | The elements, in slot order. (*1–3 items*) |
| `type` | string |  | The dimension type — see the description. |
| `anchor` | "center" \| "gap" \| "span" |  | Two spheres: centre to centre (the default), the gap between them, or the span across them. |
| `limit` | { kind, max } \| { kind, nominal, plus, minus } |  | What the value is checked against, for a pass or fail verdict. |
| `limit.kind` | "max" | ✓ | A ceiling. (form 1: { kind, max }) |
| `limit.max` | number | ✓ | The most the value may be, mm or degrees. (form 1: { kind, max }) |
| `limit.kind` | "band" | ✓ | A nominal with an allowance either side. (form 2: { kind, nominal, plus, minus }) |
| `limit.nominal` | number | ✓ | The nominal value, mm or degrees. (form 2: { kind, nominal, plus, minus }) |
| `limit.plus` | number | ✓ | Allowed above it. (form 2: { kind, nominal, plus, minus }, *≥ 0*) |
| `limit.minus` | number | ✓ | Allowed below it (positive). (form 2: { kind, nominal, plus, minus }, *≥ 0*) |
| `basic` | number |  | An angularity’s basic angle, degrees. |
| `name` | string |  | A name; otherwise numbered — "Distance 2". |

<a id="dimension_remove"></a>
### `dimension.remove`

**Delete a dimension** · change — one undo step  
MCP tool `dimension_remove` — adds `wait`, `timings`

Delete a dimension or tolerance. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `dimension` | integer \| string | ✓ | The dimension. |

<a id="dimension_set_basic"></a>
### `dimension.set_basic`

**Set an angularity’s basic angle** · change — one undo step  
MCP tool `dimension_set_basic` — adds `wait`, `timings`

The basic angle an angularity tolerance is read against, in degrees, or null to take it off. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `dimension` | integer \| string | ✓ | The angularity. |
| `basic` | number \| null | ✓ | The basic angle. |

<a id="dimension_set_limit"></a>
### `dimension.set_limit`

**Set a dimension’s limit** · change — one undo step  
MCP tool `dimension_set_limit` — adds `wait`, `timings`

Hold a dimension to a limit — a ceiling, or a nominal ± band — or take it off with null. Returns the dimension with its verdict. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `dimension` | integer \| string | ✓ | The dimension. |
| `limit` | { kind, max } \| { kind, nominal, plus, minus } \| null | ✓ | The limit, or null for none. |
