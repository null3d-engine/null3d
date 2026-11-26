# Verdict on api-2-substance-25

## The finding as given

- Page: api/materials (hand-written, source docs/api/materials.md)
- Anchor: 29 long paragraphs (stats lines 107, 167, 191, 210, 243, 287, 299, 339, 411, 455, 457, 459, 496, 509, 513, 519, 561, 576, 578, 593, 621, 671, 675, 722, 813, 840, 846, 848, 852)
- Category: long-paragraph. Severity: medium.
- Claim: The longest are setUniform (526, 170 words), shadows of masked custom materials (847, 182 words), the layer-map rules (346, 133 words) and uvTransform with its formula (516, 146 words). Most "### Cost of ..." paragraphs are dense detail for implementers.
- Proposed edit: Put each "### Cost of ..." body in `<details><summary>Technical details: cost of ...</summary>`, and keep one sentence in the main text: "Nothing runs until the first such material; list x in preload to load it before the first frame." Split 526 into "set at setup" and "setUniform in a frame". Move the uvTransform formula and the rules at 847 into details blocks.

Verdict: partly

## Evidence

- The four named paragraphs exist with the stated word counts. The finding's line numbers are file lines; stats.json gives the same paragraphs 7 lines earlier (519, 840, 339, 509). Both point at the same text: file lines 526, 847, 346, 516.
- The long-paragraph problem is real. The page has 29 paragraphs over the limit and 13,672 words.
- The one-sentence template for the cost sections is wrong for several of them:
  - Transmission (file line 174) and weighted blending (678) start when the first such surface *draws*, not when the first material exists.
  - Light under the surface (250) also stays off while the quality setting gives it no taps. This is a real condition: Low and Medium, WebGL2 and compatibility mode give 0 taps (line 242). The template would drop it.
  - The layers (306) and iridescence/anisotropy (360) have no "nothing runs" rule. Their shaders load when the material is *created*, and both list `'coat_sheen'`.
  - Each section has its own preload key: transmission, translucency, subsurface, coat_sheen, decals, weighted, and bump plus displacement for relief (512).
  So the kept sentence must be written per section, with that section's trigger and key.
- Paragraph 847 holds rules that a user must follow, or the shadows go wrong. The main text must still make sense with every block closed. If the whole paragraph moves into a block, a reader never learns two things:
  - A masked custom material needs a coverage function to cut its shadow.
  - A flat caster needs `doubleSided: true`, or the shadow pass culls it and it casts nothing.
  Only the internals should move: the caster builds against the depth template, why front faces are culled, and why an unmasked coverage function is refused.
- The edit leaves paragraphs out that the finding names. It gives no fix for the layer-map rules at 346, even though it names them among the longest. The same holds for 682 (moment transparency, 126 words, with a benchmark comparison that fits a block), 848, 852 and the rest of the 29.
- Paragraph 526 ends with `bun run bench:allocation --setters` (a repository script in package.json). This is a check in the engine's own repository, not something a developer who uses the engine runs. It belongs in the block or should be cut, not in the main text of the setUniform split.
- The uvTransform formula and the split of 526 are sound proposals that follow the writing rules and the block format.

## Corrected claim

The page has 29 long paragraphs. The longest are 847 (182 words), 526 (170), 516 (146), 346 (133) and 682 (126). The cost sections hold dense per-pixel and per-frame detail that suits a block. But each one opens with a trigger and a preload key that differ from section to section, and the reader needs both.

## Corrected edit

- Cost sections (174, 217, 250, 306, 360, 418, 512, 678): keep one sentence in the main text for each, with that section's own trigger and preload key. Examples:
  - "Nothing runs until the first surface that lets light through draws; list `'transmission'` in `preload` to load its shaders before the first frame."
  - "Nothing runs while no material has `subsurfaceRadius` or the quality setting gives it no taps; list `'subsurface'` in `preload` ..."
  - "The layers' shaders load when you create the first layered material; list `'coat_sheen'` in `preload` ..."
  Move the per-pixel, per-light, render-pass and bytes-per-pixel detail into `<details><summary>Technical details: cost of ...</summary>`.
- 526: split it into two paragraphs. The first says `set` is for setup and several values at once. The second covers `setUniform` in a frame: what it takes, and that colors go in an array that you change in place. Move the boxing explanation and the `bench:allocation` sentence into a details block, or cut the benchmark sentence.
- 516: keep the rotate, scale, then offset order and the `mapUvTransforms` sentences in the main text. Move the two-line formula and the shared-slot and glTF notes into a details block.
- 847: keep the main-text rules:
  - "A masked custom material cuts its shadow only when its WGSL declares `fn coverage(input: SurfaceInput) -> f32`."
  - "Without one, or without a surface alpha, it casts its whole mesh."
  - "Give a flat caster `doubleSided: true`, or it casts nothing."
  - "The coverage function needs the `mask` alpha mode."
  Move the caster builds against the depth template, the front-face culling reason and the development-build refusal reason into a details block.
- 346: keep "A material takes either the coat and sheen maps or the iridescence and anisotropy maps, not both; development builds throw E1217." Move the production-build, glTF-loader and texture-array pairing rules into a details block.
- 682: keep what the setting does and how to turn it on. Move the test-scene comparison and the moments method into a details block.
