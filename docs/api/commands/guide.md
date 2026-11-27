<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# `guide.*` commands

1 command, from the app, Banana Scan 0.11.2. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).

- [`guide.read`](#guide_read) — Read a guide

<a id="guide_read"></a>
### `guide.read`

**Read a guide** · read-only · runs headless  
MCP tool `guide_read`

How to do a task with Banana Scan: the workflow, the judgement and the traps the tools’ own descriptions do not carry, written for this build — read the guide for your task, whole, before its first step, and a section again when you need it. The guides: flat-patterns — a flat pattern of a scanned surface as a DXF or SVG: a cylinder or cone unrolled by its fitted element, or a bent sheet flattened to its blank with the distortion read — which skin, the neutral fibre, judging the result, the files (read with measure, first); measure — measuring a 3D scan: fitting elements, dimensions and GD&T-like checks, sections and the 2D sheet, deviation against a reference part, wall thickness, the report — by hand or as an automatic run over many scans; measure-reference — the measuring tools’ shapes with examples, what each answer costs, what each refusal means — a section at a time, as the measure guide sends you; model — designing or editing a solid part feature by feature — sketches, extrudes, revolves, lofts, booleans, rounds, parameters, STEP — from given numbers, a drawing or a description, with or without a scan; how the session, notes, batches and jobs work for a modeller, the kernel’s habits and the checks before a handover; model-reference — every tool’s shape with an example, the feature kinds with their fields, constraints and picks, plane frames, what answers cost, what refusals mean — a section at a time, as the model and scan-to-cad guides send you; scan-to-cad — reverse engineering a 3D scan (STL, PLY, OBJ, 3MF) into a parametric CAD solid and STEP: reading the scan, its tolerance and datums, measuring it for the model, building from it by the part’s archetype, validating against it both ways, the report (read with model, first). topic: a guide, or several read in order (a guide and the ones it is read with, in one call) — as many as fit in about 60 k characters, the rest named in next, to read in the next call. A guide longer than that by itself answers its sections in order while they fit, and names the rest in sectionsLeft, each to read by section. A guide’s sections for one moment of the task — measuring, building — are not in the whole read: later names each with when to read it, and the note says how; read it by section when that moment comes, before the step it is for. section: one section of one guide, by its heading — the index lists them, with when to read those a whole read leaves for later. A long section with ### parts under it — a reference’s list of command shapes — is best read by those parts: section takes a ### heading too, the one part you need. With no topic, the index: each guide with its sections and what each costs in tokens. Changes nothing.

| Field | Type | Req. | Description |
|---|---|:-:|---|
| `topic` | string \| string[] |  | A guide by its id, or several to read in order — as many as fit in one answer, the rest named in next. Leave it out for the index. |
| `section` | string |  | One section of the guide, by its heading — a ## section or a ### part of one (without its number, or a part of it that names one section), whole: a section the whole read named in later, when its moment comes, or one to read again. Only with one topic. |
