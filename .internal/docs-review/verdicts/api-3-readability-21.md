# api-3-readability-21

## Finding as given

- page: api/tasks
- anchor: intro line 13 and first example lines 17-44
- category: unclear
- severity: medium
- claim: Line 13 says an add-on does not sort its drawn rows through a task. The example right under it defines SORT_TASK named 'splat-sort' with a 'splat sorter' WebAssembly file and a sortRound function. The reader cannot tell whether to sort in a task. The intro also opens with the splats add-on's internals before it says what a task is.
- evidence: line 13 'so an add-on does not sort its drawn rows through a task'; line 21 name: 'splat-sort'; line 24 what: 'the splat sorter'.
- proposedEdit: Open with lines 15 and 46 (what a task is, how a worker runs it). Rename the example to work that fits the text, such as 'chunk-select' and selectChunks, in both examples. After the example add: 'The engine sorts blended rows itself, so a task chooses rows but does not sort them for drawing.'
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/api/tasks.md:13 ends "so an add-on does not sort its drawn rows through a task". Lines 20-31 then define `SORT_TASK` with name 'splat-sort', a WebAssembly file described as 'the splat sorter', and `sortRound`. The mismatch is real.
- The real splats add-on does not have a sort task. packages/splats/src/select.ts:26-35 defines `SELECT_TASK` with name 'splats-select' and what 'the splat selector'. So the page's example looks like the add-on's own code but names it wrongly. This makes the confusion worse, and renaming to a selection task matches the code.
- The shared-memory section (lines 63-72) reuses `SORT_TASK` and its prose speaks of "a per-frame sort" and "the sorted values". The rename "in both examples" must also reword those lines, or the section stops fitting its example.
- The second half of the claim does not hold. Line 13 opens with two sentences that say what `runTask` does ("move heavy work off the thread ... onto the engine's job workers"). The splats detail comes third. The page does not open with add-on internals; it gives them too early, before line 15 says what a task object is.
- Line 46 talks about "the module" that the second example (lines 36-44) shows. Moving it above the first example puts it before the reader has seen a module, so it does not belong in the opening.
- The proposed closing sentence repeats the last clause of line 13. Add it only if that clause moves out of the intro; otherwise it is a duplicate.

## Corrected claim

The first example contradicts line 13. Line 13 says an add-on does not sort drawn rows in a task, but the example names its task 'splat-sort' with 'the splat sorter'. The real add-on's task is 'splats-select' with 'the splat selector' (packages/splats/src/select.ts:26-35). The intro does say what `runTask` does first. Its splats detail and the transparent-pass sentence come before the reader learns what a task is.

## Corrected edit

1. Keep the first two sentences of line 13, then put line 15 (what a task is) right after them. Move the splats example sentence and the transparent-pass clause to after the first example as one short paragraph: "The Gaussian splats add-on uses a task like this to choose each chunk's splats, nearest first. The engine's transparent pass sorts the chosen rows itself, as it does for every blended draw, so a task chooses rows but does not sort them for drawing."
2. Rename the first example to match the real add-on: `SELECT_TASK`, name 'splats-select', script './select-task.ts', what 'the splat selector', and a function such as `selectChunks`. Change the module example's comments to match ("chooses the chunks", not "sorts").
3. In the shared-memory section, use `SELECT_TASK` and reword "A per-frame sort" to "A per-frame task", and the comment and `sorted` variable to the task's result. Or keep a neutral sort there with a non-splat name such as 'value-sort', so long as no splat name appears.
4. Leave line 46 where it is, after the module example.
