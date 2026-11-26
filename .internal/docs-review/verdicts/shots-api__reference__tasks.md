# Verdicts: api/reference/tasks (screenshots and demo links)

## Shots

None proposed. None needed: this page lists functions and types. A picture of a running demo would not show a task at work.

## Demo links

None proposed.

## Concepts said to have no demo

All three claims hold. No file under examples/ uses runTask, TaskModule or WasmFile. demos.ts and compare/comparisons.ts never name them.

- runTask: confirmed, no demo. The splats demo (code "splats/") runs tasks, but only inside the splats add-on. Its sketch never calls runTask, so a reader who opens the demo will not find the call.
- TaskModule: confirmed, no demo. No example ships a task module.
- WasmFile: confirmed, no demo. No example lists a WebAssembly file for a task.

Note for the page owner: the splats add-on source is a complete, real example of all three: packages/splats/src/select.ts (the task with its WebAssembly file, and the runTask calls) and packages/splats/src/select-task.ts (the module that exports run). It is not a demo, so the website demo-link format does not fit it. A short code example on the explainer page (docs/api/tasks.md) would fill the gap better than a demo link.
