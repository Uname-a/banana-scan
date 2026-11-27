<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `project.*` commands

3 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`project.load`](#project_load) — Open a project
- [`project.rename`](#project_rename) — Name the project
- [`project.save`](#project_save) — Save the project

<a id="project_load"></a>
### `project.load`

**Open a project** · change — one undo step  
MCP tool `project_load` — takes `path` in place of `bytes` — adds `saveTo`, `wait`, `timings`

Open a .bananascan project in place of the session — its models, then every measurement in it, remeasured, each fit as it was saved. Refuses while the session holds measurements unless discard is true. Needs the browser. Returns the session, with a warning naming any fitted element whose surface was not found again (its saved fit stands). Not undoable: an opened project starts a new history.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `bytes` | bytes | ✓ | The project file’s contents. |
| `name` | string |  | Its name, for the status line. |
| `discard` | boolean |  | true: replace the session though it holds measurements (lost unless saved as a project first). Refused otherwise when there is work to lose. |

<a id="project_rename"></a>
### `project.rename`

**Name the project** · change — one undo step  
MCP tool `project_rename` — adds `wait`, `timings`

Give the project a name — what Save Project saves it under, the stem of every export and the browser tab’s title, kept in the project file. An empty name takes it off, and the scan’s or the image’s name stands in again. session.state reads it as project.name.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `name` | string | ✓ | The name; empty takes it off. |

<a id="project_save"></a>
### `project.save`

**Save the project** · read-only · returns a file  
MCP tool `project_save` — adds `path`

The session as a .bananascan project file, as Save Project downloads it: the scan, the reference, the image and every measurement, each rebuilt when it is opened. Needs the browser. Returns the file’s bytes and its name, holds (what is in it, counted — read it before calling the file a revision: a page reset holds no model), aligned (whether the scan stands in an aligned frame) and says (what a workspace wants said of the work saved).

*No input.*
