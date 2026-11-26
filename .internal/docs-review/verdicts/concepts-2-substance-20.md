# concepts-2-substance-20

## Finding as given

- page: concepts/quality-presets
- anchor: 29 long paragraphs: lines 63, 85, 111, 120, 124, 128, 137, 163, 178, 184, 200, 202, 204, 212, 218, 220, 222, 224, 226, 237, 252, 287, 300, 313, 315, 317, 321, 323, 333
- category: long-paragraph, severity: medium
- claim: The page has 6,748 words, and most paragraphs run past 90 words. Useful but dense detail stops the reader: when a stored check result applies (128-139), moment transparency's bytes (212), the prepass's bit-exact depth (224), how the governor judges a second (256-259).
- proposedEdit: Keep one short paragraph per idea in the main text. Move into details blocks: "Technical details: when a stored check result applies" (130-139), "Technical details: the memory of moment transparency" (212), "Technical details: why both passes compute the same depth" (224), "Technical details: how the governor judges a second" (256-259). Split line 63 into the heat effect and the iPad figures.

Verdict: partly

## Evidence

- stats.json gives 6,748 words and 29 long paragraphs. Its line numbers are relative to the body after the 7-line front matter. The finding's lines (stats line + 7) match the real file lines in docs/concepts/quality-presets.md. The line list is correct.
- "Most paragraphs run past 90 words" is wrong. Only 16 of the 29 long paragraphs pass 90 words (file lines 63, 120, 124, 128, 137, 184, 204, 212, 218, 220, 222, 224, 237, 287, 313, 333). The other 13 are long only by sentence count (5 to 8 sentences, 64 to 89 words). The page has many more short paragraphs, lists, tables and code blocks, so 16 is far from "most".
- The four proposed blocks hold dense detail that suits a closed block:
  - 212 (192 words): bytes per pixel and MiB figures for moment transparency. The main text at 210 already says what the option does and why presets leave it off.
  - 224 (121 words): why the two passes need bit-exact depth, and how each GPU path builds its prepass shaders. Keep its first sentence ("Both GPU paths draw the prepass, and it gives the same image...") in the main text. Keep 226 (equal-depth ties and the depth-bias advice) in the main text, because it tells the reader what to do.
  - 130-137: the conditions for a stored check result. The main text must keep one sentence that a stored result applies only while the start matches the measured one, and that the engine measures again otherwise. Line 139 (stored rounds after each lowered preset) is a separate behavior. It does not fit the block title "when a stored check result applies". Give it its own block or a short main-text sentence.
  - 256-259 are items of a bulleted list (256-264), not paragraphs. A details block cannot sit inside a Markdown list item without breaking the list. Lines 260 and 262 also rely on "a second over budget" and "the target", which 257 and 258 define. So the main text must keep one plain definition before the list, for example: "A second is over budget when its frames average under 95% of the target rate." Then put the quarter-second rule, the GPU-delay rule, the Safari timer note and the target-fall rule (rest of 257-259) in a block after the list.
- The proposal names only 4 blocks and one split for 29 long paragraphs. It leaves out the densest remaining ones: 287 (176 words: 8-bit colour paths, when the final pass is added, FXAA plus GSR 1 steps, the sharpen cost), 220 (151 words, 12 sentences: which objects skip the prepass, its default on each GPU path and preset), 204 (126 words: FXAA vs MSAA and how the preset check moves the anti-aliasing mode) and 313 (119 words). 128 (123 words) carries iPad timing figures that also suit a block. "Keep one short paragraph per idea" gives no edit for these.
- Line 63 split is right: the heat effect and the advice to name Low are main text; the iPad benchmark figures can go into a block. (The "S4 benchmark" name is an internal benchmark label; that is a separate wording issue, not part of this finding.)

## Corrected claim

The page has 6,748 words and 29 long paragraphs. 16 of them pass 90 words; the other 13 are long by sentence count. Several hold dense implementer detail that should move into closed blocks.

## Corrected edit

- Line 63: keep the heat effect and the advice to name Low; put the iPad figures in "Technical details: an iPad Pro as it heats up".
- 128-139: keep one main-text sentence on reuse and re-measuring, plus the `?check=fresh` switch. Put the condition list and the storage rules (130-137) in "Technical details: when a stored check result applies". Put 139 in a separate sentence or block on stored rounds. Move the iPad timings in 128 into the first block or one of their own.
- 212: "Technical details: the memory of moment transparency". Keep 214's cost figures in the main text in one short sentence, or add them to the same block.
- 224: keep its first sentence in the main text; move the rest into "Technical details: why both passes compute the same depth". Keep 226 in the main text.
- 256-264: before the list, add one sentence that defines a second over budget. Move the detail of 256-259 into "Technical details: how the governor judges a second", placed after the list, not inside it.
- Also move into blocks: 287 ("Technical details: 8-bit colour paths and the two-step final pass"), the per-path defaults of 220 ("Technical details: which objects and GPU paths use the prepass"), and the check's change of anti-aliasing mode in 204. Split 313 into the step rules and the reverse-order rules.
