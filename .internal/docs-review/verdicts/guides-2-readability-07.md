# guides-2-readability-07

## Finding as given

- page: guides/performance
- anchor: lines 46-57, 65-89, 198, 261, 298-300, 343, 351, 355-357, 370-372, 401-405
- category: technical-details-block
- severity: medium
- claim: Correct figures sit inline with the rules they back, so a reader must read device, browser and millisecond detail to find the rule: the S1 per-thread table, upload route timing, Chrome heap sampling, why the GPU is sampled one frame in eleven, Firefox and Safari completion lag, Chrome flags, job worker counts per browser.
- evidence: line 351 "Eleven is a prime above the longest far cascade interval..."; line 343 "A render worker whose own heap is 1.4 MB can show as 52 MB."
- proposedEdit: Keep one figure per section in the main text. Move the rest into blocks: "how S1's frame splits on a MacBook Pro" (table line 48, line 57); "how uploads travel" (line 198); "how each browser reports finished frames" (lines 351, 355-357); "Chrome flags for GPU timing and uncapped frames" (370, 372); "job workers in each browser" (401-405).

Verdict: partly

## Evidence

All the quoted text is on the page, and the page has no `<details>` block yet.

Parts that hold. In these places the rule comes first and the rest explains how it works. A reader can skip that explanation:
- Line 57: the production-build numbers repeat the table above them on another build. This fits a block.
- Line 198: the first sentence is the rule ("you do not need to"). The other four sentences describe the upload routes and their speed in Chrome and Safari. This fits a block.
- Line 343: the paragraph explains how Chrome samples the heap. The reader needs only the last sentence (`jsHeapNote`). This fits a block.
- Line 351: the last two sentences (the cost of timing and why the number is eleven) are background. This fits a block.
- Lines 355-357: the Firefox delay, the WebGL2 fence rounding and the Safari wait explain how to read `gpuLatencyMs` in each browser. This fits a block.

Parts that do not hold:
- Lines 46-53, the S1 table. The table is the main evidence for the section's point. Line 55 ("The update calls Math.sin ... Make your own loops tight") reads the table, and line 46 introduces it. If the table goes into a closed block, lines 46 and 55 make no sense. That breaks the rule that the text must make sense with every block closed. In a performance guide, benchmark figures are the guidance. They are not background for implementers.
- Lines 65-89, the phone and tablet tables. The finding anchors these lines but proposes no block for them. They back the 70% budget rule (line 61), the heat effect (line 76) and the advice to keep pipelined mode on the iPad (line 89). Keep them in the main text.
- Lines 261 and 298-300. These are anchored but have no proposed block. The S3 and prepass figures back the default choice for each GPU path (lines 298 and 300), and line 261 gives the three.js limit. Keep them in the main text.
- Lines 370 and 372, the Chrome flags. These are steps in the "Measure fairly" list. A reader who wants exact `gpuMs` must start Chrome with these flags. If the flags go into a block, a needed step is hidden. Only the second sentence of line 370 (the greatest-common-divisor detail) and the middle of line 372 (thousands of calls a second) are background.
- Lines 401-405. The list is the evidence for the rule "Browsers report different numbers on the same device". It is three short bullets. Moving it is a matter of taste and helps the reader very little.
- "Keep one figure per section" is an arbitrary limit for a page whose figures are the advice.

Severity: low. What remains is about eight sentences of mechanism on an 8,423-word page.

## Corrected claim

Some paragraphs mix a rule with dense detail about how the engine or browser works, and that detail can go into blocks: line 57, line 198 after its first sentence, line 343 except the `jsHeapNote` sentence, the last two sentences of line 351, lines 355-357, and the second sentence of line 370. The benchmark tables and the figures that back each rule (lines 46-53, 65-89, 261, 298-300, 401-405), and the Chrome flags themselves, stay in the main text.

## Corrected edit

- After line 55, add `<details><summary>Technical details: S1 in a production build</summary>` with line 57.
- Keep the first sentence of line 198. Move the rest into `<details><summary>Technical details: how uploads travel</summary>`.
- Keep the last sentence of line 343 ("The `jsHeapNote` field says when the figures cover only the page"), with a short lead-in such as "Chrome's heap figures can include shared memory." Move the rest into `<details><summary>Technical details: how Chrome measures worker heaps</summary>`.
- Keep the first three sentences of line 351 in the list item. After the list, put the last two sentences of line 351 and lines 355-357 in one `<details><summary>Technical details: how GPU timing and completion work in each browser</summary>`. Keep one sentence after line 353 in the main text: "Firefox's WebGPU path reports finished frames late, which costs frame rate when the GPU is busy."
- In "Measure fairly", keep the Chrome flags in lines 370 and 372. Cut the greatest-common-divisor sentence and the "thousands of times a second" detail, or move them into a block after the list. Do not put a block inside a list item.
- Leave lines 46-53, 65-89, 261, 298-300 and 401-405 as they are.
