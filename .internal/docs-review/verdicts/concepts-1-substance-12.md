# Verdict for concepts-1-substance-12

## The finding as given

- page: concepts/architecture
- anchor: ### When the job workers start, line 47 (stats line 40, 322 words); also file lines 33, 83, 89, 106, 110, 141, 143, 159 (stats 26, 76, 82, 99, 103, 134, 136, 152)
- category: long-paragraph, severity: medium
- claim: The job worker paragraph is 322 words in 23 sentences. The reader needs three facts: none start at first, they start as the parallel work grows, and they stay until the engine stops. The timing windows, the 0.2 ms rule, the decoder rule and the 18-core Mac figures are implementer detail. Some sentences make no sense alone: "Each reading of the browser's clock allocates. A slow frame rate makes that wait no longer."
- evidence: stats.json concepts/architecture; packages/engine/src/page/switches.ts:398-402 confirms the cap (cores less a reserve, at least 1).
- proposedEdit: Keep a short summary paragraph (3.5 MiB per worker, none at first, start as the work grows up to logical cores minus 2, a small scene never starts one, engine.mode.jobWorkers, stats overlay). Move the rest into `<details><summary>Technical details: when the engine asks for more job workers</summary>`, and explain the 4.5 s pause there. In "## One frame", put sketch-worker steps 3-9 in a block under a two-line summary.

Verdict: partly

## Evidence

- docs/concepts/architecture.md:47 is one paragraph of 322 words and 23 sentences (stats.json). It mixes the user facts with the window rules, the decoder rule, the script preload, the timing pause and benchmark figures.
- The code agrees with the detail the finding wants to keep in a block. packages/engine/src/sketch/runner.ts:356-370 sets the 2 s window, the 2-frame minimum, the 200 microsecond threshold and the 4.5 s pause. runner.ts:1400-1431 doubles the request (at least 2) and pauses the timing after a quiet window. The pause comment (runner.ts:365-368) says each timing reads the clock, "which allocates a number", and that the pause is a time so a slow frame rate does not lengthen it. The page's two sentences "Each reading of the browser's clock allocates. A slow frame rate makes that wait no longer." do not say this clearly. That part of the claim holds.
- packages/engine/src/page/switches.ts:396-401 confirms the cap: cores minus 2, at least 1.
- So the job worker half of the finding holds. A summary plus a `<details>` block is the right fix. The detail is correct and useful to implementers, so it should move, not go.

## What does not hold

- The "One frame" part of the edit is wrong. Steps 3-9 are a numbered list, not a long paragraph, so they are outside a long-paragraph finding. Stats.json flags no paragraph there.
- Hiding steps 3-9 breaks the rule that the main text must make sense with every block closed. The list would jump from step 2 to step 10. A `<details>` block in the middle of an ordered list also breaks the list's numbering in GitHub Markdown.
- Steps 3 and 6 hold the order of the sketch's own hooks: pointer handlers, animation events, `onFixedUpdate`, `onUpdate`, then `onLateUpdate` after the transforms. A developer needs that order, so it must stay in the main text.
- The finding lists eight more long paragraphs (lines 33, 83, 89, 106, 110, 141, 143, 159) but proposes no edit for any of them.
- The proposed summary drops "and at least 1" from the cap. The table at line 42 keeps it, so this is minor, but the summary should match.

## Corrected claim

The job worker paragraph (line 47, 322 words, 23 sentences) is too long. It hides the three facts a user needs among the window rules, the decoder rule and the benchmark figures, and two of its sentences are unclear on their own. The "One frame" list is not a long paragraph. Its steps 3 and 6 give the hook order that users need, so it stays visible.

## Corrected edit

- Line 47: keep the proposed short summary, with the cap written as "up to the logical cores minus 2, and at least 1". Move the rest into `<details><summary>Technical details: when the engine asks for more job workers</summary>`. Put the 30-frame or 2-second window, the 0.2 ms mean, the doubling, the decoder and between-frame requests, the script preload and the 18-core Mac figures there. Write the pause as: "After a window with too little parallel work, the sketch thread stops timing its loops for 4.5 seconds of sketch time, because each read of the browser's clock allocates memory. The pause is a time, not a frame count, so a slow frame rate does not make it longer."
- "## One frame": leave the list as it is. If it must be shorter, move only the texture mip-drop and light-gathering clauses of step 8 into a block after the list. Keep every step number and every hook name in the main text.
- Line 106 (98 words, 6 sentences): split it in two. The first paragraph covers WebGL2 with no compute passes. The second covers the one-time environment filtering and the render graph's cached order.
- Line 143 (125 words, 9 sentences): split it in two. The first paragraph covers what `sketchThread: 'main'` does and when to use it. The second covers the costs, the `?render=main` switch and E1415.
- Line 159 (96 words, 6 sentences): split it in two. The first paragraph covers the kept memory and `release: true`. The second covers the 45-second retry.
- Lines 33, 83, 89, 110 and 141 are only a little over the limit (65 to 103 words, 5 or 6 sentences). Leave them as they are, or split each once where the topic changes.
