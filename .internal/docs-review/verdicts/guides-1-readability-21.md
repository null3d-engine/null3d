# guides-1-readability-21

## Finding as given

- Page: guides/deterministic-simulation
- Anchor: lines 56, 110, 166, 218, 222
- Category: long-paragraph. Severity: medium.
- Claim: Line 56 states the import rule, then five sentences of bundle sizes for two Bun versions. Line 110 lists listeners in running text. Lines 218 and 222 are build-figure paragraphs.
- Evidence: stats.json lines 49 (82 words, 5 sentences), 103 (84, 6), 159 (74, 5), 211 (108, 7), 215 (81, 6).
- Proposed edit: Line 56: keep the rule and the FinalizationRegistry reason; move the 9,133 / 1,202 / 87,857 byte figures and Bun 1.3.11 into `<details><summary>Technical details: bundle sizes</summary>`. Line 110: lead sentence plus lists of listeners it leaves out and keeps. Line 166: split after 'draws it in onUpdate'. Lines 218/222: see the contradiction finding.

Verdict: partly

## Evidence

- The stats.json line numbers are 7 lower than the page lines, because stats count from after the front matter (7 lines). Stats 49, 103, 159, 211 and 215 are page lines 56, 110, 166, 218 and 222. The counts are facts.
- Line 56 holds what the claim says: the rule, then Bun 1.4.3 (9,133 against 1,202 bytes), the `FinalizationRegistry` reason, and Bun 1.3.11 (87,857 bytes with `Atomics`, `document`, `navigator`, `requestAnimationFrame` and `Math.sin`/`cos`/`acos`/`exp`/`random`). The figures are correct: they match the maths-entry decision record's table. A block for the byte figures is right.
- But the proposed edit for line 56 is too wide. The last sentence is not only a size figure. It tells the reader that some bundlers pull in browser globals and inexact `Math` calls, which break a replay. That is the main hazard of the main entry, so one plain sentence of it must stay in the main text. Only the byte counts and the full name list go into the block.
- Line 110: the claim holds (one paragraph of 6 sentences lists the listeners in running text). But the proposed two lists repeat what the linked page already holds. docs/api/input.md "Input off" (line 206 on) gives the dropped listeners as a list and the kept listeners as a table, and line 110 links to it. Two new lists here would duplicate the reference. Shorter text plus the link fixes the length with no duplicate.
- Line 166: the split after "draws it in `onUpdate`" is right. The first part says how the state travels; the second says what to send and why each message needs a new array.
- Lines 218 and 222: the claim holds, but the finding gives no edit for them and defers to another finding. Lines 218 and 222 give two sets of figures for what reads as the same game (300 files, 26 MB, 762 files, 226 MB against 297 files, 26,057,130 bytes, 759 files, 225,683,678 bytes). The exact byte counts in 222 are dense detail that suits a block, whatever the contradiction finding decides.

## Corrected claim

Lines 56, 110, 166, 218 and 222 are long paragraphs. Line 56 mixes the import rule with exact bundle sizes. Line 110 lists in running text the listeners that the linked "Input off" section already lists. Line 166 joins how to send the state with what to send. Lines 218 and 222 mix build steps with exact build figures.

## Corrected edit

- Line 56: keep the rule, the `FinalizationRegistry` reason, and one sentence such as "Some bundlers keep each re-exported namespace whole, and then bring in browser globals and `Math` calls that differ between JavaScript engines." Move the byte counts (9,133, 1,202, 87,857), the Bun versions and the full list of names into `<details><summary>Technical details: bundle sizes</summary>`.
- Line 110: keep the lead sentence, say in one sentence that the engine drops its pointer, key, wheel, focus, pointer lock and gamepad listeners and its pointer capture, give `visibilitychange` as the one example it keeps, and link to [Input off](../api/input.md#input-off) for the full list. Add no lists that repeat that section.
- Line 166: split after "draws it in `onUpdate`", as proposed.
- Line 218: split before "A real game recorded this way". Line 222: keep the 5-word result and the two last sentences (record again; the engine names a missing word) in the main text. Move the exact file and byte counts, with the 172-word comparison and the full-set size, into `<details><summary>Technical details: build figures</summary>`. Give one set of figures after the contradiction finding decides which holds.
