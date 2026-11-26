# guides-2-substance-13

## The finding as given

```json
{
 "page": "guides/performance",
 "anchor": "whole page; ## Measure (lines 302-343), ## Measure fairly, ## Browsers differ",
 "category": "split-page",
 "severity": "medium",
 "claim": "One page of 8,400 words does three jobs: a cost model, fixes by topic, and a full reference of measuring (the engine.measure figure table at lines 306-337, browser quirks at 349-372). A reader who asks 'why is my scene slow' must read past all of it. The figure table duplicates the API reference of measure.",
 "evidence": "stats.json guides/performance: 8,423 words, 21 long paragraphs.",
 "proposedEdit": "Split into 'Performance guide' (where time goes, fixes by topic) and 'Measuring performance' (stats overlay, engine.measure, bench, measure fairly, presented and completed rates, browsers differ). Link the figure table to the Engine API reference and keep only the figures that the guide uses.",
 "generatedSource": "",
 "id": "guides-2-substance-13",
 "slice": "guides-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

What holds:
- stats.json gives 8,423 words and 21 long paragraphs for the page. The page covers the cost model (Where frame time goes, The frame budget), fixes by topic (Rust work through The depth prepass), and a measuring reference (## Measure at line 302, ### The presented rate... at 345, ## Measure fairly at 359). The intro (line 13) says the page covers "how to measure" as its own job. A separate measuring page is a fair split.

What does not hold:
1. "A reader who asks 'why is my scene slow' must read past all of it." This is wrong. The measuring sections come last (lines 302-373), after the cost model and all the fixes. A reader who wants causes and fixes reads them first and never passes the measuring part. The real cost is page length and the 21 long paragraphs, not the order.
2. "The figure table duplicates the API reference of measure." Only in part, and the proposed link target is wrong:
   - The Engine API page gives `measure` one line (docs/api/engine.md:167) and lists no figures. It links to this guide for the meaning.
   - The type reference for the figures is `FrameMetrics` in docs/api/reference/debug.md:116 (generated from TSDoc), not the Engine reference. Its rows are one-line type notes.
   - The hand-written debug page points readers here for the figures: docs/api/debug.md:403 says "[Performance guide](../guides/performance.md#measure) explains each figure and how to measure fairly."
   - The guide table adds meaning that the reference does not have, for example `visibleEntries` being null on WebGPU, when `occludedEntries` is 0, and when `gpuObjects` rises. "Keep only the figures that the guide uses" would delete the only plain-English explanation of these figures, which other pages link to.
3. "Browsers differ" (line 397) is not only about measuring. It also gives the job-worker count per browser, which belongs with the cost model. "Memory peak" (line 375) gives fixes too. Neither moves cleanly to a measuring page.

Costs the edit leaves out:
- A new page needs an entry in PAGES in tools/lib/docs.ts (the guides/performance entry is at line 150, and its summary starts with "Measuring"). That is the source for docs/pages.md, so `generatedSource` should name it.
- Seven inbound links point at the measuring anchors and must move: docs/cli/null3d.md:347 (#measure), docs/guides/start-time.md:298 (#measure), docs/api/debug.md:403 (#measure), docs/api/debug.md:337 (#measure-fairly), docs/api/engine.md:167 (#measure-fairly), docs/getting-started/cdn.md:234 (#measure-fairly), docs/guides/phones.md:77 (#memory-peak, which stays).
- The skill reference skills/null3d-develop/references/performance.md:72 says the `guides/performance` page "explains each figure and how to measure fairly". The docs-and-skills sync rule makes this a required edit.

## Corrected claim

The page is 8,423 words and does three jobs. The measuring part (## Measure, the presented and completed rates, ## Measure fairly) is a full reference of its own. It is at the end, so it does not block a reader who looks for fixes, but it makes the page long and hard to scan. The figure table is the docs' only plain explanation of the `engine.measure` figures. The `FrameMetrics` type reference (api/reference/debug.md) gives only one-line type notes, and api/debug.md and api/engine.md link here for the meaning.

## Corrected edit

Move ## Measure, ### The presented rate, the completed rate and GPU time, and ## Measure fairly to a new page, "Measuring performance" (guides/measuring). Keep the whole figure table there. Do not cut it to the figures the guide uses. Wrap the table and the dense browser timing paragraphs (the Firefox, Safari and WebGL2 fence notes, and the Chrome heap note) in `<details><summary>Technical details: every figure that engine.measure returns</summary> ... </details>` blocks. The main text must still say what to measure and how without them. Add one link from the table to the `FrameMetrics` type reference (../api/reference/debug.md#framemetrics) for the field types. Keep ## Memory peak and ## Browsers differ in the Performance guide, because they hold fixes and cost facts. In the Performance guide, keep a short "Measure" section of two or three sentences that links to the new page.

Also edit:
- tools/lib/docs.ts PAGES: add the new page, and remove "Measuring" from the guides/performance summary (line 150).
- The inbound links: docs/cli/null3d.md:347, docs/guides/start-time.md:298, docs/api/debug.md:337 and :403, docs/api/engine.md:167 and docs/getting-started/cdn.md:234.
- skills/null3d-develop/references/performance.md:72: point it at the new page.

If the split is not wanted, the smaller fix is enough: put the figure table and the browser timing notes in `<details>` blocks on this page.
