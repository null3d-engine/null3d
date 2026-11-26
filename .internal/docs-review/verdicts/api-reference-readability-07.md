# api-reference-readability-07

## Finding as given

- Page: api/reference/engine, api/reference/scene
- Anchor: engine line 618 `WebGPUReport.directDraws`; scene line 492 `timeOfDay`
- Category: internal-note. Severity: high.
- Claim: A decision record number and a maintainer benchmark command appear in user docs. AGENTS.md forbids decision record numbers in docs, and users cannot run the repository's benchmark.
- Evidence: engine line 618: 'whose validation of each indirect draw the direct path removes (D-174).' Source packages/engine/src/page/capabilities.ts:115. scene line 492: '`bun run bench:allocation --time-of-day` checks that.' Source packages/engine/src/scene/time-of-day.ts:207-208.
- Proposed edit: Delete '(D-174)' in capabilities.ts:115. Delete the benchmark sentence in time-of-day.ts and keep 'a day cycle then allocates nothing, so a sketch can move the time in every frame.' Consider making the docs style check block D-\d{3} in generated pages.
- Generated source: packages/engine/src/page/capabilities.ts

## Verdict: partly

## Evidence

The decision record half holds.
- docs/api/reference/engine.md:618 ends with "(D-174)". It comes from the TSDoc of `directDraws` in packages/engine/src/page/capabilities.ts:111-116. A reader cannot look the record up, because public docs never link to `.dev/`.
- The docs style check does not catch it. tools/lib/docs-style.ts:147-159 defines the pattern for decision records (`\bD-\d+\b`) inside the internal reference check. But that check runs only on commit subjects (docs-style.ts:491). No page check uses it.
- The finding misses a second case. docs/porting/threejs-mapping.md:255 says "did not pass (D-206)". Its source is a "notes" field in docs/data/threejs-mapping.json (near line 1762). The same fix applies there.

The benchmark half does not hold as an internal note.
- Naming the benchmark that checks a claim is a pattern used across the docs on purpose. Examples: docs/api/geometry.md:204 ("`bun run bench:allocation --calls` checks it."), docs/api/controls.md:106, docs/api/scene.md:341 and 549, docs/api/debug.md:335, docs/api/raycast.md:23 and docs/guides/start-time.md:320.
- The Writing docs rules in AGENTS.md say "Name the engine's benchmarks when you cite a figure". `bun run` is the required way to write commands. No rule bans a benchmark command in user docs.
- If this one sentence goes, the timeOfDay entry no longer matches the other pages. The claim that the call allocates nothing then has no named check. At most, a reader may not know that the command runs in a clone of the engine's repository, not in their own project. That is a low, cross-page wording issue. start-time.md:320 already handles it: "The engine's repository times the engine's own start with `bun run bench:startup`."

Severity: "high" is too strong. An unexplained "(D-174)" is noise, but it does not mislead a reader or block a newcomer. Medium suits it, because it breaks the rule against internal references.

## Corrected claim

Two user pages show decision record numbers that readers cannot look up. They are "(D-174)" on api/reference/engine (`WebGPUReport.directDraws`, from packages/engine/src/page/capabilities.ts:115) and "(D-206)" on porting/threejs-mapping (from docs/data/threejs-mapping.json). The docs style check has the pattern but runs it only on commit subjects. The benchmark command in the `timeOfDay` entry follows the docs' own pattern and is not an internal note.

## Corrected edit

1. In packages/engine/src/page/capabilities.ts:115, delete " (D-174)". The sentence still reads correctly.
2. In docs/data/threejs-mapping.json, delete " (D-206)" from the FXAA/SMAA note (the line that renders as docs/porting/threejs-mapping.md:255).
3. In tools/lib/docs-style.ts, run `internalReferences` (or at least the decision record pattern) on the prose of user pages, generated pages included, as it already runs on commit subjects.
4. Keep the `timeOfDay` benchmark sentence. If the wording changes, change it on every page that cites a benchmark the same way. The form in start-time.md:320 makes clear that the check runs in the engine's repository, for example: "The engine's repository checks that with `bun run bench:allocation --time-of-day`."
