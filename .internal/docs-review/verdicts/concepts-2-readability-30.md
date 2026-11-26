# concepts-2-readability-30

## Finding as given

- Page: concepts/particle-buffer
- Anchor: ## A record line 52; ## Layout in practice 54-69; before ## Write into the buffer (71)
- Category: example-placement
- Severity: medium
- Claim: Line 52 (103 words) brings in writeRecords with its nine-number block, wrapping and size stability, and shiftRecords, before the reader has seen one write call in context. The fountain example comes after three sections of layout rules.
- Evidence: stats.json concepts/particle-buffer line 45: 103 words, 6 sentences.
- Proposed edit: Order: 'What the buffer holds', 'A record' (table and the write signature only), 'Write into the buffer' (example and notes), an H3 'Write many births in one call' for writeRecords, then 'Layout in practice'. Move shiftRecords next to the time-base item in Limits (190), or into <details><summary>Technical details: moving the time base</summary>.

Verdict: survives

## Evidence

- Page line 52 (stats line 45 counts without the front matter): one paragraph of 103 words and 6 sentences. It introduces `writeRecords` (nine numbers per birth, wrap at the capacity, a block that keeps its size) and `shiftRecords`. Both claims hold.
- The first write in context is the short snippet at line 64, after line 52. The full fountain example starts at line 73, after "What the buffer holds" (26), "A record" (38) and "Layout in practice" (54). One small slip: "What the buffer holds" is an overview, not a layout rule. So it is two sections of layout rules plus an overview. This does not change the issue.
- AGENTS.md "Writing docs": "A concept page opens with a Mermaid diagram and a plain explanation, followed by examples." Here the bulk-write and time-shift calls come before the first example, so the reorder follows the rule.
- `shiftRecords` and `writeRecords` exist (packages/engine/src/scene/particles.ts:685 and :712). The API reference documents both (docs/api/reference/particles.md:46-47), so the concept page can give less on them without losing anything.
- Limits line 190 says that a buffer "moves its time base" and describes `frame[2]` and `frame[3]`. It never names the call that does it. Putting `shiftRecords` next to that item fills a real gap for anyone who writes their own emitter.
- The proposed `<details>` block keeps to the contract: it has no heading inside and is not nested. The main text still makes sense with the block closed.

## Refinements to the edit

- The H3 still holds about 75 words and 5 sentences after `shiftRecords` moves out. It is still over the limit. Split it into two paragraphs: (1) the call and the block layout; (2) the engine packs and marks the records, and the block should keep its size from frame to frame.
- After the reorder, the fountain example already shows `born % capacity`. The row-reuse snippet in "Layout in practice" (lines 62-65) repeats it. Cut that snippet, or point back to the example's line.
- The fountain example sets `frame[1] = Math.min(born, capacity)`, but its notes do not explain it. "Layout in practice" explains it, and that section now comes later. Add one sentence to the notes that links forward, or put a short code comment on that line.
