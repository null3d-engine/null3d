# api-3-substance-07

## The finding as given

- Page: api/tasks
- Anchor: intro, line 13 "an add-on does not sort its drawn rows through a task" and the example SORT_TASK 'splat-sort', lines 20-31
- Category: contradiction. Severity: medium.
- Claim: The first paragraph says add-ons do not sort through a task, then the only example is a sort task named after the splats add-on, and the shared-memory section is "A per-frame sort". The splats add-on chooses prefixes in its task; it does not sort. A reader learns the wrong pattern.
- Evidence: docs/api/tasks.md:13, 20-31, 63-73; docs/api/splats.md:110-119.
- Proposed edit: Change the example to a selection task, such as name 'pick-chunks' with chooseChunks(view) that writes chosen indices into the shared buffer, and call the shared-memory example "A per-frame selection".
- Generated source: none (hand-written page).

Verdict: survives

## Evidence

- docs/api/tasks.md:13 says the splats add-on "chooses each chunk's prefix there, nearest first", that the transparent pass sorts the chosen rows on the job workers, "so an add-on does not sort its drawn rows through a task".
- docs/api/tasks.md:20-31 then shows `SORT_TASK` named `'splat-sort'`, with a WebAssembly file named `'splat'` described as "the splat sorter", and a function `sortRound` that returns an `order`. The module at lines 37-43 calls `sorter.sort(input.view)`.
- docs/api/tasks.md:63-73 opens "A per-frame sort", and its comment says the task "writes the sorted values".
- The real add-on task is a selection task, not a sort: packages/splats/src/select.ts:26-32 defines `SELECT_TASK` with name `'splats-select'` and a WebAssembly file named `'splats'`. packages/splats/src/system.ts:8 and packages/splats/src/index.ts:9 say the engine sorts the rows back to front. docs/api/splats.md:110-119 agrees.
- So the page names its example after the splats add-on, yet shows the exact pattern it says the add-on does not use. Nothing else on the page or on the linked pages resolves this. The cost to a reader is real: a newcomer copies the sort pattern for drawn rows.

One nuance, which does not refute the finding: the selection does order chunks by distance ("nearest first", and select.ts:2 says "the selection and its distance sort"). A sort inside a task is not wrong in itself. The contradiction is that the example sorts the drawn rows, under the splat add-on's name.

## Notes on the edit

The proposed edit is right. Keep the new example clearly generic (for example `'pick-chunks'`, a WebAssembly file named for the add-on's own picker), so it does not claim to be the splats add-on's code. Update all four places together: the task name and WebAssembly label (lines 21-24), the caller function and answer field (lines 28-30), the module sketch (lines 38-42), and the shared-memory paragraph, code and comment (lines 63-72: "A per-frame selection", and the task writes the chosen indices after the inputs).
