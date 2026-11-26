# porting-shaders-substance-22

## Finding as given

- page: porting/threejs-materials
- anchor: ## MeshToonMaterial and MeshMatcapMaterial, stats line 79 (155 words, 9 sentences)
- category: long-paragraph
- severity: medium
- claim: One paragraph mixes the uniform recipe, the lobe alternative with its call rules, and the matcap note.
- evidence: stats.json longParagraphs for porting/threejs-materials
- proposedEdit: Main text: 'Both become custom materials, as the recipes below show. The toon recipe takes the light's direction as a uniform, because a surface function cannot read the scene's lights. For bands that follow every light, step the light in a lobe function. The matcap recipe is an unlit function, so it ignores the lights.' Move the lobe call rules into <details><summary>Technical details: toon bands in a lobe function</summary>.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- stats.json gives one long paragraph for this page: line 79, 155 words, 9 sentences. In the generated page it is line 86 (docs/porting/threejs-materials.md:86). It does hold three topics: the uniform toon recipe, the lobe alternative with its call rules, and the matcap note. The claim holds.
- The call rules are correct in code. crates/null3d-shaders/wgsl/lit.wgsl:2304 calls `lobe(LobeInput(...))` for the main light; lit.wgsl:2317-2333 adds the fill directional lights with `direct_light` and no lobe call. So "no lobe for the fill lights" is true and is useful detail. It is fit for a collapsible block, not for deletion.
- The linked page docs/shaders/surface-functions.md:183-213 already gives the lobe signature and fields, and says area lights get no lobe. It does not name the fill directional lights. So the porting page's detail is not fully duplicated, and keeping it in a block is right.

## What is wrong in the proposed edit

1. The main text says "For bands that follow every light". With the block closed, this is false: the lobe is not called for the fill directional lights or the area lights. The main text must not mislead when every block is closed.
2. It drops "and its shadows", which is the main reason to choose the lobe over the uniform recipe (the lobe gets the shadowed irradiance).
3. It drops the link to Surface functions from the main text.
4. It cuts the matcap note to "ignores the lights" and loses "looks up a texture by the normal in view space" and "as three.js's matcap does". Those are short and help a porter. Keep them, as their own paragraph.

## Corrected edit

Main text:

Both become custom materials, as the recipes below show. The toon recipe takes the light's direction as a uniform, because a surface function cannot read the scene's lights. For bands that follow the main light, the point and spot lights and their shadows, step the light in a lobe function instead ([Surface functions](../shaders/surface-functions.md#a-materials-own-lobe)).

<details>
<summary>Technical details: toon bands in a lobe function</summary>

The engine calls `fn lobe(input: LobeInput) -> vec3f` for the main directional light and for each point and spot light. It gets the light's direction and its shadowed irradiance, and its color adds to that light's specular. The base lighting stays beside it, so set `s.baseColor` to black and `s.roughness` to 1, as the toon recipe does. The engine calls no lobe for the fill directional lights and the area lights, so the bands do not follow them.

</details>

The matcap recipe looks up a texture by the normal in view space. It is an unlit function, so it ignores the scene's lights, as three.js's matcap does.
