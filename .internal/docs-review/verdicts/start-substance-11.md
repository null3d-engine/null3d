# Verdict: start-substance-11

## The finding as given

- id: start-substance-11 (slice start, role substance)
- page: cli/null3d
- anchor: lines 39, 52, 191, 210, 223, 300, 312, 347, 442, 446, 470, 488, 539, 541
- category: technical-details-block
- severity: medium
- claim: Fourteen long paragraphs. The allocation gate (line 442, 161 words) and assets optimize (line 446, 154 words) use terms such as "permutation bits" and "pipeline keys" with no explanation. The impostor bake (539-541) and the glTF extras (470) are dense reference text.
- evidence: stats.json cli/null3d longParagraphs (lines 32-534, offset 7 from file lines).
- proposedEdit: Line 446: keep "`assets optimize` makes glTF models smaller and faster to load and draw. Each model becomes one `.glb` file with its textures beside it. It prints a budget report for each model." Move the rest into <details><summary>Technical details: what optimize changes in a model</summary>. Line 442: keep two sentences on what the gate counts and when it fails, and move the rest into <details><summary>Technical details: how the allocation gate samples</summary>. Put lines 470 and 539-541 in blocks too. Split lines 191, 300 and 347.

Verdict: partly

## Evidence

- The offset is right: the page has 7 lines of front matter and the roadmap note, so stats lines 32-534 are file lines 39-541. The fourteen paragraphs exist as listed.
- Line 446 (docs/cli/null3d.md) is one 154-word paragraph that mixes what the command does with the contents of its budget report. A block for the detail is right.
- "No explanation" is only partly true. The page does not define "permutation bits" or "pipeline keys", but the asset pipeline guide does: docs/guides/assets-pipeline.md:238-262 ("The budget report" table, rows at 254 and 256), :268 (what a permutation bit is) and :278. Line 472 of the CLI page already links that guide, two paragraphs after the terms.
- Line 442 is 161 words. Most of it repeats docs/guides/add-ons.md:153 (what the allocation gate counts, how it names source files, when it fails). Only the 250,000-object cap, the coarser sampling and the software-GPU note are new on the CLI page. A block is right for those, but the repeated part is better replaced by a link.
- Line 470 is not dense reference text. It is a 67-word instruction a reader acts on: two glTF extras that turn off a mesh's blocker or its integer positions, and when to use the second (a city merged by material whose corners move by centimeters). Hidden in a block, a reader who sees that visible bug would not find the fix. It must stay in the main text.
- Line 539 names the three output files and says to load them with `loadImpostorAtlas`. That is how a reader uses the command's output. It must stay visible.
- Line 541 says a base color texture must be PNG or JPEG, so the reader must bake the source model and not a model from `assets optimize`. A reader who misses this gets a failed bake. It must stay visible. Only the triangle-list limit, the 4,096-texel cap and the list of material fields that the bake reads are block material.
- Splits for 191 (91 words, 6 sentences: what mcp does, then what the page needs), 300 (the last sentence about `null3d.json` mistakes is off topic) and 347 (110 words, 8 sentences: build, then run steps) are sound. The finding proposes no edit for 39, 52, 210, 223, 312 and 488 (52-73 words). That is correct: they read clearly.

## Corrected claim

Lines 442 and 446 are long and dense and need a block. Line 446 uses "permutation bits" and "pipeline keys" without a definition on this page; the asset pipeline guide defines them, but the link comes two paragraphs later. Line 442 mostly repeats the add-ons guide. Lines 470, 539 and the first half of 541 are usage instructions, not reference detail, and must stay in the main text. Lines 191, 300 and 347 need splits.

## Corrected edit

- Line 446: keep "`assets optimize` makes glTF models smaller and faster to load and draw. Each model becomes one `.glb` file in the output folder, with its textures in a `textures` folder beside it. It prints a budget report for each model ([The budget report](../guides/assets-pipeline.md#the-budget-report) explains each line)." Move the merge, vertex, clip, KTX2, shader-list and pipeline-key sentences into `<details><summary>Technical details: what optimize changes in a model</summary>`.
- Line 442: keep "The allocation gate counts the bytes per frame that the add-on's own code allocates on each preset, and prints the page's figure beside it. It fails only when it cannot measure the add-on's code, and never on a figure. [Run the check](../guides/add-ons.md#run-the-check) says how it finds the add-on's code." Move the 250,000-object cap, the coarser sampling and the software-GPU note into `<details><summary>Technical details: how the allocation gate samples</summary>`.
- Line 470: keep it in the main text. If it needs a shorter shape, turn the two extras into a small table (extra, value, effect) and keep the city example as one sentence below it.
- Lines 539-541: keep the file names, `loadImpostorAtlas`, and the PNG or JPEG rule with "bake the source model" in the main text. Move only the list of material fields the bake reads, the triangle-list limit and the 4,096-texel cap into `<details><summary>Technical details: what the bake reads</summary>`.
- Split lines 191, 300 and 347 as proposed; move the last sentence of 300 (mistakes in `null3d.json`) to its own short paragraph.
