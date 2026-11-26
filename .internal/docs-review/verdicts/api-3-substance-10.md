# api-3-substance-10

## Finding as given

```json
{
 "page": "api/raycast,api/scene,api/wind",
 "anchor": "raycast line 23, scene lines 246, 341, 462, 549, wind line 372: \"`bun run bench:allocation --calls` checks it.\"",
 "category": "internal-note",
 "severity": "medium",
 "claim": "The pages tell users to run a benchmark script of the engine's own repository. A user's project has no such script, so these are maintainer test notes. The same appears in api/controls:106, api/debug:335, api/geometry:204, api/materials:526.",
 "evidence": "The lines above; AGENTS.md Writing docs: notes for maintainers belong in code comments or .dev guides.",
 "proposedEdit": "Delete each \"`bun run bench:allocation ...` checks it.\" sentence and keep \"allocates nothing\". Where the measure matters write \"The engine's allocation benchmark checks it.\" In wind:372 write \"The add-on's code allocates nothing in a frame.\"",
 "generatedSource": "",
 "id": "api-3-substance-10",
 "slice": "api-3",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- Every cited line exists and names the repository script: raycast:23, scene:246, 341, 462, 549, wind:372, controls:106, debug:335, geometry:204, materials:526.
- The script is a repository script (package.json:57, `bun bench/allocation.ts`), listed in AGENTS.md's maintainer command table. A user's project does not have it.
- AGENTS.md "Writing docs" says notes for maintainers belong in code comments, AGENTS.md or `.dev/`. It allows naming the engine's benchmarks only when the page cites a figure. None of these lines cites a figure.
- The docs already have a correct form: docs/guides/start-time.md:320 says "The engine's repository times the engine's own start with `bun run bench:startup`". So the finding's "The engine's allocation benchmark checks it." fits the house style.

## What does not hold

1. The quote in the anchor is the raycast wording only. Other lines use other flags: scene:246 `--sky` and `--atmosphere`, scene:341 `--environment`, scene:462 `--fog` (after a semicolon), scene:549 `--time-of-day` "measures both", materials:526 `--setters`. wind:372 is an instruction: "Run `bun run bench:allocation --wind` to see the bytes...". controls:106 also names a repository test file, `tests/image/controls.spec.ts`. The fixer must match each sentence, not one string.
2. The finding misses a generated page. docs/api/reference/scene.md:492 has "`bun run bench:allocation --time-of-day` checks that." Its source is the TSDoc of `timeOfDay` in packages/engine/src/scene/time-of-day.ts:208.
3. The wind rewrite claims more than the page does. wind:372 says the add-on "makes no object of its own in a frame", and the benchmark sentence talks about "the bytes that the add-on's code allocates". "The add-on's code allocates nothing in a frame" is a stronger claim. The first sentence already says what is true, so delete the benchmark sentence only.
4. scene:549 does not say "allocates nothing". It says the browser still boxes some fractions. Delete "`bun run bench:allocation --time-of-day` measures both." and keep the sentence before it.

## Corrected claim

Ten handwritten places and one generated place name the repository's allocation benchmark script (and controls:106 also a repository test file) as the check, or tell the reader to run it. A user's project has neither. Places: raycast:23; scene:246, 341, 462, 549; wind:372; controls:106; debug:335; geometry:204; materials:526; and api/reference/scene.md:492, generated from the `timeOfDay` TSDoc in packages/engine/src/scene/time-of-day.ts:208.

## Corrected edit

- raycast:23, geometry:204, debug:335, scene:246, scene:341, scene:462, materials:526: delete the script sentence (in scene:462, the clause after the semicolon; keep "the volumetric fog included" only if moved into the main sentence). Keep the "allocates nothing" sentence. Where a page wants the proof, write "The engine's allocation benchmark checks it."
- controls:106: write "`update` allocates nothing, in every gesture." Drop the test file and the script.
- scene:549: delete "`bun run bench:allocation --time-of-day` measures both."
- wind:372: delete the last sentence. Keep "The add-on makes no object of its own in a frame".
- packages/engine/src/scene/time-of-day.ts:208 (TSDoc of `timeOfDay`): delete "`bun run bench:allocation --time-of-day` checks that." Then regenerate api/reference/scene.md.
