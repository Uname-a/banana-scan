<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `thickness.*` commands

2 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`thickness.measure`](#thickness_measure) — Measure the wall thickness
- [`thickness.settings`](#thickness_settings) — Set how the wall thickness is searched and read

<a id="thickness_measure"></a>
### `thickness.measure`

**Measure the wall thickness** · change — one undo step  
MCP tool `thickness_measure` — adds `wait`, `timings`

Measure the wall thickness at every point of the scan, as the Wall Thickness workspace’s Measure button does, with the search settings given or those in hand. Returns the statistics (min, max, mean, sigma, share under the thin-wall limit, points measured) and the settings. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `method` | "ray" \| "sphere" |  | ray: along the inward normal to the far wall (the shortest of a cone with coneRays). sphere: the largest sphere that fits at the point. |
| `maxThickness` | number |  | The thickest wall searched for, mm. (*> 0*) |
| `coneRays` | integer |  | ray: rays in the cone about the normal; 0 for the normal alone. (*≥ 0*, *≤ 256*) |
| `coneAngleDeg` | number |  | ray: the cone’s half-angle, degrees. (*≥ 0*, *≤ 89*) |
| `normalDeviationDeg` | number \| null |  | How far the far wall may turn from facing back, degrees, or null for any. |

<a id="thickness_settings"></a>
### `thickness.settings`

**Set how the wall thickness is searched and read** · change — one undo step  
MCP tool `thickness_settings` — adds `wait`, `timings`

The search settings (method, maxThickness, coneRays, coneAngleDeg, normalDeviationDeg — they take effect at the next thickness.measure) and the reading: low and high, the ends of the colour scale, mm; bands, a stepped scale or null; limit, the thin-wall limit the statistics count under, mm. Returns the thickness state. One undo step.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `method` | "ray" \| "sphere" |  | ray: along the inward normal to the far wall (the shortest of a cone with coneRays). sphere: the largest sphere that fits at the point. |
| `maxThickness` | number |  | The thickest wall searched for, mm. (*> 0*) |
| `coneRays` | integer |  | ray: rays in the cone about the normal; 0 for the normal alone. (*≥ 0*, *≤ 256*) |
| `coneAngleDeg` | number |  | ray: the cone’s half-angle, degrees. (*≥ 0*, *≤ 89*) |
| `normalDeviationDeg` | number \| null |  | How far the far wall may turn from facing back, degrees, or null for any. |
| `low` | number |  | Colour scale’s low end, mm. (*≥ 0*) |
| `high` | number |  | Colour scale’s high end, mm. (*> 0*) |
| `bands` | integer \| null |  | Stepped colours, or null. |
| `limit` | number |  | Thin-wall limit, mm. (*> 0*) |
