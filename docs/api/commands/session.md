<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `session.*` commands

3 commands, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`session.recent`](#session_recent) — What recent jobs did
- [`session.reset`](#session_reset) — Start over
- [`session.state`](#session_state) — Read the session

<a id="session_recent"></a>
### `session.recent`

**What recent jobs did** · read-only  
MCP tool `session_recent`

What became of the commands an agent’s server ran under its jobs — each change and each batch is one, and the server names it — newest first: the job, the command, running, done or failed, when it started and its ms, and its result or its error { code, message }. A result past 16,000 characters is left out (resultOmitted says its size). The page keeps the last 100 for as long as it stays open, so a server started after the one that asked can still say what a job did. job: only that job’s.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `job` | string |  | Only this job’s commands, as the server named it. |
| `limit` | integer |  | How many at most, newest first — 20 by default. (*≥ 1*, *≤ 100*) |

<a id="session_reset"></a>
### `session.reset`

**Start over** · change — one undo step  
MCP tool `session_reset` — adds `saveTo`, `wait`, `timings`

Close the scan, the reference part and the 2D image, and with them every measurement and the project’s name, as opening an empty project does. Refuses while the session holds measurements unless discard is true. Not undoable: the history starts over too.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `discard` | boolean |  | true: replace the session though it holds measurements (lost unless saved as a project first). Refused otherwise when there is work to lose. |

<a id="session_state"></a>
### `session.state`

**Read the session** · read-only · runs headless  
MCP tool `session_state`

The whole session as JSON: the app and its plugins, the project (name, unsaved, holds), the workspace on screen, busy, the scan (file, units, counts, bounding box, centre, size, alignment), every element with its fit, every dimension with value, limit and verdict, the sections, what is open in the panels, the deviation, wall thickness and 2D state with their statistics, the guided hint, the undo history and ui.units. Trap: the screen may show inches; every answer here is in millimetres, angles in degrees. Read it before acting and after.

*No input.*
