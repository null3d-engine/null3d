# guides-1-readability-08

## Finding as given

- page: guides/assets-pipeline
- anchor: ## The shader list, line 276
- category: technical-details-block
- severity: medium
- claim: The longest paragraph in the slice (212 words, 10 sentences) mixes the user's point (shader files download with the textures, so nothing downloads during play) with loader rules for coverage, lod_fade, measured and hand-set levels and the governor.
- evidence: stats.json line 269: 212 words, 10 sentences.
- proposedEdit: Keep two sentences: "The engine reads the list as it loads the file and downloads those shader files beside the textures. `scene.warmUp()` then builds the pipelines that the model's objects need, so nothing new downloads while the game plays." Move the rest into `<details><summary>Technical details: which listed files the engine holds back</summary>` as a list: coverage needs MSAA; lod_fade needs lodFade, off on Low; hand-set fades always need the file; measured levels name no fade file; a held file loads on first use later.

Verdict: partly

## Evidence

- The paragraph is at docs/guides/assets-pipeline.md:276 in the generated copy (stats.json lists it at 269, 212 words, 10 sentences). It mixes the reader's point with loader rules, as the finding says. A block is the right tool.
- The code claims the block would carry are correct: packages/engine/src/sketch/runner.ts:846 and :1742 mark `coverage` usable only with MSAA; runner.ts:1484 ties `lod_fade` to the `lodFade` setting.
- The proposed main text is wrong in two ways:
  1. It drops "at a preset's own threshold" and the fact that some listed files are held back. With the block closed, the main text says "nothing new downloads while the game plays" with no limit. The page itself says a held file still downloads on first use, when the settings change, or when the governor raises the threshold. So the closed-block text would mislead.
  2. The block list leaves out the last two sentences: the list names only what the model decides, and device bits (half precision) and scene bits (receiving shadows) are not part of it. That is useful detail and must not be cut.

## Corrected claim

The paragraph is too long and its loader rules belong in a block. But the main text must keep a one-sentence caveat that the engine holds back files the current settings cannot use, and that those download later if the settings change. The scope note (what the list does not name) must move into the block, not vanish.

## Corrected edit

Main text:

> The engine reads the list as it loads the file and downloads those shader files beside the textures. It holds back a file that the page's settings cannot use, and downloads it later if the settings change to use it. So `scene.warmUp()` builds the pipelines that the model's objects need, and nothing new downloads while the game plays at a preset's own threshold.

Then:

<details>
<summary>Technical details: which listed files the engine holds back</summary>

- Alpha to coverage (`coverage`) needs MSAA.
- A distance band's fading edges (`lod_fade`) need the `lodFade` setting, which Low turns off.
- A hand-set level's own fade always needs the `lod_fade` file, whatever the setting, because its switch would pop without it.
- The list names `lod_fade` only for levels that fade. A level with a measured error switches at once while the threshold stays small, so a model whose levels the command cut names no fade file.
- A pipeline that needs a held feature still loads its file on first use. So the fade file downloads once the governor raises the threshold past the point where a measured switch shows.
- The list names only what the model itself decides. Bits that a device fixes, such as half precision, and bits that the scene decides, such as receiving shadows, are not part of it.

</details>
