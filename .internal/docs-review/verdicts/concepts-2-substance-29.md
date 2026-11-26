# concepts-2-substance-29

## Finding as given

- page: concepts/static-dynamic
- anchor: ## Setters and direct writes, lines 74 (158 words) and 76; line 106
- category: duplication
- severity: low
- claim: Lines 74 and 76 both say that the development check reads static batch rows in turns and raises E1110 within a few frames. Line 74 also holds the benchmark cost and the hold mode note.
- evidence: stats.json concepts/static-dynamic longParagraphs (stats lines 67, 69, 99).
- proposedEdit: State the batch rule only in line 76. Move the turn size (4,096 rows a frame), the S2 cost and the hold mode note into <details><summary>Technical details: the development check</summary>.

Verdict: partly

## Evidence

- Page lines 74 and 76 (stats lines 67 and 69; stats lines are 7 lower than page lines). Line 74: "The rows of static instance batches get the same check, against their markDirty marks. The rows take turns, at most 4,096 a frame over all batches, so a scene of many rows reports a write within a few frames." Line 76: "The development check reads the rows of static batches in turns, so a row that you forgot to mark raises E1110 within a few frames." The duplication is real.
- The 4,096 figure is correct: packages/engine/src/scene/unmarked-writes.ts:201 `ROWS_PER_CHECK = 4096`, the most rows the check hashes in a frame over every batch.
- The S2 cost (0.06 ms WebGPU, 0.03 ms WebGL2) also appears in docs/guides/performance.md:361. It is reference detail, so a collapsed block suits it.
- The hold mode note ("A live engine logs the error once and carries on. Hold mode stops at it, so a test fails at once.") is not dense implementer detail. It tells every reader what E1110 does to a running app and to a test. docs/errors/E1110.md does not say this. Hiding it in a collapsed block would leave the main text silent on whether the error stops the app. That part of the edit is wrong.
- The anchor names line 106 (stats line 99, the 105-word phones paragraph), but the claim and edit say nothing about it. That line has no duplication with lines 74 and 76. It does not belong in this finding.

## Corrected claim

Lines 74 and 76 both say that the development check reads static batch rows in turns and raises E1110 within a few frames. Line 74 also holds the per-frame row limit and the benchmark cost, which are reference detail. Line 106 is not part of this duplication.

## Corrected edit

In line 74, cut the two sentences about batch rows ("The rows of static instance batches get the same check..." and "The rows take turns, at most 4,096 a frame..."). Keep the batch rule in line 76, and add the link to instances.md#static-and-dynamic-batches there. Keep "A live engine logs the error once and carries on. Hold mode stops at it, so a test fails at once." and "Release builds leave the check out." in the main text. After line 76, add:

<details>
<summary>Technical details: the development check</summary>

The check reads at most 4,096 batch rows a frame, over all static batches. The rows take turns, so a large scene reports an unmarked row within a few frames. The check reads every static object in each frame. In the S2 benchmark on a MacBook Pro, it cost about 0.06 ms per frame on WebGPU and 0.03 ms on WebGL2.

</details>

Drop line 106 from the anchor.
