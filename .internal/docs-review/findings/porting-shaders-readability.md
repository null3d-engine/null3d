# Readability and layout review: porting and shaders pages

Slice: porting/react-three-fiber, porting/threejs-loop-and-threads, porting/threejs-mapping, porting/threejs-materials, porting/threejs-overview, porting/threejs-postprocessing, porting/threejs-shaders, porting/threejs-unsupported, porting/verification, shaders/builtins, shaders/library, shaders/surface-functions, shaders/wgsl-rules.

Line numbers are file lines in the generated copy. The stats file counts body lines after the 7 lines of front matter, so a stats line is the file line less 7. Both are given where they matter.

A "technical details block" below means:

```
<details>
<summary>Technical details: what is inside</summary>

Markdown body.

</details>
```

The main text must make sense with every block closed. No headings and no nested blocks inside one.

Findings 1 to 30 were checked against the pages and their sources. Findings 31 and after are marked "not verified".

---

## 1. porting/threejs-mapping: the Notes cells are too long to read in a table

- Severity: high
- Category: wall-of-text
- Anchor: every section table; worst rows "CSS2DRenderer / CSS3DRenderer (HTML labels)" (line 281) and "LOD (addLevel) / SimplifyModifier" (line 209)
- Claim: The page is 21,943 words in 16 six-column tables. Of 194 entries, 69 have notes over 90 words and 25 over 150 words. The longest notes are 409, 351, 283, 276 and 273 words. One table row is up to 2,817 characters. A reader who looks up one API must read a cell that is a whole page. On a phone the table cannot be read at all.
- Evidence: docs/data/threejs-mapping.json `entries[].notes`; tools/lib/docs.ts `mappingMarkdown` puts each note in one cell with `tableCell(e.notes)`. Row lengths: line 281 is 2,817 characters, line 209 is 2,480, line 215 is 2,127.
- Proposed edit: Give each entry a short `notes` (one or two sentences: what to do) and an optional `details` field (the rest). In `mappingMarkdown`, after each section's table, write one technical details block, "Technical details: <section> notes", with one bullet per entry that has `details`, led by the three.js name in code font. Keep the table cells short. Example for the LOD row: notes "Levels belong to the mesh. A mesh made in code of 4,096 triangles or more plans its own levels; glTF levels come from `assets optimize --lod`." The rest (fades, coverage, shadow levels, impostors, clusters) goes into the block.
- Generated source: docs/data/threejs-mapping.json (render in tools/lib/docs.ts)

## 2. shaders/surface-functions: advanced sections come before the basics, and the page should split

- Severity: high
- Category: split-page
- Anchor: "## A normal for the diffuse light" (line 130) to "## A material's own lobe" (line 183), before "## Uniforms" (line 211)
- Claim: The page is 7,509 words with 23 H2 sections. After "Unlit surfaces", it goes to four advanced lighting controls (a second normal, a third normal, occlusion by minimum, a custom lobe). Only then does it reach uniforms and textures, which every newcomer needs for a first material. A reader who scans in order meets crown-of-leaves normals before they learn to pass a number to the shader.
- Evidence: Heading order in stats.json: "The surface", "Unlit surfaces", "A normal for the diffuse light", "A normal for the sky's light", "Occlusion counted once", "A material's own lobe", "Uniforms", "Textures", "Reflections", "The scene's depth", "Transmission", "Light through thin surfaces", "Clear coat and sheen", "Vertex offsets", "Shadows", "Cut-out shapes", ...
- Proposed edit: Keep on this page, in this order: Make a custom material, The surface input, The surface, Unlit surfaces, Uniforms, Textures, Vertex offsets, Cut-out shapes, Shadows, Built-in values, Library functions, Rules. Move to a new page "Advanced surface outputs" (id shaders/surface-outputs): the two extra normals, occlusion counted once, a material's own lobe, reflections, the scene's depth, transmission (with water seen from below), light through thin surfaces, clear coat and sheen. Add the page to PAGES in tools/lib/docs.ts. Link it from "The surface" table rows and from Related pages. Fix inbound anchors such as `surface-functions.md#a-materials-own-lobe` in porting/threejs-materials.
- Generated source: (written page)

## 3. porting/threejs-shaders: worked examples sit far from the steps they show

- Severity: medium
- Category: example-placement
- Anchor: "## Worked examples" (line 190) with "### A fresnel glow from a ShaderMaterial", "### Wind sway from onBeforeCompile", "### A dissolve from TSL"
- Claim: The steps for ShaderMaterial (line 110), the onBeforeCompile table (line 123) and the TSL table (line 138) have no code. Their examples come 70 to 130 lines later, after Displacement. A reader who follows the steps must jump down and back.
- Evidence: threejs-shaders.md lines 110-162 against lines 190-285.
- Proposed edit: Move "A fresnel glow" to the end of "ShaderMaterial and RawShaderMaterial", "Wind sway" to the end of "onBeforeCompile patches" and "A dissolve" to the end of "TSL and node materials", each as an H3 "Example: ...". Delete the "Worked examples" H2.
- Generated source: (written page)

## 4. porting/threejs-mapping: code in the cells has no code font, and the Docs column is not a link

- Severity: medium
- Category: scan-order
- Anchor: every table; "Docs" column; for example "WebGLRenderer / WebGPURenderer" row (line 27)
- Claim: Calls, options and values in the three.js, null3D and Notes columns are plain text: `createEngine({ canvas, sketch })`, `antialias: true`, `'msaa'`. A reader cannot tell code from prose. The Docs column shows a page ID in code font, such as `getting-started/first-scene`, so the reader cannot click to the page. Notes also cite pages as bare IDs in parentheses, such as "(concepts/post-processing)".
- Evidence: threejs-mapping.md line 27; tools/lib/docs.ts line 429 renders `` `${e.docs}` ``; the JSON notes hold unquoted code.
- Proposed edit: In the JSON, put code spans in backticks in `three`, `target` and `notes`. In `mappingMarkdown`, render the Docs cell as a relative link with the page title from PAGES, such as `[First scene](../getting-started/first-scene.md)`. Replace bare page IDs in notes with links, or let the generator turn `(area/page)` into a link.
- Generated source: docs/data/threejs-mapping.json and tools/lib/docs.ts (mappingMarkdown)

## 5. shaders/library: 148 H3 headings, one per constant and function, make the page hard to scan

- Severity: medium
- Category: heading-depth
- Anchor: every module section, for example "## `null3d::math`" with "### `PI`", "### `TAU`", "### `HALF_PI`", "### `INV_PI`", "### `EPSILON`" (lines 62-100)
- Claim: The page is 7,189 words and 1,374 lines. Every item gets an H3, a code block and often one sentence. Five constants of math each take a heading. `null3d::lighting` alone has 32 H3s. A page outline with 161 headings does not help a reader find a function. Each module also lacks a list of its items, so a reader must scroll the whole module.
- Evidence: stats.json headings for shaders/library; counts per module: math 17, noise 21, color 23, lighting 32, fog 15, vertex 12, depth 9, sdf 18, reflection 1. tools/lib/shader-library.ts `libraryPage` writes `### \`${item.name}\`` for every item.
- Proposed edit: In `libraryPage`, write each module as: its summary; a table of its constants (name, value, meaning); a table of its functions and structs (name linked to its entry, first sentence of its doc); then an H3 entry for each function and struct only. Constants get no H3. This keeps anchors for functions and cuts the outline by about a third.
- Generated source: tools/lib/shader-library.ts

## 6. shaders/library: doc comments collapse into one paragraph, and implementer detail has no place to go

- Severity: medium
- Category: long-paragraph
- Anchor: file lines 404, 688, 750, 782, 890, 976, 1028, 1136, 1176, 1360, 1368 (stats lines 397, 681, 743, 775, 883, 969, 1021, 1129, 1169, 1353, 1361)
- Claim: Eleven entries run over 90 words or 4 sentences. The generator joins all comment lines with a space, so a blank comment line that the author meant as a paragraph break vanishes. The fog summary shows it: "before any tone mapping and encoding.  Per pixel, the fog costs" (two spaces, one paragraph). Dense implementer facts sit in the main text: `dfg_lut` names "group 0 at binding 2" and "group 0 at binding 1"; `reflection_uv` and the reflection module explain row order per path.
- Evidence: crates/null3d-shaders/wgsl/lib/fog.wgsl lines 3-10 hold a blank `//` line; tools/lib/shader-library.ts `commentText` uses `.join(' ')`; library.md line 890 (fog summary, 117 words, 8 sentences), line 688 (`dfg_lut`, 105 words), lines 1360 and 1368 (reflection, 101 and 99 words).
- Proposed edit: In `commentText`, turn a blank `//` or `///` line into a paragraph break. Add a marker line, `/// Technical details:`, after which the rest of the comment goes into a technical details block on the page. Then edit the modules: fog summary splits into "what fog is" and a details block with the per-pixel cost; `dfg_lut` keeps its first sentence and moves the table layout and bindings into details; the reflection module and `reflection_uv` keep how to call them and move the row order per path into details; `SPECULAR_AA_VARIANCE`, `ambient_irradiance`, the vertex module summary, the depth module summary, `distance_code` and `limit_hdr` split at their second sentence.
- Generated source: tools/lib/shader-library.ts and crates/null3d-shaders/wgsl/lib/*.wgsl

## 7. porting/threejs-materials: the toon and matcap paragraph is a 155-word wall

- Severity: medium
- Category: long-paragraph
- Anchor: "## MeshToonMaterial and MeshMatcapMaterial", line 86 (stats line 79)
- Claim: One paragraph of 9 sentences gives two toon methods, the lobe contract, which lights call the lobe, a base-color trick and the matcap method. A reader cannot see that there are two choices for toon.
- Evidence: stats.json porting/threejs-materials longParagraphs line 79: 155 words, 9 sentences.
- Proposed edit: Write: "Both become custom materials. For toon shading, pick one:" then a list. 1. "A surface function with the light's direction as a uniform. It is simple, but follows one light. See the toon recipe." 2. "A lobe function, which follows every directional, point and spot light and their shadows." Then "Matcap is an unlit function that looks up a texture by the normal in view space." Move the lobe details (when the engine calls it, the black base color and roughness 1, no lobe for fill and area lights) into a technical details block, "Technical details: toon bands with a lobe function".
- Generated source: (written page)

## 8. porting/threejs-materials: recipes sit far below the sections that need them

- Severity: medium
- Category: example-placement
- Anchor: "## Recipes" (line 131); table rows `alphaMap` (line 36) and `clippingPlanes` (line 47) say "The recipe below"
- Claim: The toon and matcap section (line 84) has no code, and its recipes come 45 lines later after texture settings and color spaces. The alpha map and clipping plane rows point to "the recipe below" with no link. The fact that a custom material takes every standard option but the maps, and up to 6 textures, comes last (line 204), after all four recipes that rely on it.
- Evidence: threejs-materials.md lines 36, 47, 84-86, 131-204.
- Proposed edit: Move the toon and matcap recipes into "MeshToonMaterial and MeshMatcapMaterial". Keep "Recipes" for the clipping plane and the alpha map, rename it "Recipes for clipping planes and alpha maps", and link to it from the two table rows. Move the line 204 sentence to the top of that section.
- Generated source: (written page)

## 9. porting/threejs-overview: the workflow comes after four reference sections

- Severity: medium
- Category: scan-order
- Anchor: "## The workflow" (line 101)
- Claim: This is the entry page of the porting area. Its diagram shows the six steps, but the numbered steps come only after "What gets faster", "What changes in the code", "What needs rewriting by hand" and "What stays the same". A newcomer who wants to start reads three tables first.
- Evidence: stats.json headings for porting/threejs-overview.
- Proposed edit: Move "The workflow" (with "A large app in two steps") right after the intro under the diagram. Then "A small example", then the reference sections. Or keep the order and add one line under the diagram: "[The workflow](#the-workflow) gives the steps. The sections before it list what changes."
- Generated source: (written page)

## 10. porting/threejs-overview: "What stays the same" holds the list of settings that change the look

- Severity: medium
- Category: structure
- Anchor: "## What stays the same", line 94 "Some settings change the look, so check them first when a port looks different:"
- Claim: The four items (tone mapping, pixel ratio, shadows, light range) are differences, the first thing to check when a port looks wrong. They sit under a heading that says nothing changes, so a reader who scans headings misses them.
- Evidence: threejs-overview.md lines 85-99.
- Proposed edit: Give the list its own H2, "Settings that change the look", right after "What stays the same".
- Generated source: (written page)

## 11. porting/react-three-fiber: the first code is the complex view component; the simple one has no code

- Severity: medium
- Category: example-placement
- Anchor: "## A view component" (line 33); line 107 "A simpler component also works."
- Claim: The first code on the page is 63 lines, with an engine cache, a timer and StrictMode handling. A newcomer needs the simple component first: a canvas, `createEngine` in an effect, `destroy()` in the cleanup. The page gives that only as prose after the long code.
- Evidence: react-three-fiber.md lines 33-107.
- Proposed edit: Open the section with the simple component as a short code block (about 15 lines). Then add "### A view that keeps its engine" for apps that switch views, with the long component and its four bullets. Move the StrictMode and per-mount handler bullets into a technical details block under that code.
- Generated source: (written page)

## 12. shaders/surface-functions: long paragraphs on the page

- Severity: medium
- Category: long-paragraph
- Anchor: file lines 13, 38, 100, 150, 168, 590 (stats lines 6, 31, 93, 143, 161, 583)
- Claim: Six paragraphs run over the limit: the opening (85 words, 5 sentences), "Make a custom material" (49 words, 5 sentences), `defaultSurface` (95 words, 7 sentences), the sky's normal (95 words, 6 sentences), occlusion (97 words, 5 sentences) and built-in values (91 words, 6 sentences).
- Evidence: stats.json shaders/surface-functions longParagraphs.
- Proposed edit: Line 13: end the first paragraph after "it returns a `Surface`"; start a second with "The engine then lights the surface". Line 38: make the options a list (`wgsl`, `uniforms`, `textures`, standard options). Line 100: turn the starting values of `defaultSurface` into a short table (field, starting value) and keep one lead sentence. Line 150: keep the first two sentences; move the crown example to a sentence under the code. Line 168: split at "That suits an occlusion map"; the second paragraph is the case for `occlusionByMinimum`. Line 590: keep the first sentence and the link to Built-in shader inputs; make the rest a three-item list (`frame.time`, `object.position`, `object.values`).
- Generated source: (written page)

## 13. shaders/surface-functions: the list of reserved names is one 230-word bullet

- Severity: medium
- Category: technical-details-block
- Anchor: "## Rules", first bullet (line 611) "Do not declare a name that the engine declares."
- Claim: The bullet lists about 70 names in run-on sentences, with conditions (instance, matrices, lobe) mixed in. The rule itself is one sentence. A reader needs the list only when the build stops on a clash, and then they get the name from the error.
- Evidence: surface-functions.md line 611.
- Proposed edit: Keep "Do not declare a name that the engine declares. The build stops at your line when a name clashes." Move the names into a technical details block, "Technical details: the names that the engine declares", as four short lists: always declared; added when the WGSL reads `instance` or `object.id`; added when it reads the object's matrices; added when it declares a lobe.
- Generated source: (written page)

## 14. shaders/surface-functions: the "pays nothing" note repeats in seven sections

- Severity: medium
- Category: duplication
- Anchor: lines 146, 164, 181, 209, 415, 464, 488
- Claim: Each advanced field ends with a near-identical bullet: "The engine compiles the ... into the material's builds alone, where its WGSL names the field. A material that does not name it pays nothing." The reader reads the same rule seven times, and the bullet hides the facts that differ per section.
- Evidence: surface-functions.md lines 146, 164, 181 ("pays nothing, and its builds stay as they were"), 209, 415, 464, 488.
- Proposed edit: State the rule once, in "The surface" under its table: "A field costs something only in a material whose WGSL names it. The engine builds that field's code into that material alone." Delete the repeats. Keep only the per-section facts, such as "the material also needs the `transmission` option at creation" and the E1217 cases.
- Generated source: (written page)

## 15. shaders/surface-functions: "Cut-out shapes" mixes prose and bullets out of order, and comes after "Shadows"

- Severity: medium
- Category: structure
- Anchor: "## Cut-out shapes" (line 559), lines 574-586; "## Shadows" (line 534)
- Claim: After the example, three paragraphs describe the passes that run the function, then three bullets repeat the same points (shadow, motion, hash). The paragraph about inputs in each pass (line 578) and the depth copy note (line 580) are implementer detail. "Shadows" comes first and depends on alpha masking, which "Cut-out shapes" introduces.
- Evidence: surface-functions.md lines 534-586.
- Proposed edit: Put "Cut-out shapes" before "Shadows". Under the example, keep the `alphaToCoverage` and `hash` sentences, then one list: the shadow keeps the mask's holes; a vertex offset adds a motion build with the same holes; a hashed mask casts a hashed shadow. Move lines 576-580 (which passes run the function, what inputs each gets, no depth copy there) and line 586 (levels of detail) into a technical details block, "Technical details: the passes that run a masked surface".
- Generated source: (written page)

## 16. shaders/surface-functions: dense texture-budget and texture-array detail in the "Textures" bullets

- Severity: medium
- Category: technical-details-block
- Anchor: "## Textures", bullets at lines 279 (texture arrays) and 283 (up to 6 textures); error list at lines 310-316
- Claim: The section has 10 bullets. The texture unit arithmetic (7 units for lighting, at least 16 units, 3 free, E1209) is implementer detail in a bullet of about 90 words. The texture array bullet is 100 words and sits before its own example, 9 lines later.
- Evidence: surface-functions.md lines 277-316.
- Proposed edit: Keep "A material samples up to 6 textures. Each takes one of the 32 numbers of the uniforms." Move the WebGL2 unit budget and E1209 into a technical details block after the list. Move the texture array bullet into a short paragraph directly above the facade example. Put the E1216 cases and the build errors (lines 310-316) in a technical details block, "Technical details: texture errors".
- Generated source: (written page)

## 17. shaders/surface-functions: shadow caching sits in "Vertex offsets", and the vertex record sits in "Shadows"

- Severity: low
- Category: structure
- Anchor: "## Vertex offsets" bullets at lines 531-532 (`castsStill`, `swayDistance`); "## Shadows" bullets at lines 553, 554, 557
- Claim: The last two vertex offset bullets are about shadow cascade caching. The last "Shadows" bullet is about the vertex record, an input of vertex offsets. Lines 553 and 554 are details of how the caster builds and culls.
- Evidence: surface-functions.md lines 528-557.
- Proposed edit: Move the vertex record bullet (557) into "Vertex offsets", under the `vertexRecord` row. Move the `castsStill` and `swayDistance` bullets into "Shadows" as "Shadows of moving vertices". Put bullets 553 and 554 in a technical details block in "Shadows", keeping one main-text sentence: "Give flat single-sided casters `doubleSided: true`, or they cast nothing."
- Generated source: (written page)

## 18. shaders/surface-functions: the Surface table mixes core fields with layer fields

- Severity: low
- Category: scan-order
- Anchor: "## The surface" table (lines 71-98)
- Claim: The table has 23 rows. A newcomer needs about 8 (base color, alpha, metalness, roughness, normal, emissive, occlusion, irradiance). They are mixed with two extra normals, a lobe vector, a shadow offset, transmission, coat, sheen and iridescence rows, some 50 words long.
- Evidence: surface-functions.md lines 71-98.
- Proposed edit: Split into two tables: "Fields every surface uses" and "Fields for layers and special light paths", each row linking to its section. If finding 2 is done, the second table moves to the new page.
- Generated source: (written page)

## 19. porting/threejs-postprocessing: two long paragraphs

- Severity: medium
- Category: long-paragraph
- Anchor: line 125 "Uniforms are `f32`..." (stats line 118); line 210 "For any other curve, `post.set` takes the WGSL..." (stats line 203)
- Claim: Line 125 has 70 words in 5 sentences: types, a size limit, packing, color strings and errors. Line 210 has 70 words in 6 sentences: the function shape, when it runs, what follows, the vignette and the uniform rule.
- Evidence: stats.json porting/threejs-postprocessing longParagraphs.
- Proposed edit: Line 125: make a list: allowed types; up to 32 floats, each `vec3f` and `vec4f` starting a group of four; a `vec3f` takes a color string; a wrong name fails the type check and throws E1216. Line 210: keep "The WGSL declares `fn toneCurve(color: vec3f) -> vec3f`" and "A tone curve takes no uniforms" in the text. Move the order of steps (after bloom, clamp, sRGB, grading, dithering, vignette first) into a technical details block or a short list.
- Generated source: (written page)

## 20. porting/threejs-postprocessing: long conversion cells in the passes table

- Severity: medium
- Category: technical-details-block
- Anchor: "## Passes that become settings" rows `OutlinePass` (line 63), `ShaderPass(VignetteShader)` (line 65), `SharpenNode` (line 68), `BokehPass` (line 69)
- Claim: These Notes cells run 60 to 110 words. They mix the mapping (which option becomes which) with derivations (FSR 1's RCAS, the 2^-sharpness formula, why corners darken). The table becomes hard to scan.
- Evidence: threejs-postprocessing.md lines 63, 65, 68, 69.
- Proposed edit: Keep in each cell only the renames and the one number to set, such as "`sharpen: 0.87` for three.js's default of 0.2". Move the explanations under the table into a technical details block, "Technical details: matching outlines, vignettes, sharpening and depth of field", with one bullet per pass.
- Generated source: (written page)

## 21. shaders/wgsl-rules: three long paragraphs, two of them implementer detail

- Severity: medium
- Category: technical-details-block
- Anchor: lines 53, 55, 65 (stats lines 46, 48, 58)
- Claim: Line 55 (115 words, 7 sentences) explains how the build splits GLSL structs for phone GPUs. The reader only needs the rule: keep values in an array of structs within half precision's range. Line 53 (68 words) explains array copies. Line 65 (73 words) holds a WebKit commit ID, "321006@main", and a release status.
- Evidence: stats.json shaders/wgsl-rules longParagraphs.
- Proposed edit: Line 53: lead with the rule, "Read a uniform array one element at a time.", then the reason in one sentence. Line 55: keep "Keep the values in an array of structs within half precision's range, from about 6.1e-5 to 65504. The build fails and names the function when it cannot split a struct." Move how the build splits structs, pointers, `modf` and `frexp` into a technical details block, "Technical details: how the build splits structs for WebGL2". Line 65: keep the warning and that Safari 27.0 fails. Move the WebKit fix ID into a technical details block, or delete it.
- Generated source: (written page)

## 22. shaders/builtins: the cost paragraph is a 112-word wall before its table

- Severity: medium
- Category: long-paragraph
- Anchor: "## What the inputs cost", line 106 (stats line 99)
- Claim: Six sentences cover three ideas: unused values are free; how the plugin finds the fields it reads; what happens when a mesh lacks an input. The table that the paragraph leads into comes after all three.
- Evidence: stats.json shaders/builtins longParagraphs line 99: 112 words, 6 sentences.
- Proposed edit: Lead with two sentences: "A value that a material does not read costs nothing. The inputs in this table cost something, so only WGSL that reads them gets them." Then the table. After it: "A mesh that lacks an input that the material reads does not draw with it. A mesh without second texture coordinates gives its first set." Move how the plugin finds the fields (the type rule, your own `tangent` field) into a technical details block.
- Generated source: (written page)

## 23. shaders/builtins, shaders/wgsl-rules, shaders/library: page facts are hidden in the status banner

- Severity: medium
- Category: scan-order
- Anchor: the blockquote under each H1 (builtins line 11, wgsl-rules line 11, library line 13)
- Claim: The banner starts with the roadmap step, which readers learn to skip. Each of these banners then adds a fact the reader needs: "The built-in values hold no light values. Pass a light's direction or color to a material as a uniform." (builtins); "It draws no other shader of your own." (wgsl-rules); "A custom material's surface function, vertex offset or full shader can call these modules." (library). These facts are lost.
- Evidence: builtins.md line 11; wgsl-rules.md line 11; library.md line 13; tools/lib/shader-library.ts line 263.
- Proposed edit: End each banner after the stability sentence. Move the builtins fact into the first paragraph, after the list of the four values, and the wgsl-rules fact into its first paragraph. In tools/lib/shader-library.ts, move the library sentence into INTRO.
- Generated source: tools/lib/shader-library.ts (library); builtins and wgsl-rules are written pages

## 24. shaders/library and porting/threejs-mapping: decision record numbers in published text

- Severity: medium
- Category: internal-note
- Anchor: library `SPECULAR_AA_LIMIT` (line 608) "(D-79)"; mapping row "FXAAPass / FXAAShader / SMAAPass / TAARenderPass / SSAARenderPass" (line 255) "(D-206)"
- Claim: The writing rules forbid decision record numbers in docs/. A reader cannot follow them, because the records are not published to users.
- Evidence: crates/null3d-shaders/wgsl/lib/lighting.wgsl line 19; docs/data/threejs-mapping.json line 1762.
- Proposed edit: Delete "(D-79)". In the mapping note, delete "(D-206)" and the sentence about the prototype that does not ship. Write "A moving view has no temporal anti-aliasing. Use MSAA or FXAA."
- Generated source: crates/null3d-shaders/wgsl/lib/lighting.wgsl; docs/data/threejs-mapping.json

## 25. porting/threejs-mapping: the Since column and its legend add width and roadmap words

- Severity: low
- Category: structure
- Anchor: lines 17-22 "The "Since" column gives the roadmap step..."; the Since column of every table
- Claim: Every value is 0.1, 0.2 or 0.3, and the page says all three ship in null3D 0.1.0. The column tells the reader nothing they can act on. It takes width from the Notes column, and its legend leads the page with roadmap terms before the first table.
- Evidence: Since counts in the JSON: 99 at 0.1, 78 at 0.2, 15 at 0.3, 2 without. tools/lib/docs.ts line 411.
- Proposed edit: Drop the Since column and the `sinceLegend` text from the page render. Keep the Status legend. If the field must stay for the skill copy, keep it in the JSON only.
- Generated source: tools/lib/docs.ts (mappingMarkdown); docs/data/threejs-mapping.json

## 26. porting/react-three-fiber: the step-by-step list is at the end

- Severity: low
- Category: scan-order
- Anchor: "## Step by step" (line 221)
- Claim: The seven steps are the plan of a port, and each points to a section above. At the end of the page a reader meets them after they have read the details.
- Evidence: react-three-fiber.md lines 221-229.
- Proposed edit: Move "Step by step" to right after the diagram and line 31. Link each step to its section: step 4 to "A view component", step 2 to "State between React and the sketch", and so on.
- Generated source: (written page)

## 27. porting/threejs-unsupported: long workaround cells repeat the materials page

- Severity: low
- Category: duplication
- Anchor: "## Materials and shaders" row `MeshToonMaterial` (line 38); row "Clipping planes" (line 43)
- Claim: The toon workaround cell is about 70 words and repeats the lobe rules from porting/threejs-materials. The clipping cell repeats the `clipShadows` detail. In a list of gaps, a reader wants the workaround in one line.
- Evidence: threejs-unsupported.md lines 38 and 43; threejs-materials.md lines 47 and 86.
- Proposed edit: Toon: "A surface function or a lobe function that steps the light into bands ([Porting materials and textures](threejs-materials.md#meshtoonmaterial-and-meshmatcapmaterial))". Clipping: "A surface function with `alphaMode: 'mask'` ([recipe](threejs-materials.md#recipes))".
- Generated source: (written page)

## 28. porting/threejs-shaders: the opening paragraph after the diagram is too dense

- Severity: low
- Category: long-paragraph
- Anchor: line 26 (stats line 19) "A custom material takes its WGSL in one `wgsl` option..."
- Claim: Five sentences in 68 words give four separate facts: where the WGSL goes, which functions it holds, full shaders, and uniforms.
- Evidence: stats.json porting/threejs-shaders longParagraphs line 19.
- Proposed edit: Make it a short list under "A custom material takes its WGSL in one `wgsl` option:": a template literal tagged `/* wgsl */` or a `.wgsl` import; `fn surface`, `fn vertexOffset`, or both; or a full shader's `@vertex` and `@fragment`; uniforms declared once as `struct Uniforms` and read from `material`. Keep the two links in a sentence after the list.
- Generated source: (written page)

## 29. porting/verification: the three.js frame counting detail is dense for the main text

- Severity: low
- Category: technical-details-block
- Anchor: "## Compare performance", lines 144-157
- Claim: The paragraph on why `requestAnimationFrame` overcounts, the WebGPURenderer code and the `fenceSync` method are needed only by a reader who times three.js by hand. They sit between the measure table and the note about unoptimized originals.
- Evidence: verification.md lines 144-159.
- Proposed edit: Keep one sentence: "Count the three.js frames that drew and the frames that the GPU finished, and compare with the lower rate." Move the reason, the code block and the WebGL fence method into a technical details block, "Technical details: counting three.js frames".
- Generated source: (written page)

## 30. porting/threejs-loop-and-threads and porting/threejs-overview: the main-thread mode is described twice

- Severity: low
- Category: duplication
- Anchor: loop-and-threads "## A sketch on the main thread" (line 216); overview "### A large app in two steps" (line 117)
- Claim: Both pages explain `sketchThread: 'main'`, the two-step port, that render and job workers keep running, and that layout work can delay frames, in nearly the same words.
- Evidence: threejs-loop-and-threads.md line 218; threejs-overview.md lines 119-124.
- Proposed edit: Keep the full text on the overview page, which owns the workflow. On the loop page, keep one sentence and a link: "A large app can port with the sketch on the main thread first ([A large app in two steps](threejs-overview.md#a-large-app-in-two-steps))." Keep the paragraph about pages without cross-origin isolation.
- Generated source: (written page)

---

## Not verified

The findings below were not checked as closely as the top 30.

## 31. porting/threejs-loop-and-threads: opening paragraph has 5 short sentences (not verified)

- Severity: low
- Category: long-paragraph
- Anchor: line 27 (stats line 20) "A three.js app usually runs everything on the main thread"
- Claim: 51 words in 5 sentences, just over the sentence limit. It reads well, but the last three sentences are a list of the two sides.
- Proposed edit: Keep the first two sentences. Then: "The page module runs on the main thread and keeps the HTML. The sketch runs in a worker and keeps the scene. They talk through small messages." as a two-item list, or leave as is.
- Generated source: (written page)

## 32. porting/threejs-mapping: the "Other" section mixes unrelated topics (not verified)

- Severity: low
- Category: structure
- Anchor: "## Other" (line 283)
- Claim: Its 11 rows cover WebXR, Gaussian splats, audio, GUI panels, physics, three-mesh-bvh, React Three Fiber, GLSL strings, DOM access, the Vite config and workers. A reader who scans headings cannot find audio or physics.
- Proposed edit: In the JSON, give these entries the categories "Audio", "Libraries and frameworks" and "Build, workers and the DOM". Keep "Other" only for WebXR and splats, or fold those into "Renderer and loop" and "Geometry".
- Generated source: docs/data/threejs-mapping.json

## 33. porting/threejs-postprocessing and porting/threejs-mapping: SMAA described two ways (not verified)

- Severity: low
- Category: contradiction
- Anchor: postprocessing passes table row `SMAAPass, SSAARenderPass, TAARenderPass` (line 67) "null3D has no SMAA, SSAA or TAA."; mapping FXAAPass row notes "SMAA 1x smooths the moment transparency layer's edges"
- Claim: The engine uses SMAA 1x inside the moment transparency layer, but the post-processing page says it has no SMAA. The intent is "no SMAA pass for the whole image", but the plain sentence reads as false next to the mapping.
- Proposed edit: Write "null3D has no SMAA, SSAA or TAA pass for the whole image."
- Generated source: (written page); docs/data/threejs-mapping.json

## 34. shaders/surface-functions: the scene depth example reaches into engine internals (not verified)

- Severity: low
- Category: unclear
- Anchor: "## The scene's depth" example, `distance_of` reads `engine_frame.camera_range` and `engine_frame.camera_position.w` (lines 360-367)
- Claim: `engine_frame` is in the list of names that the engine declares, and the page documents none of its fields. A reader cannot tell what `camera_position.w > 0.5` means. The built-in `camera.near` and `camera.far` cover the range.
- Proposed edit: Write the helper from `camera.near`, `camera.far` and a documented way to tell perspective from orthographic, or give the conversion as a library function in `null3d::depth` and call it. If the internals must stay, add one comment line that says what each value holds.
- Generated source: (written page)

## 35. porting/threejs-materials: the MeshStandardMaterial table has long cells (not verified)

- Severity: low
- Category: technical-details-block
- Anchor: row `clippingPlanes` (line 47), row `displacementMap` (line 35)
- Claim: The `clippingPlanes` cell is about 60 words with the `fn coverage` trick for `clipShadows: false`. That detail belongs with the clipping recipe.
- Proposed edit: Cell: "The recipe below cuts a mesh at a plane, shadow included." Move the `clipShadows: false` note under the clipping recipe.
- Generated source: (written page)

## 36. shaders/builtins: dense rows in the `frame` and `camera` tables (not verified)

- Severity: low
- Category: technical-details-block
- Anchor: `frame` rows `lastFrame` and `resolution` (lines 36-37); paragraph after the `camera` table (line 54)
- Claim: The motion pass's second call and the masked shadow caster's resolution are implementer cases inside table cells. The shadow pass sentence in line 54 is the same kind of detail.
- Proposed edit: Shorten the cells to what the field holds in a normal draw. Add a technical details block after each table with the motion pass and shadow pass cases.
- Generated source: (written page)

## 37. Every page in the slice: the banner leads with a roadmap step (not verified)

- Severity: low
- Category: scan-order
- Anchor: the blockquote under each H1, "Roadmap step 0.x, first released in null3D 0.1.0."
- Claim: The first words a newcomer reads name an internal roadmap step that means nothing to them. The release number is the useful part.
- Proposed edit: Lead with the release: "First released in null3D 0.1.0. The API is experimental, so it can still change between versions." The docs check that asks for the step wording would need the same change.
- Generated source: tools/lib/steps.ts (shipsSentence) and the docs check in tools/lib/docs.ts

## 38. porting/threejs-overview, porting/threejs-materials, porting/threejs-postprocessing, porting/verification: the tone mapping default is repeated (not verified)

- Severity: low
- Category: duplication
- Anchor: overview line 96; materials line 129; postprocessing lines 28 and 56; verification line 49
- Claim: Five places say that null3D defaults to punchy AgX and that an original without tone mapping needs `toneMapping: 'none'`. Some repeats help, because readers land on any page, but the postprocessing page says it twice.
- Proposed edit: On porting/threejs-postprocessing, keep the line 28 paragraph and cut the repeat in the table row at line 56 to "`'agx-punchy'`, the default, has no three.js match."
- Generated source: (written page)

## 39. shaders/wgsl-rules: no short checklist for the rules a developer must follow by hand (not verified)

- Severity: low
- Category: scan-order
- Anchor: "## Rules the build cannot check" (line 73)
- Claim: The rules that fail silently (limits, 32-bit float filtering, sampling in branches, `%`) sit at the end, after the rules the build enforces loudly. A reader porting a shader most needs the silent ones.
- Proposed edit: Add a four-item list in the intro, after line 15, linking each rule the build cannot check.
- Generated source: (written page)
