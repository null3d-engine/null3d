# tree-structure-08

## Finding as given

- page: guides/*
- anchor: ## Guides (pages.md)
- category: structure
- severity: medium
- claim: The 25 guides form one unordered list: performance, shaders, example add-ons, loading, accessibility, physics, testing and deploying are interleaved.
- evidence: PAGES guides order: performance, phones, custom-shaders, custom-passes, car-paint, lens-kit, screens, loading-screens, start-time, accessibility, content-pages, ui-overlays, video-textures, audio, physics, deterministic-simulation, multiple-views, assets-pipeline, baked-light-data, testing, add-ons, debugging, deploying, agents, first-use-shaders.
- proposedEdit: Groups: Performance (performance, profiling NEW, phones, loading-screens, first-use-shaders); Pages and UI (ui-overlays, content-pages, accessibility, multiple-views, video-textures); Game systems (physics, deterministic-simulation, audio); Rendering (custom-passes, baked-light-data); Example add-ons (example-add-ons NEW, car-paint, lens-kit, screens); Testing and debugging (testing, debugging). Other guides move out as listed in the tree.
- generatedSource: tools/lib/docs.ts (PAGES)

## Verdict: partly

## Evidence

- docs/pages.md:94-122 has one "## Guides" table of 25 rows and no subheadings. This holds.
- tools/lib/docs.ts:49-56: `PageEntry` has no group field. tools/lib/docs.ts:520-542 (`pageList`) writes one `##` heading per area and nothing below it. So the page cannot show groups today; the fix needs code, not only a new order.
- tools/lib/docs.ts:150-173: the order in PAGES. "Unordered" overstates it. Loose clusters exist: performance and phones (rows 1-2), shader and look pages (3-7), loading and start (8-9), page and UI pages (10-13), game systems (14-17). But clusters break where it matters: loading-screens and start-time sit 6 rows from performance; testing and debugging are split by add-ons; first-use-shaders is row 25, far from loading-screens, which explains it.
- Small error in the evidence: first-use-shaders is not in PAGES. It is a generated page, and `pageList` puts every page that PAGES leaves out at the end of its area (rank MAX_SAFE_INTEGER). Its place at the end comes from that rule, not from PAGES.
- The proposed groups hold only 19 of the 25 current guides. Six (custom-shaders, start-time, assets-pipeline, add-ons, deploying, agents) depend on moves to other areas in the tree review (.internal/docs-review/findings/tree-structure.md). Two members (profiling, example-add-ons) are new pages from other findings. As written, the edit is not complete on its own: if a move is rejected, that guide has no group.

## Corrected claim

The 25 guides sit in one flat table with no group headings. The order has loose clusters, but related pages are split: the loading pages are apart from performance, testing is apart from debugging, and the generated first-use-shaders page falls to the end because PAGES does not list it.

## Corrected edit

1. Add a `group` field to `PageEntry` and an ordered group list per area in `AREAS`. Make `pageList` write a `###` heading per group. Give generated pages a slot in the order, so first-use-shaders sits after loading-screens.
2. Give every current guide a group, so the grouping does not depend on the moves in other findings. For example:
   - Performance and loading: performance, phones, loading-screens, first-use-shaders, start-time
   - Shaders and rendering: custom-shaders, custom-passes, baked-light-data
   - Example add-ons: car-paint, lens-kit, screens
   - Pages and UI: ui-overlays, content-pages, accessibility, multiple-views, video-textures
   - Game systems: physics, deterministic-simulation, audio
   - Testing and debugging: testing, debugging
   - Building and shipping: assets-pipeline, add-ons, deploying, agents
3. When a move or a new page from another finding lands, change the group lists in the same branch: remove the moved guide, and add profiling and example-add-ons.
