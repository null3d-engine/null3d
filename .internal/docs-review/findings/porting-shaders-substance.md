# Porting and shaders: sense and substance review

Slice: porting/react-three-fiber, porting/threejs-loop-and-threads, porting/threejs-mapping, porting/threejs-materials, porting/threejs-overview, porting/threejs-postprocessing, porting/threejs-shaders, porting/threejs-unsupported, porting/verification, shaders/builtins, shaders/library, shaders/surface-functions, shaders/wgsl-rules.

Paths below are relative to the generated copy of the repository. "Stats line" is the line that stats.json gives (the body without front matter). "File line" is the line in the generated page.

Findings 1 to 30 are verified against the source. Findings 31 to 37 are marked "not verified".

## Findings, ranked

### 1. The shader library page leaves out the modules that full shaders need (high, missing-content)

- Page: shaders/library (also porting/threejs-shaders, shaders/builtins)
- Anchor: "## Modules" table
- Claim: The page lists nine modules. Other pages tell readers to import `null3d::mesh` (`InstanceIn`, `find_instance`, `clip_position`, `relative_position`, `world_normal`, `finish`, `finish_exposed`) and `null3d::builtins` (`fill_builtins`, `frame`). Neither module is on the library page. The generator comment says shaders other than the engine's "cannot rely on" the other modules, which contradicts the full-shader docs.
- Evidence: tools/lib/shader-library.ts:16-31 (PUBLIC_MODULES has no `mesh` or `builtins`); crates/null3d-shaders/wgsl/lib/mesh.wgsl:248 (`struct InstanceIn`); docs/porting/threejs-shaders.md:89 ("A full shader calls `clip_position` from `null3d::mesh`"); docs/shaders/builtins.md:13 and :98; docs/guides/custom-shaders.md:53-92; docs/errors/E1215.md:13.
- Proposed edit: Add `mesh` and `builtins` to PUBLIC_MODULES, and give their public items doc comments (or a curated public subset: `InstanceIn`, `find_instance`, `clip_position`, `relative_position`, `world_normal`, `finish`, `finish_exposed`, `fill_builtins`, `frame`, `camera`, `object`). Fix the comment in shader-library.ts to say which modules full shaders may use. Put the WebGPU/WebGL2 instance details of `InstanceIn` in a "Technical details: how InstanceIn differs on each GPU path" block.
- Source: tools/lib/shader-library.ts; crates/null3d-shaders/wgsl/lib/mesh.wgsl; crates/null3d-shaders/wgsl/lib/builtins.wgsl

### 2. "Replace three.js's lighting with a full shader" sends readers to a dead end (high, wrong-claim)

- Page: porting/threejs-shaders
- Anchor: file lines 20 (Mermaid "replaces the lighting"), 35, 133
- Claim: The page says a shader that replaces three.js's lighting becomes "a full shader with the `null3d::lighting` helpers". A full shader gets no lights, no uniforms and no textures. The built-in values hold no light values. So a full shader cannot learn where the lights are, and cannot take a light direction as a uniform either. The page's own line 39 says this, but the table does not. The lobe function is the tool that does read each light.
- Evidence: docs/guides/custom-shaders.md (Full shaders, last rule: "The standard values, uniforms and textures do not reach a full shader"); docs/shaders/builtins.md:11 ("The built-in values hold no light values. Pass a light's direction or color to a material as a uniform"); docs/shaders/surface-functions.md "A material's own lobe".
- Proposed edit: Change the row to: "Changes how each light lights the surface, such as toon bands or a rim: a lobe function, `fn lobe(input: LobeInput) -> vec3f` ([A material's own lobe](../shaders/surface-functions.md#a-materials-own-lobe)). A full shader gets no lights, uniforms or textures, so use one only for a look with no scene light." Do the same in the onBeforeCompile table and the Mermaid diagram (add a "changes each light's response" edge to "Lobe function").

### 3. Swizzle assignment: the porting page says Chrome allows it, the build rejects it everywhere (high, contradiction)

- Page: porting/threejs-shaders (with shaders/wgsl-rules)
- Anchor: file line 65 ("Only Chrome allows assignment to a swizzle."), file line 291 ("WGSL has no assignment to a swizzle in most browsers.")
- Claim: A reader learns that `v.xy = w` works in Chrome. The null3D build rejects every swizzle assignment, in every browser.
- Evidence: docs/shaders/wgsl-rules.md:29 (`swizzle_assignment`: "An assignment to a swizzle, such as `color.rgb *= 2.0;`" is rejected).
- Proposed edit: Line 65: "`v = vec3f(w, v.z);`. The null3D build rejects an assignment to a swizzle ([WGSL rules](../shaders/wgsl-rules.md#language-features))." Line 291: "The build rejects an assignment to a swizzle. Write the whole vector."

### 4. The tolerance table promises tolerances that the test command cannot apply (high, wrong-claim)

- Page: porting/verification
- Anchor: "## Tolerances", file lines 106-112
- Claim: The table gives "Under 0.5% of pixels" for directional shadows and "Review the diff image" for other content. `bunx @null3d/cli test` has one fixed tolerance: 0.1% of pixels past 10% of the range. No test setting changes it. A port with shadows that differs by 0.3% fails, and the reader has no way to accept it in the test.
- Evidence: packages/cli/src/compare.js:23 (`TOLERANCE = { threshold: 0.1, maxDiffRatio: 0.001 }`); docs/cli/null3d.md:290-298 (test settings: name, sketch, page, hold, script, size, tiers; no tolerance); docs/cli/null3d.md:310.
- Proposed edit: Add after the table: "`bunx @null3d/cli test` fails every image past 0.1% of pixels. For a view with a looser tolerance, capture it with `bunx @null3d/cli shot`, read the diff by eye, and write the result in the report. Keep only the views that pass at 0.1% in `null3d.json`." Or add a per-test tolerance setting to the CLI and document it.

### 5. WGSL rules page says the engine draws no other shader of your own (high, contradiction)

- Page: shaders/wgsl-rules
- Anchor: file line 11 ("It draws no other shader of your own.")
- Claim: The engine also draws custom effects (`post.addEffect`), custom tone curves, sky layers, full-screen passes and compute passes. These pages and the error text name them. A reader may think the rules do not apply to effects, or that effects do not exist.
- Evidence: docs/errors/E1215.md:13 (effects, tone curves, sky layers); docs/porting/threejs-postprocessing.md:93, :189; docs/api/reference/render.md:59, :175 (compute passes).
- Proposed edit: "The engine draws WGSL of your own in custom materials (surface functions and full shaders), custom effects and tone curves, sky layers, and the passes of `render.addPass`. Every one follows the rules on this page."

### 6. Mapping rows mix supported and unsupported features under one status, so the porting scanner miscounts (high, contradiction)

- Page: porting/threejs-mapping (with porting/threejs-unsupported, porting/threejs-overview)
- Anchor: rows "OrbitControls / MapControls / TrackballControls / ArcballControls" (status changed), "FilmPass / GlitchPass / HalftonePass / AfterimagePass / ..." (status manual), "renderer.shadowMap.enabled / .type (PCFSoftShadowMap, VSMShadowMap)" (status changed)
- Claim: TrackballControls, ArcballControls, AfterimagePass, BasicShadowMap and VSMShadowMap have no equivalent (the unsupported page lists them). The mapping files them under `changed` or `manual`. The scanner groups features by the mapping status and sizes the effort by it, so an app that uses TrackballControls or AfterimagePass shows no unsupported feature in its inventory.
- Evidence: docs/data/threejs-mapping.json (those rows); docs/porting/threejs-unsupported.md:25, :30, :62; skills/null3d-port-threejs/scripts/analyze-threejs.mjs:149-155 (groups and weighs by `entry.status`).
- Proposed edit: Split each row so each feature has one honest status: "TrackballControls / ArcballControls: unsupported", "AfterimagePass: unsupported", "BasicShadowMap / VSMShadowMap: unsupported". Add a docs check that every three.js name on the unsupported page has a mapping row with status `unsupported`.
- Source: docs/data/threejs-mapping.json

### 7. Decision record numbers and prototype history reach user docs (high, internal-note)

- Pages: porting/threejs-mapping, shaders/library
- Anchor: mapping row "FXAAPass / FXAAShader / SMAAPass / TAARenderPass / SSAARenderPass" ("TAA of a moving view is a prototype that does not ship: ... measured and did not pass (D-206)"); mapping row "TRAANode / traa() / TAAUNode" ("The temporal resolve's prototype passes the engine's own paths, and its quality against the reference was measured ... so no version ships it"); library `SPECULAR_AA_LIMIT` ("The lower limit flickers less on small glossy shapes (D-79).")
- Claim: Decision record numbers and the story of a prototype are maintainer notes. AGENTS.md forbids them in docs/.
- Evidence: docs/data/threejs-mapping.json:1762, :1773; crates/null3d-shaders/wgsl/lib/lighting.wgsl:19; AGENTS.md "Writing docs".
- Proposed edit: Mapping: "null3D has no temporal anti-aliasing of a moving view. A view that holds still blends jittered frames into a sharper picture by itself." Delete the prototype sentences. Library: delete "(D-79)". Add "D-[0-9]" and "prototype" to the docs style check, and run it over generated pages and the sources that feed them.
- Source: docs/data/threejs-mapping.json; crates/null3d-shaders/wgsl/lib/lighting.wgsl

### 8. Post-processing page says null3D has no SMAA, SSAA or TAA; the mapping and unsupported pages say otherwise (medium, contradiction)

- Page: porting/threejs-postprocessing (with porting/threejs-mapping, porting/threejs-unsupported)
- Anchor: file line 67 ("null3D has no SMAA, SSAA or TAA.")
- Claim: The mapping says SMAA 1x smooths the moment transparency layer's edges, and a still view blends jittered frames into a sharper picture. The unsupported page says the same for a still view. A reader who ports TAARenderPass on a still product view gets different advice from each page. The still-view blend also matters for image checks.
- Evidence: docs/porting/threejs-mapping.md:255; docs/porting/threejs-unsupported.md:31.
- Proposed edit: "null3D has no SMAA pass, no SSAA and no TAA of a moving view. A view that holds still blends jittered frames by itself, so TAARenderPass and SSAARenderPass on a still camera need no pass ([The post-processing chain](../concepts/post-processing.md))."

### 9. The `?view=` parameter in the verification recipe is also the engine's debug-view switch (medium, wrong-claim)

- Page: porting/verification
- Anchor: "## Compare the port with image tests", file lines 78, 98, 101 (`"page": "/?view=hero-closeup"`, `shot --page '/?view=hero-closeup'`)
- Claim: On a page address, `?view=<name>` picks a debug view. A camera view named `normals`, `depth`, `shadows`, `wireframe`, `motion` or `levels` then draws a debug view, and the image test compares the wrong picture. The page test also needs the page to pass the parameter on to the sketch, which the page does not explain.
- Evidence: packages/engine/src/page/switches.ts:503 (`view: params.get('view')`); docs/api/debug.md:134 ("`?view=<name>` picks any debug view on any page ... A name that no view has draws the materials.").
- Proposed edit: Rename the parameter to `?camera=` in the JSON, the sketch code and the `shot` command. Add: "In a page test, the page reads `camera` from its own address and passes it to the sketch in the sketch's address."

### 10. No porting page links to the three.js comparisons or to any demo (medium, missing-content)

- Pages: porting/threejs-overview, porting/verification, porting/threejs-shaders, porting/threejs-postprocessing, porting/threejs-materials, porting/threejs-loop-and-threads, porting/react-three-fiber, porting/threejs-unsupported
- Anchor: whole pages (stats.json: exampleLinks is empty for every page in the slice)
- Claim: The repository has three scenes that run in three.js and in null3D from one description (battle, factory, night-town). They are the best worked example of a port, of image parity and of timing both engines. No porting page links them.
- Evidence: examples/compare/comparisons.ts:99, :169, :237; tests/image/references/chrome-real-gpu/webgpu/compare-night-town-threejs.png and compare-night-town-null3d.png.
- Proposed edit: Overview, "What gets faster": "Three scenes run in both engines from one description: [battle](https://github.com/null3d-engine/null3d/tree/main/examples/compare/battle/), [factory](https://github.com/null3d-engine/null3d/tree/main/examples/compare/factory/) and [night town](https://github.com/null3d-engine/null3d/tree/main/examples/compare/night-town/)." Verification, "Compare performance": the same links. Shaders, "onBeforeCompile patches": link battle (grass and flags sway with WGSL in null3D and GLSL added to MeshStandardMaterial in three.js). See the per-page demo lists below.

### 11. The scene-depth example reads an undocumented engine value (medium, term-before-definition)

- Page: shaders/surface-functions
- Anchor: "## The scene's depth", file lines 361-363 (`engine_frame.camera_range`, `engine_frame.camera_position.w`)
- Claim: `engine_frame` and its fields appear nowhere in the built-in inputs page. The Rules section lists `engine_frame` as an engine name that the reader must not declare. A reader cannot tell if the field is public or how `camera_position.w` marks a perspective camera. The documented values give the same result.
- Evidence: docs/shaders/builtins.md (only `frame`, `camera`, `object`, `material`); docs/shaders/surface-functions.md:611; docs/shaders/library.md (`null3d::depth::is_orthographic`, `linear_depth`, `orthographic_depth_to_view_z`); the same internal value in docs/guides/custom-passes.md:421.
- Proposed edit: Rewrite `distance_of` with documented values: `#import null3d::depth::{is_orthographic, linear_depth, orthographic_depth_to_view_z}` and `if is_orthographic(camera.projection) { return -orthographic_depth_to_view_z(depth, camera.near, camera.far); } return linear_depth(depth, camera.near, camera.far);`. Or document `engine_frame` on the built-ins page.

### 12. Mapping notes are walls of text inside table cells (medium, wall-of-text)

- Page: porting/threejs-mapping
- Anchor: every section table; the longest notes are "CSS2DRenderer / CSS3DRenderer" (409 words), "LOD (addLevel) / SimplifyModifier" (351), "Raycaster.setFromCamera" (283), "MeshPhysicalMaterial transmission" (276), "AnimationMixer" (273)
- Claim: 76 of the 194 notes are longer than 80 words, in one table cell each. The page is about 22,000 words. A reader who looks up one API must read a paragraph in a narrow cell. Most of the length is correct detail that implementers need.
- Evidence: docs/data/threejs-mapping.json (note lengths measured from the `notes` field).
- Proposed edit: Add a `details` field to the JSON entries. Keep `notes` to one or two sentences: the action to take. The generator writes, under each section's table, one block per entry with details: `<details>` / `<summary>Technical details: CSS2DRenderer and CSS3DRenderer</summary>` / the details text / `</details>`. Move the rest of each long note there.
- Source: docs/data/threejs-mapping.json; tools/lib/docs.ts (mappingMarkdown, :392-432)

### 13. The mapping's "Docs" column names page IDs instead of linking pages (medium, structure)

- Page: porting/threejs-mapping
- Anchor: every row's last cell, such as `` `concepts/quality-presets` ``; notes such as "(concepts/post-processing)"
- Claim: The reader sees a page ID in code font and cannot click it. Notes cite other page IDs in brackets as raw text.
- Evidence: tools/lib/docs.ts:427 (`` \`${e.docs}\` ``); docs/porting/threejs-mapping.md:255 ("(concepts/post-processing)").
- Proposed edit: Render the column as a link with the page's title from PAGES: `[Quality presets](../concepts/quality-presets.md)`. Turn bracketed page IDs in notes into links in the generator, or write them as links in the JSON.
- Source: tools/lib/docs.ts; docs/data/threejs-mapping.json

### 14. "Roadmap step" banners and the mapping's "Since" column use internal plan words and promise a later release (medium, internal-note)

- Pages: all 13 pages of the slice (banner on every written page); porting/threejs-mapping (Since column and legend)
- Anchor: file line 11 or 13 ("> Roadmap step 0.3, first released in null3D 0.1.0."); mapping lines 18-23 ("1.0: the stable API")
- Claim: "Roadmap step" is a build-plan term that readers do not know. Every step listed ships in 0.1.0, so the "Since" column holds no fact a user can act on. "1.0: the stable API" promises a later feature, which AGENTS.md forbids.
- Evidence: tools/lib/steps.ts (shipsSentence), tools/lib/docs.ts:411-413 (STEPS_NOTE and sinceLegend); AGENTS.md "Writing docs" (no internal plans, no promise of a later feature).
- Proposed edit: Banner: "First released in null3D 0.1.0. The API is experimental, so it can still change between versions." Drop the mapping's "Since" column and the roadmap legend, or show the first release version instead.
- Source: tools/lib/steps.ts; tools/lib/docs.ts; docs/data/threejs-mapping.json (sinceLegend)

### 15. Toon and clipping-plane guidance is copied across four pages (medium, duplication)

- Pages: porting/threejs-materials, porting/threejs-unsupported, porting/threejs-overview, porting/threejs-mapping
- Anchor: materials file line 86 (toon and lobe paragraph) and line 47 (clipShadows cell); unsupported file line 38 (MeshToonMaterial cell) and line 43 (clipping planes cell); mapping rows "MeshToonMaterial" and "renderer.clippingPlanes"
- Claim: The same sentences about the lobe function, fill lights, area lights and `clipShadows: false` appear on each page. They will drift, and the unsupported page's table cells become paragraphs.
- Evidence: the anchors above.
- Proposed edit: Keep the full text on porting/threejs-materials. In the unsupported page, shorten each cell to the workaround in one sentence and a link: "A toon surface function, or a lobe function ([Porting materials](threejs-materials.md#meshtoonmaterial-and-meshmatcapmaterial))". Shorten the mapping notes the same way, as finding 12 proposes.
- Source: docs/data/threejs-mapping.json for the mapping rows

### 16. Porting pages give an incomplete uniform limit (medium, wrong-claim)

- Pages: porting/threejs-shaders, porting/threejs-postprocessing
- Anchor: shaders file line 121 ("up to 32 numbers in all"); postprocessing file line 125 ("up to 32 floats in all")
- Claim: For a custom material, each texture takes one of the 32 numbers, and `vec2f`, `vec3f` and `vec4f` align. A port with 6 textures has 26 numbers, less padding. The shaders page also says "Pass a matrix as `vec4f` rows", which costs 16 of them, without saying so. A port of a ShaderMaterial with a mat4 and some textures can hit the build error with no warning from this page.
- Evidence: docs/shaders/surface-functions.md:245, :283; packages/engine/src/generated/core.ts:351 (EFFECT_FLOATS = 32).
- Proposed edit: Shaders page: "The uniforms fit in 32 numbers, less one for each texture. Each `vec3f` and `vec4f` starts a group of four, and a `mat4x4f` passed as four `vec4f` rows takes 16 ([Uniforms](../shaders/surface-functions.md#uniforms))."

### 17. GLSL `mod` port uses a hand formula when the library has one (medium, missing-content)

- Pages: porting/threejs-shaders, shaders/wgsl-rules
- Anchor: shaders file line 58 and line 290; wgsl-rules "### The remainder operator"
- Claim: Both pages tell the reader to write `x - y * floor(x / y)`. `null3d::math::modulo` is "a modulo that matches GLSL's `mod`".
- Evidence: docs/shaders/library.md:47 and the `modulo` entry.
- Proposed edit: "`mod(x, y)` becomes `modulo(x, y)` from `null3d::math`, which keeps GLSL's sign. WGSL's `%` keeps the sign of `x`."

### 18. Surface functions page: long paragraphs and a 90-name list in the Rules (medium, long-paragraph)

- Page: shaders/surface-functions
- Anchor: stats lines 6 (85 words), 31 (49 words, 5 sentences), 93 (95), 143 (95), 161 (97), 583 (91); file line 611, the first Rules bullet with every engine name
- Claim: The opening paragraph and the Rules bullet are the densest. The Rules bullet lists about 90 reserved names in one sentence chain, so the rule itself ("do not declare a name that the engine declares; the build stops at the clash") is lost.
- Evidence: stats.json; docs/shaders/surface-functions.md:611.
- Proposed edit: Rules: keep "Do not declare a name that the engine declares. The build stops at your line when a name clashes, and names the clash." Move the full list to `<details><summary>Technical details: every name the engine declares</summary>`, as a list grouped by when it applies (always, with `instance` or `object.id`, with a lobe). Split the other paragraphs at their second sentence. Move the cost notes of the second and third normal (lines 147, 158) into one "Technical details: what each optional field costs" block.

### 19. Shader library entries hold derivations in the main text (medium, long-paragraph)

- Page: shaders/library
- Anchor: stats lines 397 (94 words), 681 (105), 743 (70), 775 (86), 883 (117), 969 (96), 1021 (72), 1129 (57), 1169 (92), 1353 (101), 1361 (99)
- Claim: Each long entry opens with what the function gives, then explains the derivation, Filament's constants or the engine's storage layout. A reader looking up a function needs the first sentence and the signature.
- Evidence: stats.json; for example `dfg_lut` (stats 681) and `fog` (stats 883).
- Proposed edit: Let the generator split each doc comment at a marker line (such as `/// Details:`) and render the rest in `<details><summary>Technical details: how <name> works</summary>`. Then mark the eleven comments above.
- Source: tools/lib/shader-library.ts; crates/null3d-shaders/wgsl/lib/*.wgsl doc comments

### 20. WGSL rules: three dense paragraphs about phone GPUs and Safari (medium, long-paragraph)

- Page: shaders/wgsl-rules
- Anchor: stats lines 46 (68 words), 48 (115 words, 7 sentences), 58 (73 words)
- Claim: The rule (what the build rejects and what to write) is buried under why phone GPUs fail and how the build splits structs.
- Evidence: stats.json; docs/shaders/wgsl-rules.md:53, :55, :65.
- Proposed edit: Keep one sentence each: "The build rejects a copy of a whole array out of a uniform buffer. Read one element at a time." / "Keep values in an array of structs within half precision's range, about 6.1e-5 to 65504." Move the reasons and the struct-splitting description into `<details><summary>Technical details: why phone GPUs need these rules</summary>`.

### 21. Pages say drei's ContactShadows has no equivalent, but never mention null3D's own contact shadows (medium, unclear)

- Pages: porting/threejs-unsupported, porting/react-three-fiber
- Anchor: unsupported file line 78; react-three-fiber file lines 165, 183
- Claim: null3D has a feature named contact shadows, with a demo. It is a different effect (a short screen-space shadow where objects touch the ground). A reader who searches "contact shadows" finds both and cannot tell how they relate.
- Evidence: docs/concepts/shadows.md:314 ("## Contact shadows"), :149 (`contactDistance`); examples/demos.ts:523 (contact-shadows demo).
- Proposed edit: Add to the unsupported row: "null3D's own [contact shadows](../concepts/shadows.md#contact-shadows) are another effect: the dark line where an object meets the ground, from the light's direction ([demo](https://github.com/null3d-engine/null3d/tree/main/examples/contact-shadows/))."

### 22. Materials page: the toon and lobe paragraph is 155 words (medium, long-paragraph)

- Page: porting/threejs-materials
- Anchor: "## MeshToonMaterial and MeshMatcapMaterial", stats line 79 (155 words, 9 sentences), file line 86
- Claim: The paragraph mixes three things: the uniform recipe, the lobe alternative and its limits, and the matcap note.
- Evidence: stats.json.
- Proposed edit: Main text: "Both become custom materials, as the recipes below show. The toon recipe takes the light's direction as a uniform, because a surface function cannot read the scene's lights. For bands that follow every light, step the light in a lobe function. The matcap recipe is an unlit function, so it ignores the lights, as three.js's matcap does." Move the lobe's call rules (main directional, point and spot lights, no fill or area lights, black base color) into `<details><summary>Technical details: toon bands in a lobe function</summary>`.

### 23. Post-processing page: two dense paragraphs (low, long-paragraph)

- Page: porting/threejs-postprocessing
- Anchor: stats lines 118 (70 words) and 203 (70 words, 6 sentences); file lines 125 and 210
- Claim: The uniform rules and the tone-curve call order are reference detail in running text.
- Evidence: stats.json.
- Proposed edit: Keep "Uniforms are numbers and vectors, up to 32 floats in all" and "The WGSL declares `fn toneCurve(color: vec3f) -> vec3f`, and takes no uniforms." Move the alignment, colour-string and E1216 rules, and the clamp, grade and dither order, into `<details><summary>Technical details: ...</summary>` blocks.

### 24. Porting shaders: the opening paragraph after the diagram packs the material contract (low, long-paragraph)

- Page: porting/threejs-shaders
- Anchor: stats line 19 (68 words, 5 sentences), file line 26
- Claim: It names five things in a row: the `wgsl` option, the tag, three function forms, `struct Uniforms`, and two links.
- Evidence: stats.json.
- Proposed edit: Split: "A custom material takes its WGSL in its `wgsl` option. The WGSL holds `fn surface`, `fn vertexOffset`, or both, or a full shader's entry points." Then a second paragraph for uniforms and the links.

### 25. Built-in inputs: the cost rules paragraph (low, long-paragraph)

- Page: shaders/builtins
- Anchor: "## What the inputs cost", stats line 99 (112 words, 6 sentences)
- Claim: The rule is "inputs that cost something reach only WGSL that reads them". The plugin's field matching and the mesh fallback rules are detail.
- Evidence: stats.json.
- Proposed edit: Keep the first two sentences and the table. Move "It counts a field only where the WGSL reads it from a value of the input's type..." through "...gives its first set in their place" into `<details><summary>Technical details: how the plugin finds the inputs a material reads</summary>`.

### 26. Porting shaders names a clash with `finish`, which the engine's list does not hold (low, wrong-claim)

- Page: porting/threejs-shaders
- Anchor: file line 297 ("such as `frame`, `camera`, `object`, `material`, `shade` or `finish`")
- Claim: The surface-function rules list `finish_material` and `finish_exposed_material`, not `finish`. `finish` is a `null3d::mesh` item for full shaders. A reader renames a helper for no reason, or keeps `finish_material`.
- Evidence: docs/shaders/surface-functions.md:611.
- Proposed edit: "such as `frame`, `camera`, `object`, `material`, `shade` or `fs` ([Rules](../shaders/surface-functions.md#rules) lists every name)."

### 27. Overview gives the wrong unit for area lights (low, wrong-claim)

- Page: porting/threejs-overview
- Anchor: "## What stays the same", file line 88 ("candela for point and spot lights, and lux for the others")
- Claim: Rectangle and tube lights take nits.
- Evidence: docs/api/reference/lights.md (`intensity`: "lux for directional and ambient lights, candela for point and spot lights, and nits for rectangle and tube lights").
- Proposed edit: "candela for point and spot lights, nits for rectangle and tube lights, and lux for directional and ambient lights."

### 28. Loop page: `physicsWorld.step()` with no step fits Rapier only (low, unclear)

- Page: porting/threejs-loop-and-threads
- Anchor: "## Converting the loop", file lines 76-78 and 92
- Claim: cannon-es's `World.step` needs the fixed step as its first argument. A cannon-es port that copies the example steps by nothing.
- Evidence: the page names cannon-es on line 208 as a library to run in the sketch.
- Proposed edit: Write `physicsWorld.step(1 / 60); // cannon-es; Rapier's world.step() takes its timestep from world.timestep`. Or say "the fixed step, `1 / fixedRate`".

### 29. WGSL rules: a Safari release note that will go stale (low, internal-note)

- Page: shaders/wgsl-rules
- Anchor: "## Atomic compare-exchange", file line 65 ("WebKit has fixed the fault (321006@main), but no Safari release that has the fix is out yet.")
- Claim: A WebKit commit ID and "not out yet" are status notes. They go wrong at the next Safari release, with no check to catch it.
- Evidence: docs/shaders/wgsl-rules.md:65.
- Proposed edit: "Safari 27.0 cannot compile such a shader, so it fails to load on Apple devices with that version." Keep the commit ID in the build's warning text or a code comment.

### 30. Surface functions page names the forest demo without a link (low, missing-content)

- Page: shaders/surface-functions
- Anchor: "## Vertex offsets", file line 532 ("The forest demo's tree material does both from one value.")
- Claim: The reader cannot find the demo.
- Evidence: examples/demos.ts (forest, code `forest/`).
- Proposed edit: "The [forest demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest/)'s tree material does both from one value."

### 31. (not verified) textureGather: "fails to link" against "the build rejects"

- Pages: shaders/surface-functions (Textures bullet on `textureGather`), shaders/wgsl-rules ("Code that WebGL2 cannot run")
- Claim: Surface functions say a material with `textureGather` fails to link on WebGL2. WGSL rules say the build rejects code that GLSL ES 3.00 cannot express. One of them is wrong. crates/null3d-shaders/src/textures.rs handles `textureGather` but I did not confirm whether the WebGL2 translation rejects it.
- Proposed edit: State one behavior on both pages once confirmed.

### 32. (not verified) "Positions and directions are in world space, relative to the camera"

- Page: shaders/surface-functions, "## The surface input", first paragraph
- Claim: `worldPosition` is absolute, so "relative to the camera" does not hold for every field. Say "Directions are in world space. `relativePosition` is relative to the camera; `worldPosition` is absolute."

### 33. (not verified) Mapping cells show API names as plain text

- Page: porting/threejs-mapping
- Claim: The three.js and null3D cells hold code such as `createEngine({ canvas, sketch })` without code font, so they read as prose. Render the first two cells in code font where they are API names.
- Source: tools/lib/docs.ts:427

### 34. (not verified) Overview benchmark table: "the engine's own work" and five of six scenes

- Page: porting/threejs-overview, "## What gets faster"
- Claim: The S1 row's "the engine's own work" is not explained. The README says null3D beats three.js in five of six scenes, and this table shows five rows. Say which scene is left out, or add it.

### 35. (not verified) Overview: "Material options keep the names ... such as the clear coat and the sheen"

- Page: porting/threejs-overview, file line 89
- Claim: The materials page says there is no `sheen` option (multiply it into `sheenColor`). "Most of the names" holds, but the sheen is a poor example. Use "such as the clear coat and the transmission".

### 36. (not verified) Post-processing Mermaid: effects to final pass skips bloom

- Page: porting/threejs-postprocessing, the opening diagram
- Claim: The edge from custom effects straight to the final pass, beside the edge through bloom, is not explained. Label it "without bloom".

### 37. (not verified) Loop page opening paragraph

- Page: porting/threejs-loop-and-threads, stats line 20 (5 sentences)
- Claim: Short sentences, but five in one paragraph. Low priority; it reads well.

## Screenshots, demo links and concepts with no demo, per page

Reference images live in tests/image/references/chrome-real-gpu/<tier>/. Test pages live in tests/pages/sketches/.

### porting/threejs-overview

Screenshots:
- `night-town-two-engines` (reference): the night-town comparison as three.js draws it and as null3D draws it, side by side, under "What gets faster". Images: compare-night-town-threejs.png and compare-night-town-null3d.png (webgpu). Alt: "The same rainy night street drawn by three.js on the left and by null3D on the right."

Demo links:
- compare/battle/, compare/factory/, compare/night-town/ under "What gets faster".
- hold-mode/ under "The workflow" (step 2, frames that repeat).

Concepts with no demo: the two-step port with `sketchThread: 'main'`; the scanner's inventory; model conversion with the command line tool.

### porting/threejs-loop-and-threads

Screenshots:
- `threads-in-devtools` (manual): Chrome DevTools Performance panel while the instances demo runs, with the main thread nearly idle and the sketch, job and render worker tracks busy, under "What goes where". Alt: "A DevTools performance recording where the page's main thread is idle and the engine's workers do the frame's work."

Demo links:
- instances/ under "Per-object classes become arrays".
- input/ and walk-and-fly/ under "Input and camera controls".
- css3d-labels/ and sound/ under "What goes where".
- picking/ under "Messages between the page and the sketch".

Concepts with no demo: `sketchThread: 'main'`; a GUI panel on the page that sends values to the sketch; an IndexedDB cache in the sketch.

### porting/threejs-mapping

Screenshots: none.

Demo links: generators/ and extra-shapes/ under "Geometry"; multiple-views/ under "Cameras"; hero-shadow/ and area-lights/ under "Lights and shadows"; gltf-model/ under "Loaders"; instances/ under "Instancing and batching"; character/ under "Animation"; picking/ and gizmos/ under "Interaction and controls"; math/ under "Math"; post-effects/ under "Post-processing"; sprites-lines/ and galaxy/ under "Sprites, points, lines and labels".

Concepts with no demo: "Renderer and loop" as a section; "Helpers and debugging".

### porting/threejs-materials

Screenshots:
- `toon-and-matcap` (scripted): the toon recipe and the matcap recipe on two spheres under one directional light, under "Recipes". Steps: a test page with both recipes, hold 0, 640x360, tone mapping none.
- `clipping-plane` (scripted): a mesh cut by the clipping-plane recipe, with its shadow cut too, under "Recipes".
- `coat-and-sheen` (reference): demo-coat-and-sheen.png under "MeshPhysicalMaterial".
- `parity-diff` (scripted): the night-town comparison's three.js image, null3D image and the diff that `bunx @null3d/cli test` writes, under "Check the result".

Demo links: coat-and-sheen/ and iridescence-and-anisotropy/ under "MeshPhysicalMaterial"; relief/ under "MeshStandardMaterial" (displacement); decals/ and water/ under "Other materials"; tone-mapped/ under "Color spaces".

Concepts with no demo: Lambert and Phong conversion; toon; matcap; clipping planes; alpha map; `scene.overrideMaterial`.

### porting/threejs-postprocessing

Screenshots:
- `tone-curves` (scripted): the bright tiles under none, aces, agx, agx-punchy, neutral, reinhard and cineon in one strip, under "Passes that become settings". Steps: tile the existing test references tone-none.png, tone-aces.png, tone-agx.png, tone-agx-punchy.png, tone-neutral.png, tone-reinhard.png, tone-cineon.png (tests/pages/sketches/bright-sketch.ts), with each curve's name.
- `post-effects` (reference): demo-post-effects.png under "Delete the composer".
- `rgb-shift` (scripted): the RGB shift effect from the example on the post-effects demo, under "Example: RGBShiftShader".

Demo links: post-effects/ under "Passes that become settings"; auto-exposure/ (AdaptiveToneMappingPass), light-shafts/ (GodRaysEffect), wet-street/ (SSRPass), camera-lens/ (BokehPass) in the same section; compare/battle/ under "Port a ShaderPass to a custom effect" (its lens grade is an effect in both engines).

Concepts with no demo: the depth fog effect; a chain of full-screen passes with targets of their own; a custom tone curve in WGSL; `reinhard` and `cineon` from the compat package.

### porting/threejs-shaders

Screenshots:
- `shader-inputs` (reference): demo-shader-inputs.png under "Built-in values".
- `dissolve` (scripted): the dissolve test page (tests/pages/sketches/custom-dissolve-sketch.ts; reference custom-dissolve.png) under "A dissolve from TSL".
- `wind-sway` (reference): demo-vegetation-wind.png under "Wind sway from onBeforeCompile".
- `fresnel-glow` (scripted): the fresnel glow port on a sphere in a dark scene, under "A fresnel glow from a ShaderMaterial".

Demo links: shader-inputs/ under "Built-in values"; vegetation-wind/ under "Wind sway from onBeforeCompile"; relief/ under "Displacement"; rain/ under "GLSL to WGSL" (`vertex_index` draws); compare/battle/ under "onBeforeCompile patches"; compare/night-town/ under "ShaderMaterial and RawShaderMaterial".

Concepts with no demo: the fresnel glow; full shaders as a port target.

### porting/threejs-unsupported

Screenshots: none.

Demo links: multiple-views/ under "Rendering and output" (split screens); css3d-labels/ under "Objects and scenes" (text as HTML labels); contact-shadows/ under "React Three Fiber and drei" (to show how the null3D feature differs).

Concepts with no demo: XR; a physics library in the sketch; toon shading.

### porting/verification

Screenshots:
- `test-diff` (scripted): a failed image test's image, its reference and its red-marked diff, under "Compare the port with image tests". Steps: run `bunx @null3d/cli test` on a copy of the night-town comparison with one material changed.
- `inspector` (scripted): the `?inspect` panel open on the picking demo with one piece selected, under step 5.
- `stats-overlay` (scripted): the stats overlay open on the instances demo, under "Compare performance".

Demo links: compare/battle/, compare/factory/, compare/night-town/ under "Compare performance"; hold-mode/ under "Capture the three.js images".

Concepts with no demo: the capture helper; `bench`; frame counting with fences.

### porting/react-three-fiber

Screenshots: none.

Demo links: gltf-model/ under "React Three Fiber and drei in null3D" (useGLTF); environment/ (drei Environment); css3d-labels/ and picking/ (drei Html and mesh events) in the same section.

Concepts with no demo: the React view component; state messages between React and the sketch; the frame-budget governor in place of drei's adaptive components.

### shaders/builtins

Screenshots:
- `builtins` (scripted): the built-ins test page (tests/pages/sketches/custom-builtins-sketch.ts; reference custom-builtins.png) under the opening example.
- `object-values` (reference): demo-shader-inputs.png under "`object`" (row color, per-object bands, the picked stone by `object.id`).

Demo links: shader-inputs/ under "`object`"; far-from-origin/ under "Positions relative to the camera".

Concepts with no demo: `frame.lastFrame` in the motion pass; the cost of each input.

### shaders/library

Screenshots:
- `noise-kinds` (scripted): tiles of value, Perlin, simplex, Worley and fractal noise in 2D, under "`null3d::noise`". Steps: a new test page with one unlit tile per function.

Demo links: aurora/ under "`null3d::noise`"; shader-inputs/ under "`null3d::reflection`" (its pool reads a reflection pass); showroom/ under "`null3d::lighting`" (its car paint uses the lighting helpers in a lobe).

Concepts with no demo: `null3d::sdf`; `null3d::depth`; `null3d::fog`.

### shaders/surface-functions

Screenshots:
- `custom-surface` (scripted): the custom surface test page (tests/pages/sketches/custom-material-sketch.ts; reference custom-surface.png) under the opening example.
- `vertex-offset` (scripted): tests/pages/sketches/custom-vertex-offset-sketch.ts (reference custom-vertex-offset.png) under "Vertex offsets".
- `translucency` (reference): demo-translucency.png under "Light through thin surfaces".
- `coat` (reference): demo-coat-and-sheen.png under "Clear coat and sheen".

Demo links: shader-inputs/ under "The surface input" and "Reflections"; showroom/ under "A material's own lobe"; translucency/ under "Light through thin surfaces"; coat-and-sheen/ under "Clear coat and sheen"; vegetation-wind/ and forest/ under "Vertex offsets"; impostors/ under "Shadows" (cards that cast a crown's shape).

Concepts with no demo: unlit surfaces; occlusion counted once; the scene's depth; water seen from below; cut-out shapes.

### shaders/wgsl-rules

Screenshots: none. A screenshot of the build's error output for a swizzle assignment would help under "Language features" (manual, a terminal capture).

Demo links: none fit.

Concepts with no demo: every rule on the page; they are build checks.
