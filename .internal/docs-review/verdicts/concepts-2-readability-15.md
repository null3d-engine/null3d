# concepts-2-readability-15

## The finding as given

- Page: concepts/render-graph
- Anchor: ## The engine's passes, lines 68-80; also 93, 114, 142, 144, 158, 162
- Category: long-paragraph. Severity: medium.
- Claim: The page has 13 long paragraphs. Under one heading, line 76 (211 words) defines views, culling per path, scene passes, createView viewports, the WebGPU row flip and a reflection exception. Line 78 (175 words) covers sketch full-screen and compute passes. Line 80 (131 words) covers final against resolve. None can be scanned or linked.
- Evidence: stats.json lines 30, 61, 63, 67, 69, 71, 73, 86, 107, 135, 137, 151, 155.
- Proposed edit: Add H2 'Views' and make line 76 a list. Move the row flip and reflection_uv into `<details><summary>Technical details: image rows on WebGPU and WebGL2</summary>`. Make line 78 a table 'Pass a sketch adds | Runs | A material that shows it sees'. Make line 80 a two-row table (HDR path, 8-bit path with MSAA). Move the 'so far' rule in 74 into a technical details block. Split 142 into temporary targets and kept targets.

Verdict: partly

## Evidence

- stats.json line numbers count from after the front matter, so page line = stats line + 7. The finding maps them correctly (stats 69 = page 76, 71 = 78, 73 = 80).
- stats.json lists 14 long paragraphs, not 13. The finding leaves out stats line 26 (page line 33, 67 words, 5 sentences, the opening paragraph).
- Page lines 76, 78 and 80 say what the finding says. Lines 68 to 80 are seven paragraphs under "## The engine's passes", after a 25-row table, with no subheading. A reader cannot link to the text on views, sketch passes or the final and resolve passes. This part holds.
- The 'so far' rule (page line 74) is not occlusion detail. It is a general ordering rule of the graph: crates/null3d-render/src/graph.rs:25-26 and :644-646 (`Pass::reads_so_far`), used by light clustering, transmission, the depth copy and passes that read the scene color (crates/null3d-render/src/frame_graph.rs:3503, :3623, :3663, :3691, :3707). The page's "How the graph orders passes" section (lines 131-134) gives two rules, and rule 2 says a reader runs after every writer. The 'so far' rule is an exception to rule 2. To put it in a details block inside the occlusion paragraph keeps that contradiction hidden from a reader of the ordering section.
- Page line 80 describes three cases, not two: the HDR path (final pass), the 8-bit path with MSAA (resolve pass, while no effect needs the final pass), and the 8-bit path with FXAA or none (final pass reads the 8-bit target and keeps its colors). A two-row table drops the third case.
- Line 78's last sentence (a vertex offset that reads a compute pass's texture also orders the pass before the shadow, motion and pick passes) does not fit the proposed column "A material that shows it sees". It needs a note under the table or a details block.
- The anchor names lines 93, 114, 144, 158 and 162, and stats also lists 37, 68 and 70, but the edit proposes nothing for them. Most are 5 to 6 sentences and 59 to 93 words, so they are low cost. Lines 37 (93 words, 7 sentences) and 68 (78 words, 6 sentences) are the larger of these.

## Corrected claim

The page has 14 long paragraphs. Seven of them (lines 68 to 80) sit under one heading after the pass table, with no subheadings. Lines 76 (211 words), 78 (175 words) and 80 (131 words) each mix several topics and cannot be linked to.

## Corrected edit

- Add a heading "Views" (H2, or H3 under "The engine's passes") for line 76 and make it a short list. Move the WebGPU row flip, the copy pass and the `reflection_uv` exception into `<details><summary>Technical details: image rows on WebGPU and WebGL2</summary>`.
- Add a heading for sketch passes (line 78) and use a three-row table: "Pass a sketch adds | Runs | A material that shows it sees" (full-screen pass that reads only other passes' textures; full-screen pass that reads scene color, outline mask or scene depth; compute pass). Put the vertex-offset ordering sentence in a technical details block under the table.
- Add a heading for line 80 and use a three-row table: HDR path (final pass), 8-bit path with MSAA (resolve pass), 8-bit path with FXAA or none (final pass that keeps the colors). Keep the color management links.
- Move the 'so far' rule out of line 74 into "How the graph orders passes" as a third rule, or as a technical details block right after rule 2 that names it as the exception. Keep only "the occluders' pass reads the visible instances before late culling writes them again" in line 74.
- Split line 142 into temporary targets and kept targets, as proposed.
