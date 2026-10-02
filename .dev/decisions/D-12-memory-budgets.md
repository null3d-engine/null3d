# D-12: Memory budgets per preset

Status: proposed. Date: 2026-10-03. Task: M1-L3. Test: T-25.

## Question

How much GPU texture memory may each quality preset plan for, and how large a WebAssembly memory maximum may it declare? Phone and tablet browsers close a tab that uses too much memory. The presets' values must keep a scene well below that point on the weakest device that each preset serves.

## Rule

Each preset's texture budget and WebAssembly maximum stay under half the lowest failure point measured on the weakest device that the preset serves. [D-04](D-04-memory-maximum.md) sets the default maximum at 1024 MiB, and lets a page ask for up to 4096 MiB.

## Data

The device runner's `tab-memory` plan grows one kind of memory in one tab, in steps of 32 MiB, until something gives. Each step allocates and fills its memory with data that does not compress, and waits until the GPU has taken it. After each step that lived, the page posts its progress to the dev server. So the run keeps the last step when the browser closes the tab. [Device sessions](../devices.md#the-tab-memory-plan) describes the plan.

The failure point of a growth is the step after the last that lived.

Pending: the runs on the iPad (Safari) and the S24+ (Chrome, Brave).

## Decision

Pending the data.

## Consequences

- The values go into the preset table: `memoryMaximumMiB` in `packages/engine/src/quality/presets.ts`, and the planned `textureMemoryMiB` in `preset-docs.ts` until the texture budget is built.
- T-25 closes in section 17 of the plan with the failure points.
- The record is in the table in README.md.
