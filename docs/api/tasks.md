---
id: api/tasks
title: Tasks on the job workers
status: experimental
since: "0.3"
summary: "runTask: an add-on's code and WebAssembly on the job workers; shared memory; ordering with the frames; failures."
---

# Tasks on the job workers

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

An add-on can move heavy work off the thread that runs the sketch, and onto the engine's job workers. `runTask` runs a task there while the frames continue. An add-on that sorts many instances in each frame uses this hook, and so does one for Gaussian splats.

A task is an object with three parts: a name, the address of the module that runs, and the WebAssembly files that the module uses. The module exports `run`, and the worker calls it for each task. The answer travels back to the thread that called `runTask`.

```ts
import { runTask, type Task } from '@null3d/engine';

export const SORT_TASK: Task = {
  name: 'splat-sort',
  script: new URL('./sort-task.ts', import.meta.url),
  wasm: [
    { name: 'splat', url: new URL('./splat.wasm', import.meta.url), what: 'the splat sorter' },
  ],
};

export async function sortRound(view: Int32Array): Promise<number[]> {
  const answer = await runTask<{ order: number[] }>(SORT_TASK, { view });
  return answer.order;
}
```

The module that the task's address names looks like this:

```ts
export function run(input, wasm) {
  const module = wasm('splat'); // the compiled WebAssembly module, by the name the task gives it
  const sorter = startSorter(module); // the add-on's own start of its WebAssembly
  const order = sorter.sort(input.view); // reads the caller's shared buffer
  // ... write the order into the shared buffer ...
  return { output: { order } };
}
```

The engine imports the module once in each worker that runs the task, so the module keeps its state between tasks. Each WebAssembly file compiles once per page, and the engine sends the compiled module to the workers.

The build bundles the module that the task names, so it may be TypeScript with its imports. A worker imports it as it does any module, and raw TypeScript would not parse there. The engine's Vite plugin emits the module as its own chunk for that reason.

Throw a `TaskLoadError` when the module's code or WebAssembly cannot start. The engine then reports the failure at the load stage, whatever the task's input was.

## What the engine guarantees

- **Off the sketch thread.** The task runs in a job worker, not in the thread that runs the sketch.
- **Frames first.** The engine never waits for a task in a frame. A job worker leaves the job system only between the chunks of a frame. With two or more job workers, one stays for the frames.
- **Ordering.** The engine hands an answer to the thread that called `runTask` between two frames. Code in the promise's `then` runs before the next frame's `onUpdate`, and that frame draws what the task wrote.
- **No fixed order between tasks.** Tasks run at the same time in different job workers. Their answers come back in no fixed order, so await one task's answer before you queue the next when the order matters.
- **Shared memory.** A `SharedArrayBuffer` in the task's input reaches the worker shared rather than copied. The worker writes into the same memory that the sketch reads.
- **A task always runs.** Where no job worker takes the task, the engine starts a task worker for it, as on a page without worker threads.

## Shared memory

A per-frame sort copies no data when its input and output live in one `SharedArrayBuffer`. The engine posts the buffer to the worker without copying it, and the task writes the result into it.

```ts
const shared = new SharedArrayBuffer(4 * (1 + count * 2));
const view = new Int32Array(shared);
// view[0] holds the count, view[1] to view[count] the values, and the task writes the sorted
// values after them.
Atomics.store(view, 0, count);
const answer = await runTask(SORT_TASK, { view });
const sorted = view.subarray(count + 1, count + 1 + count);
```

While a task runs, both threads read the shared memory. Order the writes that both threads read with `Atomics`. Once the promise resolves, the worker has stopped writing, and the sketch reads the buffer as it stands.

A page without the isolation headers has no `SharedArrayBuffer`. Use an `ArrayBuffer` instead: the engine copies it to the worker, and the task's output returns a copy. [Hosting and cross-origin isolation](../getting-started/hosting.md) gives the headers.

## Failures

The promise rejects in four cases:

| What failed | The rejection |
| --- | --- |
| The task's WebAssembly file does not download or compile | An engine error, such as E1406 or E1418 |
| The task's module, or its WebAssembly, does not start | A `TaskFailure` with the stage `'load'` |
| The task's `run` throws | A `TaskFailure` with the stage `'run'`, and the error's message |
| The engine stops before the answer arrives | A `TaskFailure` with the stage `'stopped'` |

A task that fails does not stop the engine, and a later task tries again. A module that fails to load is imported again on the next task.

## The task's module in a build

The address must name JavaScript that the browser imports as a module. In a project built with Vite, write the task in the add-on's package, and let the package's build write it. Give the address of the built file, as in the example above.

The file must run on its own. Bundle anything that it imports, or keep it free of imports. A development server compiles a TypeScript file on request, but a production build copies it as it stands.

## Related pages

- [Sketch API: defineSketch and the context](sketch.md): the callbacks, and where to queue a task.
- [Architecture: threads and the frame](../concepts/architecture.md): the job workers and the pipelined frame.
- [Hosting and cross-origin isolation](../getting-started/hosting.md): the headers that a page needs for shared memory and for the engine's threads.

## API reference

[The API reference](reference/tasks.md) lists every export of this page with its type and description. The engine's doc comments make it.
