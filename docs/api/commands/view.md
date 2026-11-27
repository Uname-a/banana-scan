<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `view.*` commands

2 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`view.render`](#view_render) — Picture the view
- [`view.set`](#view_set) — Turn the view

<a id="view_render"></a>
### `view.render`

**Picture the view** · read-only · returns a picture · returns a file  
MCP tool `view_render` — adds `path`, `inline`

A picture of the 3D view as a PNG — what the viewport shows, without the HTML labels (dimension values, names). view and/or fit turn the view first, as view.set does; frame frames a box or a place (mmAcross says what the picture spans). Trap: only fit: true fits — a view alone keeps the zoom, and a frame stays for the pictures after it (fitted and framedEarlier say so). show puts keys on screen or away for the picture alone ({ scan: false } pictures what was built on the scan); a key that has to be read, a workspace’s map, is waited for up to 35 s, and the answer says how far it got if not; section cuts it open for the picture alone. 800 px on the long side by default, up to 2048; views: two to six standard views in one picture. In the Deviation workspace the answer says which map is painted (map) or why none (mapWhy; mapNote when the reference ghost dulls the colours); empty says why a picture has nothing in it. Waits for the session to settle. Needs the viewport.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `width` | integer |  | Pixels across, 64 to 2048. (*≥ 64*, *≤ 2048*) |
| `height` | integer |  | Pixels down, 64 to 2048. (*≥ 64*, *≤ 2048*) |
| `view` | "iso" \| "iso-front-left" \| "iso-rear-left" \| "iso-rear-right" \| "top" \| "bottom" \| "front" \| "rear" \| "left" \| "right" |  | A standard view: iso (front, right, above) and the other iso corners, top (down Z, Y up), bottom, front (from −Y, Z up), rear, left (from −X), right. |
| `views` | ("iso" \| "iso-front-left" \| "iso-rear-left" \| "iso-rear-right" \| "top" \| "bottom" \| "front" \| "rear" \| "left" \| "right")[] |  | Several standard views in one picture, each fitted. (*2–6 items*) |
| `fit` | boolean |  | Fit everything shown into the frame, keeping the direction. |
| `show` | object |  | Keys to show (true) or put away (false): scan, reference, sections, elements (with dimensions), labels, comb (the curvature comb), curvature (curvature shading, in Measure), map (the deviation map, in Deviation and in Reverse engineer), and a workspace’s own (view.set lists every key standing now). |
| `show.scan` | boolean |  |  |
| `show.reference` | boolean |  |  |
| `show.sections` | boolean |  |  |
| `show.elements` | boolean |  |  |
| `show.labels` | boolean |  |  |
| `show.comb` | boolean |  |  |
| `show.curvature` | boolean |  |  |
| `show.map` | boolean |  |  |
| `frame` | { min, max } \| { at, size } \| { world } |  | Frame a box or a place instead of everything shown; the direction stays, fit is left alone. |
| `frame.min` | number[3] | ✓ | Lowest corner, mm. (form 1: { min, max }) |
| `frame.max` | number[3] | ✓ | Highest corner, mm. (form 1: { min, max }) |
| `frame.at` | number[3] | ✓ | The centre, mm. (form 2: { at, size }) |
| `frame.size` | number | ✓ | The side of the square fitted in the picture’s shorter side, mm. (form 2: { at, size }, *> 0*) |
| `frame.world` | object | ✓ | (form 3: { world }) |
| `frame.world.min` | number[3] | ✓ | Lowest corner, mm. |
| `frame.world.max` | number[3] | ✓ | Highest corner, mm. |
| `section` | boolean \| { across, offset, flip } |  | The section view: cut open at a plane, the near half taken away, closed parts capped. Set after any turn. |
| `section.across` | integer \| string | ✓ | "XY", "YZ", "XZ", or an element with a direction. (form 2: { across, offset, flip }) |
| `section.offset` | number |  | Along its normal, mm: a coordinate plane’s coordinate, or from an element’s centre. (form 2: { across, offset, flip }) |
| `section.flip` | boolean |  | Take away the far half instead. (form 2: { across, offset, flip }) |

<a id="view_set"></a>
### `view.set`

**Turn the view** · read-only  
MCP tool `view_set`

Turn the 3D view to a standard view and/or fit everything shown — with neither, it fits — or frame a box or a place; the zoom a frame leaves stays for what comes after. show puts keys on screen or away and leaves them so; section cuts everything open at a plane and leaves it so. Waits for the session to settle first. Not a step of the history. Needs the viewport. Returns view, fitted, framed, framedEarlier, mmAcross ([width, height] mm), section (null when off) and shown: every key and whether it is, with <key>Why for a workspace key that is off.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `view` | "iso" \| "iso-front-left" \| "iso-rear-left" \| "iso-rear-right" \| "top" \| "bottom" \| "front" \| "rear" \| "left" \| "right" |  | A standard view: iso (front, right, above) and the other iso corners, top (down Z, Y up), bottom, front (from −Y, Z up), rear, left (from −X), right. |
| `fit` | boolean |  | Fit everything shown into the frame, keeping the direction. |
| `show` | object |  | Keys to show (true) or put away (false): scan, reference, sections, elements (with dimensions), labels, comb (the curvature comb), curvature (curvature shading, in Measure), map (the deviation map, in Deviation and in Reverse engineer), and a workspace’s own (view.set lists every key standing now). |
| `show.scan` | boolean |  |  |
| `show.reference` | boolean |  |  |
| `show.sections` | boolean |  |  |
| `show.elements` | boolean |  |  |
| `show.labels` | boolean |  |  |
| `show.comb` | boolean |  |  |
| `show.curvature` | boolean |  |  |
| `show.map` | boolean |  |  |
| `frame` | { min, max } \| { at, size } \| { world } |  | Frame a box or a place instead of everything shown; the direction stays, fit is left alone. |
| `frame.min` | number[3] | ✓ | Lowest corner, mm. (form 1: { min, max }) |
| `frame.max` | number[3] | ✓ | Highest corner, mm. (form 1: { min, max }) |
| `frame.at` | number[3] | ✓ | The centre, mm. (form 2: { at, size }) |
| `frame.size` | number | ✓ | The side of the square fitted in the picture’s shorter side, mm. (form 2: { at, size }, *> 0*) |
| `frame.world` | object | ✓ | (form 3: { world }) |
| `frame.world.min` | number[3] | ✓ | Lowest corner, mm. |
| `frame.world.max` | number[3] | ✓ | Highest corner, mm. |
| `section` | boolean \| { across, offset, flip } |  | The section view: cut open at a plane, the near half taken away, closed parts capped. Set after any turn. |
| `section.across` | integer \| string | ✓ | "XY", "YZ", "XZ", or an element with a direction. (form 2: { across, offset, flip }) |
| `section.offset` | number |  | Along its normal, mm: a coordinate plane’s coordinate, or from an element’s centre. (form 2: { across, offset, flip }) |
| `section.flip` | boolean |  | Take away the far half instead. (form 2: { across, offset, flip }) |
