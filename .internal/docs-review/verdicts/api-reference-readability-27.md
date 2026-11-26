# Verdict: api-reference-readability-27

## The finding as given

```json
{
 "page": "api/reference/water,api/reference/lights,api/reference/assets,api/reference/splats,api/reference/features,api/reference/input,api/reference/math,api/reference/post",
 "anchor": "water 51, 367; lights 33, 174; assets 265, 335; splats 55; features 65; input 17; math 33; post 220",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Long single-paragraph summaries on the remaining pages.",
 "evidence": "stats.json: water 44 (100 words) and 360 (114 words); lights 26 (66 words, 6 sentences) and 167 (58, 5); assets 258 (44, 5) and 328 (110, 7); splats 48 (136, 7); features 58 (134, 3); input 10 (76, 5); math 26 (88, 5); post 213 (92, 6).",
 "proposedEdit": "createWaterfall: inputs as a list, shorten the 50-word first sentence. OceanValues: split after sentence 1. DirectionalLight: split after 'Its position does not matter.' registerGltfExtensions: move the dev-reload replacement rule into @details. createSplats: three paragraphs (sources, drawing, streams), call rule on its own line. defineFeature: errors as a list. input, math: split after sentence 2. ToneMapping: value table.",
 "generatedSource": "packages/splats/src/system.ts",
 "id": "api-reference-readability-27",
 "slice": "api-reference",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The long paragraphs are real. The stats lines are the page body without its front matter. In the generated pages they sit 7 lines lower, at the anchor lines the finding gives: water.md:51 (createWaterfall), water.md:367 (WaterMaterialOptions), lights.md:33 (DirectionalLight), lights.md:174 (RectAreaLight), assets.md:265 (Prefab), assets.md:335 (registerGltfExtension), splats.md:55 (createSplats), features.md:65 (defineFeature), input.md:17 (Input), math.md:33 (createMath), post.md:220 (ToneMapping).
- The proposed edits cannot be made in TSDoc alone. `tools/lib/api-docs.ts:74` defines `flat`, which turns every line break into a space. `summaryOf` (api-docs.ts:120-124) runs every summary through it. `renderSymbol` (api-docs.ts:494) then writes the summary as one line. A blank line, a list or a table in a doc comment therefore comes out as one paragraph. This is why every summary on these pages is one paragraph. The root cause is the generator, not the prose.
- There is no `@details` tag. `DOC_TAGS` (api-docs.ts:99) holds only category, internal, param and returns. `misreadTags` (api-docs.ts:106-117) adds the text of any other tag to the summary as it is written. So `@details ...` would print the literal "@details" in the page. This edit breaks the page as proposed.
- `generatedSource` names one file, but the finding covers eight pages. The sources are: packages/water/src/waterfall.ts (createWaterfall); packages/water/src/water.ts (WaterMaterialOptions); packages/engine/src/scene/scene.ts (DirectionalLight, RectAreaLight); packages/engine/src/scene/prefab.ts (Prefab); packages/engine/src/scene/gltf-extensions.ts (registerGltfExtension); packages/splats/src/system.ts (createSplats); packages/engine/src/scene/features.ts (defineFeature); packages/engine/src/sketch/input.ts (Input); packages/engine/src/math/create-math.ts (createMath); packages/engine/src/scene/post.ts (ToneMapping). The generator change goes in tools/lib/api-docs.ts.
- The proposal names "OceanValues", but the paragraph at water.md:367 is `WaterMaterialOptions`. Its split point is also weak. Sentence 1 is 10 words, so a split after it leaves about 100 words. The better break is before "Give `attenuationColor`": the values that the surface works out are one part, and how to tint the water is another.
- registerGltfExtension (assets.md:335): the rule that the add-on loaded last wins an extension changes what a user sees. It must stay in the main text. Only the reason (a development reload needs it) is dense detail that could go in a collapsible block.
- Two of the listed paragraphs need no change: Prefab (assets.md:265, 44 words in five short sentences) and RectAreaLight (lights.md:174, 58 words). They read easily, and the finding proposes no edit for them. Splitting them is a matter of taste.
- The other proposals are sound once the generator keeps line breaks: createSplats in three paragraphs with the per-frame call rule on its own line; DirectionalLight split after "Its position does not matter."; Input and createMath split after sentence 2; createWaterfall with the inputs as a list (the WaterfallOptions table on the same page already explains each option, so the list only names them); ToneMapping with one list item per value. defineFeature's list of E1223 rejections (features.md:65) suits a collapsible block, with a link to docs/errors/E1223.md, which holds the full list.

## Corrected claim

Eleven reference summaries on these pages run long (stats.json counts). Nine of them gain from a break. The split is blocked in the generator, not in the comments: api-docs.ts joins every doc comment into one line (`flat`, line 74, used by `summaryOf`, line 123) and knows no tag for a collapsible block. Prefab and RectAreaLight are fine as they are.

## Corrected edit

1. In tools/lib/api-docs.ts, make `summaryOf` (and the namespace summary at line 324) keep blank lines as paragraph breaks and keep list lines. Join only the lines inside one paragraph. Member summaries in table cells stay on one line through `tableCell`.
2. Add a tag for dense detail, for example `@remarks`, to `DOC_TAGS`. Render it after the summary as `<details>` with `<summary>Technical details: ...</summary>`, a blank line, the body and `</details>`. Put no headings in it and no block inside another.
3. Then edit the TSDoc in the source files listed above:
   - createWaterfall: a short first sentence on what the fall is, then a list of the inputs, then the rule to end the river at the lip.
   - WaterMaterialOptions: break before "Give `attenuationColor`".
   - DirectionalLight: break after "Its position does not matter."
   - registerGltfExtension: keep "the add-on loaded last wins" in the main text. Move the development-reload reason into the details block.
   - createSplats: three paragraphs (sources, drawing, streams), with the `splats.update(eye)` and `destroy` rule on its own.
   - defineFeature: E1223's rejections as a list in a details block, linked to the E1223 error page.
   - Input and createMath: split after sentence 2.
   - ToneMapping: one list item per value.
   - Leave Prefab and RectAreaLight as they are.
