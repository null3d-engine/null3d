# start-readability-07

## Finding as given

```json
{
 "page": "cli/null3d",
 "anchor": "lines 39, 52, 191, 210, 223, 300, 312, 347, 442, 446, 470, 488, 539, 541",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Fourteen paragraphs pass 4 sentences or 90 words. Several are procedures or lists written as prose; line 442 is 161 words, line 446 is 154 words, line 347 is 110 words.",
 "evidence": "stats.json cli/null3d longParagraphs at stats lines 32, 45, 184, 203, 216, 293, 305, 340, 435, 439, 463, 481, 532, 534 (file line + 7).",
 "proposedEdit": "52: three numbered steps (dev server, headless browser with ?hold, step-draw-read). 191: two lists, 'What an agent can do' and 'What the page needs'. 210: numbered --connect steps. 223: list of the three ways to name an object. 300: two-row table sketch test vs page test. 312: numbered new-reference steps (run, open, --update-references, check git diff, commit). 347: numbered steps matching the diagram. 440 and 442: one sentence per gate, sampling detail into <summary>Technical details: how the allocation gate measures</summary>. 446: list of what optimize does. 470: table Extra | Effect | Use it for. 488: list of inputs and conversions. 539: table of the three impostor files. 541: 'Limits' list. 39: split, put the bun install step under the code.",
 "generatedSource": "",
 "id": "start-readability-07",
 "slice": "start",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The counts hold. stats.json lists 14 long paragraphs for cli/null3d. With the +7 offset they map to file lines 39, 52, 191, 210, 223, 300, 312, 347, 442, 446, 470, 488, 539, 541. Line 442 (the allocation gate) is 161 words and 9 sentences. Line 446 (`assets optimize`) is 154 words and 9 sentences. Line 347 (`bench`) is 110 words and 8 sentences.
- "Procedures or lists written as prose" holds for 312 (the steps to make a new reference), 446 (one sentence for each thing optimize does), 470 (three glTF extras), 539 (three output files) and 541 (a set of limits).
- The page is hand-written (docs/cli/null3d.md), so no generated source applies.

## What does not hold

1. Lines 52 and 347: the proposal turns each into numbered steps "matching the diagram". But a Mermaid flowchart sits right above each paragraph (lines 43-50 for `shot`, lines 336-345 for `bench`). The flowcharts already show those same steps in order. A numbered list would say the same thing a third time. A better fix: split each paragraph into two short ones. For 347, one paragraph says what `bench` builds and why it uses a production build. The next says how each run waits, warms up and measures.
2. Line 440 is not a long paragraph. stats.json does not list it (no stats line 433). Recasting it as "one sentence per gate" is outside this finding. Only 442 needs the change.
3. Several flagged paragraphs only just pass the limit. Lines 52, 210, 223, 300, 470, 488 and 539 have 5 or 6 sentences and 52 to 73 words. Line 223 (52 words) and line 488 (66 words, one fact per sentence) already read well. Changing them is mostly a matter of taste. The real cost to a reader is in 442, 446, 347 and 191. Medium severity is fair for the page as a whole, but only because of those four.
4. Line 446: the proposal makes a list of what optimize does. But it does not move the dense budget-report detail (shader features, permutation bits, pipeline keys, texture memory budgets per preset). That detail helps implementers and suits a collapsible block.

## Corrected claim

Fourteen paragraphs pass 4 sentences or 90 words. The ones that cost the reader most are 442 (161 words), 446 (154 words), 347 (110 words) and 191 (91 words). Lines 312, 446, 470, 539 and 541 are lists or procedures written as prose. The others only just pass the limit.

## Corrected edit

- 442: Keep in the main text what the gate prints and when it fails: it fails when it cannot measure the page or when the page ran none of the add-on's code, and it never fails on a figure. Move these into `<details><summary>Technical details: how the allocation gate measures</summary>`: how functions are named by source file through the build's source map, the rule for which source files count as the add-on's own, the cap on sampled objects per worker, and the note that the software-GPU figure reads lower.
- 446: A bulleted list of what optimize does (merge copies, quantize and reorder vertices, resample clips, encode KTX2 with mips, one .glb plus a textures folder). After it, one sentence on the budget report. Put what the report contains (shader features, permutation bits, pipeline keys, which presets' texture budgets pass) and how the shader list is embedded into `<details><summary>Technical details: what the budget report holds</summary>`.
- 347 and 52: Split each into two short paragraphs. Do not add numbered steps, because the flowchart above already shows them.
- 312: Numbered steps, as proposed.
- 191: Two short lists ("What an agent can do" and "What the page needs"), as proposed. Use bold lead-ins or plain sentences, not headings.
- 470 and 539: Tables, as proposed.
- 541: A short "Limits" list, as proposed.
- 39, 210, 300: The proposed splits are fine but low priority.
- 223 and 488: Leave as they are.
- 440: No change. It is not a long paragraph.
