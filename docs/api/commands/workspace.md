<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `workspace.*` commands

1 command, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`workspace.set`](#workspace_set) — Show a workspace

<a id="workspace_set"></a>
### `workspace.set`

**Show a workspace** · change — one undo step  
MCP tool `workspace_set` — adds `wait`, `timings`

Put a workspace on screen: measure (fitting elements and dimensions), deviation (scan against a reference part or an element), thickness (wall thickness), flat (2D measuring of an image or a section), or a plugin’s by its id — session.state lists them under app.plugins. Commands put their own workspace on screen; this is for showing the person something.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `workspace` | string | ✓ | The workspace — measure, deviation, thickness, flat, or a plugin’s id. |
