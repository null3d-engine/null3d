# Shot and demo-link verdicts: guides/add-ons

## Shots

### addon-stats-row: keep, with corrected steps
The picture helps. A newcomer has not seen the stats overlay, and the page quotes only one line of its text. The proposed steps are wrong in three places:
- The water stats test page starts the engine with the overlay already on, so `?stats` does nothing there.
- The overlay opens with every figure showing. A click on its header collapses the card and hides the water row.
- The test page switches to Low and then destroys the engine. It has no point at which a capture can wait, and its canvas is only 320 by 180 pixels, with a status line under it.

Corrected source: load the water demo (`water`) with `?stats&preset=medium`. Do not click the header. Wait until the overlay's water row (`[data-figure="feature:water"]` in the overlay's shadow root) shows `reflectionEvery` and a `memory` figure, then capture the card. The frame-budget governor can still double the cadence on a slow GPU, so check that the row reads `reflectionEvery 2` before the capture.

### levels-debug-view: drop
The steps work: `?view=levels` and `?hold` are real page switches, and the levels view colors each level. But the picture does not fit this section. The section gives an add-on author a coding rule: build meshes through `fromArrays` or a generator and leave the `levels` option out. A picture cannot show that rule. The forest demo also does the opposite. Its trees take hand-made levels (see `examples/lib/trees.ts`), the case that the page puts aside at line 71. A colored-levels picture belongs on the Levels of detail concept page, and this section already links there. The existing `lod-levels.png` reference (webgpu tier only) shows plain test spheres, so it is no better here.

## Demo links

| Code | Concept | Keep | Reason |
| --- | --- | --- | --- |
| water/ | preset settings and the stats row | no | The water demo's code calls `createWater` and nothing else. It has no `FeatureHost`, `defineFeature`, preset row or stats code. A reader who follows the link does not find what the section teaches. The feature code is in `packages/water/src/water.ts`, which is not a demo. |
| forest/ | levels of detail on meshes made in code | no | The forest's trees take hand-made levels, not the default planned levels that the section asks for. Keep the link only if it is moved to line 71 and retitled "hand-made levels on a generated plant". |
| terrain/ | terrain blocks with their own level system | yes | The demo draws the terrain add-on's ground. Near blocks are fine and far blocks are coarse, which matches the table row. |
| impostors/ | impostor cards as far stand-ins | yes | The demo draws level meshes near, merged cells in the middle and impostor cards far out. That covers both "impostor cards" and "merged far cells" in the table. |
| splats/ | an add-on namespace (splats) | no | The splats demo has no code value, so its link is `splats/`. The demo only uses the splats add-on. It never calls `declareAddonNamespace`. The page's `@acme/splats` is a made-up example, not this demo. |

## Concepts said to have no demo

| Concept | Confirmed | Note |
| --- | --- | --- |
| namespace claim | yes | No file under `examples/` calls `declareAddonNamespace`. |
| plugin interface range and E1433 | yes | No example uses `PLUGIN_INTERFACE_VERSION` or `checkAddonVersion`. |
| public entry points | yes | The example add-ons in `examples/addons/` keep this rule, but that folder is not a demo code. The aurora demo has no code value, so its link points to its sketch, not to the add-on. |
| Rust hot path on job workers | yes | No example calls `runTask`. |
| check-addon gates | yes | This is a command-line check. No demo shows it. |
| size budgets | yes | Same as above. |
| allocation gate | yes | Same as above. |
| preset settings and the stats row | yes | Added: no demo's code declares a feature with preset settings. The water demo with `?stats` shows the row when it runs, which the corrected shot covers. |
