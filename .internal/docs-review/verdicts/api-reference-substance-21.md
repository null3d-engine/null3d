# Verdict: api-reference-substance-21

## Finding as given

- page: api/reference/water, api/reference/terrain, api/reference/particles, api/reference/impostors, api/reference/lights, api/reference/post, api/reference/geometry
- anchor: each page's header line
- category: missing-content
- severity: medium
- claim: No reference page links a demo, though most visual APIs have one (water/, terrain/, particles/, impostors/, area-lights/, post-effects/).
- evidence: Page statistics exampleLinks is empty for all 39 pages; tools/lib/docs.ts:325-338 renders only a link to the written page.
- proposedEdit: Read a TSDoc tag such as `@demo water/` (add it to DOC_TAGS) and render 'Demo: [Water](https://github.com/null3d-engine/null3d/tree/main/examples/water/)' under that export's heading. Start with each package's main make function.
- generatedSource: tools/lib/api-docs.ts, tools/lib/docs.ts

Verdict: partly

## Evidence

- The fact holds. The reference pages have no demo link. `referencePage` in tools/lib/docs.ts (about lines 323-338) writes only the front matter, the title and one line that links the written page. stats.json gives empty exampleLinks for api/reference/water and api/reference/lights.
- The demos exist. examples/demos.ts has code `water/` (line 425), `area-lights/` (714), `particles/` (690), `terrain/` (894), `impostors/` (973) and `post-effects/` (657).
- The finding aims at the wrong pages. Each reference page's first line links its written page, and the written page is where a reader looks for a demo:
  - docs/api/post.md lines 489-490 already link the post-effects and camera-lens demos.
  - docs/api/geometry.md lines 52, 85, 155, 178 and 206 already link five demos.
  - docs/api/impostors.md line 13 names the demo only as plain text ("in `examples/impostors`"), with no link.
  - docs/api/water.md, terrain.md, particles.md and lights.md do not mention a demo at all (stats.json exampleLinks is empty for all four, and a search for "demo" or "examples/" finds nothing).
  So for post and geometry, the gap is already handled one click away. For water, terrain, particles, lights and impostors, the real gap is on the written page, which the finding does not name.
- The proposed edit costs more than it gives. A new `@demo` tag means changes to DOC_TAGS and to the code that reads tags (tools/lib/api-docs.ts line 99 and `misreadTags`), and a demo link under each export of a lookup page. A reader who wants a demo starts from the written page, not from one export's entry.

## Corrected claim

Five written API pages give no demo link, though a demo exists for each: water (`water/`), terrain (`terrain/`), particles (`particles/`), lights (`area-lights/`), and impostors, which names `examples/impostors` only as plain text. The post and geometry written pages already link their demos. The generated reference pages link no demo, but they link the written page in their first line, so that part is low severity.

## Corrected edit

1. On docs/api/water.md, terrain.md, particles.md and lights.md, add one sentence near the top that links the demo, in the website contract format, for example: "The [water demo](https://github.com/null3d-engine/null3d/tree/main/examples/water/) draws a river that runs into a lake." Use `area-lights/` for lights.
2. On docs/api/impostors.md line 13, make "the demo Impostors" a link to https://github.com/null3d-engine/null3d/tree/main/examples/impostors/.
3. Optional, low: do not add a `@demo` tag. If reference pages need demos, let `referencePage` in tools/lib/docs.ts add the written page's demo links to its header line, from a field on the page's PAGES entry. That keeps one source for each page's demos.
