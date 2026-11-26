# Verdict: guides-2-readability-02

## The finding as given

```json
{
 "page": "guides/performance",
 "anchor": "whole page (8,423 words, 27 headings)",
 "category": "split-page",
 "severity": "high",
 "claim": "The page explains the frame, lists each feature's cost, and teaches measuring. A reader who wants to measure finds '## Measure' at line 302 of 406, though line 15 says to measure first. The 12 per-feature sections (lines 190-300) are reference material that a reader opens for one feature.",
 "evidence": "stats.json words 8423; headings from '## Moving objects cost uploads' to '## The depth prepass' are per-feature; '## Measure', '### The presented rate...', '## Measure fairly', '## Memory peak', '## Browsers differ' are at the end.",
 "proposedEdit": "Split into three pages: (1) guides/performance keeps the intro, frame time, frame budget, Rust, allocation, objects during play and batching sections, plus a new short 'Measure first' section with three steps (?stats, engine.measure, bunx @null3d/cli bench); (2) guides/performance-costs 'What each feature costs' with lines 190-300; (3) guides/measuring 'Measure performance' with lines 302-405. Add the pages to PAGES in tools/lib/docs.ts and update links to performance.md#measure, #memory-peak, #the-depth-prepass and #phones-and-tablets in testing, start-time, phones and loading-screens.",
 "generatedSource": "",
 "id": "guides-2-readability-02",
 "slice": "guides-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

What holds:

- The page has 8,423 words (stats.json) and 27 headings. `## Measure` is at line 302 of 405. The measuring group (`## Measure`, `### The presented rate...`, `## Measure fairly`, `## Memory peak`, `## Browsers differ`) fills lines 302-405.
- Lines 190-300 hold per-feature sections, from `## Moving objects cost uploads` to `## The depth prepass`. Each stands alone, and other pages link into single ones (lighting.md to `#point-and-spot-lights`, phones.md to `#the-depth-prepass`). So they are reference sections.
- The engine's own skill says "Measure first" (skills/null3d-develop/references/performance.md:3), but the page puts measuring last. A split is a sound fix. The page is too long to fix by moving sections around.

What does not hold:

- Line 15 does not say "measure first". It says "Measure in every rendering mode and preset, over the whole camera path, with repeats", and it links to testing.md#check-every-rendering-mode. The intro (line 13) also says the guide ends with "how to measure", so the order is announced. The problem is real, but the page does not contradict itself.
- The list of links to update is wrong. It names pages that need no change and misses pages that do. Inbound anchor links in the generated tree:
  - `#phones-and-tablets` (phones.md:91) points to a subsection of `## The frame budget`, which stays on guides/performance. No change.
  - testing.md:220 and loading-screens.md:120 link only to `#how-the-engine-batches-builds-pipelines-and-times-frames`, which stays. No change.
  - Missed links that move to the measuring page: cli/null3d.md:347 (`#measure`), getting-started/cdn.md:234 (`#measure-fairly`), api/debug.md:337 (`#measure-fairly`) and :403 (`#measure`), api/engine.md:167 (`#measure-fairly`, plus a bare `performance.md` link for "explains the numbers"), start-time.md:298 (`#measure`), phones.md:77 (`#memory-peak`).
  - Missed link that moves to the costs page: concepts/lighting.md:142 (`#point-and-spot-lights`). phones.md:37 (`#the-depth-prepass`) moves there too.
  - phones.md:91 ends with "The Performance guide also shows how to measure the frame". It must point to the measuring page.
- The edit misses links inside the page that become links between pages: line 80 (frame budget) links to `#the-presented-rate-the-completed-rate-and-gpu-time`, which moves to the measuring page. Line 175 (batching table) links to `#large-worlds`, which moves to the costs page.
- The edit misses the skill. "Docs and skills stay in sync" applies. skills/null3d-develop/references/performance.md:49 says `guides/performance` holds the measured values. Line 72 says it explains each figure. After the split, those facts live in the costs page and the measuring page.
- The PAGES entry for guides/performance (tools/lib/docs.ts:150) and the page's front matter both give the summary "Measuring; the frame budget; ...". After the split, the summary must drop "Measuring".

## Corrected claim

The page has 8,423 words and 27 headings. It mixes a guide to the frame, reference sections for each feature (lines 190-300) and the full measuring guide (lines 302-405). Measuring comes last, but the engine's skill tells readers to measure first. Line 15 asks the reader to measure in every mode and links to the testing guide. It does not say "measure first", and the intro says that measuring comes last.

## Corrected edit

Split as proposed: guides/performance keeps lines 1-188 and gets a short "Measure first" section after the intro. That section gives three steps (`?stats`, `engine.measure`, `bunx @null3d/cli bench`) and links to the measuring page. The costs page takes lines 190-300 and the measuring page takes lines 302-405. Then:

1. Add both pages to PAGES in tools/lib/docs.ts, after guides/performance. Change the guides/performance summary in PAGES and in the front matter so it no longer starts with "Measuring".
2. Point these links to the measuring page: cli/null3d.md:347, getting-started/cdn.md:234, api/debug.md:337 and :403, api/engine.md:167 (both links), start-time.md:298, phones.md:77, and the last sentence of phones.md:91. Also point performance.md:80 there.
3. Point these links to the costs page: concepts/lighting.md:142, phones.md:37, and performance.md:175 (`#large-worlds`).
4. Leave phones.md:91 `#phones-and-tablets`, testing.md:220, loading-screens.md:120, start-time.md:266, culling.md:38, architecture.md:126, objects.md:123 and scene.md:571 as they are. Their targets stay on guides/performance.
5. Update skills/null3d-develop/references/performance.md lines 3, 49 and 72 to name the new pages. Then run `bun run skills`.
6. On the measuring page, link the figures table to the frame measurement section of api/debug.md, which covers the same call.
