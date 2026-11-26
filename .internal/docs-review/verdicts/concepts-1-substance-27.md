# concepts-1-substance-27

## Finding as given

- page: concepts/handles
- anchor: ## Stale handles, line 75 (stats line 68, 131 words) "A call on a destroyed object never changes the object that takes its slot..."
- category: long-paragraph
- severity: low
- claim: One paragraph covers release builds, core logging, batch arrays and world getters, so the main point gets lost. The page also never says that slot 0 is never used, or that a destroyed object's wrapper keeps a generation that never matches a later object.
- evidence: crates/null3d-core/src/handle.rs:1-31 (slot 0 never handed out; REUSE_DELAY 1024; DEAD_GENERATION never handed out).
- proposedEdit: Keep the first and last sentences. Move the rest into <details><summary>Technical details: what each build does with a destroyed object</summary>, and add: 'Slot 0 is never used, so handle 0 means none. A destroyed object's wrapper keeps a generation that no live object gets, so it never matches a later object in its slot.'
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/concepts/handles.md:75 is one paragraph of 131 words and 9 sentences (stats.json line 68). It mixes the main rule (a stale call never harms the new object), release-build writes, light setters, a second destroy, core logging, instance batch arrays, world getters and the advice to debug in a development build.
- With the block closed, the first and last sentences still make a complete point: "A call on a destroyed object never changes the object that takes its slot, in any build. The call is still a bug in your sketch, so find it in a development build." The middle sentences are correct, dense, per-build detail, which is what the block is for. No heading or nested block is needed.
- The page never says slot 0 is unused or that the wrapper gets a generation no live object has. Checked the whole page (lines 1-93). The table at line 29 gives 1,048,575 slots (2^20 - 1), which hints at it but does not say it.
- The code supports both added sentences:
  - crates/null3d-core/src/handle.rs:5-9: slot 0 is never handed out, so handle 0 means none; the highest generation is never handed out, and a destroyed wrapper keeps a handle with it that stays stale however often the slot is reused.
  - crates/null3d-core/src/handle.rs:23, 31: MAX_SLOTS excludes index 0; DEAD_GENERATION equals the generation mask.
  - packages/engine/src/scene/scene.ts:1470-1485: destroy() sets the wrapper's data row to 0 and ORs the dead generation into its handle. The handle is a public field (scene.ts:1118), so a reader can see it.
- The slot-0 fact also explains the existing phrase "its setters then write to a row that no object uses": that row is row 0, which no object gets. So the addition fits inside this block and does not need to go to "What a handle holds".
- Small accuracy point that supports the finding: "its wrapper stops pointing at the slot" is loose. The wrapper's data row goes to 0, but its handle keeps the slot number with the dead generation. The added sentence makes this clear.

## Suggested refinement of the edit (optional)

Main text:

> A call on a destroyed object never changes the object that takes its slot, in any build. The call is still a bug in your sketch, so find it in a development build.

Block:

> <details>
> <summary>Technical details: what each build does with a destroyed object</summary>
>
> Slot 0 is never used, so handle 0 means no object. When you destroy an object, its wrapper's setters switch to row 0, and its handle gets a generation that no live object gets, so it never matches a later object in its slot. In a release build, its setters then write to that unused row, and its light setters reach no light. A second `destroy()` frees nothing. The engine core checks the generation of each change that waits for the next frame, and logs E1101 for a change to a destroyed object. An instance batch's arrays throw E1101 in every build once the batch is gone. The world getters throw it in every build from the frame after the destroy, and at once in development builds.
>
> </details>
