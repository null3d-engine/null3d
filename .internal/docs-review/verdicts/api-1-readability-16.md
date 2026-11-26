# api-1-readability-16

## Finding as given

- page: api/debug
- anchor: line 24 (last sentence); lines 123-130; 297-298; 310-314; 323-328; 427
- category: technical-details-block
- severity: medium
- claim: Correct but dense internals bury the user-facing facts: the hold-mode extra frame, the motion view's GPU history, the 2.4 KB that stays in release builds, how WebGPU copies culled counts back, how the browser counts shared memory, the texture counting rules and the Chrome timestamp flags.
- evidence: debug.md:130 'about 2.4 KB after Brotli'. :310 explains job workers leaving the job loop to run the memory measurement. :427 gives Chrome flags.
- proposedEdit: Add <details> blocks: 'Technical details: debug lines in hold mode' (line 24 tail); 'how the views draw' (lines 124, 128 and 130 tail); 'triangle counts on WebGPU' (lines 297-298; keep 'In a production build on WebGPU, call debug.frameStats() once to count every triangle.'); 'how the page measures its memory' (line 310 from 'The browser counts...', and line 314); 'what the GPU memory figures count' (lines 323-328); 'timestamp rounding' (line 427 tail).

Verdict: partly

## Evidence

The main claim holds. The page does carry dense internals in the places named, and most of them suit a collapsed block:

- docs/api/debug.md:24 ends with a sentence about the extra frame that hold mode draws. It matters only to test writers, and docs/guides/testing.md covers hold mode.
- debug.md:124 (the motion view keeps last frame's transforms on the GPU; the hold-mode extra frame), :128 (each level is a bucket, so no shader per material) and :130 (the parts that stay in a release build, about 2.4 KB after Brotli) are internals.
- debug.md:297 (one frame in eleven, counts arrive a few frames late, development builds copy back anyway) is internals.
- debug.md:310 (the browser counts shared memory once per thread; idle job workers leave the job loop) and :314 (browsers that never answer) are internals.
- debug.md:323-328 (mip levels, compressed blocks, samples, 24-bit depth, driver alignment, canvas left out, tiled GPUs) are counting rules for implementers.
- debug.md:427: the GCD sentence repeats the `gpuStepMs` row of the table at debug.md:280. The Chrome flags also appear at docs/guides/performance.md:370.

Four parts of the proposed edit are wrong or would hide facts that a user needs:

1. "line 130 tail" names the wrong sentence. The last sentence of line 130 is the user-facing E1213 rule: a development build fails on a view name that it does not know. That sentence must stay in the main text. The block should take only the middle sentences: "A few small parts stay ... and less to a pipelined one." The first two sentences (views work only in development builds; a release build holds none of their code) also stay in the main text.

2. Lines 297-298: the sentence that the proposal keeps loses the warning that stops a reader from being misled. Line 298 says that in a production build on WebGPU, `engine.measure` counts only the draws the CPU issues, unless the card is open or the sketch has called `debug.frameStats()`, so a scene that the GPU culls can show almost no triangles. It also links to [Cost](#cost). With the block closed, a reader must still see why the figure is near zero and what the call costs. Keep line 298 whole in the main text. Move only the line 297 mechanics (one frame in eleven, the development build copy, a few frames late) into the block.

3. Line 310 "from 'The browser counts...'" would hide three user-facing facts in the block: the overlay shows a second figure with shared memory counted once; `measurePageMemory()` from `@null3d/engine/stats` is a public API that this page alone describes in prose (only docs/api/reference/debug.md also names it); and the line reads `measuring` until the first answer comes. Keep these in the main text. Move only the per-thread double counting, the "about a minute" wait and the job-worker sentence. Line 314 (the line hides after two minutes with no answer) is something a viewer sees on screen. Keep one short sentence of it in the main text, for example "If the browser never answers, the line hides."

4. Lines 323-328: a block is fine. Keep one plain sentence in the main text so the figures are not taken as the driver's real usage, for example "The figures count the bytes that the engine asks for, so they can differ a little from what the GPU uses."

Two smaller points:

- Line 124: "While it shows, the engine keeps the last frame's transforms ... In other frames it keeps nothing and draws no motion pass" is a cost fact, which users want. It can go in the block, but the hold-mode sentence is the real internals. Line 128's last sentence repeats line 126 (a view's first frame builds pipelines). Cut it, do not move it into a block.
- Line 427: the GCD sentence repeats the table row at line 280, so cut it instead of moving it. A block with only the Chrome flags sentence is fine; performance.md:370 also has the flags.

Website contract: the blocks for lines 124, 128 and 130 come from bullet items. Do not put a `<details>` inside a list item. Put one block for "how the views draw" after the list that ends at line 130. Each block has no headings and no nested blocks, which follows the rule.

## Corrected claim

The page buries implementer detail at the lines named, and collapsible blocks suit most of it. But some of the text that the proposal would move holds user-facing facts: the E1213 rule (line 130's last sentence), the production WebGPU triangle-count warning and its cost link (line 298), the `measurePageMemory()` API, the `measuring` state, and the fact that the whole-page line can hide (lines 310 and 314). These must stay in the main text.

## Corrected edit

- After line 24: block "Technical details: debug lines in hold mode" with the last sentence of line 24.
- After the bullet list that ends at line 130 (not inside a bullet): one block "Technical details: how the views draw". It takes line 124's GPU history and hold-mode sentences, line 128's bucket sentence, and line 130's "A few small parts stay ... less to a pipelined one." Delete line 128's last sentence, because it repeats line 126. Keep line 130's first two sentences and its E1213 sentence in the main text.
- Line 297: keep its first sentence and its last sentence in the main text. Move "The engine copies those counts back ... each frame adds the newest of them" into the block "Technical details: triangle counts on WebGPU". Keep line 298 whole.
- Line 310: keep "The memory bar's parts ... own line", "Beside the browser's figure, the overlay gives the figure with the shared memory counted once", the `measurePageMemory()` sentence, the `measuring` sentence and "one measurement at a time". Move the double-counting explanation, the "about a minute" timing and the job-worker sentence into the block "Technical details: how the page measures its memory", with line 314. Leave one short sentence in the main text: "If the browser never answers, the line hides."
- Lines 323-328: block "Technical details: what the GPU memory figures count", with a one-sentence summary in the main text before it.
- Line 427: delete the GCD sentence, because it repeats the table row at line 280. Put the Chrome flags sentence in the block "Technical details: timestamp rounding", or replace it with a link to the GPU timing notes in the performance guide.
