# guides-2-substance-15

## The finding as given

- Page: guides/start-time
- Anchor: file lines 25, 60, 106, 138, 140, 144, 162, 166, 200, 232, 244, 246, 248, 264, 270, 292
- Category: long-paragraph. Severity: medium.
- Claim: 16 paragraphs run over the limit. Several carry rules that implementers need only now and then: line 248 (the check's target and rounds), 264 (Chrome's pipeline cache sizes 2 MB, 128 KB, 6 MB), 270 (the stored list's key), 140 (Safari stalls over HTTP/2 from the dev server).
- Evidence: stats.json guides/start-time longParagraphs (body lines; file lines are 7 higher).
- Proposed edit: Split each into the advice plus a block: 'Technical details: how the check picks its target' (248); 'Technical details: what browsers keep between visits' (264, 270); 'Technical details: HTTP/2 and the dev server' (140).

Verdict: partly

## Evidence

- stats.json lists 16 long paragraphs for guides/start-time, at body lines 18 to 285. Adding 7 gives exactly the 16 file lines in the anchor. The count holds.
- The four named paragraphs say what the finding claims (start-time.md:140, 248, 264, 270).
- Line 140 repeats getting-started/hosting.md:384 almost word for word: the plugin serves HTTP/1.1, Safari on an iPad stalls over HTTP/2, and `http2: true` serves HTTP/2 for other browsers. The Safari stall is also the reason a reader must think before turning `http2` on, so it is a warning, not optional detail. Hiding it in a closed block is wrong. The repeat should become a link instead.
- Line 248, sentences 2 and 3 (the check stores its rounds, and the next start begins at the lowered preset) repeat guides/loading-screens.md:174. Only the target and round rules (display rate, the check's own load, the 4-second first round, the quarter-of-target jump to Low) are new here. They suit a block.
- Line 270, sentences 1 to 3 (the list in `localStorage`, built by the drawing thread as each shader arrives, while downloads and setup run) repeat guides/loading-screens.md:145, and the paragraph already links to loading-screens.md#repeat-visits. The list's key and the partway-through builds are new detail and suit a block. The last sentence (hold mode, replays and recordings skip the list; `?builds=fresh` turns it off) is a switch that people who test need. It must stay in the main text.
- Line 264: the first two sentences are measured results. The Chrome cache sizes (2 MB, 128 KB, 6 MB) explain why the engine keeps its own list. A block for the sizes is right, but the main text must keep the reason in one sentence ("Chrome keeps only a small cache of compiled pipelines, so the engine keeps its own list").
- The edit covers only 4 of the 16 paragraphs. The other 12 (lines 25, 60, 106, 138, 144, 162, 166, 200, 232, 244, 246, 292) get no proposal, though the review rules ask one finding to handle all of a page's long paragraphs.

## Corrected claim

16 paragraphs run over the limit. Four of them hold dense detail, but two of those (140, and parts of 248 and 270) repeat text that already sits on linked pages (hosting.md:384, loading-screens.md:145 and :174). Repeats should be cut to a link, not moved into a block.

## Corrected edit

- Line 140: cut to two sentences and a link. "The null3D Vite plugin serves its dev server over HTTP/1.1, because Safari on an iPad sometimes stalls over HTTP/2. Its `http2: true` option serves HTTP/2 for other browsers ([During development](../getting-started/hosting.md#during-development))." Put the timing figures (13.8 to 7.2 s, 11.7 to 4.7 s) in a block, or cut them.
- Line 248: keep sentence 1 and the last sentence in the main text. Cut sentences 2 and 3 and link to [The preset check](loading-screens.md#the-preset-check). Move the target and round rules into a block "Technical details: how the check sets its target".
- Line 264: keep the two measured results and one sentence of reason. Move the Chrome and computer cache sizes into a block "Technical details: what browsers keep between visits".
- Line 270: cut sentences 1 to 3 to one sentence that links to [Repeat visits](loading-screens.md#repeat-visits). Move the key fields and the partway-through builds into the same block as 264 or one of its own. Keep the hold mode and `?builds=fresh` sentence in the main text.
- The other 12 paragraphs: split at natural breaks. Lines 60, 106 and 292 are mostly test conditions and measured figures; move the conditions into a block or split them from the result. Lines 25, 138, 144, 162, 166, 200, 232, 244 and 246 split into two paragraphs each at the change of subject (for example 162 before "The engine's package keeps no `sideEffects` list", 166 before "Hold mode, a replay and a recording", 244 before "A repeat visit takes the stored result").
