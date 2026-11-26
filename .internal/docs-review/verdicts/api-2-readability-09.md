# Verdict: api-2-readability-09

## The finding as given

- id: api-2-readability-09 (slice api-2, readability reviewer)
- page: api/materials (docs/api/materials.md, written by hand, not generated)
- anchor: long paragraphs at lines 114, 174, 198, 217, 250, 294, 306, 346, 418, 462, 464, 466, 503, 516, 520, 526, 568, 583, 585, 600, 628, 678, 682, 729, 820, 847, 853, 855, 859
- category: long-paragraph; severity: medium
- claim: 29 paragraphs are over the limit. The worst are 182 words (847, coverage function), 170 (526, set vs setUniform), 146 (516, uvTransform) and 133 (346). Each holds several rules, so readers miss the one they need.
- evidence: stats.json api/materials longParagraphs, 29 entries (stats lines 107-852; file line = stats line + 7).
- proposedEdit: 526: split into 'Use set at setup' and 'Use setUniform in a frame' with a two-row table, move the boxing reason to a technical details block, and delete the benchmark command. 516: keep two sentences, and move the formula to a details block. 847: make a numbered list. 198: unwrap, and put the leaf values in a table. 583, 585, 600, 628: break at each change of subject, and put the preload names in a details block. 682: keep one sentence, and move the accuracy figures to a details block. Split the others after the second or third sentence.

Verdict: partly

## Evidence

The claim holds:

- stats.json lists 29 long paragraphs for api/materials. The word counts of the four worst match: 182 (stats 840), 170 (stats 519), 146 (stats 509), 133 (stats 339).
- The offset of 7 is right. docs/api/materials.md:114 starts "A surface reflects some light", :526 starts "`set` is for setup", :516 starts "`uvTransform` places every map", :847 starts "A masked custom material cuts its shadow". These match the stats openings.
- docs/api/materials.md:198-204 is one paragraph hard-wrapped over seven lines. That is why line 198 looks short in the file.
- The page has no `<details>` block yet, so the proposals add new structure. They do not conflict with an existing one.

Parts of the proposed edit are wrong:

1. "Delete the benchmark command" at 526. AGENTS.md "Writing docs" says "Name the engine's benchmarks when you cite a figure." The same `bun run bench:allocation ...` sentence also sits in api/geometry.md:204, api/debug.md:335, api/raycast.md:23, api/controls.md:106, api/wind.md:372 and api/scene.md:246, 341, 462, 549. If you delete it on this one page, the pages no longer agree, and the rule is broken. Move it into the technical details block with the boxing reason.
2. "Make a numbered list" at 847. The sentences are separate conditions, not steps in an order: when the shadow cuts, which builds a material gets, why a flat caster needs `doubleSided`, and why the mask mode is required. Use a bulleted list. Put the caster builds and the depth template (sentence 4) in a details block. Also, sentence 1 says the shadow cuts "only when" the WGSL declares a coverage function. Sentence 3 implies that a surface alpha alone also changes the caster. Make the list say one thing.
3. "Keep two sentences" at 516. The sentences after the formula are not dense detail. They give `mapUvTransforms`, a public option, and three rules a reader needs: a left-out value takes its default, two maps in one slot share a transform, and glTF keeps one transform for each texture. Only the formula (sentence 2, after the colon) belongs in a details block. Keep the rest in the main text as a second paragraph or a short list.
4. "Put the preload names in a details block" for 583, 585, 600, 628. Only 600 names preload values (`'coverage'`, `'hash'`). Lines 174, 217, 250, 306, 418 and 678 keep their preload instruction in the main text. A preload is an action the reader takes, not background. If only 600 hides it, the page stops agreeing with itself. Move the last two sentences of 600 into a short paragraph of their own instead.
5. "Split the others after the second or third sentence" is too blunt for three paragraphs:
   - 859 gives the valid range of about 25 options. A table (option, range, what a bad value throws) reads better than a split.
   - 855 lists the errors a custom material throws (E1215, E1216). Use a bulleted list.
   - 346 and 462 are the slot-sharing rules for layer maps and volume maps. Keep the first sentence of each (which maps a material may not take) in the main text. Put the texture-array details in a details block. A split after the third sentence would cut a rule off from its result.

The rest stands: the table and details block at 526, the unwrapped paragraph and leaf-value table at 198, the details block for the moment figures at 682, and splits at each change of subject for 583, 585 and 628.

## Corrected claim

The claim stands as given. 29 paragraphs are over the limit. The worst are 847 (182 words), 526 (170), 516 (146) and 346 (133).

## Corrected edit

- 526: two-row table, "set at setup" and "setUniform in a frame". Move the boxing reason and the `bun run bench:allocation --setters` sentence into one technical details block. Keep the command, as the other API pages do.
- 516: keep the main text and `mapUvTransforms` with its rules in the main text. Move only the formula into a details block.
- 847: bulleted list (not numbered). Caster builds and the depth template go into a details block. Make the "only when" rule agree with the surface-alpha case.
- 198: unwrap the hard-wrapped lines, and put the leaf values in a table.
- 600: put the preload sentence in a paragraph of its own in the main text, as the other features on the page do. 583, 585, 628: break at each change of subject.
- 682: keep the first sentence and the "exact for one or two surfaces" fact in the main text. Move the accuracy figures and the moment method into a details block.
- 859: table of option ranges. 855: bulleted list of errors. 346 and 462: keep the first rule in the main text, and move the texture-array sharing into a details block.
- Others (114, 174, 217, 250, 294, 306, 418, 464, 466, 503, 520, 568, 729, 820, 853): split at each change of subject.
