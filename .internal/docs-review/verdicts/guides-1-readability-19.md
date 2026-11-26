# guides-1-readability-19

## The finding as given

- page: guides/custom-shaders
- anchor: lines 43, 175, 187; ### Where a custom material's builds go and ### Where a custom effect's and a tone curve's builds go (lines 166-185); line 219
- category: technical-details-block
- severity: medium
- claim: Line 43 (100 words) lists four WGSL hooks in running text. The two 'builds go' H3s explain file splitting and size figures; the user needs one action from them (deploy every file, line 185). Line 219 is dev-server thread detail.
- evidence: stats.json lines 36 (100 words, 6 sentences), 168 (87, 5), 180 (85, 5).
- proposedEdit: Line 43: a list of struct Uniforms, texture declarations, fn vertexOffset, fn lobe, then the links. Merge the two H3s into 'Where the builds go': two sentences plus the deploy rule with E1424; move file counts, names, skinned and no-tone-mapping files and line 175's figures into <details><summary>Technical details: the build files and their sizes</summary>. Move line 219 into a details block under Hot reload.

Verdict: partly

## Evidence

- stats.json line numbers are body lines; the page lines are 7 higher (front matter). Stats 36, 168, 180 are page lines 43, 175, 187. The counts hold.
- Line 43 (docs/guides/custom-shaders.md:43): six sentences of running text over four separate WGSL hooks (uniforms, textures and texture arrays, vertexOffset, lobe), then two links. A list is the right fix.
- Lines 166-185: the two H3s repeat one pattern (own files per GPU path, a small value in the module, download on first use). Line 175 is a worked size example with exact figures; it is dense detail that suits a closed block. Line 185 (deploy every file, E1424) is the one action. This part holds.
- Gap 1: the finding anchors line 187 (the array paragraph, 85 words, 5 sentences) but neither the claim nor the edit treats it. That paragraph is about how the WebGL2 build rewrites arrays. It has nothing to do with where builds go; it only sits under the effect H3 by accident. If the two H3s merge into "Where the builds go", the paragraph stays under a wrong heading. It belongs under "What the plugin compiles", after the portable-rules sentence (line 164), and its rewrite detail (out parameter, element-by-element fill) suits a details block.
- Gap 2: docs/guides/add-ons.md:117 links to `custom-shaders.md#where-a-custom-materials-builds-go` and says the section "shows the files". Renaming the heading breaks that anchor, and moving the file names into a closed block hides what the link promises. The edit must update that link (to `#where-the-builds-go`) and its wording.
- Gap 3: some lines the edit sends into the block are behavior a user sees, not implementer detail: "The first frame waits for that file and for the material's pipelines" (line 172) and "A pass or an effect whose pipelines wait for it draws nothing until the file arrives, and the rest of the frame keeps drawing" (line 183). These must stay in the main text, so it makes sense with the block closed.
- Line 219: the thread count, the per-thread memory and the variant split are dense detail; a block is fine. The first clause (the dev server stays responsive while a shader compiles) is the reader-facing point and can stay in the main text. Minor.

## Corrected claim

Line 43 should be a list, and the two "builds go" sections can merge, with the file counts, file names, extra skinned and no-tone-mapping files and line 175's size figures in a details block. But line 187 is anchored and not handled: it is about array rewrites in the WebGL2 build and is misplaced under the effect builds heading. The merge also breaks the anchor that docs/guides/add-ons.md:117 links to.

## Corrected edit

1. Line 43: a list (struct Uniforms and set(); texture_2d and texture_2d_array with the textures option; fn vertexOffset; fn lobe), then the two links.
2. Merge the two H3s into "### Where the builds go". Main text: the builds of a custom material, effect or tone curve go into small files of their own, not your module; the sketch downloads its device's file on first use; the first frame waits for a material's file, and a pass or effect draws nothing until its file arrives while the rest of the frame draws; deploy every file that the build writes, or the engine stops with E1424. Then `<details><summary>Technical details: the build files and their sizes</summary>` with the file counts and names, the skinned and no-tone-mapping files, the module's value, build versus dev-server serving, and line 175's figures.
3. Update docs/guides/add-ons.md:117 to link `custom-shaders.md#where-the-builds-go`.
4. Move line 187 (arrays) out of the builds section to the end of "What the plugin compiles", after line 164. Keep "You can use arrays in every form that WGSL allows; your WGSL does not change" in the main text, and put the WebGL2 rewrite detail in a `<details><summary>Technical details: how the WebGL2 build rewrites arrays</summary>` block.
5. Line 219: keep "The plugin compiles WGSL on worker threads, so the dev server answers the page's other requests while a shader compiles." Move the thread count, memory and variant split into a details block under Hot reload.
