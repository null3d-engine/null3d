# guides-2-readability-14

## Finding as given

- page: guides/testing
- anchor: ## Hold mode, lines 66-82
- category: technical-details-block
- severity: medium
- claim: Steps 2 and 4 carry reasons and edge cases (motion vectors, mirrors, light probes). Paragraphs 74, 76 and 78 explain frame counts, the extra bounce-light frame, job worker tasks and planned levels. Line 78 is 218 words in 13 sentences, the longest paragraph in this slice. A test author needs what hold mode fixes, how to start it, what it returns and its limits.
- evidence: stats.json line 71 (file line 78) 218 words, 13 sentences; line 71 'Motion vectors read the frame before, so with them it draws the frame before the last one too.'
- proposedEdit: Keep each numbered step to one or two sentences. Keep line 74's first three sentences and line 80. Move the rest into <details><summary>Technical details: frame counts, extra frames, tasks and planned levels</summary> (step 2's reason, step 4's extra frames, line 76, line 78 split into two paragraphs: job worker tasks; planned levels and E1408). Keep in the main text: 'Hold mode waits for tasks on the job workers and for planned levels of detail before it draws the held frame.'

Verdict: partly

## Evidence

- docs/guides/testing.md:78 is the 218-word, 13-sentence paragraph (stats.json lists it at line 71; the stats lines are 7 lower than the file lines). Lines 74 (77 words) and 76 (113 words) are also long. The readability problem is real, and a collapsible block is the right tool for most of this detail.
- Step 2's reason (testing.md:69) is said again at testing.md:194 under "Frames that stay the same on every run", which links back to Hold mode. Moving it into a block loses nothing.
- Step 4's motion-vector, mirror and light-probe frames (testing.md:71), the extra bounce-light frame (testing.md:76, sentences 3-5), and the end of line 78 (setup waits, "delays the hold twice", hand-over order, memory places) are mechanism detail. They fit a block.
- What does not hold: the proposed one-line summary drops limits that a test author acts on. Line 78 holds three of them: a job-worker task gets 10 seconds, then the engine warns and draws anyway; a level-of-detail plan that has not answered after five minutes stops the hold with E1408; and `levels: false` makes a test draw a mesh without levels. The claim itself says a test author needs the limits. "When a hold fails" (testing.md:170-182) lists E1408 only for a failed step and a failed draw, not for a plan timeout. So a closed block would hide the only place that names this failure and its fix.
- Line 74: the proposal keeps only sentences 1-3. Sentence 3 says `engine.measure()` finds no frames, and sentence 4 ("The hold's result gives the held frame's own figures instead") tells the reader where to look. Cutting sentence 4 leaves a dead end. Sentence 5 (the held frame creates every GPU object and uploads the whole scene) explains the large upload figures in `stats` (testing.md:94), so it is useful but can go in the block.
- Line 76, sentences 1-2 (91 frames, `time.frame` is 91) explain the `frame` value that the result returns (testing.md:91). They are short and concrete. Keeping them in the main text is better than hiding them, but this point is a matter of taste.

## Corrected claim

Lines 74, 76 and 78 are long, and line 78 (218 words, 13 sentences) mixes limits that test authors act on with mechanism detail. Steps 2 and 4 carry reasons that can be moved. The fix is to move the mechanism detail into a block and keep the limits in the main text, not to reduce the waits to one sentence.

## Corrected edit

- Steps: keep step 2 as "It runs the sketch's setup. The sketch's `assets` calls run one at a time, in the order the sketch made them." Keep step 4 as "It draws the last frame on the canvas and reads its pixels back. The GPU passes of the other frames never run, and `time.drawn` is false in them."
- Line 74: keep sentences 1-4. Move sentence 5 into the block.
- Line 76: keep sentences 1-2 in the main text. Move sentences 3-5 (the extra bounce-light frame) into the block.
- Replace line 78 in the main text with a short paragraph that keeps the limits: "Before it draws the held frame, hold mode waits for the tasks that the sketch queued on the job workers, and for the levels of detail that meshes made in code plan. It waits up to 10 seconds for a task, then warns and draws anyway. It waits for plans as long as they take, and says every 10 seconds which meshes still plan. A plan that has not answered after five minutes stops the hold with [E1408](../errors/E1408.md). Give a mesh `levels: false` when a test should draw it without levels."
- After the numbered list and paragraphs, add one block:
  `<details>` / `<summary>Technical details: load order, extra frames and waits</summary>`, with short paragraphs for: why loads run one at a time (step 2's reason); the extra frames for motion vectors, mirrors and light probes (step 4); the extra bounce-light frame and its debug lines (line 76, sentences 3-5); the held frame creating every GPU object (line 74, sentence 5); the setup's waits and the one extra frame that draws what the tasks wrote; and the hand-over order of levels and their fixed places in engine memory. No headings inside the block, and no nested blocks.
- Keep line 80 and line 82 as they are.
- Also add the plan timeout row to the table in "When a hold fails" (E1408, naming the meshes), so that section lists every way a hold can fail.
