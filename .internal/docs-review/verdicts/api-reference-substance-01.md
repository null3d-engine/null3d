# api-reference-substance-01

## Finding as given

- Pages: every docs/api/reference/*.md page (39 pages)
- Anchor: every `## <name>` heading
- Category: missing-content. Severity: high.
- Claim: No page says which package or entry point an export comes from, so a reader cannot write the import. Geometry mixes 30 engine exports with 38 @null3d/geometry exports in one alphabetical list. The particles page, titled '(@null3d/particles)', holds 13 engine exports. Subpath entries (@null3d/engine/stats, @null3d/engine/math, @null3d/sound/page, @null3d/grass/hash) are never named.
- Evidence: @category counts; tools/lib/api-docs.ts:22-39, :51, :486-503; package.json export maps.
- Proposed edit: Add an entry (import specifier) field to ApiSymbol in readApi from the ApiPackage that exported it. In renderSymbol print 'Import from `@null3d/geometry`.' under each heading, and group the page by import specifier.
- Generated source: tools/lib/api-docs.ts

Verdict: partly

## Evidence

What holds:
- No reference page prints an import source. `renderSymbol` (tools/lib/api-docs.ts:486-503) prints the heading, the signature or "Class X", the summary and the member table. Nothing else.
- `ApiSymbol` (api-docs.ts:51-63) has no entry field. `ApiPackage` (api-docs.ts:10-15) holds only file paths, not an import specifier.
- The counts are right: `@category api/geometry` appears 30 times in packages/engine/src and 38 times in packages/geometry/src. `@category api/particles` appears 13 times in packages/engine/src and 10 times in packages/particles/src. docs/api/reference/geometry.md has 68 `##` headings in one name-sorted list (sorted at api-docs.ts:471).
- The particles reference page is titled "Particles (@null3d/particles)", but `ParticleBuffer`, `ParticleLook` and the other engine exports on it are not exported by packages/particles/src/index.ts (lines 9-18 export only 10 names). A reader who imports them from @null3d/particles gets an error.

What does not hold:
- "Subpath entries are never named" is false for the docs as a whole. The explainer pages name them with import lines: docs/api/debug.md:358 (`@null3d/engine/stats`), docs/api/math.md:117-118 (`@null3d/engine/math`, `@null3d/engine/math/quat`), docs/api/sound.md:61 (`@null3d/sound/page`), docs/api/grass.md:104 (`@null3d/grass/hash`). They are missing only from the reference pages.
- "A reader cannot write the import" overstates it. Every reference page opens with a link to its explainer page, and 37 of the 39 explainer pages have at least one `from '@null3d/...'` import line (animation and input have none, but their exports are used through the sketch context). The gap is real for exports that the explainer page does not show in code, and for mixed pages such as geometry and particles. That makes the page harder to use, not a blocker: medium, not high.

Problems with the proposed edit:
- One export can come from more than one entry. readApi lists a shared export once (api-docs.ts:417-422, "An export that two entry points share ... goes into the reference once"). Example: `FrameStats` is exported by both packages/engine/src/index.ts:11 and packages/engine/src/stats.ts. A single "entry from the ApiPackage that exported it" keeps only the first package and hides the other path. The field must be a list.
- `ApiPackage` has no import specifier, only `entry` and `source` paths. The edit needs a new `specifier` field on each `API_PACKAGES` row (such as `'@null3d/engine/stats'`), not a path-derived guess.
- Grouping the page by import specifier breaks the single name-sorted list that a reader scans, and it splits closely related types (for example `ParticleSystemOptions` in @null3d/particles and `ParticleLook`, which it uses, in @null3d/engine). One line under each heading is enough. Grouping is optional and a matter of taste.

## Corrected claim

The API reference pages never say which package or entry point an export comes from. The explainer pages show import lines, subpaths included, but only for the exports their examples use. Pages that mix packages are the worst case: geometry (30 engine exports and 38 @null3d/geometry exports in one list) and particles (titled "@null3d/particles" but 13 of its 23 exports come from @null3d/engine). Severity: medium.

## Corrected edit

In tools/lib/api-docs.ts:
1. Add `specifier: string` to `ApiPackage` and set it on every `API_PACKAGES` row (`'@null3d/engine'`, `'@null3d/engine/stats'`, `'@null3d/engine/math'`, `'@null3d/sound/page'`, `'@null3d/grass/hash'`, and so on).
2. Add `imports: string[]` to `ApiSymbol`. In readApi, keep each export's package specifier, and when a later entry exports a symbol already listed, add its specifier to that symbol's list instead of dropping it.
3. In `renderSymbol`, print one line under the heading, after the signature or kind line: "Import from `@null3d/geometry`." (or "Import from `@null3d/engine` or `@null3d/engine/stats`." for a shared export).
4. Keep the single name-sorted list. Do not group the page by specifier.
