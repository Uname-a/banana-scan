<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts -->
# Command reference

Every command of Banana Scan 0.11.2 with the plugins in this repository: 164 in all, 70 read-only. An MCP tool's name is the command's with dots as underscores (`element.fit` → `element_fit`). How commands are called, and what answers and refusals look like: [the API overview](../README.md).

Kinds: **R** read-only, **C** a change (one undo step), **P** returns a picture, **F** returns a file, **L** long (an MCP server runs it as a job), **H** runs headless.

| Namespace | From | Commands |
|---|---|--:|
| [`align`](align.md) | the app | 4 |
| [`deviation`](deviation.md) | the app | 8 |
| [`dimension`](dimension.md) | the app | 4 |
| [`element`](element.md) | the app | 7 |
| [`export`](export.md) | the app | 6 |
| [`flat`](flat.md) | the app | 15 |
| [`guide`](guide.md) | the app | 1 |
| [`history`](history.md) | the app | 4 |
| [`mesh`](mesh.md) | the [`mesh-tools`](../../../plugins/mesh-tools/) plugin | 32 |
| [`project`](project.md) | the app | 3 |
| [`report`](report.md) | the app | 1 |
| [`reverse`](reverse.md) | the [`reverse`](../../../plugins/reverse/) plugin | 55 |
| [`scan`](scan.md) | the app | 13 |
| [`section`](section.md) | the app | 3 |
| [`session`](session.md) | the app | 3 |
| [`thickness`](thickness.md) | the app | 2 |
| [`view`](view.md) | the app | 2 |
| [`workspace`](workspace.md) | the app | 1 |

## [`align`](align.md)

| Command | Title | Kind |
|---|---|---|
| [`align.auto`](align.md#align_auto) | Auto-align the part | C |
| [`align.clear`](align.md#align_clear) | Reset the alignment | C |
| [`align.datum`](align.md#align_datum) | Align the part to datums | C |
| [`align.symmetry`](align.md#align_symmetry) | Align the part on its symmetry plane | C |

## [`deviation`](deviation.md)

| Command | Title | Kind |
|---|---|---|
| [`deviation.align`](deviation.md#deviation_align) | Best-fit the scan onto the reference | C |
| [`deviation.export`](deviation.md#deviation_export) | Export the deviation as data | R F |
| [`deviation.hotspots`](deviation.md#deviation_hotspots) | Where the deviation lies over tolerance | R |
| [`deviation.measure`](deviation.md#deviation_measure) | Measure the deviation map | C |
| [`deviation.open_reference`](deviation.md#deviation_open_reference) | Open the reference part | C |
| [`deviation.set_target`](deviation.md#deviation_set_target) | Measure against an element | C |
| [`deviation.settings`](deviation.md#deviation_settings) | Set how the deviation is read | C |
| [`deviation.volume`](deviation.md#deviation_volume) | Volume error | R L |

## [`dimension`](dimension.md)

| Command | Title | Kind |
|---|---|---|
| [`dimension.add`](dimension.md#dimension_add) | Add a dimension | C |
| [`dimension.remove`](dimension.md#dimension_remove) | Delete a dimension | C |
| [`dimension.set_basic`](dimension.md#dimension_set_basic) | Set an angularity’s basic angle | C |
| [`dimension.set_limit`](dimension.md#dimension_set_limit) | Set a dimension’s limit | C |

## [`element`](element.md)

| Command | Title | Kind |
|---|---|---|
| [`element.construct`](element.md#element_construct) | Construct an element | C |
| [`element.fit`](element.md#element_fit) | Fit an element | C |
| [`element.fit_marked`](element.md#element_fit_marked) | Fit an element to a marked surface | C |
| [`element.remove`](element.md#element_remove) | Delete an element | C |
| [`element.rename`](element.md#element_rename) | Rename an element | C |
| [`element.set_visible`](element.md#element_set_visible) | Show or hide elements | C |
| [`element.unlink`](element.md#element_unlink) | Unlink a construction from its sources | C |

## [`export`](export.md)

| Command | Title | Kind |
|---|---|---|
| [`export.cloud`](export.md#export_cloud) | Export the scan as a point cloud | R F |
| [`export.csv`](export.md#export_csv) | Export the 2D measurements as CSV | R F |
| [`export.dxf`](export.md#export_dxf) | Export the 2D sheet as DXF | R F |
| [`export.step`](export.md#export_step) | Export the elements as STEP | R F |
| [`export.stl`](export.md#export_stl) | Export the scan as a mesh | R F |
| [`export.svg`](export.md#export_svg) | Export the 2D sheet as SVG | R F |

## [`flat`](flat.md)

| Command | Title | Kind |
|---|---|---|
| [`flat.calibrate`](flat.md#flat_calibrate) | Calibrate the image | C |
| [`flat.curvature`](flat.md#flat_curvature) | Read how an edge bends | R |
| [`flat.detect_edges`](flat.md#flat_detect_edges) | Detect the image’s edges | C |
| [`flat.dimension_add`](flat.md#flat_dimension_add) | Add a 2D dimension | C |
| [`flat.edges`](flat.md#flat_edges) | List the detected edges | R |
| [`flat.edit`](flat.md#flat_edit) | Change a 2D element, dimension, note or count | C |
| [`flat.fit`](flat.md#flat_fit) | Fit a 2D element | C |
| [`flat.note_add`](flat.md#flat_note_add) | Write a note on the sheet | C |
| [`flat.objects`](flat.md#flat_objects) | Find the parts on the image | R |
| [`flat.open_image`](flat.md#flat_open_image) | Open a flatbed image | C |
| [`flat.profile`](flat.md#flat_profile) | Profile an outline and count its peaks | C |
| [`flat.remove`](flat.md#flat_remove) | Remove from the 2D sheet | C |
| [`flat.render`](flat.md#flat_render) | Picture the sheet | R P |
| [`flat.report`](flat.md#flat_report) | Get the 2D report | R |
| [`flat.set_alignment`](flat.md#flat_set_alignment) | Align the sheet | C |

## [`guide`](guide.md)

| Command | Title | Kind |
|---|---|---|
| [`guide.read`](guide.md#guide_read) | Read a guide | R H |

## [`history`](history.md)

| Command | Title | Kind |
|---|---|---|
| [`history.checkpoint`](history.md#history_checkpoint) | Mark the history | R H |
| [`history.redo`](history.md#history_redo) | Redo | C H |
| [`history.restore`](history.md#history_restore) | Back to a mark in the history | C H |
| [`history.undo`](history.md#history_undo) | Undo | C H |

## [`mesh`](mesh.md)

| Command | Title | Kind |
|---|---|---|
| [`mesh.apply_reduced`](mesh.md#mesh_apply_reduced) | Apply the reduced mesh | C |
| [`mesh.apply_wrap`](mesh.md#mesh_apply_wrap) | Apply the wrap | C |
| [`mesh.boolean`](mesh.md#mesh_boolean) | Boolean with solids | C |
| [`mesh.cut`](mesh.md#mesh_cut) | Cut the mesh | C |
| [`mesh.cut_preview`](mesh.md#mesh_cut_preview) | Preview a cut | R |
| [`mesh.delete_marked`](mesh.md#mesh_delete_marked) | Delete surface | C |
| [`mesh.densify`](mesh.md#mesh_densify) | Densify the mesh | C |
| [`mesh.discard_edited`](mesh.md#mesh_discard_edited) | Discard the edits | C |
| [`mesh.export`](mesh.md#mesh_export) | Export a part as a mesh | R F |
| [`mesh.export_pattern`](mesh.md#mesh_export_pattern) | Export the flat pattern | R F |
| [`mesh.fill_holes`](mesh.md#mesh_fill_holes) | Fill holes | C |
| [`mesh.flatten`](mesh.md#mesh_flatten) | Flatten a curved sheet | C |
| [`mesh.flip_normals`](mesh.md#mesh_flip_normals) | Flip normals | C |
| [`mesh.inspect`](mesh.md#mesh_inspect) | Inspect the mesh | R L |
| [`mesh.mark`](mesh.md#mesh_mark) | Mark surface on the part | R |
| [`mesh.merge`](mesh.md#mesh_merge) | Merge the other scan into the mesh | C |
| [`mesh.merge_clear`](mesh.md#mesh_merge_clear) | Let the other scan go | C |
| [`mesh.merge_open`](mesh.md#mesh_merge_open) | Open another scan to merge | C |
| [`mesh.merge_place`](mesh.md#mesh_merge_place) | Place the other scan on the mesh | C |
| [`mesh.mirror`](mesh.md#mesh_mirror) | Mirror the mesh | C |
| [`mesh.offset`](mesh.md#mesh_offset) | Shrink or expand | C |
| [`mesh.parts`](mesh.md#mesh_parts) | List the parts | R |
| [`mesh.pattern_points`](mesh.md#mesh_pattern_points) | Place points on the flat pattern | R |
| [`mesh.reduce`](mesh.md#mesh_reduce) | Reduce the mesh | C |
| [`mesh.remove_islands`](mesh.md#mesh_remove_islands) | Remove islands | C |
| [`mesh.shell`](mesh.md#mesh_shell) | Hollow or thicken | C |
| [`mesh.show`](mesh.md#mesh_show) | Show or hide parts | R |
| [`mesh.smooth`](mesh.md#mesh_smooth) | Smooth the mesh | C |
| [`mesh.trim`](mesh.md#mesh_trim) | Trim a body to the scan | C |
| [`mesh.unroll`](mesh.md#mesh_unroll) | Unroll a cylinder or cone | C |
| [`mesh.use_edited`](mesh.md#mesh_use_edited) | Use the edited mesh for analysis | C |
| [`mesh.wrap`](mesh.md#mesh_wrap) | Wrap the mesh | C |

## [`project`](project.md)

| Command | Title | Kind |
|---|---|---|
| [`project.load`](project.md#project_load) | Open a project | C |
| [`project.rename`](project.md#project_rename) | Name the project | C |
| [`project.save`](project.md#project_save) | Save the project | R F |

## [`report`](report.md)

| Command | Title | Kind |
|---|---|---|
| [`report.get`](report.md#report_get) | Get the report | R |

## [`reverse`](reverse.md)

| Command | Title | Kind |
|---|---|---|
| [`reverse.body.check`](reverse.md#reverse_body_check) | Check a body | R L H |
| [`reverse.body.clearance`](reverse.md#reverse_body_clearance) | How bodies stand to each other | R |
| [`reverse.body.compare`](reverse.md#reverse_body_compare) | Compare the bodies with the scan | R P L |
| [`reverse.body.compare_in_deviation`](reverse.md#reverse_body_compare_in_deviation) | Compare in Deviation | C |
| [`reverse.body.describe`](reverse.md#reverse_body_describe) | Describe a body | R H |
| [`reverse.body.fillet_read`](reverse.md#reverse_body_fillet_read) | Read rounds off the scan | R |
| [`reverse.body.fillet_try`](reverse.md#reverse_body_fillet_try) | Try a round at other sizes | R L H |
| [`reverse.body.probe`](reverse.md#reverse_body_probe) | Measure on the bodies | R H |
| [`reverse.body.review`](reverse.md#reverse_body_review) | Review the model against the scan | R P L |
| [`reverse.body.section`](reverse.md#reverse_body_section) | Cut the bodies at a plane | R H |
| [`reverse.body.set`](reverse.md#reverse_body_set) | Name, colour, show or hide a body | C |
| [`reverse.body.volume_compare`](reverse.md#reverse_body_volume_compare) | Volume error of the bodies | R L |
| [`reverse.build`](reverse.md#reverse_build) | Build the bodies | R H |
| [`reverse.build.stop`](reverse.md#reverse_build_stop) | Stop the build | C |
| [`reverse.export.step`](reverse.md#reverse_export_step) | Export the bodies as STEP | R F L H |
| [`reverse.export.stl`](reverse.md#reverse_export_stl) | Export the bodies as a mesh | R F L H |
| [`reverse.feature.add`](reverse.md#reverse_feature_add) | Add a feature | C H |
| [`reverse.feature.clear`](reverse.md#reverse_feature_clear) | Remove every feature | C H |
| [`reverse.feature.list`](reverse.md#reverse_feature_list) | List the features | R H |
| [`reverse.feature.move`](reverse.md#reverse_feature_move) | Move features in the list | C H |
| [`reverse.feature.refit`](reverse.md#reverse_feature_refit) | Fit a feature’s numbers again | C |
| [`reverse.feature.remove`](reverse.md#reverse_feature_remove) | Remove a feature | C H |
| [`reverse.feature.rollback`](reverse.md#reverse_feature_rollback) | Move the rollback bar | C H |
| [`reverse.feature.schema`](reverse.md#reverse_feature_schema) | The fields of a kind of feature | R H |
| [`reverse.feature.suppress`](reverse.md#reverse_feature_suppress) | Suppress features | C H |
| [`reverse.feature.update`](reverse.md#reverse_feature_update) | Edit a feature | C H |
| [`reverse.freeform.body`](reverse.md#reverse_freeform_body) | Make a freeform solid over a region of the scan | C |
| [`reverse.import.step`](reverse.md#reverse_import_step) | Import a STEP file | C H |
| [`reverse.network.auto`](reverse.md#reverse_network_auto) | Lay out a patch network by itself | C |
| [`reverse.network.create`](reverse.md#reverse_network_create) | Make a patch network | C |
| [`reverse.network.edit`](reverse.md#reverse_network_edit) | Edit a patch network | C |
| [`reverse.network.read`](reverse.md#reverse_network_read) | Read a patch network | R |
| [`reverse.network.suggest_creases`](reverse.md#reverse_network_suggest_creases) | Suggest creases for a patch network | R L |
| [`reverse.note.add`](reverse.md#reverse_note_add) | Pin a question on the part | C H |
| [`reverse.note.list`](reverse.md#reverse_note_list) | Read the notes on the part | R H |
| [`reverse.note.resolve`](reverse.md#reverse_note_resolve) | Answer a note on the part | C H |
| [`reverse.parameter.add`](reverse.md#reverse_parameter_add) | Add a parameter | C H |
| [`reverse.parameter.list`](reverse.md#reverse_parameter_list) | List the parameters | R H |
| [`reverse.parameter.remove`](reverse.md#reverse_parameter_remove) | Remove a parameter | C H |
| [`reverse.parameter.rename`](reverse.md#reverse_parameter_rename) | Rename a parameter | C H |
| [`reverse.parameter.set`](reverse.md#reverse_parameter_set) | Set a parameter | C H |
| [`reverse.plan.replace`](reverse.md#reverse_plan_replace) | Say what took a removed feature’s place | C H |
| [`reverse.plan.set`](reverse.md#reverse_plan_set) | Set the plan for the part | C H |
| [`reverse.plan.tick`](reverse.md#reverse_plan_tick) | Tick a region of the plan off | C H |
| [`reverse.plan.update`](reverse.md#reverse_plan_update) | Change one region of the plan | C H |
| [`reverse.plane.along_path`](reverse.md#reverse_plane_along_path) | Planes along a path | C |
| [`reverse.plane.describe`](reverse.md#reverse_plane_describe) | Describe a plane | R H |
| [`reverse.scan.tube_trace`](reverse.md#reverse_scan_tube_trace) | Read a bent tube’s centreline from the scan | R L |
| [`reverse.section.fit`](reverse.md#reverse_section_fit) | Fit lines and arcs to a section | R |
| [`reverse.section.outline`](reverse.md#reverse_section_outline) | A section’s chain as a polyline | R |
| [`reverse.section.stack`](reverse.md#reverse_section_stack) | Slice the scan at several heights | R |
| [`reverse.sketch.candidates`](reverse.md#reverse_sketch_candidates) | What a sketch’s pieces nearly are | R |
| [`reverse.sketch.edit`](reverse.md#reverse_sketch_edit) | Edit a sketch piece by piece | C H |
| [`reverse.sketch.wrap_read`](reverse.md#reverse_sketch_wrap_read) | Read where a wrapped sketch lands | R L |
| [`reverse.thread.read`](reverse.md#reverse_thread_read) | Read a thread off the scan | R |

## [`scan`](scan.md)

| Command | Title | Kind |
|---|---|---|
| [`scan.curvature`](scan.md#scan_curvature) | Curvature shading | R L |
| [`scan.draft`](scan.md#scan_draft) | Read the draft against a pull | R |
| [`scan.fit_surface`](scan.md#scan_fit_surface) | Fit a sloped or curved patch | R |
| [`scan.gear`](scan.md#scan_gear) | Read the gears round an axis | R L |
| [`scan.heightmap`](scan.md#scan_heightmap) | Map the scan’s heights | R P |
| [`scan.nearest`](scan.md#scan_nearest) | Find a place on the scan | R |
| [`scan.open`](scan.md#scan_open) | Open a scan | C |
| [`scan.outline`](scan.md#scan_outline) | Read the scan’s outline | R |
| [`scan.pattern`](scan.md#scan_pattern) | Count the repeats round an axis | R |
| [`scan.qa`](scan.md#scan_qa) | Check the scan before modelling | R L |
| [`scan.query`](scan.md#scan_query) | Read the scan’s points | R |
| [`scan.scale`](scan.md#scan_scale) | Scale the scan | C |
| [`scan.segment`](scan.md#scan_segment) | Find the scan’s flat regions | R |

## [`section`](section.md)

| Command | Title | Kind |
|---|---|---|
| [`section.cut`](section.md#section_cut) | Cut a section | C |
| [`section.get`](section.md#section_get) | Read a section’s polylines | R |
| [`section.render`](section.md#section_render) | Picture a section | R P |

## [`session`](session.md)

| Command | Title | Kind |
|---|---|---|
| [`session.recent`](session.md#session_recent) | What recent jobs did | R |
| [`session.reset`](session.md#session_reset) | Start over | C |
| [`session.state`](session.md#session_state) | Read the session | R H |

## [`thickness`](thickness.md)

| Command | Title | Kind |
|---|---|---|
| [`thickness.measure`](thickness.md#thickness_measure) | Measure the wall thickness | C |
| [`thickness.settings`](thickness.md#thickness_settings) | Set how the wall thickness is searched and read | C |

## [`view`](view.md)

| Command | Title | Kind |
|---|---|---|
| [`view.render`](view.md#view_render) | Picture the view | R P |
| [`view.set`](view.md#view_set) | Turn the view | R |

## [`workspace`](workspace.md)

| Command | Title | Kind |
|---|---|---|
| [`workspace.set`](workspace.md#workspace_set) | Show a workspace | C |

## Guides

What `guide.read` serves an agent before a task — the workflow and judgement the tools do not carry, written for this build. `guide.read` with no topic lists them; with `topic` and `section` it gives a part.

| Topic | Title | For | Read with |
|---|---|---|---|
| `flat-patterns` | Flat patterns: unrolling and flattening a scan | a flat pattern of a scanned surface as a DXF or SVG: a cylinder or cone unrolled by its fitted element, or a bent sheet flattened to its blank with the distortion read — which skin, the neutral fibre, judging the result, the files | `measure` |
| `measure` | Measuring a 3D scan | measuring a 3D scan: fitting elements, dimensions and GD&T-like checks, sections and the 2D sheet, deviation against a reference part, wall thickness, the report — by hand or as an automatic run over many scans |  |
| `measure-reference` | Measuring a 3D scan — reference | the measuring tools’ shapes with examples, what each answer costs, what each refusal means — a section at a time, as the measure guide sends you |  |
| `model` | Modelling a part in the Reverse engineer | designing or editing a solid part feature by feature — sketches, extrudes, revolves, lofts, booleans, rounds, parameters, STEP — from given numbers, a drawing or a description, with or without a scan; how the session, notes, batches and jobs work for a modeller, the kernel’s habits and the checks before a handover |  |
| `model-reference` | Modelling and scan reverse engineering — reference | every tool’s shape with an example, the feature kinds with their fields, constraints and picks, plane frames, what answers cost, what refusals mean — a section at a time, as the model and scan-to-cad guides send you |  |
| `scan-to-cad` | Scan → CAD reverse engineering | reverse engineering a 3D scan (STL, PLY, OBJ, 3MF) into a parametric CAD solid and STEP: reading the scan, its tolerance and datums, measuring it for the model, building from it by the part’s archetype, validating against it both ways, the report | `model` |
