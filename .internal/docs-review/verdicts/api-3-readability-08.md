# api-3-readability-08

## Finding as given

- page: api/render
- anchor: lines 21, 67, 81, 146, 152, 382, 395, 441, 445; bullets at lines 58 and 465
- category: technical-details-block, severity: medium
- claim: Nine paragraphs are over the limit. The intro (124 words) names four pass kinds in prose. Lines 67 and 146 are lists written as prose. Line 395 (208 words, 13 sentences) gives history-pass memory. Line 152 holds benchmark figures. Lines 58 and 465 hold 8-bit and copy-path detail that only implementers need.
- proposedEdit: Line 21: two sentences, then a table Pass kind | What it does | Section. Lines 67 and 146: bulleted "It draws / It does not draw" lists. Line 395: keep the first sentence and "Size a history pass for its grid, not the canvas", and put a byte table in `<details><summary>Technical details: the memory of a pass with history</summary>`. Line 152: keep the preset shares, and put the S1 figures in `<summary>Technical details: measured cost</summary>`. Lines 58 and 465: details blocks "pass textures on 8-bit devices" and "how each path turns the image upright". Lines 81, 382, 441, 445: break at the fourth sentence (445 before "Give no fallback when the work needs atomics").

Verdict: partly

## Evidence

- stats.json lists nine long paragraphs for api/render at lines 14, 60, 74, 139, 145, 375, 388, 434, 438. The page has seven lines of front matter, so these are page lines 21, 67, 81, 146, 152, 382, 395, 441, 445. The count and the line mapping in the finding are right.
- Line 21 (124 words, 7 sentences) names scene, reflection, full-screen and compute passes in prose. A table is a fair fix.
- Lines 67 and 146 are lists of what each pass draws, written as prose. Bullets fit.
- Line 152: the S1 figures are correct to keep with the benchmark name. AGENTS.md "Writing docs" says "Name the engine's benchmarks when you cite a figure", so the block must keep "S1, the swarm benchmark" beside the numbers.
- Line 445 (page lines 445): "Give no fallback when the work needs atomics" is the sixth sentence, not the fourth. A break there leaves a first part of five sentences, still over the limit. The paragraph also mixes three topics: layer counts (sentences 1-4), uniform positions in the fallback (sentence 5), and work a fallback cannot do (sentences 6-9).
- Line 395 (page lines 395-406): the last sentence, "`render.dumpGraph()` does not list the state textures, so budget them beside its figures", is a warning every user of history needs. So is the point that a canvas-sized history pass can take gigabytes. The proposal keeps only two sentences in the main text and would hide both.
- Line 58 (bullet): only the mechanism is implementer detail (the engine turns colors back to linear, the tone curve runs twice). The visible effect (the image looks a little lighter in the middle tones; on WebGL2 without float targets it looks brighter and flatter) is what any user sees on a minimap. It must stay in the main text, or a reader with every block closed cannot explain the look. Line 148 already refers back to it ("as to a scene pass's texture").
- Line 465 (bullet in "Cost"): the cost point is the full-screen copy at one texel read per texel. The per-path detail on how the image turns upright fits a block.
- Lines 81, 382, 441: a break at the fourth sentence falls at a natural seam in each ("A custom material reads...", "A reader of the array...", "A pass with `history` runs...").

## Corrected claim

Nine paragraphs are over the limit, and most proposed breaks and blocks are right. Three parts of the edit need change: the split of line 445 is at the wrong sentence, the line 395 block would hide two warnings readers need, and the line 58 block would hide a visible effect, not only implementer detail.

## Corrected edit

- Line 445: split in three. Sentences 1-4 (layers and their limits) stay as one paragraph. Move sentence 5 ("The values keep their positions...") into the paragraph after line 441 ("A fragment form writes the same texels..."), as it is about the fallback matching the compute form. Sentences 6-9 ("Give no fallback..." to "...on WebGPU only.") become their own paragraph.
- Line 395: keep in the main text the first sentence, "Size a history pass for its grid, not the canvas", one sentence such as "A canvas-sized pass can take gigabytes", and the `render.dumpGraph()` budget warning. Put the layer counts per path and the byte table in `<details><summary>Technical details: the memory of a pass with history</summary>`.
- Line 58: keep the bullet's first sentence and the visible result ("the image looks a little lighter in the middle tones; on WebGL2 devices without float targets it looks brighter and flatter"). Put only the mechanism (colors turned back to linear, the tone curve applied twice) in a `<details>` block placed after the bullet list, not inside it.
- Line 152: keep the preset shares and the render-scale sentence in the main text, and a one-line result such as "On S1, the swarm benchmark, it added under 1 ms of GPU time". Put the per-path figures and the note on small objects in `<details><summary>Technical details: measured cost</summary>`, with the benchmark name kept.
- Line 465: place the upright-image block after the "Cost" list; keep "a full-screen copy at one texel read per texel" in the bullet.
- Lines 21, 67, 146, 81, 382, 441: as proposed.
