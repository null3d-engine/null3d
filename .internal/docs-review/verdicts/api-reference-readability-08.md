# Verdict: api-reference-readability-08

## The finding as given

```json
{
 "page": "api/reference/tasks",
 "anchor": "`runTask`, line 19",
 "category": "wall-of-text",
 "severity": "high",
 "claim": "The page's main export is one paragraph of 381 words and 18 sentences. Restoring the source paragraphs helps, but parts read better as lists and a details block.",
 "evidence": "stats.json tasks line 12 (page line 19): 381 words, 18 sentences. Source packages/engine/src/shared/run-task.ts:21-53 has 7 paragraphs.",
 "proposedEdit": "After the generator keeps paragraphs: keep paragraphs 1-3 (where it runs, when the promise resolves, answer order) as main text. Make the last paragraph a list of what input and output may hold. Make the three TaskFailure cases a list. Move the SharedArrayBuffer/Atomics paragraph and the task-worker fallback paragraph into @details.",
 "generatedSource": "packages/engine/src/shared/run-task.ts",
 "id": "api-reference-readability-08",
 "slice": "api-reference",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- Page `docs/api/reference/tasks.md:19` is one paragraph that holds all of `runTask`. The counts (381 words, 18 sentences) come from stats.json and are facts.
- Source `packages/engine/src/shared/run-task.ts:21-53` has a one-line summary (line 21) and 7 body paragraphs (23-26, 28-30, 32-35, 37-41, 43-45, 47-49, 51-53). The claim of 7 paragraphs holds when you count the body only.
- The cause is the generator. `summaryOf` in `tools/lib/api-docs.ts:119-123` passes the comment through `flat()`, "on one line". Finding 1 of the same slice reports this exact page and line as its first piece of evidence. So most of the "high" cost (one 381-word block) belongs to finding 1. What this finding adds is the layout after finding 1 is fixed. With 8 short paragraphs, that layout problem is medium, not high.
- No `@details` tag exists yet. Finding 3 of the slice proposes it. Without that change, the compiler ends the summary at the `@details` word, and `misreadTags` (`tools/lib/api-docs.ts:105-117`) adds the tag text back as plain text. So this edit depends on findings 1 and 3. The findings file says "after finding 1" but does not name finding 3.
- Moving the shared-memory paragraph and the fallback paragraph into a details block loses nothing for a newcomer. The guide `docs/api/tasks.md` covers both: lines 57-59 (no fixed order, shared memory, "a task always runs") and lines 63-77 (the `SharedArrayBuffer` example, the `Atomics` rule, the `ArrayBuffer` fallback). The reference page links that guide at line 11.
- The proposed edit has three gaps:
  1. The last source paragraph (51-53) holds two things: a rule on where to call `runTask` ("the setup function or a callback") and the list of values that can pass to a worker. The edit turns the whole paragraph into a list of values. The findings file's wording for that list drops the call-site rule. That rule tells the reader when the call is valid, so it must stay in the main text.
  2. The failure paragraph (47-49) has a fourth outcome: a WebAssembly file that does not download or compile rejects with the engine's error, not a `TaskFailure`. A list of only the three `TaskFailure` cases loses this unless the list keeps it as its own item.
  3. The second sentence of body paragraph 2 ("A job worker leaves the job system only between the chunks of a frame ... one stays for the frames") is engine scheduling detail, like the fallback paragraph. The edit keeps it in the main text. It belongs in the same details block.

## Corrected claim

After finding 1 makes the generator keep paragraphs, `runTask` still mixes how to use it with how the engine schedules it. Some parts read better as lists and one details block. The 381-word wall itself is finding 1's issue. This finding is medium, and it depends on findings 1 and 3.

## Corrected edit

In `packages/engine/src/shared/run-task.ts`, after findings 1 and 3 land:

- Main text, in this order:
  - Summary line, as it is.
  - "Call it from the code that runs the sketch: the setup function or a callback." Move it up from the last paragraph.
  - The module paragraph (23-26), as it is.
  - "The task runs in a job worker, never in the thread that ran the sketch."
  - The promise and order paragraph (32-35), as it is.
  - "A task's input and output must pass to another worker. They can hold:" followed by a list: numbers, strings, plain objects and arrays; typed arrays; `ArrayBuffer`s and `SharedArrayBuffer`s; the objects that the transfer list names.
  - "The promise rejects:" followed by a list: with a `TaskFailure` when the module or WebAssembly fails to start; with a `TaskFailure` when `run` throws; with a `TaskFailure` when the engine stops before the answer arrives; with the engine's error when a WebAssembly file does not download or compile.
- One `@details` block, with no heading inside:
  - The job-worker scheduling sentence from paragraph 28-30.
  - The `SharedArrayBuffer` and `Atomics` paragraph (37-41).
  - The paragraph on asking the page for job workers and on the task-worker fallback (43-45).
