# api-1-substance-30

## Finding as given

- page: api/engine
- anchor: ## Memory, line 149
- category: wrong-claim
- severity: low
- claim: "'1024 MiB holds about 5 million rows with the rest of the scene' leaves no room: 5,000,000 rows at about 210 bytes take about 1,001 MiB, so about 23 MiB remain for everything else."
- evidence: docs/api/engine.md:149 (arithmetic from the page's own figures).
- proposedEdit: "'so instance rows alone fill 1024 MiB at about 5 million. Leave room for the rest of the scene, or ask for a larger maximum.'"
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/api/engine.md:149 says: "Each instance row takes about 210 bytes of engine memory, so 1024 MiB holds about 5 million rows with the rest of the scene."
- Arithmetic: 5,000,000 x 210 B = 1,050,000,000 B = 1,001.4 MiB. 1024 MiB leaves about 23 MiB for meshes, textures copies, object tables and the rest of the scene.
- It is tighter than that. The E1109 text (packages/engine/src/errors/codes.ts:84) says the engine keeps the last 8 MiB under the limit for its own small requests. So about 15 MiB remain, which a scene with any real meshes passes. E1109 also says the first frame copies every mesh, which needs more room again.
- The 210-byte figure looks like a measured, all-in figure. The core's own per-row count (crates/null3d-core/src/instances.rs:535, `row_bytes`) is (10 inputs + 1 cell + 2 x 16 world floats) x 4 = 172 bytes, and a decision record measures a million instances at a 246 MiB memory. So I cannot argue that 210 overstates the cost enough to rescue "with the rest of the scene".
- The page does not handle this elsewhere: the Memory section gives no other room budget.
- The proposed edit keeps the useful number, adds a clear action, and breaks no writing rule. It does not lengthen the paragraph much (the paragraph is already listed in stats.json as 93 words, 6 sentences; that is a separate finding).

## Related places with the same figure (not part of this finding)

- packages/engine/src/errors/codes.ts:84 (E1109 page): "So about 5 million rows fill 1 GiB, along with the rest of the scene." This reads as "rows and the rest together fill 1 GiB", which is looser but still implies 5 million is reachable with a scene. Worth the same fix for consistency.
- docs/concepts/backends.md:146 and docs/guides/performance.md:163: "holds about 5 million (instance) rows". These say nothing about the rest of the scene, so they are less wrong, but a reader may take 5 million as a usable budget.

## Corrected edit

The proposed edit stands. Optional wording that keeps the sentence count the same:

"Each instance row takes about 210 bytes of engine memory, so rows alone fill 1024 MiB at about 5 million. Leave room for the meshes and the rest of the scene, or ask for a larger maximum."
