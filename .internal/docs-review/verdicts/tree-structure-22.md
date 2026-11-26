# tree-structure-22

## Finding as given

- page: concepts
- anchor: (missing page)
- category: term-before-definition
- severity: medium
- claim: The docs coin many terms, each defined on a different page, and some appear before their definition.
- evidence: Terms used across pages: sketch, sketch worker, GPU path, tier, preset check, frame-budget governor, hold mode (cookbook/index links it to guides/testing), row, scene pass, feature.
- proposedEdit: NEW concepts/glossary: one line per term with a link to the page that explains it. Link it from the docs home.
- generatedSource: tools/lib/docs.ts (PAGES)

## Verdict: partly

## Evidence

What holds:
- The terms are spread wide. Pages (outside api/reference and errors) that use each one: "sketch worker" 26, "GPU path" 73, "tier" 41, "preset check" 16, "frame-budget governor" 22, "hold mode" 36, "scene pass" 32. No glossary page exists in docs/ or in PAGES (tools/lib/docs.ts:80).
- "GPU path" has no definition anywhere. It is used as a synonym of "tier" and "backend" without saying so: getting-started/install.md:54, getting-started/first-scene.md:60 and :62, getting-started/hosting.md:284-297, concepts/architecture.md:39. concepts/backends.md (titled "GPU tiers and backends") uses "tier" and only once says "a GPU path" (line 21). So a reader of Getting started meets an undefined term before any page that would explain it.

What does not hold:
- "sketch" is defined on the docs home before any other page: docs/index.md:19 ("In null3D, a 3D scene is called a sketch ... It runs in a worker of its own"). That also covers "sketch worker" in install.md:50.
- Several listed terms are linked to their defining page at first use, which is the normal fix, not a defect. The finding's own example shows this: cookbook/index.md:19 links "hold mode" to guides/testing.md, where line 24 explains it and line 52 has its section. The governor is linked from concepts/architecture.md:66 and concepts/post-processing.md:420 to concepts/quality-presets.md#the-frame-budget-governor (section at :289). "preset check" has its own section at concepts/quality-presets.md:87.
- "row" and "feature" are plain words used in their plain meaning (concepts/instances.md, concepts/particle-buffer.md:56 explains rows). They are not coined terms.

Problem with the proposed edit:
- AGENTS.md "Writing docs" says: "A concept page opens with a Mermaid diagram and a plain explanation, followed by examples." A one-line-per-term list under concepts/ breaks that rule. The page fits better as getting-started/glossary (or a root page "glossary"), added to PAGES in tools/lib/docs.ts and linked from docs/index.md "Where to start".
- A glossary alone does not fix the real defect, the undefined "GPU path".

## Corrected claim

The coined terms spread over many pages, and the docs have no glossary. Most terms are defined on their owning page and linked at first use ("sketch" on the docs home, hold mode, preset check, frame-budget governor). The one real term-before-definition case is "GPU path": it appears in Getting started and in 70+ pages, but no page defines it or says it means the same as "tier" or "backend". "row" and "feature" are plain words, not coined terms.

## Corrected edit

1. In concepts/backends.md, near line 21, define the term once: "The engine draws on one GPU path: WebGPU (core or compatibility mode) or WebGL2. These docs call each path a tier." Or replace "GPU path" with "tier" across the written pages, so one word names one thing. In getting-started/first-scene.md:60 link the first "GPU path" to concepts/backends.md.
2. Optional, low severity: add a short glossary page as getting-started/glossary (not under concepts/, which must open with a Mermaid diagram). Add its entry to PAGES in tools/lib/docs.ts and a link in docs/index.md "Where to start". One line per term (sketch, sketch worker, tier or GPU path, quality preset, preset check, frame-budget governor, hold mode, scene pass, instance batch), each linked to the section that explains it. Leave out "row" and "feature".
