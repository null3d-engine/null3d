# Verdict on api-2-substance-26

## The finding as given

```json
{
 "page": "api/quality",
 "anchor": "long paragraphs at file lines 67, 71, 75, 87, 102, 163, 177, 190",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Line 71 (121 words) packs the rules of quality.set together with the render-scale cap of the lowest tier ('a minRenderScale above the tier's cap ... raises the cap to it instead. Only a maxRenderScale that the sketch set itself throws'). Line 75 mixes setPreset with the preset check. Line 102 (140 words) lists every governor step in running text.",
 "evidence": "stats.json api/quality; docs/api/quality.md:71, 75, 102.",
 "proposedEdit": "Make the quality.set rules a list. Move the lowest-tier interaction into <details><summary>Technical details: render scale limits in the lowest tier</summary>. Make the governor's order at 102 a numbered list, or link the concept page's order and keep one sentence.",
 "generatedSource": "",
 "id": "api-2-substance-26",
 "slice": "api-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The page is hand-written (docs/api/quality.md), so no generated source applies.
- The stats.json line numbers are 7 lower than the file's lines (stats 64 = file 71, 95 = 102, and so on). Stats lists 9 long paragraphs. In file lines they are 61, 67, 71, 75, 87, 102, 163, 177 and 190. The anchor leaves out line 61 (66 words, 5 sentences, the `quality.settings` paragraph).
- Line 71 (121 words, 7 sentences): the claim holds. One paragraph gives what `set` does, five cases that throw E1213, a tip about moving both ends of the range, and a lowest-tier exception. A short list of the throw cases fits. The lowest-tier exception is an edge case, and concepts/quality-presets.md:323 already says that a sketch's own `minRenderScale` wins over the tier's floor and cap. A details block is a good home for it.
- Line 75 (110 words, 7 sentences): the claim holds. The sentence that starts "The preset check is different" is an exception about the start-up check, not about `setPreset`. The proposed edit gives no change for this paragraph.
- Line 102 (140 words, 9 sentences): the claim holds. But concepts/quality-presets.md:300-312 already gives the full order as a numbered list of 10 steps, and line 102 already links to it ("Quality presets gives the order of the steps"). A second numbered list here would copy that list, and the two copies could drift apart. Of the two options, only "keep one sentence and link" is right.
- Lines 67, 87, 163, 177 and 190 are in the anchor, but the claim and the edit do not cover them. The task asks for one finding that covers all the long paragraphs of a page, so the edit is not complete.

## Corrected claim

The page has 9 long paragraphs, at file lines 61, 67, 71, 75, 87, 102, 163, 177 and 190. Lines 71, 75 and 102 are the worst. Line 71 mixes the rules of `quality.set` with a lowest-tier exception. Line 75 mixes `setPreset` with an exception for the start-up preset check. Line 102 repeats in running text the governor order that the concept page already gives as a numbered list.

## Corrected edit

- Line 71: keep "changes the settings it gets, from the next frame, and resolves at once". Make the E1213 cases a bulleted list, and keep the tip about giving both ends in one call. Move the lowest-tier exception into `<details><summary>Technical details: render scale limits in the lowest tier</summary>`, with a link to concepts/quality-presets.md#the-lowest-quality-tier.
- Line 75: split it after "keep their values". Put the start-up preset check exception into its own short paragraph or a details block. Start a new paragraph for the GPU-path cap and `quality.highest`.
- Line 102: do not add a numbered list. Shorten the paragraph to one sentence: budgets and render scale go down first, then detail, shadow and effect settings, then the lowest tier. Keep the existing link to the concept page's order. Make a second paragraph from the `quality.settings` and `quality.governor` sentences.
- Lines 61, 67, 87, 163, 177 and 190 are only a little long (60 to 100 words). Split each one where its subject changes. For example, at 87 split before "A name that is no preset", and at 190 split before "Keep handlers cheap".
