# api-1-readability-21

## Finding as given

```json
{
 "page": "api/controls, api/debug, api/geometry",
 "anchor": "controls.md:106; debug.md:335; geometry.md:204",
 "category": "internal-note",
 "severity": "medium",
 "claim": "The docs point at a repo test file and a repo bench script. A developer who installed the packages cannot run them. They read as maintainer notes inside lists of user-facing facts.",
 "evidence": "controls.md:106 says '`tests/image/controls.spec.ts` checks it through every gesture, and `bun run bench:allocation --calls` samples it in every frame.' debug.md:335 and geometry.md:204 end with '`bun run bench:allocation --calls` checks it.'",
 "proposedEdit": "Cut the file path and the command, and keep the fact, for example 'update allocates nothing, so you can call it in every frame.' If the proof matters, put it in <details><summary>Technical details: how the engine checks this</summary> and name the engine's allocation benchmark without a repo path.",
 "generatedSource": "",
 "id": "api-1-readability-21",
 "slice": "api-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The quotes are right: docs/api/controls.md:106, docs/api/debug.md:335 and docs/api/geometry.md:204 say what the finding says. These three pages are hand-written, so the edit goes in the page.
- The test path holds as a maintainer note. `tests/image/controls.spec.ts` is a file in the engine's repository. It is not an API fact, and a reader cannot use it. This part survives.
- The benchmark part goes too far. AGENTS.md, "Writing docs", says "Name the engine's benchmarks when you cite a figure." Naming the benchmark is allowed. The script is real: the root package.json:57 defines `bench:allocation`, and bench/allocation.ts:92 says `--calls` makes "the calls whose docs promise no allocation". The real fault is narrower. The guides introduce such commands as the repository's own: docs/guides/performance.md:13 ("which the engine's repository runs with `bun run bench:run`") and docs/guides/start-time.md:320 ("The engine's repository times the engine's own start with `bun run bench:startup`"). The API pages give the bare command, so a reader may try it in their own project, where no such script exists.
- The finding misses most of the pages with the same pattern. A cross-page finding must name every page. The others are:
  - docs/api/raycast.md:23
  - docs/api/scene.md:246, 341, 462, 549
  - docs/api/materials.md:526 (`--setters`)
  - docs/api/wind.md:372 ("Run `bun run bench:allocation --wind` to see...", which speaks to the reader directly and is the worst case)
  - docs/api/reference/scene.md:492, generated from the TSDoc of `timeOfDay` in packages/engine/src/scene/time-of-day.ts:208
- "generatedSource" is empty, but the generated mention needs that TSDoc source.

## Corrected claim

The image test's file path in controls.md:106 is a maintainer note and should go. The writing rules allow the allocation benchmark mentions. On the API pages they are bare commands that do not say they run in the engine's repository, so a reader may try them in their own project. The same pattern is on raycast.md:23, scene.md:246/341/462/549, materials.md:526, wind.md:372 and the generated reference/scene.md:492 (source: the TSDoc in packages/engine/src/scene/time-of-day.ts:208). Medium severity is too high for the benchmark lines. Low fits better. Only wind.md:372, which tells the reader to run the command, is closer to medium.

## Corrected edit

- controls.md:106: cut the test path. Write: "`update` allocates nothing, so you can call it in every frame. The engine's allocation benchmark checks this in every frame and through every gesture."
- Keep the benchmark on every page, as the rule asks, and frame it the way the guides do. One way, used the same on every page: "The engine's repository checks this with its allocation benchmark, `bun run bench:allocation --calls`." The flag can also go in a closed block, which keeps the main text short:

  <details>
  <summary>Technical details: how the engine checks this</summary>

  The engine's repository runs `bun run bench:allocation --calls`, which makes these calls in every frame and counts the bytes they allocate.

  </details>

- wind.md:372: change "Run `bun run bench:allocation --wind` to see..." to "The engine's repository measures the bytes with `bun run bench:allocation --wind`."
- reference/scene.md:492: make the same change in the TSDoc at packages/engine/src/scene/time-of-day.ts:208.
- Do not cut the benchmark completely. That breaks the rule to name the engine's benchmarks.
