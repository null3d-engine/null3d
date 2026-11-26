# tree-structure-30

## Finding as given

```json
{
 "page": "concepts/backends",
 "anchor": "# GPU tiers and backends",
 "category": "unclear",
 "severity": "low",
 "claim": "The page title uses three names (tier, backend, path) for one idea, while the pages say 'GPU path' most often.",
 "evidence": "Title 'GPU tiers and backends'; pages use 'GPU path' (e.g. 'Highest preset of each GPU path', 'both GPU paths').",
 "proposedEdit": "Retitle 'GPU paths and tiers' in PAGES and front matter; keep the ID concepts/backends.",
 "generatedSource": "tools/lib/docs.ts (PAGES title)",
 "id": "tree-structure-30",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

- The title has two names, not three: "GPU tiers and backends" (docs/concepts/backends.md:3 and :9; tools/lib/docs.ts:95). "Path" is not in the title.
- Across all docs, "GPU path(s)" appears 251 times and "GPU tier(s)" 45 times. So the docs as a whole do favour "GPU path". That part holds.
- On this page, "tier" is the main word: 22 uses, and five headings use it ("The three tiers", "Quality presets on each tier", "Color and anti-aliasing on each tier", "Depth on each tier", "Choosing a tier for testing"). "GPU path" appears only twice on the page.
- The API also uses "tier": the exported type `Tier` (packages/engine/src/index.ts:430) and the field `engine.capabilities.tier`. docs/api/engine.md:155 already maps the two words: "gives the GPU path (`tier`)".
- On this page, "path" also means other things: "the 8-bit path" (3 times), "a direct-draw path", and the HDR path in the colour section. A title that says "GPU paths" adds one more meaning of "path" to the page that already uses it most loosely.
- About 20 pages link to this page with the link text "GPU tiers and backends" (for example index.md:14 and :39, getting-started/hosting.md:399, guides/phones.md:117, concepts/culling.md:42 and :223, api/engine.md:96, :103 and :155). The proposed edit changes only the PAGES title and front matter, so those link texts would no longer match the title.

## Corrected claim

The docs use two names for one idea: most pages say "GPU path", but this page and the API say "tier" (`Tier`, `engine.capabilities.tier`). This page never says that the two words mean the same thing. The title has two names (tier, backend), not three.

## Corrected edit

Keep the title "GPU tiers and backends", because it matches the API's `Tier` name, this page's five headings and the 20 link texts. Instead, add one sentence to the opening paragraph of docs/concepts/backends.md: "Other pages call the tier the GPU path. `engine.capabilities.tier` says which one the engine started on." A retitle is a matter of taste. If one is done, it must also change the link text on every page that links here.
