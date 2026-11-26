# guides-2-readability-28

## Finding as given

- page: guides/start-time
- anchor: lines 232, 284, 320
- category: internal-note
- severity: low
- claim: Line 284 says what 'the engine's demo page dropped', which is history. Line 232 names the showcase demos' ?grown switch, which a user's page does not have. Line 320 gives bun run bench:startup, a command of the engine's repository that a user cannot run in their project.
- evidence: line 284 'The engine's demo page dropped such a worker: it sent about 1,570 requests and 820 MB...'; line 320 'The engine's repository times the engine's own start with `bun run bench:startup`.'
- proposedEdit: Line 284: state a present fact, e.g. 'A worker that caches a large build at load can send over a thousand requests on the start's connections.' Line 232: cut the ?grown sentence or move it to a technical details block. Line 320: cut, or move into <details><summary>Technical details: how the engine's own start is timed</summary>.

Verdict: partly

## Evidence

The line numbers match the page file (docs/guides/start-time.md lines 232, 284, 320).

Line 284 holds. "Dropped" tells what happened in the past. AGENTS.md "Writing docs" says a page states what holds now and leaves "when it happened" to git. The proposed rewrite is weaker than it needs to be, though. It throws away the measured figure ("about 1,570 requests and 820 MB"). The rules ask for a figure as a present fact, so the figure should stay.

Line 232 does not hold as an internal note. `?grown` is a real switch in the shipped demos. examples/showcase/island/sketch.ts:166 reads `ctx.engine.held || params.has('grown')` and then preloads every model (line 169). The Creek and splat demos have the same switch (examples/splats/sketch.ts:33). It is not a process word or a maintainer note. It shows a pattern that a user can copy: let a page wait for the finished scene so that it measures the finished scene. The real fault is smaller. The sentence names a demo switch with no link, so a reader cannot find the code. Cutting it would lose a useful pattern.

Line 320 partly holds. `bench:startup` exists (package.json:59, bench/startup.ts). It is a tool of the engine's repository, not something a user runs in their own project. But AGENTS.md says "Name the engine's benchmarks when you cite a figure", and this page cites many start-time figures. So the line is allowed, and cutting it is the wrong fix. Putting it in a details block fits the user's request: dense detail goes into a block that is closed by default.

## Corrected claim

Line 284 tells history ("dropped") where it should give a present fact. Line 320 names a tool of the engine's repository in the main text. It is allowed as the benchmark behind the figures, but it belongs in a technical details block. Line 232's `?grown` switch is a real, shipped demo feature, not an internal note. It needs a link to the demo code, not a cut.

## Corrected edit

- Line 284: "A worker that caches every file of the engine's demo page sends about 1,570 requests and 820 MB over the start's connections."
- Line 232: keep the sentence and link it: "The [Island demo](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/) takes a `?grown` switch that does the same on a live page."
- Line 320: move it into a block at the end of "Measure a start", and do not cut it:

<details>
<summary>Technical details: how the engine's own start is timed</summary>

The engine's repository times its own start with `bun run bench:startup`. It loads the engine's test page cold and warm in Chrome, on Slow 4G by default. It prints the median of each stage, with the drawing thread's device, shader file and renderer.

</details>
