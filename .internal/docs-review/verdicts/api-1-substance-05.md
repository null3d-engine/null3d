# Verdict: api-1-substance-05

## Finding as given

```json
{
 "page": "api/controls,api/debug,api/geometry,api/engine",
 "anchor": "controls ## Each frame line 106; debug ### Cost line 335; geometry ## Vertices that change line 204; engine E1402 row line 70",
 "category": "internal-note",
 "severity": "medium",
 "claim": "The pages cite the engine repository's own tests and maintainer commands (tests/image/controls.spec.ts, bun run bench:allocation --calls) that users cannot run. The engine page has a maintainer note about null3D's own dev server checking the checkout's Rust sources.",
 "evidence": "docs/api/controls.md:106; docs/api/debug.md:335; docs/api/geometry.md:204; docs/api/engine.md:70.",
 "proposedEdit": "Keep the fact without the process, such as 'update allocates nothing, so a call in every frame makes no garbage.' Delete the test file and bench names. Delete the last sentence of the E1402 row.",
 "generatedSource": "",
 "id": "api-1-substance-05",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

All four cited lines say what the finding claims:

- docs/api/controls.md:106 names `tests/image/controls.spec.ts` and `bun run bench:allocation --calls`.
- docs/api/debug.md:335 ends with "`bun run bench:allocation --calls` checks it."
- docs/api/geometry.md:204 ends with "`bun run bench:allocation --calls` checks it."
- docs/api/engine.md:70, the E1402 row, ends with "On null3D's own dev server, they also check that the core was built from the checkout's Rust sources."

`bench:allocation` is a script in the repository's root package.json (line 57, `bun bench/allocation.ts`). It is not in any published package, so an engine user cannot run it. The E1402 check applies only when the engine is served from a checkout of the engine repository, which is maintainer work. The edit keeps the useful fact (no allocation, safe to call every frame) and drops only the process. A collapsible details block is not right here: a test file name or a maintainer command does not help an implementer who uses the engine.

What does not hold: the finding names four pages, but the same issue is on more pages. A cross-page finding must name every page. Search of docs/ for `bench:allocation`, `tests/image/` and "own dev server":

- docs/api/raycast.md:23: "`bun run bench:allocation --calls` checks it."
- docs/api/wind.md:372: "Run `bun run bench:allocation --wind` to see the bytes ..."
- docs/api/materials.md:526: "`bun run bench:allocation --setters` checks ..."
- docs/api/scene.md:246 (`--sky` and `--atmosphere`), 341 (`--environment`), 462 (`--fog`), 549 (`--time-of-day`).
- docs/api/reference/scene.md:492 (generated): source is the TSDoc in packages/engine/src/scene/time-of-day.ts:207-208.
- The E1402 dev-server note is also on docs/errors/E1402.md:6 and :13, docs/errors/index.md:55 and docs/pages.md:197. All are generated from the E1402 summary in packages/engine/src/errors/codes.ts:322.

## Corrected claim

Hand-written API pages cite the engine repository's allocation bench and its own tests, which users cannot run: api/controls (106), api/debug (335), api/geometry (204), api/raycast (23), api/wind (372), api/materials (526), api/scene (246, 341, 462, 549). The generated api/reference/scene page (492) has the same note, from TSDoc in packages/engine/src/scene/time-of-day.ts. The E1402 maintainer note about null3D's own dev server checking the checkout's Rust sources is on api/engine (70), and, from packages/engine/src/errors/codes.ts:322, also on errors/E1402, errors/index and pages.

## Corrected edit

- controls.md:106: replace the bullet with "`update` allocates nothing, so a call in every frame makes no garbage."
- debug.md:335, geometry.md:204, raycast.md:23: delete the sentence "`bun run bench:allocation --calls` checks it."
- materials.md:526, scene.md:246, 341, 549: delete the bench sentence and keep the fact before it. scene.md:462: end the sentence at "every frame", and if needed add "This includes the volumetric fog."
- wind.md:372: delete "Run `bun run bench:allocation --wind` ..."; keep the statement that the add-on makes no object of its own in a frame.
- packages/engine/src/scene/time-of-day.ts:207-208: delete "`bun run bench:allocation --time-of-day` checks that." (this fixes api/reference/scene.md).
- engine.md:70: delete the last sentence of the E1402 row.
- packages/engine/src/errors/codes.ts:322: delete the two sentences on null3D's own dev server and the checkout's Rust sources from the E1402 summary (this fixes errors/E1402, errors/index and pages).
