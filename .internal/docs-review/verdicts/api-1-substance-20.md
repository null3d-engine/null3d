# api-1-substance-20

## Finding as given

- page: api/engine
- anchor: ## The start line 36; ## Memory line 149
- category: long-paragraph
- severity: medium
- claim: Line 36 (158 words, 10 sentences) covers browser tests, the setup, firstFrame and its rejections, and the preset check with its options and stored result. A reader who wants to know when to hide a loading screen must parse it all. Line 149 is 93 words of figures.
- evidence: stats.json api/engine longParagraphs (line 29: 158 words; line 142: 93 words); docs/api/engine.md:36, 149.
- proposedEdit: Split line 36 into three paragraphs: what createEngine resolves on; engine.firstFrame and its rejections; the preset check and presetChecked. Turn the figures of line 149 into a short list.
- generatedSource: (none; docs/api/engine.md is a hand-written, tracked page)

Verdict: partly

## Evidence

- docs/api/engine.md:36 is one paragraph with three separate topics: what the start does and when `createEngine` resolves; when `engine.firstFrame` resolves or rejects (E1404, E1420); the preset check, `presetChecked`, `before-play` and the stored result on a repeat visit. The proposed three-way split follows those topic seams exactly. This half survives.
- The "loading screen" cost is smaller than claimed: the code sample at docs/api/engine.md:27 already says `await engine.firstFrame` is the moment to remove the loading screen. The split still helps, because the paragraph is the only place that says how `firstFrame` can reject.
- docs/api/engine.md:149 is not "93 words of figures". Of its 6 sentences, 3 are sizing figures (about 210 bytes per instance row and 5 million rows in 1024 MiB; about 267 bytes per object place; old and new tables both held while they grow). The other 3 are the advice ("Ask for more only when a scene needs it") and the two failures (E1109 when the scene outgrows the maximum, E1409 for a bad maximum). The advice and the error codes are what a reader acts on; they belong in the main text, not in a list of figures.
- The sizing figures are correct, dense detail that helps an implementer size `maximumMiB`. Per the review's block rule, such detail should move into a collapsible block rather than be flattened into a list in the main text.

## Corrected claim

Line 36 mixes three topics and should be split as proposed. Line 149 is half sizing figures and half advice and error codes; only the figures are dense detail.

## Corrected edit

1. Split line 36 into three paragraphs, as proposed: (a) what `createEngine` tests and starts, and that it resolves once the setup has run; (b) `engine.firstFrame` resolves when the GPU has finished the first frame, and rejects with the failure that ended the frames (E1404) or with E1420 on a destroy before that frame; (c) the preset check, `engine.presetChecked`, the `before-play` option and the stored result on a repeat visit.
2. Keep in the main text of line 149: "Ask for more only when a scene needs it. A scene that needs more memory than the maximum fails with E1109. A maximum that is not a whole number of MiB from 256 to 4096 fails the start with E1409."
3. Move the sizing figures into a block after that paragraph:

<details>
<summary>Technical details: how much memory a scene takes</summary>

- Each instance row takes about 210 bytes of engine memory. So 1024 MiB holds about 5 million rows with the rest of the scene.
- Each place for an object takes about 267 bytes in the scene's tables.
- While the tables grow, the old and the new tables both take memory for a moment.

</details>
