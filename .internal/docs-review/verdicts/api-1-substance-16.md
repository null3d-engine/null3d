# Verdict for api-1-substance-16

## Finding as given

- id: api-1-substance-16 (slice api-1, role substance)
- page: api/debug
- anchor: "### Memory figures lines 310, 312, 314; ## Debug drawing line 24"
- category: technical-details-block
- severity: medium
- claim: Line 310 (146 words) explains shared-memory double counting and job-loop exits; line 312 lists internal tables such as "the frame builder's bucket-key scratch"; line 24 ends with a hold-mode detail. The use of each figure gets lost.
- evidence: docs/api/debug.md:24, 310, 312, 314.
- proposedEdit: Keep one sentence: the whole-page figure comes from the browser and counts shared memory per thread, so the overlay also gives it counted once. Move the rest into `<details><summary>Technical details: how the page measures its memory, and the tables of Memory by system</summary> ... </details>`. Move the hold-mode sentence of line 24 into a similar block or to the testing guide.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/api/debug.md:310 is 146 words and 10 sentences (stats.json lists it at its body line 303). It does mix reader-facing facts with implementer detail. The sentence about idle job workers leaving the job loop is implementer detail and fits a block. So does the remark that the browser counts shared memory once per thread.
- docs/api/debug.md:312 is 149 words and 11 sentences. The list of tables ("the frame builder's bucket-key scratch", "upload arenas", and so on) is implementer detail and fits a block.
- docs/api/debug.md:24 ends with the hold-mode sentence. It has no link to hold mode, unlike line 124, which links to guides/testing.md#hold-mode. The sentence is a real but narrow behavior note, so a block (or a link) fits.

Where the proposed edit goes too far:

1. Line 310 names `measurePageMemory()` from `@null3d/engine/stats`. It is the only mention of this public export on any guide page (grep finds it only here and in docs/api/reference/debug.md:268). The page summary in the front matter also names `@null3d/engine/stats`. If this sentence goes into a closed block, readers lose the pointer to a public API. It must stay in the main text. Two more reader-facing facts must also stay: the line reads `measuring` until the first answer, and the browser can take about a minute to answer. A user who opens the overlay sees both.
2. The block summary moves all of line 312, "the tables of Memory by system", into a block. The main text would then not say that a development build has a `Memory by system` list. It would also not say that each row gives used, reserved and peak bytes, that the list runs only while the card is open, or what faults it finds (a table that keeps its peak after the scene shrinks). That is the "use" the finding says gets lost. Those sentences must stay. Only the list of table names belongs in the block.
3. Line 314 is named in the anchor, but the claim says nothing about it. It is 4 sentences and is not in the stats list of long paragraphs. It says that the overlay hides the line when a browser never answers, which a user sees on screen. It should stay as it is.
4. The claim "the use of each figure gets lost" is too strong for the table at lines 300 to 308. The table gives each figure's source clearly. The real issue is the two long paragraphs below the table.

## Corrected claim

Lines 310 and 312 of docs/api/debug.md (146 and 149 words) mix reader-facing facts with implementer detail. Examples are the job loop of the idle workers, the per-thread counting by the browser, and the list of internal tables. The sentence at the end of line 24 is a narrow hold-mode note with no link. Line 314 and the table are fine.

## Corrected edit

- Line 310: keep in the main text that the whole-page figure is not the bar's total and so has its own line. Also keep that the overlay gives it with the engine's shared memory counted once, that the line reads `measuring` until the first answer (which can take about a minute), and the `measurePageMemory()` sentence. Move the per-thread counting of the browser, the job-loop sentence and "one measurement at a time" into `<details><summary>Technical details: how the page measures its memory</summary> ... </details>`.
- Line 312: keep the sentences on what the list is (dev build only, card open only, used/reserved/peak bytes, tooltip gives exact bytes) and on the faults it finds. Move the two sentences that list the tables into `<details><summary>Technical details: the tables of Memory by system</summary> ... </details>`.
- Line 314: no change.
- Line 24: move the hold-mode sentence into a short `<details><summary>Technical details: debug lines in hold mode</summary> ... </details>`, and link "hold mode" to ../guides/testing.md#hold-mode. Or cut the sentence from this page and add it to the hold mode section of the testing guide.
