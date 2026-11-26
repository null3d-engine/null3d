# porting-shaders-readability-07

## Finding as given

- Page: porting/threejs-materials
- Anchor: ## MeshToonMaterial and MeshMatcapMaterial, line 86 (stats line 79)
- Category: long-paragraph. Severity: medium.
- Claim: One paragraph of 155 words and 9 sentences gives two toon methods, the lobe contract, which lights call the lobe, a base-color trick and the matcap method. A reader cannot see that toon has two choices.
- Evidence: stats.json porting/threejs-materials longParagraphs line 79: 155 words, 9 sentences.
- Proposed edit: Write "Both become custom materials. For toon shading, pick one:" and a list: 1. a surface function with the light's direction as a uniform (simple, one light; see the toon recipe); 2. a lobe function, which follows every directional, point and spot light and their shadows. Then "Matcap is an unlit function that looks up a texture by the normal in view space." Move the lobe details (which lights call it, black base color and roughness 1, no lobe for fill and area lights) into a technical details block, "Technical details: toon bands with a lobe function".

Verdict: partly

## Evidence

- docs/porting/threejs-materials.md:86 is one paragraph that holds two toon methods, the lobe signature, the lights that call it, the black-base-color advice, the fill/area exception and matcap. stats.json gives 155 words and 9 sentences. The split into a choice list is right.
- The page's facts are correct. crates/null3d-shaders/wgsl/lit.wgsl:1266-1267 and :2229 say the engine calls the lobe for the sun and each point and spot light; the sun call is under CUSTOM_LOBE near :2301; the fill directional loop that follows (about :2317-2333) adds plain direct_light with no lobe and "without its shadows". clustered_lobed_light (:2143-2148) keeps the base lobe for area lights. docs/shaders/surface-functions.md "A material's own lobe" says the same.
- The proposed list item 2 is wrong: "follows every directional, point and spot light and their shadows". Only the main directional light calls the lobe. The fill directional lights do not, and they cast no shadows. With the exception moved into a closed block, the main text would then mislead the reader.
- The fill/area exception is a reason to choose one method over the other (a scene lit by fill lights gets no bands from them), so a short form of it belongs in the main text, not only in the block.
- The lobe method has no recipe on this page. The main text must keep the link to Surface functions (../shaders/surface-functions.md#a-materials-own-lobe), or a reader with the block closed has nowhere to go.
- The "black base color and roughness 1" advice is a step the reader must do for the lobe method to look right; it can go in the block only if the main item says "see the details below" or the block opens with it. Keeping it in the block is acceptable.

## Corrected claim

The paragraph is too long and hides the choice between two toon methods; a list plus a details block is right. But the proposed list item overstates which lights the lobe follows.

## Corrected edit

"Both become custom materials, as the recipes below show. For toon shading, pick one:

1. A surface function with the light's direction as a uniform. It is simple and follows one light. The toon recipe below does this.
2. A lobe function, which steps the light in bands for the main directional light and for each point and spot light, with their shadows. Fill directional lights and area lights do not get bands ([Surface functions](../shaders/surface-functions.md#a-materials-own-lobe)).

Matcap is an unlit function that looks up a texture by the normal in view space. It ignores the scene's lights, as three.js's matcap does.

<details>
<summary>Technical details: toon bands with a lobe function</summary>

The engine calls `fn lobe(input: LobeInput) -> vec3f` once for each light that it answers for. The lobe gets the light's direction and its shadowed irradiance, and its color adds to that light's specular. The base lighting stays beside it, so set `s.baseColor` to black and `s.roughness` to 1 in the surface function, as the toon recipe does. The fill directional lights and the area lights draw with the base lobe only.

</details>"
