# api-reference-substance-06

## Finding as given

- page: api/reference/engine, api/reference/scene
- anchor: engine.md:618 '(D-174)'; scene.md:492 '`bun run bench:allocation --time-of-day` checks that.'
- category: internal-note
- severity: high
- claim: A decision record number and a command of the engine's own repository reach the user docs. A user cannot run the engine's benchmarks in a project. The written pages repeat the pattern, and api/controls.md:106 even names tests/image/controls.spec.ts.
- evidence: packages/engine/src/page/capabilities.ts:115; packages/engine/src/scene/time-of-day.ts:207-208. Written pages: api/geometry.md:204, api/raycast.md:23, api/controls.md:106, api/scene.md:341 and :462. AGENTS.md 'Writing docs' forbids decision records and where-a-fact-came-from notes.
- proposedEdit: Delete '(D-174)'. Replace the benchmark sentence with 'The call allocates nothing, so a sketch can move the time in every frame.' Make the same cut on the written pages, and add D-[0-9]+, bench: and tests/ to the docs style check for docs/ and public TSDoc.
- generatedSource: packages/engine/src/page/capabilities.ts, packages/engine/src/scene/time-of-day.ts

Verdict: partly

## Evidence

- The decision record part holds. docs/api/reference/engine.md:618 ends the `directDraws` row with "(D-174)". It comes from the TSDoc at packages/engine/src/page/capabilities.ts:115. A reader cannot look the number up, and AGENTS.md "Writing docs" tells writers never to explain where a fact came from in internal terms.
- The same leak is on two more generated pages that the finding does not name: docs/guides/first-use-shaders.md:31 "(D-206)", from tools/lib/first-use-docs.ts:25, and docs/shaders/library.md:608 "(D-79)", from crates/null3d-shaders/wgsl/lib/lighting.wgsl:19.
- The docs style check does not catch these today. tools/lib/docs-style.ts:147-158 defines the decision record pattern and `internalReferences`, but only `checkSubject` (line 491) uses it, for commit subjects. So the proposed style check for D-numbers is right, and can reuse that pattern.
- The benchmark part does not hold as a rule break. AGENTS.md "Writing docs" says: "Name the engine's benchmarks when you cite a figure." docs/guides/performance.md:13 names `bun run bench:run` as "the engine's repository" command on purpose. The repository is public, and the docs link to it. A sentence that names the benchmark behind "allocates nothing" is a sourced claim, not an internal note. Cutting it is a matter of taste.
- The proposed style check for `bench:` would break the rule above. It would block correct lines in docs/guides/performance.md and docs/guides/start-time.md, and nine pages in all hold `bench:`.
- `tests/image/controls.spec.ts` at docs/api/controls.md:106 is a test file path, not a benchmark. It tells a user nothing they can act on. Cutting it is reasonable polish. A blanket `tests/` ban is too wide to propose without checking each hit.
- Severity: "(D-174)" is noise. It does not mislead a reader or block a newcomer. Medium at most, not high.

## Corrected claim

Decision record numbers reach the user docs on three generated pages: api/reference/engine.md:618 (D-174), guides/first-use-shaders.md:31 (D-206) and shaders/library.md:608 (D-79). The docs style check matches decision record numbers only in commit subjects. The benchmark commands that back "allocates nothing" are allowed by the rule that says to name the engine's benchmarks. Only the test file path at api/controls.md:106 is a real repository internal with no use to a reader. Severity medium.

## Corrected edit

- Delete "(D-174)" in packages/engine/src/page/capabilities.ts:115, "(D-206)" in tools/lib/first-use-docs.ts:25 and "(D-79)" in crates/null3d-shaders/wgsl/lib/lighting.wgsl:19 (the shader library source). Regenerate.
- In docs/api/controls.md:106, cut "`tests/image/controls.spec.ts` checks it through every gesture, and". Keep "`bun run bench:allocation --calls` samples it in every frame."
- Keep the `bench:allocation` sentences on scene.md, geometry.md, raycast.md and the reference pages.
- Make the docs style check apply the existing decision record pattern (`DECISION_RECORD_SOURCE` in tools/lib/docs-style.ts) to published docs and to public TSDoc. Do not add `bench:` or `tests/` to it.
