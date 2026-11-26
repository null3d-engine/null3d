# Verdict on api-1-readability-20

## The finding as given

- page: api/assets
- anchor: ## glTF models (line 61) to ## Extensions that add-ons read (line 173)
- category: split-page
- severity: medium
- claim: At 6,408 words, the page mixes glTF loading and add-on extension handlers with textures, LUTs, environments, cube maps, baked light and caching. A reader who wants loadEnvironment scrolls past the extension tables.
- evidence: stats.json gives 6,408 words. assets.md:61-173 covers glTF.
- proposedEdit: Move 'glTF models', 'Freeing a model' and 'Extensions that add-ons read' to a new page api/gltf ('glTF models'). Keep the loadGltf row in the calls table, with a link, and a three-sentence section with the short example. Link the new page from animation.md:27 and scene.md.
- generatedSource: (empty)

Verdict: partly

## Evidence

What holds:
- Lines 61-174 hold 2,301 of the page's 6,408 words (36%). The glTF part is the largest single topic on the page.
- A split has a precedent. `loadTexture` is an `assets` call, but its options live on their own page, api/textures (tools/lib/docs.ts:118, `@category api/textures` in packages/engine/src/scene/textures.ts). A glTF page would follow the same pattern.

What does not hold, or is overstated:
- "A reader who wants loadEnvironment scrolls past the extension tables" is weak. The calls table at assets.md:36-57 links each call to its section. The `loadEnvironment` row links to `#environments` (line 47). A reader jumps there without scrolling.
- 6,408 words is not an outlier among API pages. stats.json gives scene 8,672, animation 6,712 and materials 13,672 words. Page length alone does not justify the split.
- Most of the scroll cost comes from one table cell. The "A material" row of the glTF table (line 94) is one cell of several hundred words about the KHR_materials_* extensions. The handler's `data` table (lines 150-161) is dense implementer detail too. Collapsible blocks would cut most of the scroll without a new page.

The proposed edit is incomplete:
- generatedSource is empty, but a new API page needs generated parts. It needs a page entry in tools/lib/docs.ts (PAGES, beside line 119). The glTF exports must move to `@category api/gltf`, so that docs/api/reference/gltf.md exists. Those exports live in packages/engine/src/scene/prefab.ts and gltf-extensions.ts, and in the `loadGltf` and `registerGltfExtension` members in assets.ts. The new page needs its own "API reference" heading with a link to reference/gltf.md (AGENTS.md "Docs and skills stay in sync", rule 5). The api/assets inventory summary (docs.ts:119, "glTF models and environments") must change too.
- The edit names only animation.md:27 and scene.md as pages to link. Seven links point into the anchors that move:
  - concepts/assets.md:39 (#gltf-models), :45 (#extensions-that-add-ons-read) and :128 (#freeing-a-model)
  - api/scene.md:75 (#gltf-models)
  - api/geometry.md:299 (#freeing-a-model)
  - api/splats.md:259 (#extensions-that-add-ons-read)
  - api/features.md:296 (#extensions-that-add-ons-read)
  
  All of them must point to the new page, or the link check fails.
- The paragraph about hold mode in "The calls" (line 59) names the glTF extension handler's `load`. It needs a link to the new page.

## Corrected claim

The glTF part holds 36% of api/assets, and its material row and handler data table are dense. The page is not long next to other API pages, and the calls table already links each call to its section, so a reader of loadEnvironment does not have to scroll. A split to api/gltf is reasonable (api/textures is the precedent), but it is low severity. It also needs more work than the edit lists.

## Corrected edit

Do the cheaper fix first. In the glTF table, shorten the "A material" cell to its first sentence: "`materials.standard`, or `materials.unlit` with `KHR_materials_unlit`. The extensions below set its other options." Move the rest of the cell into a block after the table, as a list with one item per extension:

<details>
<summary>Technical details: the material extensions the loader reads</summary>

(one list item for each KHR_materials_* extension, from the text of the old cell)

</details>

Put the handler's `data` and `context` table (lines 150-161) in a second block: "Technical details: what `load` receives". The text around it must still make sense with the block closed.

If the split still goes ahead, do all of these:
- Add api/gltf to PAGES in tools/lib/docs.ts and change the api/assets summary.
- Re-tag the glTF exports in prefab.ts and gltf-extensions.ts, and the two members in assets.ts, from `@category api/assets` to `@category api/gltf`.
- Give the new page an "API reference" heading that links to reference/gltf.md.
- Point all seven inbound links listed above to the new page.
- Link the new page from the hold-mode paragraph at assets.md:59.
