# api-reference-substance-27

## Finding as given

- page: api/reference/tasks
- anchor: tasks.md:43 `TaskLoadError`
- category: unclear
- severity: low
- claim: 'The worker knows it by its name, which every copy of this module gives it.' A task author needs to know when to throw it, not how the worker detects it.
- evidence: packages/engine/src/shared/task-load-error.ts:11.
- proposedEdit: 'Throw it from a task's `run` when the task's code or WebAssembly cannot start, so the failure reports `stage: 'load'` rather than `'run'`.' Move the detection detail to a code comment.
- generatedSource: packages/engine/src/shared/task-load-error.ts

Verdict: partly

## Evidence

- docs/api/reference/tasks.md:47 has the sentence the finding quotes. The entry does not say to throw it from `run`, and it does not say what the error changes. Its one member row (the name, "which the worker reads") also describes how the worker works, not what the author does.
- The source is the TSDoc in packages/engine/src/shared/task-load-error.ts:5-13.
- The proposed wording matches the code. In packages/engine/src/workers/tasks.ts:109-118 the stage becomes 'run' before `task.run` is called. A thrown error named 'TaskLoadError' sets it back to 'load', and that stage reaches `TaskFailure.stage`.
- The reader can already find the "when". On the same page, the `TaskModule.run` row (tasks.md:61) says "Throws a `TaskLoadError` when its code or WebAssembly cannot start". The guide docs/api/tasks.md:50 says "Throw a `TaskLoadError` when the module's code or WebAssembly cannot start. The engine then reports the failure at the load stage". So this is a gap in one reference entry, not a gap in the docs. Low severity is right.
- The detail about matching by name is not only internal. The worker compares names, not classes, so the check also works for a copy of the class bundled into the task's own chunk. The guide (docs/api/tasks.md:48) says the engine's Vite plugin emits a task module as its own chunk. That is a real fact about a supported setup. Moving it to a code comment would hide it. The file's top comment (task-load-error.ts:1-3) is already about where the class lives.

## Corrected claim

The `TaskLoadError` reference entry says what the error means, but not when to throw it or what it changes. That is on the `TaskModule.run` row of the same page and in docs/api/tasks.md:50. The sentence about matching by name is too terse to use, but it points to a fact that matters to authors: a copy of the class bundled into the task module still counts. Reword that sentence. Do not drop it.

## Corrected edit

In the TSDoc on the class in packages/engine/src/shared/task-load-error.ts:

"A failure to start a task's code or WebAssembly, as against a failure on the task's input. Throw it from a task's `run` when the code or WebAssembly cannot start. The `TaskFailure` then reports the stage `'load'`, not `'run'`. The worker matches the error by its name, so a copy of this class bundled into the task's module works too."

Member row for the name: "The name that marks a failed start. Keep it as it is."
