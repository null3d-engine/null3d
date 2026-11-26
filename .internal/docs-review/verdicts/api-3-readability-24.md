# api-3-readability-24

## Finding as given

```json
{
 "page": "api/scene,api/raycast,api/wind",
 "anchor": "scene lines 246, 341, 462, 549; raycast line 23; wind line 372",
 "category": "technical-details-block",
 "severity": "low",
 "claim": "Sentences such as 'bun run bench:allocation --sky and --atmosphere check it' interrupt the user text with repository scripts that a user's project cannot run. The fact the reader needs is that the call allocates nothing.",
 "evidence": "scene line 246; raycast line 23 'bun run bench:allocation --calls checks it.'",
 "proposedEdit": "Keep 'The call allocates nothing, so a sketch may call it in every frame.' Move the benchmark name into <details><summary>Technical details: how this is measured</summary> on each page, written as 'the engine's allocation benchmark'.",
 "generatedSource": "",
 "id": "api-3-readability-24",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The quoted sentences exist: docs/api/scene.md:246 (`--sky` and `--atmosphere`), :341 (`--environment`), :462 (`--fog`), :549 (`--time-of-day`), docs/api/raycast.md:23 (`--calls`), docs/api/wind.md:372 (`Run bun run bench:allocation --wind to see the bytes...`).
- The core claim holds. The script is only in the engine repository: package.json:57 `"bench:allocation": "bun bench/allocation.ts"`, file bench/allocation.ts. A user's project has no such script. wind.md:372 is the worst case: it tells the reader to "Run" it.
- The finding misses pages. The same bare command appears in docs/api/debug.md:335, docs/api/geometry.md:204, docs/api/controls.md:106 (which also names the repo test file tests/image/controls.spec.ts), docs/api/materials.md:526, and the generated docs/api/reference/scene.md:492. The last comes from the TSDoc at packages/engine/src/scene/time-of-day.ts:208. A cross-page finding must name every page and the generated source.
- The proposed edit is wrong in two ways:
  1. It drops the exact command for "the engine's allocation benchmark". That cuts the detail an implementer needs to reproduce the check, against the request to keep dense detail. AGENTS.md "Writing docs" also says "Name the engine's benchmarks when you cite a figure".
  2. The docs already have a house pattern for repository scripts. docs/guides/performance.md:13 says "which the engine's repository runs with `bun run bench:run`". docs/guides/start-time.md:320 says "The engine's repository times the engine's own start with `bun run bench:startup`". That pattern fixes the problem in place and keeps the command.
- The kept sentence "The call allocates nothing" does not fit every anchor. scene.md:549 and wind.md:372 say the browser can still box values, so "allocates nothing" would be false there.
- Putting a one-clause mention in its own block, as at scene 246/341/462 and raycast 23, costs more than it saves. Each block would hold one sentence.

## Corrected claim

On every page that names it (api/scene, api/raycast, api/wind, api/debug, api/geometry, api/controls, api/materials, and api/reference/scene through the TSDoc in packages/engine/src/scene/time-of-day.ts), the docs name the repository's allocation benchmark command bare. Some of them tell the reader to run it. A user's project cannot run it. Low severity.

## Corrected edit

- Short mentions (scene 246, 341, 462; raycast 23; debug 335; geometry 204): keep the fact and the command, and say whose script it is, as the guides do. For example: "The call allocates nothing, so a sketch can call it in every frame. The engine's repository checks this with `bun run bench:allocation --fog`." No block is needed.
- controls 106: do the same, and say "the engine's image tests" in place of the test file path.
- Dense implementation paragraphs (scene 549, wind 372, materials 526): keep the user-facing fact in the main text, such as "pass an object to fill, and a day cycle makes no settings object of its own". Move the boxing and worker detail, with the scoped benchmark command, into `<details><summary>Technical details: what still allocates</summary>`. In wind 372, change "Run `bun run bench:allocation --wind`" to "The engine's repository measures this with `bun run bench:allocation --wind`".
- reference/scene.md:492: make the same wording change in the TSDoc at packages/engine/src/scene/time-of-day.ts:208.
