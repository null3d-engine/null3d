# concepts-2-readability-27

## Finding as given

- page: concepts/static-dynamic
- anchor: ## Setters and direct writes, lines 74 and 76
- category: long-paragraph, severity: medium
- claim: Line 74 (158 words, 11 sentences) packs what the dev check compares, the onLateUpdate re-check, the 4,096-row turns, live against hold behavior and the S2 cost. Line 76 then repeats that static batch rows are checked in turns and raise E1110 within a few frames.
- evidence: stats.json lines 67 (158 words, 11 sentences) and 69 (88 words, 6 sentences).
- proposedEdit: Main text as a list: dev builds raise [E1110] when a static object changes without a setter; live engine logs once and carries on; hold mode stops so a test fails; release builds leave the check out. Move the comparison, the onLateUpdate re-check, the row turns and the S2 cost into <details><summary>Technical details: how the static check runs</summary>. Drop line 76's last sentence.

Verdict: partly

## Evidence

- The page has front matter and a status note. Because of this, stats.json lines 67 and 69 are page lines 74 and 76. The finding names the right paragraphs.
- Line 74 holds all five points the finding lists. The code supports each one. Static objects are compared against the values from their last check (packages/engine/src/scene/unmarked-writes.ts:149). Batch rows are checked in turns, at most 4,096 rows a frame (unmarked-writes.ts:201, the row limit; unmarked-writes.ts:287, the batch check). So the detail is correct, and a block is a better place for it than a cut.
- The repeat is real. Line 74 says "The rows take turns, at most 4,096 a frame over all batches, so a scene of many rows reports a write within a few frames." Line 76 ends with "The development check reads the rows of static batches in turns, so a row that you forgot to mark raises E1110 within a few frames."
- The row-turn detail also appears in full in docs/concepts/instances.md:130, which this page links to. A short link is enough here.
- "S2 benchmark" is not explained on this page or anywhere else in docs/. (In guides/performance.md, "S2" only appears inside the phone name "Galaxy S24+".) A reader cannot tell what S2 is, so the name should not move into the block unchanged.

## What does not hold

The proposed main-text list drops the rule for instance batches. It also tells the editor to drop line 76's last sentence. After both changes, the page would say only inside a closed block that a static batch row written without `markDirty` raises E1110. That is the error a reader of this section is most likely to hit, because line 76 says direct array writes skip every setter. The rule must be visible with every block closed.

## Corrected claim

Line 74 is long and mixes the rule with how the check runs. Line 76 repeats line 74's point that batch rows are checked in turns. The fix is a short list plus a details block, but the list must keep the rule for static batch rows.

## Corrected edit

Main text, after the setter paragraph:

Development builds check this rule in every frame:

- A static object that changes without a setter raises [E1110](../errors/E1110.md), which names the object.
- A static [instance batch](instances.md#static-and-dynamic-batches) row that changes without a `markDirty` mark raises the same error.
- A live engine logs the error once and carries on. Hold mode stops at it, so a test fails at once.
- Release builds leave the check out.

<details>
<summary>Technical details: how the static check runs</summary>

Before the engine recomputes objects, it compares the position, rotation, scale and bounding sphere of each static object with the values from its last check. In a sketch with `onLateUpdate`, it checks again before it recomputes what that callback moved. Batch rows take turns, at most 4,096 a frame over all batches, so a scene of many rows reports a write within a few frames. The check reads every static object in each frame. On a MacBook Pro benchmark scene it cost about 0.06 ms per frame on WebGPU and 0.03 ms on WebGL2.

</details>

On line 76, change the last sentence to: "The development check finds a row that you forgot to mark ([Instances and batching](instances.md#static-and-dynamic-batches) tells how)." You can also delete it, because the list above now states the rule. Replace "the S2 benchmark" with a plain description of the scene, such as the number of static objects in it. Do not keep the internal name.
