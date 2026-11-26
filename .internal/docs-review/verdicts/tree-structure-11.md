# tree-structure-11

## Finding as given

- page: guides/custom-shaders, shaders/wgsl-rules
- anchor: ## Shaders (pages.md)
- category: structure
- severity: medium
- claim: The shaders area has no entry page. It opens with 'WGSL rules for portable shaders', a list of limits, while the tutorial sits in Guides.
- evidence: PAGES shaders order: wgsl-rules, surface-functions, builtins, library. guides/custom-shaders summary: 'WGSL in sketch code; shader errors; surface functions; full shaders'.
- proposedEdit: Move guides/custom-shaders -> shaders/custom-shaders as the area's first page. Order: custom-shaders, surface-functions, builtins, library, wgsl-rules.
- generatedSource: tools/lib/docs.ts (PAGES)

## Verdict: partly

## Evidence

- The claim about order is true. tools/lib/docs.ts:175-178 lists the shaders area as wgsl-rules, surface-functions, builtins, library, and docs/pages.md shows the "Shaders" table in that order. The first page a reader meets in the area is a page of rules and limits.
- The claim that the start page sits in Guides is true. tools/lib/docs.ts:152 puts guides/custom-shaders in Guides. Its opening (docs/guides/custom-shaders.md:9-22) is the natural start: one WGSL source, the Vite plugin, then custom materials and full shaders.
- The reader is not stranded. The banner of docs/shaders/wgsl-rules.md:11 links to surface functions and to full shaders in the guide. Every shaders page links back to the guide in its first sections or its related pages (builtins.md:13 and :128, surface-functions.md:40-41, library.md:1372, wgsl-rules.md:15 and :126). So the cost is a weak first step, not a dead end. Medium is high; low-to-medium fits better.
- The proposed move costs more than it fixes. The page id guides/custom-shaders appears in 28 files: 16 docs pages, docs/data/threejs-mapping.json, 7 skill files (skills/null3d-develop/SKILL.md, references/shaders.md, references/api-quickref.md, references/testing-and-debugging.md, and three files in skills/null3d-port-threejs/references), packages/vite-plugin/README.md, tools/lib/shader-library.ts and tools/lib/docs.ts. A move also breaks any published link to the old URL. The guide also covers the build pipeline, hot reload and TypeScript types, which is task material that fits the Guides area beside guides/custom-passes.
- Most of the gain comes from the reorder alone. docs/shaders/surface-functions.md:13 opens with a plain definition and a working example, which makes it a good first page for the area. wgsl-rules is reference for later, so it belongs last.

## Corrected claim

The shaders area opens with the WGSL rules page, a page of limits, so a reader who enters the area there meets constraints before any working example. The start page for shader work is guides/custom-shaders in Guides. Each shaders page links to it, so the reader can find the start, but the area's own order is backwards.

## Corrected edit

In tools/lib/docs.ts PAGES (lines 175-178), reorder the shaders area to: shaders/surface-functions, shaders/builtins, shaders/library, shaders/wgsl-rules. Keep guides/custom-shaders where it is. In docs/shaders/surface-functions.md, give the opening paragraph one sentence that sends a new reader to [Custom shaders](../guides/custom-shaders.md) for how the Vite plugin compiles WGSL and for full shaders. Do not move the page, because a move changes its id in 28 files and breaks its published URL.
