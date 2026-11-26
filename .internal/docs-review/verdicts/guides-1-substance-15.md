# guides-1-substance-15

## The finding as given

- Page: guides/assets-pipeline
- Anchor: long paragraphs at lines 23, 84, 86, 88, 117, 126, 128, 143, 151, 153, 165, 177, 187, 189, 201, 203, 207, 219, 234, 276, 278, 370, 396, 471, 485
- Category: technical-details-block
- Severity: medium
- Claim: 25 long paragraphs in an 8,386-word page mix what the reader does with how the file stores it. Line 207 gives the stage file layout with an undefined 'kind 1'. Line 189 mixes using --lod with MSFT_screencoverage internals. Line 276 mixes the shader list with fade rules.
- Evidence: .internal/docs-review/stats.json guides/assets-pipeline (statistics lines + 7).
- Proposed edit: Keep the main text to what each option does and when to use it. Blocks: 'Technical details: the stage file layout' (207); 'Technical details: how levels mark their errors' (189 from 'The levels go into the file'); 'Technical details: how the cluster tree is built' (213-219); 'Technical details: which shader files the list holds back' (276); 'Technical details: the engine's glTF extensions' (130). Split 128, 143 and 219 at topic changes.

Verdict: partly

## Evidence

- The 25 line numbers match stats.json plus the 7 front-matter lines of the generated page (stats 16 = page 23, stats 200 = page 207, and so on). The counts are facts.
- Line 207: "A kind 1 stage holds one band." The page never says what a kind is. The source confirms it is a header field of the stage file: packages/engine/src/scene/gltf.ts:582-586 (the kind of a level stage and the kind of a band stage, and the header words "magic number, version, kind and a count") and gltf.ts:636. So "kind 1" is an internal byte-format value with no meaning for a reader. This part holds.
- Line 189 mixes the user fact (a file that already has levels keeps them, with or without `--lod`; hand-set levels fade, measured ones switch at once) with storage detail (`MSFT_lod`, `NULL3D_lod_error`, `MSFT_screencoverage` made for 1080 pixels, coverage read as the mark of a measured error). This part holds.
- Line 276 mixes the user point (`scene.warmUp()` builds only what the model needs, and nothing new downloads during play) with the fade-file rules for `lod_fade`. This part holds.
- The general claim overreaches. Many listed paragraphs do not mix use with storage at all: 23 (what the command does), 117 (how the ground helps blockers), 151 and 153 (why the bake exists), 177 (how many levels), 234 (`--simplify`), 278 (texture budget warning), 396 (`--scale`). The stats threshold (over 90 words or 4 sentences) flags many paragraphs of 60 to 75 words that read well. The finding gives no proposal for about 17 of the 25, so "25 paragraphs mix" is not shown.
- The proposed blocks would hide user-facing facts if applied as written:
  - 207 as a whole block would hide that the model file holds the first band and draws a coarse but complete first picture, and that `maxLevels` counts a band as a level. A reader who sets `maxLevels` needs those with the block closed.
  - 189 "from 'The levels go into the file'" is the whole paragraph (it starts with that sentence). It would hide "a model whose file already has levels keeps them" and that hand-set levels fade.
  - 213-219 as one block would hide line 219's user facts: the tree roughly doubles the triangles, WebGL2 copies the vertices of a mesh over 65,535 vertices, and Firefox (WebGL2 without `WEBGL_multi_draw`) and the direct WebGPU path draw whole levels, not patches.
  - 276: the warm-up promise must stay in main text.
- Line 130 is a short two-sentence paragraph. A block for it alone adds a click and saves nothing. It is better to name the extensions inside the blocks that already cover the storage detail.
- Line 201 also holds storage detail the finding missed ("The tool orders each mesh's vertices coarsest level first ... A staged download can send that stretch first"). It belongs in the stage-layout block.

## Corrected claim

Some long paragraphs on this page mix what the reader does with how the file stores it: 189, 201, 207, 219 and 276. Line 207 uses "kind 1", a stage-file header value that the page never defines. Most of the other flagged paragraphs (such as 23, 117, 151, 177, 234, 278, 396) are about one topic and need at most a split, not a block.

## Corrected edit

- 207: keep in main text that the file holds the first band, that the first picture is coarse but covers the whole surface, that `maxLevels` counts a band as a level, and that a band waits until a view draws a patch of the band above. Move to "Technical details: the stage file layout" the byte order (header with its kind, patch count, each patch's sphere, run, parent and error, then the indices; parents before children). Also move there the vertex-order sentences of 201. Drop "kind 1" from the main text.
- 189: keep in main text that a file's own levels stay, and that measured levels switch at once while hand-set levels fade. Move to "Technical details: how levels mark their errors" the `MSFT_lod`, `NULL3D_lod_error` and `MSFT_screencoverage` storage, the 1080-pixel coverage, and how the loader tells measured from hand-set levels. Name `NULL3D_occluder` and `NULL3D_mesh_bvh` (line 130) beside the blocker and tree text, with no separate block.
- 213-217: put the build steps list in "Technical details: how the cluster tree is built". Split 219: keep the triangle cost and which GPU paths draw patches or whole levels in main text; the `NULL3D_clusters` name can go in the block.
- 276: keep the first two sentences and the `scene.warmUp()` result in main text. Move the `coverage`/`lod_fade` hold-back rules to "Technical details: which shader files the list holds back".
- Split 128 (build cost vs. stored tree cost) and 143 (resizing rule vs. KTX2 images the model already had) at those topic changes. Leave the other flagged paragraphs as they are.
