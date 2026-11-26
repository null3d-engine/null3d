# api-reference-readability-29

## Finding as given

- Page: api/reference/engine, api/reference/scene, api/reference/assets, api/reference/particles
- Anchor: Intro quote under the H1
- Category: example-placement
- Severity: low
- Claim: No reference page shows a working call. Only two comments hold an example, and both render broken. The intro quote links the concept page but does not say it holds the examples.
- Evidence: Code examples only in time-of-day.ts:211 and impostors load.ts:35. Intro: '> [Animation](../animation.md) explains these exports. The engine's doc comments make this page.'
- Proposed edit: Change the intro in referencePage to '[Animation](../animation.md) explains these exports, with examples.' Add a short @example to each page's main entry function once code fences render.
- Generated source: tools/lib/docs.ts

Verdict: survives

## Evidence

- The intro is one template for every reference page: `referencePage` in tools/lib/docs.ts:325-339 writes "> [title](../page.md) explains these exports. The engine's doc comments make this page." It does not say that the linked page holds examples.
- No source comment uses an `@example` tag (no match in packages/*/src). Only two doc comments hold a fenced code block: packages/engine/src/scene/time-of-day.ts (the `timeOfDay` comment, fence near line 211) and packages/impostors/src/load.ts.
- Both render broken. docs/api/reference/scene.md:492 shows the `timeOfDay` example run into the paragraph as "```ts const day = emptyTimeOfDay(); timeOfDay(...); ...```" on one line. docs/api/reference/impostors.md:317 has the same fault. The cause is `summaryOf` in tools/lib/api-docs.ts:120-124, which flattens the whole comment onto one line.
- The other code fences on the four pages are signature blocks (for example engine.md:50-52 `createEngine`, particles.md:15-17 `createParticles`), not calls.
- Every concept page that has a reference page holds code fences (each docs/api/<page>.md has at least two). So "with examples" is true for every page the template writes.

## Notes on the edit

The claim holds. Two details sharpen the edit:

1. Scope: the intro change in `referencePage` fixes every generated reference page, not only the four named.
2. Source for the second part: the comment parser is tools/lib/api-docs.ts, not docs.ts. `@example` is not one of the tags it knows (`DOC_TAGS`, api-docs.ts:99: category, internal, param, returns). An unknown tag is read back into the summary and flattened, so a new `@example` would render broken as well. The parser must first keep code fences (or render an `@example` tag as its own fenced block). Then examples can go into the comments.
