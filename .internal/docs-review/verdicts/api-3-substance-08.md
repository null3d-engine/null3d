# Verdict for api-3-substance-08

## The finding as given

```json
{
 "page": "api/tasks",
 "anchor": "line 15 \"The module exports `run`\" and the module example's `return { output: { order } }`",
 "category": "missing-content",
 "severity": "medium",
 "claim": "The page never says that run must return { output }, that it may return `transfer`, or that runTask takes a third transfer list. It does not list the values that can pass to a worker. A reader who returns the answer directly gets undefined.",
 "evidence": "packages/engine/src/shared/run-task.ts:50-61 (runTask(task, input, transfer = NO_TRANSFER); values that pass); packages/engine/src/workers/tasks.ts:35-58 (TaskModule.run returns TaskResult { output; transfer? }).",
 "proposedEdit": "Add under the module example: \"`run` returns `{ output }`, and `runTask` resolves with `output`. Add `transfer: [buffer]` to move an ArrayBuffer back instead of copying it. `runTask(task, input, transfer)` takes the same list for the input. Input and output must be numbers, strings, plain objects and arrays, typed arrays, ArrayBuffers or SharedArrayBuffers.\"",
 "generatedSource": "",
 "id": "api-3-substance-08",
 "slice": "api-3",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/api/tasks.md:15 says only "The module exports `run`, and the worker calls it for each task. The answer travels back to the thread that called `runTask`." No sentence on the page states the return shape. The words "transfer" and "TaskResult" do not appear on the page. The page lists no values that can pass to a worker.
- docs/api/tasks.md:42 shows `return { output: { order } }`, and docs/api/tasks.md:29-30 reads `answer.order`. So the example shows the shape, but the text never explains why `output` is there. A reader can take it as a field of the answer.
- docs/api/tasks.md:77 says the task's output "returns a copy" when the buffer is an `ArrayBuffer`. With a transfer list, the output moves and is not copied. The page never says so.
- The code confirms the undefined result. packages/engine/src/workers/tasks.ts:112-113 does `const { output, transfer = [] } = await task.run(...)` and posts only `output`. A `run` that returns `{ order }` makes the promise resolve with `undefined`. No error is raised.
- The code confirms the transfer list for the input. packages/engine/src/shared/run-task.ts:57-61 takes `transfer: Transferable[] = NO_TRANSFER`, and packages/engine/src/shared/tasks.ts:497-518 sends it with the request.
- The value list in the proposed edit matches the TSDoc at packages/engine/src/shared/run-task.ts:51-53, except that the TSDoc also names "the objects that the transfer list names".

What does not hold:
- The generated reference page already covers most of this. docs/api/reference/tasks.md:16 shows the third `transfer` parameter, line 19 lists the values that can pass to a worker, and lines 63-72 document `TaskResult` with `output` and `transfer`. docs/api/tasks.md:104-106 links to that page. So the facts are documented and linked. The gap is only that the explanatory page does not say them.
- Because the example shows the right shape and the reference page holds the detail, "medium" is a little high. A reader who copies the example gets working code. The cost falls on a reader who writes `run` from the prose alone. Low to medium fits better.

## Corrected claim

The explanatory page never states that `run` returns `{ output }` (with an optional `transfer` list), that `runTask` takes a third transfer list for the input, or which values can pass to a worker. Its example shows the `{ output }` shape without explaining it. A `run` that returns its answer directly makes the promise resolve with `undefined` and no error. The generated reference page (linked at the end of the page) documents all of these facts, so the gap is on the explanatory page only.

## Corrected edit

Keep the return shape in the main text, because the example depends on it. Move the transfer lists and the value list into a collapsible block, because they are implementer detail that the reference page also holds. Add this after the module example (after line 44), before the paragraph that begins "The engine imports the module once":

```md
`run` returns an object with the answer in `output`, and the promise of `runTask` resolves with that `output`. A `run` that returns its answer directly resolves the promise with `undefined`.

<details>
<summary>Technical details: what can pass to a worker, and moving buffers</summary>

A task's input and output must pass to another worker: numbers, strings, plain objects and arrays, typed arrays, `ArrayBuffer`s and `SharedArrayBuffer`s.

The engine copies an `ArrayBuffer` by default. To move one instead of copying it, name it in a transfer list. `run` can return `{ output, transfer: [buffer] }` to move a buffer back to the caller. `runTask(task, input, [buffer])` moves a buffer of the input to the worker. A moved buffer is empty on the side that sent it.

</details>
```

The block has no headings and no nested blocks, and the main text makes sense with it closed. The last sentence of the block is standard `postMessage` behavior for transferred buffers, which the engine uses at packages/engine/src/workers/tasks.ts:113 and packages/engine/src/shared/tasks.ts:393 and 431.
