# api-3-readability-15

## The finding as given

- page: api/sketch
- anchor: lines 45, 47, 108, 110, 134, 138, 140, 183
- category: long-paragraph
- severity: medium
- claim: Eight paragraphs go over the limit. Line 140 (engine.firstFrame, 134 words, 8 sentences) mixes what the promise is, when to use it, why a frame number fails, and hold-mode behavior. Lines 108-110 (serial-load warning) are a procedure written as prose.
- evidence: stats.json longParagraphs for api/sketch.
- proposedEdit: Give each engine field its own short block (viewport, capabilities, held, firstFrame). For firstFrame keep 'resolves when the GPU finishes the first frame; start later downloads then; never await it in setup', and put the frame-number caveat and hold-mode rule in <details><summary>Technical details: firstFrame in hold mode and replays</summary>. Lines 108-110: 'When the warning shows / How to fix it / When to turn it off'. Lines 45 and 47: see the reorder finding. Lines 134, 138, 183: break at the fourth sentence.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- stats.json lists eight long paragraphs for api/sketch at its lines 38, 40, 101, 103, 127, 131, 133, 176. These are the page's lines 45, 47, 108, 110, 134, 138, 140, 183 (stats.json counts from after the 7-line front matter). The count of eight holds.
- docs/api/sketch.md:140 holds what the finding says: what the promise is, when to start downloads, why a frame number is no signal, never await in setup, hold mode and replay, and "never resolves when the engine stops first". Moving the frame-number reason and the hold-mode/replay rule into a details block is right. With the block closed, the main text still makes sense: line 138 (engine.held) and the example at lines 151-162 already tell the reader to load in setup when held.
- "Give each engine field its own short block" adds nothing. Lines 134, 136, 138 and 140 are already one paragraph per field. Line 136 (capabilities) is not long. Drop this part.
- "Lines 108-110 are a procedure written as prose" is overstated. Line 108 explains when a warning shows and how to avoid it; line 110 says when the order is needed and how to turn the warning off. That is explanation with one fix, not a step list. The three-part split is fine as plain paragraphs, but it must not use bold labels or new headings (bold labels read as an AI tell). The scope sentences (environments with no file count as an earlier load, line 108; only a live setup's loads are watched, not a model's own files nor loads after the first frame, line 110) are dense detail that fits a details block.
- "Break at the fourth sentence" is wrong for line 138. It has 68 words and 5 sentences. Splitting before or after the fourth sentence cuts the held-versus-live contrast. The right break is after sentence 2 (definition), then the 3 sentences on behavior. For line 134 a break after sentence 4 works (size and pixel ratio, then when the size is read). For line 183, a break after sentence 4 leaves "structural changes take effect next frame" alone, which is acceptable; joining it with line 185 is better, since both cover what the second update does.
- "Lines 45 and 47: see the reorder finding" gives no edit of its own. Line 47 (131 words, 7 sentences) still needs one: split after "...on a slow network." (when top-level code runs), then what may and may not run there.

## Corrected claim

Eight paragraphs go over the limit (page lines 45, 47, 108, 110, 134, 138, 140, 183). The worst is line 140 (engine.firstFrame, 134 words, 8 sentences), which mixes what the promise is, when to use it, why a frame number fails, and hold-mode behavior. Lines 108-110 mix the main rule with scope detail.

## Corrected edit

- Line 140: keep in the main text "resolves once the GPU has finished the first frame; start the downloads the first frame does not need then; never await it in setup". Move the frame-number reason, the hold-mode/replay rule and the "never resolves when the engine stops first" sentence into `<details><summary>Technical details: firstFrame in hold mode and replays</summary>`.
- Line 134: break after the fourth sentence. Line 138: break after the second sentence. Line 183: move its last sentence (structural changes) to join line 185.
- Line 47: break after "...take no time of their own on a slow network."
- Lines 108-110: keep the warning, the fix, and when to turn it off as three short plain paragraphs. Move the environment rule and the "what the engine watches" scope into `<details><summary>Technical details: what the warning watches</summary>`.
- Do not add per-field blocks for the engine fields; they are already separate paragraphs.
