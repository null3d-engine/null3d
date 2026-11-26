# api-2-substance-14

## Finding as given

- page: api/materials, api/debug, api/geometry, api/raycast, api/scene, api/controls, api/wind
- anchor: in api/materials: 'bun run bench:allocation --setters checks setUniform ...' (line 526)
- category: internal-note
- severity: medium
- claim: bench:allocation is a script of the engine's own repository. A developer who uses the engine cannot run it in their project. api/controls also cites tests/image/controls.spec.ts. These sentences describe the maintainers' tests.
- evidence: docs/api/materials.md:526; docs/api/debug.md:335; docs/api/geometry.md:204; docs/api/raycast.md:23; docs/api/scene.md:246, 341, 462, 549; docs/api/controls.md:106; docs/api/wind.md:372; package.json:57.
- proposedEdit: Delete the sentences, or write 'The engine's allocation benchmark checks it in every frame.' To keep the command for contributors, put it in a <details> block, 'Technical details: how the engine checks this'.
- generatedSource: (none)

Verdict: partly

## Evidence

- All ten cited lines hold the sentence as described. package.json:57 defines `bench:allocation` as `bun bench/allocation.ts`, a script in the engine's own repository. The `bench/` folder is not part of the published engine package.
- docs/api/wind.md:372 is the worst case. It tells the reader to "Run `bun run bench:allocation --wind`", which fails in a user's project.
- docs/api/controls.md:106 names a test file of the engine's repository (`tests/image/controls.spec.ts`). A user has no such file.
- The finding misses one page. docs/api/reference/scene.md:492 has the same sentence (`bun run bench:allocation --time-of-day` checks that). That page is generated. Its source is the TSDoc comment of `timeOfDay` in packages/engine/src/scene/time-of-day.ts:207-208.
- Other pages frame such commands as the repository's own: docs/guides/performance.md:13 ("which the engine's repository runs with `bun run bench:run`") and docs/guides/start-time.md:320 ("The engine's repository times the engine's own start with `bun run bench:startup`"). The API pages give no such framing, so a reader can take the command as one to run.
- AGENTS.md:231 says to write for developers who use the engine, and to name the engine's benchmarks when a page cites a figure. Notes for maintainers belong in code comments, AGENTS.md or `.dev/`. So the sentence "The engine's allocation benchmark checks it" fits the rule. A bare command line for contributors does not.
- The third option of the proposed edit is wrong. A `<details>` block is for dense detail that helps developers who use the engine. A command that only contributors can run is a maintainer note, and AGENTS.md:231 puts those outside docs/. Hiding it in a collapsed block does not change who it is for.

## Corrected claim

The claim holds for all ten cited lines. It also holds for docs/api/reference/scene.md:492, whose source is the TSDoc of `timeOfDay` in packages/engine/src/scene/time-of-day.ts:207-208. The `<details>` option in the proposed edit would break the rule that maintainer notes stay out of the published docs.

## Corrected edit

- Replace each "`bun run bench:allocation --<x>` checks it" with "The engine's allocation benchmark checks it in every frame." Do not use a `<details>` block for the command.
- docs/api/controls.md:106: "`update` allocates nothing. The engine's tests check it through every gesture, and its allocation benchmark checks it in every frame."
- docs/api/wind.md:372: replace "Run `bun run bench:allocation --wind` to see the bytes that the add-on's code allocates in a frame." with "The engine's allocation benchmark measures the bytes that the add-on's code allocates in a frame." It can link [Write per-frame code that allocates nothing](../guides/performance.md#write-per-frame-code-that-allocates-nothing) for the reader's own code.
- docs/api/scene.md:549: "The engine's allocation benchmark measures both."
- Edit the TSDoc in packages/engine/src/scene/time-of-day.ts:207-208 the same way ("The engine's allocation benchmark checks that."), then regenerate docs/api/reference/scene.md.
