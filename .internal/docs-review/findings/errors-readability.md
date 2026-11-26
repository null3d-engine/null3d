# Error pages: readability and layout review

Slice: errors (sample E1101, E1107, E1203, E1209, E1218, E1224, E1305, E1404, E1410, E1416, E1422, E1431, E1437, E1506). All 80 error pages and the error index come from one template and one table, so I judged them through the source:

- Template: `tools/lib/docs.ts`, `errorPage()` (line 436) and `errorIndexPage()` (line 463).
- Data: `packages/engine/src/errors/codes.ts` (title, cause, example, since; docs only) and `packages/engine/src/errors/fixes.ts` (the fix; it also ends every runtime `EngineError` message, see `messageFor()` in `engine-error-core.ts` line 19).

Line numbers. Every error page has the cause on page line 13 and the fix on page line 17. stats.json counts lines from the end of the front matter, so it gives the same paragraphs as lines 6 and 10.

Facts from stats.json and my own measures of the data:

- 21 of 80 pages have a paragraph over 90 words or 4 sentences: E1109, E1110, E1206, E1215, E1216, E1217, E1218, E1220, E1221, E1223, E1307, E1405, E1406, E1410, E1412, E1416, E1419, E1424, E1434, E1501, E1505.
- 38 entries hold at least one sentence over the 25-word limit of AGENTS.md. The worst are E1223 (one cause sentence of 207 words), E1220 (74), E1217 (55) and E1414 (44).
- 8 fixes say "report it" with no place to report: E1107, E1110, E1305, E1307, E1404, E1405, E1502, E1505.
- 13 examples hold part of the fix text, and the other 67 do not. No example shows the fix and the docs link that every real message ends with.
- Other docs pages link to error pages often (E1213 from 21 places, E1101 from 12, E1203 from 12). No error page links back to any page.

## Proposed template (applies to all 80 pages)

Findings 1, 2, 4, 5, 6, 7 and 8 share one change of the template and the entry type. The sketch below shows how they fit together.

```ts
export interface ErrorEntry {
	title: string;
	/** What went wrong, in one or two short sentences. Also the page summary and the index cell. */
	cause: string;
	/** The separate ways the error comes about, one short sentence each. Docs only. */
	cases?: string[];
	/** The general fix, at most 4 sentences. It also ends the runtime message. */
	fix: string;
	/** Fixes that apply to one case each, as "If <case>: <fix>". Docs only. */
	fixCases?: string[];
	/** A code block that shows the fix, such as a policy line or a call. Docs only. */
	fixExample?: { lang: string; code: string };
	/** Dense detail for implementers: limits, figures, checks. Docs only. */
	details?: { summary: string; body: string };
	/** Docs pages that explain the area, by page id. */
	related?: string[];
	example: string;
	since: string;
}
```

Page layout that `errorPage()` would write:

```md
# E1416: glTF file not read

The message looks like this (the engine adds the fix and a link to this page after it):

    E1416: assets.loadGltf() could not read ...

## What happened

<cause, one or two sentences>

- <case>
- <case>

<details>
<summary>Technical details: <details.summary></summary>

<details.body>

</details>

## How to fix it

<fix>

- If <case>: <fix>

<fixExample code block>

<"This is an engine bug" fixes get one fixed line with the issues link>

## Related pages

- <related pages, then the pages that link to this code, which the generator finds itself>
```

The main text reads in full with the block closed. The block has no headings and no nested blocks. A test in `tools/lib/docs.test.ts` (or `errors.test.ts`) should hold each entry to the limits: a cause of at most 2 sentences, a fix of at most 4 sentences and 90 words, and no sentence over 25 words in cause, cases, fix or fixCases. The entry type's own doc comment already says "in one or two sentences" for the cause (codes.ts line 13), but nothing checks it.

---

## Findings, ranked

The numbers group the template findings first. By importance, the order is 1, 2, 3, 9, 10, 11 (all high), then 4 to 8 and 12 to 30 as listed. The returned list uses that order.

### 1. Template has no place for lists, so multi-case errors become walls of text (all 80 pages)

- Page: errors/* (all 80), template.
- Anchor: "## What happened" and "## How to fix it".
- Category: structure. Severity: high.
- Claim: each entry has one cause string and one fix string, and `errorPage()` prints each as one paragraph. Errors with many separate causes chain them as "Or ... Or ..." sentences. A reader cannot scan for their own case. 21 pages break the paragraph limit for this reason.
- Evidence: docs.ts lines 436 to 460 print `${entry.cause}` and `${entry.fix}` as single paragraphs. E1416 cause, page line 13: 194 words, 13 sentences, six of them start with "Or" or a new case. E1218 cause (codes.ts line 202) has four "Or" sentences.
- Proposed edit: add `cases?: string[]` and `fixCases?: string[]` to `ErrorEntry` in codes.ts. `errorPage()` prints each as a bullet list under its heading. Keep `cause` at one or two sentences, so it still works as the summary. Move each "Or ..." clause into `cases`, and each case-specific fix into `fixCases` as "If <case>: <fix>". Add the limit test above.
- Generated source: packages/engine/src/errors/codes.ts and tools/lib/docs.ts (errorPage).

### 2. Template has no technical details block, so limits and figures crowd the cause (all 80 pages)

- Page: errors/* (all 80), template.
- Anchor: "## What happened".
- Category: technical-details-block. Severity: high.
- Claim: dense correct detail (byte budgets, key counts, retry timings, dev-build checks) sits in the same paragraph as the plain cause. A newcomer must read through it to learn what went wrong. That detail is useful to implementers, so it should move, not go.
- Evidence: E1109 cause (codes.ts line 84) gives 210 and 300 bytes per row, 100 bytes per vertex, 84 MiB to 270 MiB and 205 MiB peaks, an 8 MiB reserve and a 45-second retry in one 216-word paragraph. E1416 cause gives 64 MiB plus 32 bytes per byte, 1 GiB, 256 MiB, 4,194,304 keys and 4,096 sides. E1110 gives the dev-build check timing.
- Proposed edit: add `details?: { summary, body }` to `ErrorEntry`. `errorPage()` prints it at the end of "What happened" as `<details><summary>Technical details: …</summary> … </details>`. Fill it for E1109, E1110, E1402, E1406, E1410, E1412, E1414, E1416, E1424, E1434, E1501 and E1217 (see the findings for each page).
- Generated source: packages/engine/src/errors/codes.ts and tools/lib/docs.ts (errorPage).

### 3. E1217: 604-word page; cause and fix are walls of rules for many material kinds

- Page: errors/E1217.
- Anchor: page lines 13 and 17 ("A material factory or scene.createLines() received...", "Give alphaMode 'opaque'...").
- Category: wall-of-text. Severity: high.
- Claim: the page is 604 words. The cause is 254 words in 9 sentences and the fix is 320 words in 17 sentences. Four cause sentences and two fix sentences pass 25 words. The rules for alpha modes, layered materials, transmission, diffuse transmission and custom WGSL run together. A reader with one wrong option cannot find their rule. The texture-array sharing rules are correct but very dense.
- Evidence: stats.json E1217: (6, 254 words, 9 sentences), (10, 320 words, 17 sentences). codes.ts line 195. fixes.ts line 54. Sentences of 55 and 41 words.
- Proposed edit:
  - Cause: "A material factory or scene.createLines() got an option value that it does not take, or two options that cannot go together. The message names the option."
  - Replace the rest with a table under "What happened": Material | Refuses | Use instead. Rows: any material (unknown alphaMode, blending, line mode); custom material ('weighted' blending; alphaToCoverage or 'hash' without WGSL that sets alpha; subsurfaceRadius; a coverage function without 'mask' or 'blend' with the caster's cutoff); material with transmission ('hash', 'weighted'); diffuse transmission (specular maps, clear coat, sheen, 'weighted'); layered material (light map, specular maps, split pairs of layer maps).
  - Move the slot and texture-array rules (which layer map fills the array that transmissionMap or thicknessMap samples, and why a thicknessMap refuses a specularColorMap) into a details block, "Technical details: which maps share a texture array".
  - Runtime fix in fixes.ts: keep the first two sentences (the alphaMode and blending values and the three.js mapping), then add "The docs page gives the rule for each kind of material." Put the remaining fixes in `fixCases`.
  - Also think about splitting the code into two: one for alpha and blending values, and one for map conflicts.
- Generated source: packages/engine/src/errors/codes.ts (E1217), packages/engine/src/errors/fixes.ts (E1217).

### 4. Summary and index cell repeat the whole cause, up to 207 words (all 80 pages and errors/index)

- Page: errors/* and errors/index.
- Anchor: front matter `summary:`; index table column "What happened".
- Category: scan-order. Severity: medium.
- Claim: `errorPage()` copies the whole cause into the front-matter summary, and `errorIndexPage()` puts the whole cause in a table cell. Long causes give 200-word summaries and 200-word table cells. The index is the page a reader scans to find a code, and long cells push the 80 rows apart.
- Evidence: docs.ts line 443 `['summary', entry.cause]` and line 466 `tableCell(entry.cause)`. errors/E1416.md line 6: a summary of 194 words. E1223: a cell of one 207-word sentence.
- Proposed edit: once finding 1 is done, `cause` is at most two sentences, and the summary and cell stay short. Until then, have the generator use only the cause's first sentence for both.
- Generated source: tools/lib/docs.ts (errorPage, errorIndexPage).

### 5. Runtime fix text is also the page's fix, so long fixes are walls on the page and in the console (all 80 pages)

- Page: errors/* (all 80), data.
- Anchor: "## How to fix it".
- Category: structure. Severity: medium.
- Claim: the fix in fixes.ts ends every runtime message and downloads with the page. The page prints the same string. So a fix written to cover every case (E1217: 320 words, E1109: 161, E1223: 150, E1215: 115, E1216: 107) is also a wall in the developer's console. The page has no docs-only place to put the case-by-case fixes.
- Evidence: engine-error-core.ts line 19 `messageFor()` appends the fix. The fixes.ts header: "the text that ends every EngineError message... downloads once, with the page".
- Proposed edit: limit `fix` to the general fix in at most 4 sentences and 90 words. Move case-by-case fixes into the docs-only `fixCases` in codes.ts. The runtime message then ends with "See <page>", where the cases are. This also makes the page download smaller.
- Generated source: packages/engine/src/errors/fixes.ts, packages/engine/src/errors/codes.ts, tools/lib/docs.ts.

### 6. Error pages link to no other page (all 80 pages)

- Page: errors/* (all 80), template.
- Anchor: end of page.
- Category: missing-content. Severity: medium.
- Claim: an error page is often the first docs page a reader lands on, from the link in the console. It gives no way on to the page that explains the area. Fixes say "the hosting page of the docs gives the headers" (E1405, E1418) and "The call's docs page lists them" (E1213) without a link. E1434 gives a raw path "docs/guides/baked-light-data.md". 45 other pages link to error pages, and no link goes back.
- Evidence: fixes.ts lines 94, 120, 46, 146. Backlinks, for example: E1422 is linked from getting-started/cdn, getting-started/hosting and api/input; E1101 from concepts/handles and guides/debugging; E1410 from guides/custom-shaders and api/sketch.
- Proposed edit: add a "## Related pages" section. Fill it from a docs-only `related?: string[]` in codes.ts (for example E1101 → concepts/handles; E1422, E1423, E1418, E1405 → getting-started/hosting; E1215, E1216 → guides/custom-shaders; E1434 → guides/baked-light-data). Then add the pages that link to the code, which the generator can find by searching the other pages for `errors/<code>.md`. In the fix text, change "the hosting page of the docs" to name the page, so the console text still makes sense.
- Generated source: tools/lib/docs.ts (errorPage), packages/engine/src/errors/codes.ts.

### 7. Example comes last, is labelled vaguely, and does not match the real message (all 80 pages)

- Page: errors/* (all 80), template and data.
- Anchor: "## Example".
- Category: example-placement. Severity: medium.
- Claim: a reader arrives with a message in hand. The first thing they want is to confirm that the page fits their message, but the sample message comes last. "Example" does not say it is a message, not code. The real message is detail + fix + "See <link>". 13 examples hold part of the fix, which then shows twice on the page (E1203, E1224). The other 67 hold none.
- Evidence: docs.ts lines 456 to 459. E1203 example (codes.ts line 115) ends "Check the value computed before this call.", which is the fix's first sentence (fixes.ts line 32). E1224 example (line 251) repeats the fix (fixes.ts line 68) almost word for word. Others with fix text: E1111, E1112, E1208, E1209, E1219, E1220, E1221, E1222, E1223, E1225, E1435.
- Proposed edit: print the sample directly under the H1, after "The message looks like this (the engine adds the fix and a link to this page after it):". Strip the fix sentences from the 13 examples, so that each example is the detail part only. Rename the heading or drop it.
- Generated source: tools/lib/docs.ts (errorPage), packages/engine/src/errors/codes.ts (examples).

### 8. "Report it" gives no place to report (8 pages, 3 in the sample)

- Page: errors/E1107, E1404, E1305 (sample); also E1110, E1307, E1405, E1502, E1505.
- Anchor: "## How to fix it", "This is an engine bug. Report it...".
- Category: missing-prerequisite. Severity: medium.
- Claim: a newcomer who hits an engine bug is told to report it but not where or how. E1107's whole fix is that one line.
- Evidence: fixes.ts line 20 (E1107), 92 (E1404), 80 (E1305), 26, 84, 94, 156, 162.
- Proposed edit: when a fix holds "report", have `errorPage()` add one fixed line under the fix: "Report it at https://github.com/null3d-engine/null3d/issues with the full message, the browser and the GPU path." Keep the runtime text as it is.
- Generated source: tools/lib/docs.ts (errorPage).

### 9. E1223: the cause is one sentence of 207 words

- Page: errors/E1223.
- Anchor: page lines 13 and 17 ("defineFeature(), FeatureRegistry.add(), addFeatureDraw()...").
- Category: wall-of-text. Severity: high.
- Claim: the cause lists about 25 separate faults in one sentence with commas, and the reader cannot find their fault. The fix is 150 words in 10 sentences, with its own per-kind rules.
- Evidence: stats.json E1223: (6, 207 words, 1 sentence), (10, 150 words, 10 sentences). codes.ts line 241. fixes.ts line 66.
- Proposed edit:
  - Cause: "A call that registers a feature, a feature draw, a full-screen effect, a sky layer or a compute pass got a description that it cannot take. The message names the field."
  - Cases as bullets, in groups: names (empty, over 64 characters, already taken, debug-view names); frame points and kinds (unknown, do not go together, order outside its band); resources, lighting slots and views (unknown, without a frame point, slot already provided, output without a neutral default).
  - Add a table of the rules for each kind, which joins cause and fix: Kind | Frame point | Views | Reads | Writes. Rows: full-screen effect (resolve, main, sceneColor and depth only with effectDepth etc., sceneColor alone); sky layer (background, draw, provides sky, main + scene-pass + reflection); compute pass (adapter's points; outputs default 'black' or 'transparent'); feature draw (the adapter's points, views and alpha modes).
  - Move the budget and governor rules into `fixCases`.
- Generated source: packages/engine/src/errors/codes.ts (E1223), packages/engine/src/errors/fixes.ts (E1223).

### 10. E1109: 406 words; memory figures and retry timings bury the cause and the steps

- Page: errors/E1109.
- Anchor: page lines 13 and 17.
- Category: technical-details-block. Severity: high.
- Claim: a common error (9 pages link to it) has a 216-word, 12-sentence cause and a 161-word, 10-sentence fix. The fix is a sequence (measure, then use less, then raise the limit, then handle several engines) written as prose.
- Evidence: stats.json E1109: (6, 216, 12), (10, 161, 10). codes.ts line 84. fixes.ts line 24.
- Proposed edit:
  - Cause: "The engine could not create or grow its WebAssembly memory. A page with worker threads gives the engine 1 GiB by default, and up to 4 GiB through createEngine's memory option."
  - Cases: "Many instance rows: about 5 million fill 1 GiB." "A mesh of millions of vertices, from geometry.fromArrays or a model file." "The first frame, which copies every mesh of the scene." "The browser refused memory sooner, as phones often do, or while an earlier engine's memory was not free yet."
  - Details block, "Technical details: memory figures and the retry": 210 and 300 bytes per row; 100 bytes per vertex while normals compute; 84 MiB of meshes peaks at about 270 MiB (direct) and 205 MiB (indirect); the 8 MiB reserve; the 45-second retry and memory-wait in onProgress after 10 seconds.
  - Fix as numbered steps: 1. Measure (engine.measure().memory.wasmBytes, engine.mode.memoryMaximumMiB, ?direct=on). 2. Use less (a bullet list: share meshes, fewer rows, size batches, colors only when needed, split or simplify large meshes, destroy unused batches). 3. Raise memory.maximumMiB. 4. With several engines, destroy unused ones or reuse one.
  - Runtime fix: keep steps 1 to 3 in at most 4 sentences.
- Generated source: packages/engine/src/errors/codes.ts (E1109), packages/engine/src/errors/fixes.ts (E1109).

### 11. E1416: 13-sentence cause chains every fault and every limit (sample)

- Page: errors/E1416.
- Anchor: page line 13 ("assets.loadGltf() downloaded a file..."), page line 17 ("Check that the file is a glTF 2.0 model...").
- Category: long-paragraph. Severity: high.
- Claim: the cause is 194 words in 13 sentences, and it mixes broken-file faults with size limits. The fix is 91 words in 5 sentences. The fix sentence "A file that passes a limit on what it decodes to is broken" uses "passes" to mean "goes over", which a reader can take the wrong way.
- Evidence: stats.json E1416: (6, 194, 13), (10, 91, 5). codes.ts line 428. fixes.ts line 116.
- Proposed edit:
  - Cause: "assets.loadGltf() downloaded a file that is not a glTF 2.0 model it can read. The message names the broken part."
  - Cases: "The file is broken: a bad JSON or binary chunk, an offset past the data, a missing buffer or image, a loop of nodes, a skin or clip that breaks glTF's rules, or Draco data that does not decode." "The file is past a limit of the engine." "The rewriteUrl option refused an address in the file."
  - Details block, "Technical details: the limits on one glTF file", as a table Limit | Value: decoded total (64 MiB plus 32 bytes per byte of the file and its buffers, at most 1 GiB, meshopt blocks included); one array (256 MiB); nodes that skins and clips move (1,024); keys per clip (4,194,304, frames times tracks); image sides (4,096); decoded images (1 GiB).
  - fixCases: "If the file is broken: open it in the Khronos glTF Validator and export it again." "If the skeleton is too large: export each character to its own file." "If the file goes over a size limit: split it or simplify its meshes."
- Generated source: packages/engine/src/errors/codes.ts (E1416), packages/engine/src/errors/fixes.ts (E1416).

### 12. Error index is one flat table of 80 rows with no groups

- Page: errors/index.
- Anchor: "| Code | Error | What happened |".
- Category: scan-order. Severity: medium.
- Claim: the codes already group by area (11xx objects and handles, 12xx values, 13xx browsers and GPUs, 14xx setup and loading, 15xx rendering), but the index does not show the groups. A reader who has no code yet, for example one who has a black canvas, cannot browse by area.
- Evidence: the fixes.ts header comment names the five groups. docs.ts lines 463 to 481 write one table.
- Proposed edit: have `errorIndexPage()` write one H2 per group ("Objects and handles", "Values", "Browsers and GPUs", "Setup and loading", "Rendering"), each with its own table. Keep the cell to the cause's first sentence (finding 4).
- Generated source: tools/lib/docs.ts (errorIndexPage).

### 13. E1206: four calls' faults and fixes in two long paragraphs

- Page: errors/E1206.
- Anchor: page lines 13 and 17.
- Category: wall-of-text. Severity: medium.
- Claim: the cause (129 words, 7 sentences) and the fix (95 words, 7 sentences) cover geometry.fromArrays(), scene.createLines(), scene.createPoints() and mesh.updateVertices() together. The counts per attribute are in prose.
- Evidence: stats.json E1206: (6, 129, 7), (10, 95, 7). codes.ts line 135. fixes.ts line 38.
- Proposed edit: one cause sentence, then a table Call | Refuses | Fix with one row per call. Then a small table "Numbers per vertex": positions 3, normals 3, uvs and uvs1 2, colors 3 or 4, tangents 4, indices 3 per triangle.
- Generated source: packages/engine/src/errors/codes.ts (E1206), packages/engine/src/errors/fixes.ts (E1206).

### 14. E1215: what each call's WGSL declares, repeated in cause and fix as prose

- Page: errors/E1215.
- Anchor: page lines 13 and 17.
- Category: wall-of-text. Severity: medium.
- Claim: the cause (96 words, 6 sentences) and the fix (115 words, 6 sentences) both list what each call's WGSL must declare. That is a table, written twice.
- Evidence: stats.json E1215: (6, 96, 6), (10, 115, 6). codes.ts line 179. fixes.ts line 50.
- Proposed edit: cause in two sentences (the call got WGSL that the Vite plugin did not compile, or that lacks its function). The fix as numbered steps: 1. Add the null3D Vite plugin to vite.config.ts. 2. Write the WGSL after a `/* wgsl */` comment, or import a .wgsl file. 3. Declare the function from this table. Table Call | WGSL declares: materials.shader() (surface, vertexOffset or lobe; a full shader with @vertex and InstanceIn; a draw that makes its own vertices with vertex_index and instance_index); post.addEffect() (fn effect); post.set({ toneMapping }) (fn toneCurve); scene.setSkyLayer() (fn skyLayer).
- Generated source: packages/engine/src/errors/codes.ts (E1215), packages/engine/src/errors/fixes.ts (E1215).

### 15. E1218: two long paragraphs, and the cause leaves out a case that the fix covers (sample)

- Page: errors/E1218.
- Anchor: page lines 13 and 17.
- Category: long-paragraph. Severity: medium.
- Claim: the cause is 95 words in 6 sentences and the fix is 91 words in 6 sentences. The fix tells readers not to name events 'loop' or 'finished', but the cause never names that case. So a reader cannot match their error to it. The last cause sentence ("is refused too, as a clip whose keys lie hours apart is") is hard to parse.
- Evidence: stats.json E1218: (6, 95, 6), (10, 91, 6). codes.ts line 202. fixes.ts line 56.
- Proposed edit: cause "An animator call got a name or a value that the object's animation does not take." Then a table Case | Fix: unknown clip, layer or joint (use animator.clips and the skeleton's joint names); value out of range (layers 0 to 3, weights 0 to 1, fades of 0 or more); animator() on an object without clips (call it on a glTF object with animations); a clip event named 'loop' or 'finished' (rename it); unknown morph target (use a number below morphTargets or a name in morphTargetNames); refused animation data, such as a joint before its parent (export again); a clip that is too long (trim or split it). Put the 4,194,304-key limit in a one-line details block or in the row.
- Generated source: packages/engine/src/errors/codes.ts (E1218), packages/engine/src/errors/fixes.ts (E1218).

### 16. E1501: the full parts are listed in prose, and the fix covers only some of them

- Page: errors/E1501.
- Anchor: page lines 13 and 17.
- Category: wall-of-text. Severity: medium.
- Claim: the cause (138 words, 10 sentences) names seven parts that can fill up, with limits in prose. The fix (80 words, 6 sentences) covers the material table, the culling limit and skinning only. A reader whose message names the upload space, one GPU buffer or the shadow atlas finds no fix.
- Evidence: stats.json E1501: (6, 138, 10), (10, 80, 6). codes.ts line 577. fixes.ts line 154.
- Proposed edit: cause "The scene needs more room than the renderer has. The message names the full part, and a frame that fails draws nothing." Then a table Full part | Limit | Fix, with one row each for the material table, upload space, culling pass (2,097,152 on WebGPU; engine.capabilities.maxInstances), skinning on WebGPU (8 buffers, about 1 GiB, 32 mesh buffers), draw list, one GPU buffer and shadow atlas. Fill the missing fixes.
- Generated source: packages/engine/src/errors/codes.ts (E1501), packages/engine/src/errors/fixes.ts (E1501).

### 17. E1412: one 165-word cause covers five file types and their limits

- Page: errors/E1412.
- Anchor: page line 13.
- Category: long-paragraph. Severity: medium.
- Claim: the cause is 165 words in 10 sentences. It covers images, KTX2, JSON, color grading tables and environment maps, and then the size limits.
- Evidence: stats.json E1412: (6, 165, 10). codes.ts line 397. fixes.ts line 108.
- Proposed edit: cause "A loading call downloaded its file but could not read it. The message says what it could not read, with the line where it has one." Cases, one per file type. Details block, "Technical details: size limits checked before decoding": KTX2 (sides up to textures.maxSize, 256 layers, mip levels, 256 MiB of texels); PNG and JPEG (sides up to textures.maxSize, or 16,384 for loadImageBitmap).
- Generated source: packages/engine/src/errors/codes.ts (E1412).

### 18. E1220: a 74-word sentence lists every refused option of addPass

- Page: errors/E1220.
- Anchor: page line 13.
- Category: long-paragraph. Severity: medium.
- Claim: the cause is 121 words in only 3 sentences: 74 words, then 36, then the rest. The faults of render.addPass() and of five other render calls run together.
- Evidence: stats.json E1220: (6, 121, 3). codes.ts line 217.
- Proposed edit: cause "A render pass call got options that it does not take, or something that is not a render pass of the kind it needs." Then two bullet lists: "render.addPass() refuses:" (unknown kind or option, no camera, size outside 1 to the largest texture, size and scale together, unknown input image, a workgroup or dispatch the device cannot run, a format a compute pass does not write, a WebGL2 compute pass with no fallback, a taken texture or pass name, more than 31 passes); "Other calls:" (textures.fromPass, setPassEnabled, setPassUniform, setPassUniforms, removePass and the kind each takes).
- Generated source: packages/engine/src/errors/codes.ts (E1220).

### 19. E1216: the uniform and texture types are a table written as a 107-word fix

- Page: errors/E1216.
- Anchor: page line 17.
- Category: wall-of-text. Severity: medium.
- Claim: the fix is 107 words in 7 sentences, with one of 40 words. It pairs each WGSL type with the value to give, which a table shows at a glance.
- Evidence: stats.json E1216: (10, 107, 7). fixes.ts line 52.
- Proposed edit: keep two fix sentences (use the field names of struct Uniforms; rename a field that has a standard value's name). Add a table WGSL type | Give: f32 (a number); i32, u32 (a whole number); vec2f, vec3f, vec4f (an array of 2, 3, 4 numbers; vec3f also takes a color); texture_2d<f32> (a texture of one layer); texture_2d_array<f32> (a texture of layers, from textures.fromData with a depth or a KTX2 file). Put post.setEffectUniform() in fixCases.
- Generated source: packages/engine/src/errors/fixes.ts (E1216), packages/engine/src/errors/codes.ts.

### 20. E1307: driver mechanics and three fixes run together

- Page: errors/E1307.
- Anchor: page lines 13 and 17.
- Category: long-paragraph. Severity: medium.
- Claim: the cause (116 words, 7 sentences) mixes what the reader sees (objects missing from a pass) with how the engine retries builds. The fix (86 words, 7 sentences) has three separate fixes, one for each thing the message can name.
- Evidence: stats.json E1307: (6, 116, 7), (10, 86, 7). codes.ts line 307. fixes.ts line 84.
- Proposed edit: cause "After the start, the GPU driver could not build a pipeline. The objects that draw with it are missing from its pass, and the engine draws on." Details block: the two build attempts, WebGL2 link failures, and the first-time-per-device reporting. fixCases: "If the message names a custom material: check its WGSL on the device, and shorten it." "If the device has little memory: lower the quality preset, and use smaller textures and fewer objects." "If it names an engine template: report it with the device."
- Generated source: packages/engine/src/errors/codes.ts (E1307), packages/engine/src/errors/fixes.ts (E1307).

### 21. E1406: the list of files loaded on first use is prose

- Page: errors/E1406.
- Anchor: page line 13.
- Category: technical-details-block. Severity: medium.
- Claim: the cause is 139 words in 8 sentences. Most of it is a list of "the first X loads Y", which a host checks one by one.
- Evidence: stats.json E1406: (6, 139, 8). codes.ts line 350.
- Proposed edit: cause "A file of the engine core, or a file that a call loads the first time, did not download whole. The server answered with an error, sent another file such as a web page, or the connection broke off." Details block, "Technical details: files that load on first use", as a table First use | File: KTX2 file (transcoder), glTF file (loader), levels of detail (planner and simplifier), meshopt and Draco (decoders), color grading table and environment (readers), sprite or point batch, line batch, feature draws and effects (adapters).
- Generated source: packages/engine/src/errors/codes.ts (E1406).

### 22. E1424: shader build file naming crowds the cause

- Page: errors/E1424.
- Anchor: page line 13.
- Category: technical-details-block. Severity: medium.
- Claim: the cause is 138 words in 7 sentences, with sentences of 29 and 33 words. It explains file naming per GPU path before it says that the engine stops drawing.
- Evidence: stats.json E1424: (6, 138, 7). codes.ts line 491.
- Proposed edit: cause "A file that holds a custom shader's builds did not download, so the engine draws no new frames. The server answered with an error, sent another file in its place, or the connection broke off." Details block, "Technical details: the shader build files": the material-*.js, effect-*.js and curve-*.js names, one per GPU path and device kind, and when each one downloads.
- Generated source: packages/engine/src/errors/codes.ts (E1424).

### 23. E1434: the baked light format rules are a 143-word cause

- Page: errors/E1434.
- Anchor: page lines 13 and 17.
- Category: long-paragraph. Severity: medium.
- Claim: the cause is 143 words in 8 sentences. It lists file-level, probe-grid and light-map faults together. The fix names "docs/guides/baked-light-data.md" as a raw path, which is not a link on the page.
- Evidence: stats.json E1434: (6, 143, 8). codes.ts line 546. fixes.ts line 146.
- Proposed edit: cause in two sentences, then cases in three groups (the whole file; a probe grid; a light map). Move the per-field size rules (12 floats per probe, one validity float from 0 to 1, rgb8 or rgba16float) into a details block. Add guides/baked-light-data to `related`, and change the fix's raw path to "the baked light data guide".
- Generated source: packages/engine/src/errors/codes.ts (E1434), packages/engine/src/errors/fixes.ts (E1434).

### 24. E1110: dev-build check timing sits in the main cause

- Page: errors/E1110.
- Anchor: page line 13.
- Category: technical-details-block. Severity: medium.
- Claim: the cause is 122 words in 7 sentences, with one of 44 words. The first three sentences say what went wrong. The rest explains when development builds check, which only implementers need.
- Evidence: stats.json E1110: (6, 122, 7). codes.ts line 91.
- Proposed edit: keep the first three sentences, plus "A row of a static batch that changed without markDirty() raises it too." Move the transform-update timing, onLateUpdate, the share of a large batch per frame, and "Release builds leave the check out" into a details block, "Technical details: when the check runs". Fix as fixCases: objects (use a setter, or make the object dynamic); batch rows (markDirty(start, count), or dynamic: true); no direct writes (an engine bug, report it).
- Generated source: packages/engine/src/errors/codes.ts (E1110), packages/engine/src/errors/fixes.ts (E1110).

### 25. E1422: an example policy is written inline as prose (sample)

- Page: errors/E1422.
- Anchor: page line 17 ("For example: worker-src 'self' blob: https://cdn.example.com; script-src ...").
- Category: example-placement. Severity: medium.
- Claim: the fix holds a whole Content-Security-Policy value inside a sentence. On the page it wraps as normal text, so a reader cannot copy it cleanly or see where it ends.
- Evidence: fixes.ts line 128.
- Proposed edit: add `fixExample: { lang: 'text', code: "Content-Security-Policy: worker-src 'self' blob: https://cdn.example.com; script-src 'self' https://cdn.example.com 'wasm-unsafe-eval'; connect-src 'self' https://cdn.example.com" }` to E1422 in codes.ts, and print it as a code block under the fix. Do the same for E1418 (script-src line). Keep the runtime text as it is, or shorten it to "Add blob: and the engine's origin to worker-src, and the origin to script-src and connect-src."
- Generated source: packages/engine/src/errors/codes.ts (E1422, E1418), tools/lib/docs.ts (errorPage).

### 26. Code names are not set as code (all 80 pages)

- Page: errors/* (all 80), data.
- Anchor: cause and fix paragraphs.
- Category: scan-order. Severity: medium.
- Claim: calls, options, values and switches (assets.loadGltf(), alphaMode: 'blend', ?hold=, worker-src, memory.maximumMiB) print as plain words. On dense pages a reader cannot pick out the names to search for. Only E1106, E1205, E1216 and E1412 use backticks, so the pages are not consistent.
- Evidence: codes.ts lines 63, 128, 187, 397 have backticks. No other entry does. fixes.ts has none.
- Proposed edit: put backticks around code names in codes.ts (docs only). For fixes.ts, allow backticks and have `messageFor()` in engine-error-core.ts remove them when it builds the runtime message, so the console text stays plain.
- Generated source: packages/engine/src/errors/codes.ts, packages/engine/src/errors/fixes.ts, packages/engine/src/errors/engine-error-core.ts.

### 27. E1410: retry behavior fills the cause (sample)

- Page: errors/E1410.
- Anchor: page line 13 ("The sketch module that createEngine got did not load...").
- Category: technical-details-block. Severity: low.
- Claim: the cause is 77 words in 5 sentences. Three of them explain the second import and when it is skipped. A reader needs only the two causes and the fact that the message gives the reason.
- Evidence: stats.json E1410: (6, 77, 5). codes.ts line 381.
- Proposed edit: cause "The sketch module that createEngine got did not load. It did not download, or its code threw an error while it loaded. The message gives the reason." Details block, "Technical details: the second import": one more import after a short wait, the console note, and why a module that threw is not imported again. fixCases: "If it did not download: pass new URL('./sketch.ts', import.meta.url)." "If its code threw: fix the error that the message quotes."
- Generated source: packages/engine/src/errors/codes.ts (E1410), packages/engine/src/errors/fixes.ts (E1410).

### 28. E1505: target rules in one prose paragraph

- Page: errors/E1505.
- Anchor: page line 13.
- Category: long-paragraph. Severity: low.
- Claim: the cause is 112 words in 6 sentences, and it lists target rules that read better as a list.
- Evidence: stats.json E1505: (6, 112, 6). codes.ts line 606.
- Proposed edit: cause "A render pass draws into targets that one GPU render pass cannot hold together." Then bullets: different size from the pass; different sample counts; two depth targets; a whole texture array instead of one layer; no target; more than four color targets; more than 32 bytes per sample. Then one sentence on resolve passes.
- Generated source: packages/engine/src/errors/codes.ts (E1505).

### 29. E1209: the cause opens with a sentence fragment, and the fix repeats the cause (sample)

- Page: errors/E1209.
- Anchor: page line 13 ("A material whose shader reads more textures than a WebGL2 shader stage has units.").
- Category: unclear. Severity: low.
- Claim: the first sentence has no main verb. It is also the page summary and the index cell, so the fragment shows in three places. The fix repeats "WebGL2 gives each shader stage at least 16 texture units, as many as the device reports, and the engine's lit shader reads most of them" from the cause, in a 37-word sentence.
- Evidence: codes.ts line 157. fixes.ts line 44.
- Proposed edit: cause "A material's shader reads more textures than a WebGL2 shader stage has units. WebGL2 gives each stage at least 16, and the engine's lit shader uses most of them." Fix "Give the material fewer textures of its own. Use the standard material's maps where they draw the effect."
- Generated source: packages/engine/src/errors/codes.ts (E1209), packages/engine/src/errors/fixes.ts (E1209).

### 30. E1419: two separate cases in one paragraph

- Page: errors/E1419.
- Anchor: page line 13.
- Category: long-paragraph. Severity: low.
- Claim: the cause (75 words, 5 sentences) mixes "another engine still draws on this canvas" with "this canvas's thread ended for good". The fixes differ (wait for destroy(), or use a new canvas).
- Evidence: stats.json E1419: (6, 75, 5). codes.ts line 452. fixes.ts line 122.
- Proposed edit: cause in one sentence, then two cases with matching fixCases: "Another engine still draws on it: wait for its destroy() promise (in React, in the effect's cleanup)." "Its drawing thread ended (it failed, the canvas left the page, the page went away, or memory was refused): put a new canvas in its place."
- Generated source: packages/engine/src/errors/codes.ts (E1419), packages/engine/src/errors/fixes.ts (E1419).

---

## Findings after the top 30 (not verified)

### 31. E1405: the fix is 89 words in 6 sentences, with three separate fixes (not verified)

- Page: errors/E1405. Anchor: page line 17. Category: long-paragraph. Severity: low.
- Evidence: stats.json E1405: (10, 89, 6). fixes.ts line 94.
- Proposed edit: fixCases: "If the sketch's setup threw: fix the setup function." "If a worker did not start: check the isolation headers and that the engine files load." "Under a Content-Security-Policy: allow the workers in worker-src." Link getting-started/hosting in `related`.
- Generated source: packages/engine/src/errors/fixes.ts (E1405), packages/engine/src/errors/codes.ts.

### 32. E1402: the dev server's stamp check is in the main cause (not verified)

- Page: errors/E1402. Anchor: page line 13. Category: technical-details-block. Severity: low.
- Evidence: codes.ts line 322. It has sentences of 37 and 26 words about null3D's own dev server and a checkout of its repository. That case concerns engine contributors more than users.
- Proposed edit: keep the first two sentences. Move the stamp comparison into a details block, "Technical details: the check on a source checkout".
- Generated source: packages/engine/src/errors/codes.ts (E1402).

### 33. E1414: a 44-word sentence on the answer timeout (not verified)

- Page: errors/E1414. Anchor: page line 13. Category: technical-details-block. Severity: low.
- Evidence: codes.ts line 413. fixes.ts line 112 (a 33-word sentence).
- Proposed edit: split it into three cases (engine stopped; read back or encode failed; drawing thread stuck). Put the timeout mechanics in one details sentence. Match the fixCases to the cases.
- Generated source: packages/engine/src/errors/codes.ts (E1414), packages/engine/src/errors/fixes.ts (E1414).

### 34. E1437: environment switches in prose (sample) (not verified)

- Page: errors/E1437. Anchor: page line 17 ("set CI=1 ... or NULL3D_CHROME=installed"). Category: example-placement. Severity: low.
- Evidence: fixes.ts line 152. It has a 30-word sentence.
- Proposed edit: keep "Run the command again" and the proxy note as the fix. Put the two platform choices into fixCases, with `CI=1` and `NULL3D_CHROME=installed` as code. Link cli/null3d in `related`.
- Generated source: packages/engine/src/errors/fixes.ts (E1437), packages/engine/src/errors/codes.ts.

### 35. E1224: a 35-word cause sentence, and the example repeats the fix (sample) (not verified)

- Page: errors/E1224. Anchor: page line 13 and the example. Category: duplication. Severity: low.
- Evidence: codes.ts line 249 (cause) and 251 (example). fixes.ts line 68.
- Proposed edit: split the second cause sentence ("Such a material draws the rows of its batch, or a sprite or line of its own. It cannot stand in for every mesh of the pass."). Cut the example after "got a sprite material."
- Generated source: packages/engine/src/errors/codes.ts (E1224).

### 36. E1208: a missing space, "fromDatafour" (not verified)

- Page: errors/E1208. Anchor: page line 17. Category: unclear. Severity: low.
- Evidence: fixes.ts line 42, "Give fromDatafour numbers per texel".
- Proposed edit: "Give textures.fromData() four numbers per texel".
- Generated source: packages/engine/src/errors/fixes.ts (E1208).

### 37. E1506: "draws its scene directly" is not explained or linked (sample) (not verified)

- Page: errors/E1506. Anchor: page line 13. Category: term-before-definition. Severity: low.
- Evidence: codes.ts line 613: "on a device that draws its scene directly. The direct path counts every draw on the CPU". The page gives no explanation of the direct and indirect paths.
- Proposed edit: add the concept page that explains the draw paths to `related`, and say in one clause what the direct path is ("the path that counts every draw on the CPU").
- Generated source: packages/engine/src/errors/codes.ts (E1506).

### 38. E1101: "slot" is used with no link to the handles concept (sample) (not verified)

- Page: errors/E1101. Anchor: page line 13 ("Its slot may already hold a new object."). Category: term-before-definition. Severity: low.
- Evidence: codes.ts line 27. concepts/handles explains slots and links to E1101, but E1101 does not link back.
- Proposed edit: `related: ['concepts/handles']` (finding 6).
- Generated source: packages/engine/src/errors/codes.ts (E1101).
