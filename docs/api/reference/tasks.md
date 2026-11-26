---
id: api/reference/tasks
title: "Tasks on the job workers: API reference"
status: generated
since: "0.3"
summary: "Every export of the Tasks on the job workers API, from the engine's doc comments."
---

# Tasks on the job workers: API reference

> [Tasks on the job workers](../tasks.md) explains these exports. The engine's doc comments make this page.

## `runTask`

```ts
function runTask<T>(task: Task, input: unknown, transfer: Transferable[] = NO_TRANSFER): Promise<T>
```

Runs a task in a job worker, beside the frames, and resolves with its output. The task's module is imported once in each worker that runs it, so a module keeps its state between tasks, and each of its WebAssembly files compiles once per page. A module exports `run`, which gets the task's input and a function that returns each compiled module by the name that the task gives it. The task runs in a job worker, never in the thread that ran the sketch. A job worker leaves the job system only between the chunks of a frame, so a frame never waits for a task, and with two or more job workers one stays for the frames. The engine resolves the promise between two frames, so code in its `then` runs before the next frame's `onUpdate`, and that frame draws what the task wrote. Tasks run at the same time in different job workers, so their answers come in no fixed order. Await one task's answer before you queue the next when the order matters. A `SharedArrayBuffer` in the input reaches the worker shared rather than copied, and the task writes into it. While the task runs, order the writes that both threads read with `Atomics`. Once the promise resolves, the worker has stopped writing, and the thread that ran the task reads the buffer as it stands. Such a buffer suits data too large to copy, such as the depths and order of many instances sorted in every frame. The engine asks the page for job workers with the first task, and sends no task to one that did not start. Where no job worker takes the tasks, the engine starts a task worker for them, as on a page without worker threads. The promise rejects with a `TaskFailure` when the task's module or WebAssembly fails to start, when its `run` throws, or when the engine stops before the answer arrives. A WebAssembly file that does not download or compile rejects with the engine's error. Call it from the code that runs the sketch: the setup function or a callback. A task's input and output must pass to another worker: numbers, strings, plain objects and arrays, typed arrays, `ArrayBuffer`s, `SharedArrayBuffer`s and the objects that the transfer list names.

## `Task`

Interface `Task`.

Work that runs in a job worker, beside the frames.

| Member | Description |
| --- | --- |
| `name: string` | The task's name. The engine's own tasks have names of their own, so give an add-on's task another one. |
| `script?: URL` | The address of the task's module, written as `new URL('<file>', import.meta.url)` so bundlers ship it. The module exports `run`, which the worker calls once per task. A task without a script names one of the engine's own tasks. |
| `wasm?: readonly WasmFile[]` | The WebAssembly files that the task's module runs, each with a name of its own. |

## `TaskFailure`

Class `TaskFailure`, which extends `Error`.

A task that failed in its worker, loading its code or WebAssembly or running on its input, or that still waited when the engine stopped.

| Member | Description |
| --- | --- |
| `readonly stage: TaskStage \| 'stopped'` | Where the task failed, or that the engine stopped before it answered. |

## `TaskLoadError`

Class `TaskLoadError`, which extends `Error`.

A failure to start a task's code or WebAssembly, as against a failure on the task's input. The worker knows it by its name, which every copy of this module gives it.

| Member | Description |
| --- | --- |
| `name: string` | The name that marks a failed start, which the worker reads. |

## `TaskModule`

Interface `TaskModule`.

A task's module, which the worker imports at the address that the task names. The module keeps its state between tasks, and the engine imports it once in each worker that runs the task.

| Member | Description |
| --- | --- |
| `run(input: unknown, wasm: (name: string) => WebAssembly.Module): TaskResult \| Promise<TaskResult>` | Runs the task on `input`, with the compiled modules the loader sent by name. Throws a `TaskLoadError` when its code or WebAssembly cannot start. |

## `TaskResult`

Interface `TaskResult`.

A task's output, and the objects that move to the loader with it rather than being copied.

| Member | Description |
| --- | --- |
| `output: unknown` | The task's answer, which the promise of `runTask` resolves with. |
| `transfer?: Transferable[]` | The objects that move to the loader with the output rather than being copied. |

## `TaskStage`

```ts
type TaskStage = 'load' | 'run';
```

Where a task failed: loading its module or its WebAssembly, or running it.

## `WasmFile`

Interface `WasmFile`.

A WebAssembly file that a task runs. The engine compiles it once per page and sends the compiled module to each worker that runs the task, which instantiates it there.

| Member | Description |
| --- | --- |
| `name: string` | The name that the module goes by in the task's `run`, and in error messages. |
| `url: URL` | The file's address, written as `new URL('<file>', import.meta.url)` so bundlers ship it. |
| `what: string` | What the file is, as error messages name it, such as "the splat sorter". |
