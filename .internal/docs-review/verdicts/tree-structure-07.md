# tree-structure-07

## Finding as given

```json
{
 "page": "api/*",
 "anchor": "## API reference (pages.md)",
 "category": "structure",
 "severity": "medium",
 "claim": "The 39 API pages need groups, and some sit in odd places: three-compat between geometry and materials, page (sketch-page messages) near the end, the add-on packages mixed with core calls.",
 "evidence": "PAGES api order: engine, sketch, scene, objects, cameras, lights, geometry, three-compat, materials, ... ui, page, tasks.",
 "proposedEdit": "Groups: Entry points (engine, sketch, page); Scene and objects (scene, objects, cameras, lights, environment NEW, geometry, materials, material-layers NEW, textures, assets, animation); Many copies (instances, sprites, points, lines, vertex-draws); Interaction (input, controls, raycast, ui); Rendering and quality (post, render, quality, debug); Utilities (time, math); Add-on packages (particles, impostors, terrain, grass, splats, water, wind, sound, three-compat).",
 "generatedSource": "tools/lib/docs.ts (PAGES)",
 "id": "tree-structure-07",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

- The problem is real. `pageList()` in tools/lib/docs.ts (around line 519) writes one flat table for each area, in the order of PAGES. `PageEntry` (line 49) has only id, title, since and summary, with no group field. So docs/pages.md has one "## API reference" table with 40 rows and no subgroups.
- The odd placements are real (PAGES lines 109-148 of tools/lib/docs.ts): `api/three-compat` sits between geometry and materials. `api/page` (messages between sketch and page) is second from last. `api/controls` (its own package) sits among the core calls. The four pages for add-on authors (features, feature-draws, feature-effects, feature-instances) sit between render and quality, apart from `api/tasks`, which is last.
- The count is wrong. There are 40 API pages, not 39. PAGES has 40 `api/` ids, stats.json has 40, and docs/api/ has 40 .md files.
- The proposed groups are wrong in three ways:
  1. They drop 5 real pages: features, feature-draws, feature-effects, feature-instances and tasks. These are the add-on author pages. They appear in no group.
  2. They name 3 pages that do not exist: "environment NEW", "material-layers NEW" and "instances". No api/environment.md, api/material-layers.md or api/instances.md exists. createInstances is covered on concepts/instances and in the scene API. A grouping proposal must not depend on pages from another finding.
  3. "Entry points" for `api/page` is a poor label. That page covers page.post, onMessage, postToSketch and onSketchMessage. It is about messages, not a way into the engine. It belongs beside engine and sketch, but under a label that fits it.

## Corrected claim

The 40 API pages are one flat table in pages.md, ordered by PAGES. Some are in odd places: three-compat between geometry and materials, page messages second from last, and the add-on author pages (features, feature-*) split from tasks and placed among the core rendering calls. Subgroups would make the list easier to scan.

## Corrected edit

In tools/lib/docs.ts, give each API page a group: add a `group` field to `PageEntry`, or add a small ordered list of API groups. Reorder PAGES to match. Change `pageList()` so the API area writes a `### <group>` subheading and its own table for each group. Every one of the 40 pages must be in exactly one group:

- Page and sketch: engine, sketch, page
- Scene and objects: scene, objects, cameras, lights, geometry, materials, textures, assets, animation
- Sprites, points, lines and vertex draws: sprites, points, lines, vertex-draws
- Interaction: input, raycast, ui, controls
- Rendering and quality: post, render, quality, debug
- Utilities: time, math
- Building add-ons: features, feature-draws, feature-effects, feature-instances, tasks
- Add-on packages: particles, impostors, terrain, grass, splats, water, wind, sound, three-compat

That is 3 + 9 + 4 + 4 + 4 + 2 + 5 + 9 = 40 pages. Pages that another finding proposes (for example environment or material layers) join a group only when they are written.
