# Verdict: api-reference-readability-25

## Finding as given

- Page: api/reference/scene
- Anchor: `ChunkRowWriter`, line 115
- Category: unclear. Severity: medium.
- Claim: "Store each chunk once with [`write`], then call [`pack`]" renders with literal square brackets; the reference-style links have no target.
- Evidence: packages/engine/src/scene/chunk-rows.ts:64-65.
- Proposed edit: Write "Store each chunk once with `write`, then call `pack`" in the source; the cross-link pass can then link the members.
- Generated source: packages/engine/src/scene/chunk-rows.ts

Verdict: partly

## Evidence

- docs/api/reference/scene.md:115 holds "[`write`]" and "[`pack`]". The page has no `[write]:` or `[pack]:` link definitions, and no `](#` anchor links at all. In GitHub Flavored Markdown, a bracket with no matching definition renders as literal text, so the reader sees the square brackets.
- packages/engine/src/scene/chunk-rows.ts:64-65 is the TSDoc comment that the generator copies through as is.
- tools/gen-docs.ts and tools/lib/docs.ts have no step that turns this bracket form into links. tools/lib/links.ts only checks link targets. A search of tools/ for any cross-link, autolink or linkify step finds none.
- The same bracket form also appears in gpu/variants.ts:37, gpu/webgl2/programs.ts:543, shared/recording.ts:391 and scene/grading.ts:212. None of these reaches a published page, so this is the only place it affects readers.
- The members are rows in the page's member table, not headings, so no anchor exists to link to.

## Corrected claim

The claim holds: the page shows literal square brackets around `write` and `pack`. But the reason given for the edit is wrong. No cross-link pass exists in the docs generator, so plain backticks will stay plain code text and will not become links.

## Corrected edit

In packages/engine/src/scene/chunk-rows.ts:64-65, write "Store each chunk once with `write`, then call `pack` with one chosen count for each slot." Drop the clause about a cross-link pass. The two members are in the table directly below, so plain code text is enough.
