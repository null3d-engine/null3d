# Verdict on api-2-readability-16

## The finding as given

- Page: api/quality
- Anchor: long paragraphs at lines 61, 67, 71, 75, 87, 102, 163, 177, 190
- Category: long-paragraph. Severity: medium.
- Claim: Line 102 (140 words) gives the governor's step order as prose. Line 177 lists five textureMemory fields in prose. Line 75 gives four preset-switch rules in one paragraph.
- Evidence: stats.json api/quality longParagraphs; line 102 'Then it lowers ... Then it lowers ...'; line 177 'Its `bytes` ... Its `budgetBytes` ...'.
- Proposed edit: 102: a numbered list of the governor's order, then one sentence on quality.governor. 177: a table of field and what it reports. 75: bullets (what takes the new value, what keeps its value, the preset-check exception, the GPU cap and quality.highest). Split 87, 163 and 190 at the change from behavior to errors.
- Generated source: none (docs/api/quality.md is hand-written).

Verdict: partly

## Evidence

- The nine long paragraphs are facts from stats.json (stats lines 54-183 match page lines 61-190). Line 102 is 140 words, 9 sentences; line 71 is 121 words, 7 sentences; line 75 is 110 words, 7 sentences. These are real costs to a reader.
- Line 75 holds separate rules in one run of prose. Bullets fit. This part holds.
- Line 177 lists four `quality.textureMemory` fields, not five: `bytes`, `budgetBytes`, `droppedLevels`, `droppedTextures`. The fifth item ("Each texture's `droppedLevels`") is a member of each texture, not of `textureMemory`. The API reference already has the field table: docs/api/reference/quality.md:202-213 (`TextureMemory`, four rows). A second table on this page repeats it. Line 177 does not link to that reference.
- Line 102 restates the governor's order, and the same sentence links to the full list. docs/concepts/quality-presets.md "The frame-budget governor" already gives that order as a Mermaid chart and a 10-step numbered list. A new numbered list here makes a third copy that can drift. Line 102 already links `QualityGovernor` in the reference.
- Line 190 has no errors in it. It is all behavior (when handlers run, what they return, keep them cheap, the preset-change wait). "Split at the change from behavior to errors" cannot apply to it.
- Line 71 is the paragraph that most needs the behavior/errors split (sentences 3-4 and 6-7 are error rules), but the proposed edit leaves it out. Lines 61 and 67 are in the anchor but get no edit; at 65-66 words and 5 sentences they are borderline and need none.
- Line 87 splits well before "A name that is no preset ... throws E1213". Line 163 ends with one error sentence; a split there is minor.

## Corrected claim

The page has nine long paragraphs. Line 102 restates, in prose, a step order that the concepts page already lists in full. Line 177 lists the four fields of `quality.textureMemory` in prose, plus a note on each texture's own count, and does not link to the reference table of those fields. Line 75 packs separate preset-switch rules into one paragraph. Line 71 mixes what `quality.set` does with five error rules.

## Corrected edit

- 102: keep it short and do not copy the order. Split it into two paragraphs. First: "When frames take too long, the engine lowers the sketch's budgets and the render scale first, then detail, shadow and effect settings, one step at a time. It raises them again once frames have time to spare. When frames still miss at the lowest render scale, it enters the lowest quality tier. [Quality presets] lists every step in order." Second: the `quality.settings` versus `quality.governor` sentences and the `QualityGovernor` link. Optionally put the step names (levels of detail, live shadows, bloom, ambient occlusion, reflections, contact shadows, far characters, fog) in a `<details><summary>Technical details: the order of the steps</summary>` block, as a short list that defers to the concepts page.
- 177: no table. Cut to: "`quality.textureMemory` reports the GPU memory of textures against the `textureMemoryMiB` budget, and how many mip levels the engine dropped to stay under it. [`TextureMemory`](reference/quality.md#texturememory) lists its fields. Each texture's own `droppedLevels` gives its count." Keep the link to Quality presets.
- 75: bullets, as proposed.
- 71: split into what `set` does (sentences 1-2, 5) and a second paragraph or bullet list of what throws E1213, with the lowest-tier exception last.
- 87 and 163: split before the error sentence, as proposed. 190: split after "It returns a function that removes the handler." (when it runs / how to write handlers), not at errors.
