# Verdict: guides-1-readability-02

## The finding as given

- Page: guides/assets-pipeline
- Anchor: lines 23, 84, 86, 88, 117, 126, 128, 143, 151, 153, 165, 177, 187, 189, 201, 203, 207, 219, 234, 276, 278, 370, 396, 471, 485
- Category: long-paragraph. Severity: high.
- Claim: 25 paragraphs pass 4 sentences or 90 words. The worst are line 276 (212 words), 189 (176 words, 12 sentences), 219 (167), 207 (142) and 128 (122). Correct file-format and loader detail hides the few rules a user acts on.
- Evidence: stats.json lines 16, 77, 79, 81, 110, 119, 121, 136, 144, 146, 158, 170, 180, 182, 194, 196, 200, 212, 227, 269, 271, 363, 389, 464, 478 (file line = stats line + 7).
- Proposed edit: Line 23: list the four outputs. Lines 84/86: keep the step rule and quantizePositions; move node/child/instancing/skin rules into `<details><summary>Technical details: where the position transform goes</summary>`. Line 117: merge the ground cases into the blocker table. Line 126: three-row table of occluder overrides. Line 128: keep "use --bvh for large meshes"; move build rates and bytes per triangle into a details block. Line 143: numbered size rules. Line 153: split; move the 0.4 cap into details. Line 165: move ETC1S palette reason and Zstandard cost into details. Line 177: list the stop rules. Lines 187/189: keep the one-pixel rule; move MSFT_lod, NULL3D_lod_error, MSFT_screencoverage and fade rules into `<details><summary>Technical details: how the file stores levels</summary>`. Lines 201/203/207: keep in-order refinement and maxLevels; move vertex ordering, set-aside timing and the kind 1 stage layout into `<details><summary>Technical details: the stage files</summary>`. Line 219: split in three and make a small table of which GPU paths draw patches; move the 65,535-vertex copy and shadow picking into details. Line 234 and 396: split after the second sentence; move the screen-pixel reasoning of --scale into details. Line 370: cut to one sentence pointing at the option table.

## Verdict: partly

## Evidence

- The counts hold. stats.json lists 25 long paragraphs for this page, and the file lines (stats line + 7) match the page. Line 276 is 212 words / 10 sentences, 189 is 176 / 12, 219 is 167 / 11, 207 is 142 / 11, 128 is 122 / 8. The ranking is right.
- The main problem is real. Line 189 mixes the user rule (a level is good enough under one pixel; a file's own levels stay) with extension names, coverage at 1080 pixels and fade logic. Line 207 gives the byte layout of a "kind 1" stage. Line 276 mixes "the engine downloads the model's shader files" with the full measured-versus-hand-set fade rule. A reader who wants to know what to do has to dig.
- Much of the fade detail at lines 189 and 276 repeats docs/concepts/lod.md lines 97, 99 and 164-180 ("Fading between levels"). A details block is fine, but a link to that section would also work and would cut words.

## What does not hold

1. The edit skips the worst paragraph. Line 276 (212 words) is named as the worst, but the proposal gives it no edit. Lines 151, 278, 471 and 485 get no edit either.
2. Line 370: "cut to one sentence pointing at the option table" would lose facts. The option table (lines 379-384) gives only the defaults White/White/Black. It does not say that each map is read from its red channel, that at least one map is needed, why each default is chosen, or that the output takes the largest map's size and the other maps stretch, so the maps must have one shape. Those are rules a user acts on.
3. Lines 187/189: "keep the one-pixel rule" is not enough. The sentence "A model whose file already has levels keeps them, with or without `--lod`" is a user-facing rule and must stay in the main text. "A file with hand-set levels fades them" is useful too, but it can go in the block with a link to concepts/lod.md#fading-between-levels.
4. Line 23: "list the four outputs" is unclear. The paragraph names three changes (meshes, clips, textures) and then the benefits. The edit should say "list the three changes" or drop this item. This paragraph is only 97 words and reads well as an intro. It is low priority.
5. Severity should be medium, not high. Nothing on the page is wrong, and the commands, the option tables and the examples come first in each section. Long paragraphs make the page "clearly harder to read". They do not mislead a reader or block a newcomer.

## Corrected claim

25 paragraphs pass 4 sentences or 90 words (the worst: line 276 at 212 words, 189 at 176, 219 at 167, 207 at 142, 128 at 122). File-format and loader detail is mixed into the rules a user acts on. Severity: medium.

## Corrected edit

Keep the proposal for lines 84/86, 117, 126, 128, 143, 153, 165, 177, 201/203/207, 219, 234 and 396, with these changes:

- Line 23: leave it as it is, or make a list of the three changes (meshes, clips, textures). Do not say "four".
- Lines 187/189: keep in the main text that a level is good enough where its error covers less than one pixel, and that a file's own levels stay, with or without `--lod`. Move `MSFT_lod`, `NULL3D_lod_error`, `MSFT_screencoverage`, the 1080-pixel coverage and the measured-versus-hand-set fade rule into `<details><summary>Technical details: how the file stores levels</summary>`. End the block with a link to [Fading between levels](../concepts/lod.md#fading-between-levels).
- Line 276: keep "The engine reads the list as it loads the file and downloads those shader files beside the textures. It holds back a file that the page's settings cannot use." Then keep "So `scene.warmUp()` builds only the pipelines that the model's objects need" and the last two sentences (what the list leaves out). Move the `coverage` / `lod_fade` rules and the governor threshold into `<details><summary>Technical details: which shader files the list holds back</summary>`, with a link to concepts/lod.md#fading-between-levels.
- Line 278: split after the second sentence. Put the presets and the bytes they take (Low and Medium: ETC2 or ASTC; High and Ultra: BC7) in a two-item list.
- Line 370: do not cut it to one sentence. Split it in two: (a) what the inputs are: a PNG, JPEG or TGA image, read from its red channel, at least one map; (b) the output takes the largest map's size and the other maps stretch to it, so the maps must have one shape. Move each missing-map default and its reason into the option table's "Without it" column ("White: no occlusion", "White: the roughness factor applies as it is", "Black: no metal").
- Line 471: split after the first sentence. Move the per-path bits (morph targets on WebGL2, instance index on WebGPU) into a details block.
- Line 485: make a short list of the recorder's options (`--page-root`, `--page <path>`, the query for states that the controls cannot reach). Move the reason why the recorder runs from a checkout of the repository into a details block.
- Line 151: optional. It is 62 words, and it explains the reason for the bake well. Leave it as it is.
