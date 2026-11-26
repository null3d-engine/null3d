# api-2-readability-18

## Finding as given

- page: api/materials
- anchor: ## Ranges, line 859
- category: wall-of-text
- severity: medium
- claim: 123 words give the ranges of 20 options and five error rules in one paragraph. Most of the ranges are already in the Standard values table.
- evidence: line 859 (stats line 852: 123 words, 9 sentences).
- proposedEdit: Make the section a short list of errors: values outside the Standard values ranges throw E1108; an unknown alphaMode or blending throws E1217; a non-finite depth bias throws E1203. Add the missing ranges (edgeFade, the angleFade order) to the decal and Standard values tables.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/api/materials.md:859 is the single paragraph of the Ranges section. The paragraph count (123 words, 9 sentences) is a fact from stats.json.
- The core claim holds. The Standard values table (lines 67-108) already gives every 0-to-1 range the paragraph lists (opacity, alphaCutoff, metalness, roughness, aoMapIntensity, transmission, diffuseTransmission, clearcoat, clearcoatRoughness, sheenRoughness), every "0 or more" range (emissiveIntensity, lightMapIntensity, thickness, subsurfaceRadius) and "Above 0" for attenuationDistance. The paragraph repeats them.
- The last sentence ("The opaque alpha mode ignores the opacity") repeats the Alpha modes table (line ~574: "The alpha has no effect").
- The page text matches the code. packages/engine/src/scene/resources.ts:3017-3027 checks angleFade as two angles from 0 to π, the first no larger than the second. Lines 3584-3645 throw E1217 for pipeline options and E1203 for a non-finite depth bias, and line 1689 throws E1203 for non-finite numbers.

What is wrong in the finding:
- The paragraph has four error rules and one behavior note, not five error rules: E1108 for an out-of-range value, E1217 for an unknown alphaMode or blending, E1217 for weighted blending on a custom or transmissive material, and E1203 for a non-finite depth bias. The opaque note throws no error.
- The edgeFade range is not missing. The Decals table (line ~389) already says "from 0 to 1". Only the angleFade range and order are missing (the Decals table gives the default, not the range).
- The proposed list drops a real rule: weighted blending on a custom material, or on a material with transmission, throws E1217. A reader who follows the new section would lose it.
- The proposed list drops the finiteness rule. The tables say only "A number" or "Two numbers" for normalScale, clearcoatNormalScale, bumpScale, displacementScale and displacementBias. They give no range for uvTransform or mapUvTransforms.
- "Values outside the Standard values ranges" leaves out the decal values, and it drops "development builds".

## Corrected claim

The Ranges paragraph (123 words) repeats ranges that the Standard values and Decals tables already give, including edgeFade's 0-to-1 range. It also repeats the Alpha modes table on opaque. Only the angleFade range and order, and the rule that the plain numbers must be finite, appear nowhere else.

## Corrected edit

Table changes:
- Standard values table: write "A finite number" or "Two finite numbers" in the Range column of normalScale, clearcoatNormalScale, bumpScale, displacementScale and displacementBias.
- Decals table, angleFade row: add "Two angles from 0 to π, the first no larger than the second".

Replace the Ranges paragraph with:

When a factory or `set` gets a value that the tables above do not allow, development builds throw an error:

- A value outside its range in the Standard values or Decals table throws E1108. So does a number in `uvTransform` or `mapUvTransforms` that is not finite.
- An `alphaMode` or `blending` that the engine does not know throws E1217. So does the `weighted` blending on a custom material or on a material with `transmission`.
- A depth bias that is not a finite number throws E1203.

Drop the sentence about the `opaque` alpha mode, because the Alpha modes table says it. No collapsible block is needed: after the cut, nothing dense is left to hide.
