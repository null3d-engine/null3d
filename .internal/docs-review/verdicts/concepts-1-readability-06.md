# concepts-1-readability-06

## The finding as given

- page: concepts/architecture
- anchor: lines 33, 47, 83, 89, 106, 110, 141, 143, 159
- category: long-paragraph
- severity: medium
- claim: Nine long paragraphs. Line 47 ('### When the job workers start') is 322 words and 23 sentences. It mixes the start rule, decoders, script caching, a 4.5 s pause, clock allocation and an 18-core Mac benchmark.
- evidence: stats.json concepts/architecture longParagraphs (stats line 40 = file line 47)
- proposedEdit: 47: keep 4 sentences (each worker costs about 3.5 MiB, so none at first; at 0.2 ms of parallel loops per frame it asks for 2, then doubles; workers stay until the engine stops and a small scene starts none; engine.mode.jobWorkers and the stats overlay). Move the rest into a block 'Technical details: how the engine times the job workers'. 33: split after '...while the sketch runs.' 83: split into 'pipelines build in the background' and 'first frame waits; scene.warmUp()'. 89: end at '...in this order.' and move the effects sentence after the list. 106, 143 and 159: split at the change of subject. 141: make it a list of facts.

Verdict: survives

## Evidence

- stats.json lists nine long paragraphs for this page at stats lines 26, 40, 76, 82, 99, 103, 134, 136 and 152. The page has 7 lines of front matter, so these are file lines 33, 47, 83, 89, 106, 110, 141, 143 and 159. The anchor is correct.
- File line 47 is the only paragraph under "When the job workers start". It is 322 words and 23 sentences (stats). It does mix the start rule, the decoder rule, the script cache, the 4.5 s pause, the clock note and the 18-core Mac numbers. The clock sentence ("Each reading of the browser's clock allocates.") stands alone and does not say it is the reason for the pause, so the paragraph is hard to follow as it is.
- The kept facts match the code. packages/engine/src/sketch/runner.ts:370 sets the pause to 4.5 seconds. packages/engine/src/sketch/runner.test.ts:429 tests "asks for twice the job workers, up to the most, after each 30 frames that hand out 0.2 ms or more of parallel work". So the short main text keeps correct facts, and the rest is correct dense detail that fits a "Technical details" block. That matches the user's request to move detail into a block, not to cut it.
- The other splits fall at real changes of subject:
  - 33: what a sketch is and where it runs, then shared memory and texture messages.
  - 83: pipelines building in the background, then the first-frame wait and scene.warmUp().
  - 89: what a pass is, then the order. The effects sentence reads better after the list.
  - 106: WebGL2 has no compute passes, then the one-time environment work, then the graph's cost.
  - 141: the fallback rules (where a worker cannot draw, what low latency does then, the warning, engine.mode) form a short list of facts.
  - 143: what sketchThread 'main' does, then its cost, then ?render=main, then the one-engine limit with E1415.
  - 159: keeping the memory for the next engine, then destroy({ release: true }), then the retry when memory is refused.
- No proposed block holds a heading or a nested block, and the main text still makes sense with the block closed. No edit breaks the writing rules or the website contract.

## Small refinements to the edit

- Line 110 is in the anchor, but the edit gives no change for it. It is 67 words and 5 sentences on one subject (32-bit precision and grid cells), and it reads well. Leave it as it is.
- In the line 47 block, join the clock sentence to the pause sentence so the reason is clear. For example: "After a window with too little parallel work, the sketch thread stops timing its loops for 4.5 seconds of sketch time, because each reading of the browser's clock allocates memory."
- Keep "Until a job worker is ready, the sketch thread runs its share of each loop" in the main text or near the top of the block. It tells a reader that work never waits for a worker to start.
