# Verdict: api-reference-readability-10

## Finding as given

- Pages: api/reference/animation, cameras, engine, scene, geometry, materials
- Anchor: animation line 45 `play(..., options?: PlayOptions)`; cameras line 15 "which extends `Object3D`"; engine line 97 "(E1302"
- Category: structure. Severity: medium.
- Claim: Type names, base classes and error codes are plain text. Readers search by hand, often across pages, and the 364 error codes never link to their error pages.
- Evidence: 364 E1xxx mentions on reference pages, 0 links to docs/errors. Apart from the intro quote, only assets (lines 31-33) and engine (line 104) have a link, and scene line 115 has a broken one.
- Proposed edit: Link each code span naming an export to its section (same page or ../reference/<page>.md#anchor). Link each E\d{4} to ../../errors/E####.md. For signature cells, add the links after the code span, since links inside code spans do not work.
- Generated source: tools/lib/api-docs.ts

Verdict: partly

## Evidence

- The core claim holds. The reference pages have 364 mentions of error codes and no link into docs/errors (grep of `errors/` on docs/api/reference/*.md gives 0 on every page). Every mentioned code has a page: all 79 distinct codes exist in docs/errors/.
- Anchors check out: animation.md:45 is the `play` row with `PlayOptions` in plain code; cameras.md:15 is "Class `Camera`, which extends `Object3D`."; engine.md:97 has "(E1302)", "(E1404)" and "E1424" as plain text.
- The renderer is the right place. tools/lib/api-docs.ts `renderSymbol` (lines 486-501) writes the "which extends" clause from `symbol.extends` as bare code spans and writes member signatures and summaries with no link step. `readApi` already knows every symbol and its page, so a name-to-section map is cheap.
- Three parts of the claim are wrong or overstated:
  1. "364 error codes" is 364 mentions of 79 distinct codes.
  2. The link list misses scene.md:404, which links to `../features.md`.
  3. scene.md:115 is not a broken link. It is two TSDoc-style bracket references, [`write`] and [`pack`], that nothing resolves, so they show as literal brackets. The source is the TSDoc comment in packages/engine/src/scene/chunk-rows.ts:64. The renderer does not resolve them, so a fix goes either in that comment or in a reference-resolving step in tools/lib/api-docs.ts.
- Some of this is already handled elsewhere. Each reference page opens with a link to its concept page, and some concept pages have an error table with linked codes: engine.md has 39 error links, animation.md 6, geometry.md 5, materials.md 1. The cameras and scene concept pages have none, but the scene reference mentions 19 distinct codes. So a reader is sometimes one click from a linked code, but not on every page. The gap is real.
- The type-link half of the edit costs more. Putting a trail of links after every signature cell would clutter the busiest tables. On the engine page, for example, most rows name two or more types. Link the base classes in the "which extends" sentence, and link each export name the first time it shows up in prose summaries. Leave signature cells as they are.

## Corrected claim

On the reference pages, error codes (364 mentions of 79 distinct codes) and base classes are plain text, and no reference page links into docs/errors. Concept pages link some codes in their error tables, but the cameras and scene concept pages link none. scene.md:115 holds unresolved TSDoc bracket references ([`write`], [`pack`]), not a broken link. Its source is packages/engine/src/scene/chunk-rows.ts:64.

## Corrected edit

In tools/lib/api-docs.ts:
1. When rendering summaries, turn each bare E\d{4} into [E####](../../errors/E####.md). Skip codes inside code spans.
2. In `renderSymbol`, link each name in the "which extends" sentence to its section, on the same page or on ../reference/<page>.md#<slug>, using the symbol-to-page map that `readApi` builds.
3. In summary text, link the first mention of each export's code span to its section. Do not add link trails after signature cells.
4. Resolve TSDoc bracket references such as [`write`] to member links, or fail the generation on an unresolved one. Fix the comment at packages/engine/src/scene/chunk-rows.ts:64 in the same change.
