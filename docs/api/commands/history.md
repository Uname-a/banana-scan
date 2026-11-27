<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `history.*` commands

4 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`history.checkpoint`](#history_checkpoint) — Mark the history
- [`history.redo`](#history_redo) — Redo
- [`history.restore`](#history_restore) — Back to a mark in the history
- [`history.undo`](#history_undo) — Undo

<a id="history_checkpoint"></a>
### `history.checkpoint`

**Mark the history** · read-only · runs headless  
MCP tool `history_checkpoint`

Mark where the undo history stands, before a run of changes that should stand or fall together: history.restore { checkpoint } later undoes every step made since, back to this mark. Changes nothing. Returns the checkpoint, the step on top and how many there are.

*No input.*

<a id="history_redo"></a>
### `history.redo`

**Redo** · change — one undo step · runs headless  
MCP tool `history_redo` — adds `wait`, `timings`

Redo the step undone last. Returns the step’s name and the session afterwards in brief (detail "full": the whole of it).

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `detail` | "brief" \| "full" |  | brief (the default): what the steps change, in brief, as after; full: the whole session, as state. |

<a id="history_restore"></a>
### `history.restore`

**Back to a mark in the history** · change — one undo step · runs headless  
MCP tool `history_restore` — adds `wait`, `timings`

Undo every step made since history.checkpoint gave this checkpoint, newest first — a run of changes that went wrong in the middle taken back whole. Refused, undoing nothing, when the mark is gone: undone past it, or the history started afresh (a scan or project opened). Returns the steps undone, newest first, and the session afterwards.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `checkpoint` | string | ✓ | What history.checkpoint returned. |
| `detail` | "brief" \| "full" |  | brief (the default): what the steps change, in brief, as after; full: the whole session, as state. |

<a id="history_undo"></a>
### `history.undo`

**Undo** · change — one undo step · runs headless  
MCP tool `history_undo` — adds `wait`, `timings`

Undo the last step — one of the person’s or one of these commands, each of which is one step. Returns the step’s name and the session afterwards in brief (detail "full": the whole of it).

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `detail` | "brief" \| "full" |  | brief (the default): what the steps change, in brief, as after; full: the whole session, as state. |
