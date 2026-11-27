<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `report.*` commands

1 command, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`report.get`](#report_get) — Get the report

<a id="report_get"></a>
### `report.get`

**Get the report** · read-only  
MCP tool `report_get`

The measurement report. format "text" is word for word what the workspace’s Copy report button gives — measure (elements and dimensions with verdicts), deviation, thickness or flat (2D). format "json" (the default) is the whole session’s report structured: what the numbers rest on (units, scale, frame, alignment, fit method, outlier cut-offs), every element with its fit, every dimension with value, unit, limit and verdict, the tally of checks, the sections, and the deviation, thickness and 2D results with their settings.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `format` | "json" \| "text" |  | json (the default) or text. |
| `workspace` | "measure" \| "deviation" \| "thickness" \| "flat" |  | For text: whose report — measure (the default), deviation, thickness or flat. |
