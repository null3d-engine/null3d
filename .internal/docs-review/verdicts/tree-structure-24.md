# tree-structure-24

## Finding as given

```json
{
 "page": "extend",
 "anchor": "(missing page)",
 "category": "missing-content",
 "severity": "low",
 "claim": "No page compares the ways to add drawing work, so an author cannot pick one without reading every page.",
 "evidence": "Separate pages for surface functions, custom effects, scene passes (api/render), vertex draws, feature draws, feature effects, instance draws and tasks; none links them in one table.",
 "proposedEdit": "NEW extend/index 'Choose an extension point': a table of what each does, which thread it runs on, its cost, and its page.",
 "generatedSource": "tools/lib/docs.ts (PAGES)",
 "id": "tree-structure-24",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

- The gap is real. No page has one table of the ways to add drawing work.
  - docs/api/features.md:11 has the nearest thing. One sentence maps the three feature kinds to `scene.addFeatureDraw`, `post.addFeatureEffect` and `render.addPass`. It does not cover surface functions, custom effects, scene passes, vertex draws or instance draws.
  - docs/guides/custom-passes.md:25 routes between custom effects, tone curves, scene passes and full-screen passes. It does not mention vertex draws, feature draws, feature effects or instance draws.
  - docs/guides/add-ons.md:155-160 (Related pages) calls custom-passes "the engine's public hooks for extra drawing". It does not link api/features, api/feature-draws, api/feature-effects, api/feature-instances, api/vertex-draws or api/tasks. So the add-on guide sends a reader to a page that covers only part of the hooks.
  - docs/guides/custom-shaders.md:145 names the vertex-count draw only in passing.
- The proposed place is wrong. There is no `extend` area. tools/lib/docs.ts:59-69 (AREAS) lists getting-started, concepts, api, guides, shaders, porting, cli, errors and cookbook. A new area for one page adds a nav section and a generator change for little gain.
- The proposed "which thread" column adds little. Every drawing hook here is GPU work that the engine records in the same place. Only tasks (api/tasks, `runTask`) run on the job workers, and tasks are CPU work, not drawing work (docs/pages.md, Tasks row). A more useful column is the GPU paths: for example, `scene.addComputeInstances` fills its count on the GPU only on WebGPU and falls back to a CPU-filled batch on WebGL2 (docs/pages.md, Add-on instance draws row).

## Corrected claim

No page compares the ways to add drawing work. The add-on guide's "Related pages" names only custom passes as the hooks for extra drawing, and it does not link the feature description, feature draw, feature effect, instance draw or vertex-count draw pages.

## Corrected edit

Do not add an `extend` area. Add a section "Choose a way to add drawing" near the top of guides/add-ons.md (hand-written; no PAGES change), or a new guide `guides/extension-points` with a PAGES entry in tools/lib/docs.ts. Give it one table with these columns: what you want to draw; the call; where in the frame it runs; GPU paths (WebGPU, WebGL2); the page. Rows: surface function (shaders/surface-functions), full custom material (guides/custom-shaders), custom effect (`post.addEffect`, guides/custom-passes), scene pass, full-screen pass and compute pass (`render.addPass`, api/render), vertex-count draw (`scene.createVertexDraw`, api/vertex-draws), feature draw (`scene.addFeatureDraw`, api/feature-draws), feature effect (`post.addFeatureEffect`, api/feature-effects), instance draw (`scene.addComputeInstances`, api/feature-instances). Put tasks (`runTask`, api/tasks) in one sentence below the table as the CPU side, not as a table row. Also add the missing links to the add-on guide's "Related pages". Severity stays low.
