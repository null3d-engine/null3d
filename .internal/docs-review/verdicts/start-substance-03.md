# start-substance-03

## The finding as given

- page: getting-started/hosting
- anchor: ## Offline play, the feature table (lines 289-295) and line 356 "`'color_copy'`"
- category: missing-content
- severity: high
- claim: The table lists nine shader features. The build's file list also names coverage, hash, cutout, transmission, color_copy, translucency, subsurface, coat_sheen and weighted. A service worker that caches only the table's names needs the network the first time it draws a masked, hashed, transmissive or weighted material. Line 356 tells readers to cache 'color_copy', which the table does not mention.
- evidence: packages/engine/src/page/engine.ts:459-475 (the full list of preload features); packages/vite-plugin/src/offline.ts:81-90 (each shader feature in null3d-files.json takes its preload name); packages/engine/src/scene/shader-preloads.ts:34.
- proposedEdit: Change the first row to "Every name that `createEngine`'s `preload` takes ([Engine](../api/engine.md))". Put the full list, with the call that starts each one, in a <details><summary>Technical details: every shader feature in the list</summary> block. Add: "Read `features` in your build's own `null3d-files.json` to see the names it holds."

Verdict: partly

## Evidence

- hosting.md, the feature table: the first row names nine shader features (`ao`, `background`, `bloom`, `lines`, `morph`, `occlusion`, `skinning`, `sky`, `sprites`) and points to the Engine API page for the calls. Line 356 then tells readers to cache `'color_copy'`, which no row names. This part holds.
- offline.ts `featuresOf`: every shader module `shaders-<a>-and-<b>-(wgsl|glsl)` goes under each of its features, with `-` turned into `_`. So `features` in null3d-files.json holds every shader feature, not only nine. This part holds.
- The finding's own list of missing names is incomplete, and its "full list" source is wrong. engine.ts:459-475 (the `preload` TSDoc) names about 17 features. The generated page docs/guides/first-use-shaders.md, made from the shader manifest, lists about 40: also `decals`, `probe_grid`, `particles`, `picking`, `dof`, `exposure`, `fog_volume`, `views`, `area_lights`, `single_layer`, `moment`, `clouds`, `physical_sky`, `row_values`, `displacement`, `bump`, `lod_fade`, `effect_groups`, `cluster_levels`, `motion`, and test-only `texcoords` and `instance_index`.
- docs/api/engine.md line 121 (the `preload` row) gives no list either. It links to Loading screens, which links to first-use-shaders.md. hosting.md never links to first-use-shaders.md. So the table's link sends readers to a page that does not hold the names.
- The proposed details block would copy a list that the generated page already holds and keeps current. A hand-written copy on hosting.md would fall out of date when a feature is added. A link to the generated page is the better fix.

## Corrected claim

The table's first row names nine shader features, but `features` in null3d-files.json holds every shader feature, about 40 of them (docs/guides/first-use-shaders.md lists them all). Masked, hashed, transmissive, weighted, decal, area light, displacement materials and more each need a feature that the table does not name. Line 356 tells readers to cache `'color_copy'`, which the table does not name. The table's link goes to the Engine API page, which gives no full list, and hosting.md never links to the generated list.

## Corrected edit

Do not add a details block with a copied list. Change the first row to:

| Every shader feature in [Shaders that load on first use](../guides/first-use-shaders.md), such as `skinning`, `bloom` or `color_copy` | The feature's shaders, and the code of sprites and lines | The call that the same page names for it |

Under the table, add: "Read `features` in your build's own `null3d-files.json` to see every name that it holds."
