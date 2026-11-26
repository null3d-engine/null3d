# porting-shaders-readability-08

## Finding as given

- page: porting/threejs-materials
- anchor: ## Recipes (line 131); table rows alphaMap (line 36) and clippingPlanes (line 47) say "The recipe below"
- category: example-placement
- severity: medium
- claim: The toon and matcap section (line 84) has no code; its recipes come 45 lines later, after texture settings and color spaces. The alphaMap and clippingPlanes rows point to "the recipe below" with no link. The fact that a custom material takes every standard option but the maps, and up to 6 textures, comes last (line 204), after the recipes that rely on it.
- evidence: threejs-materials.md lines 36, 47, 84-86, 131-204.
- proposedEdit: Move the toon and matcap recipes into "MeshToonMaterial and MeshMatcapMaterial". Rename "Recipes" to "Recipes for clipping planes and alpha maps", link to it from the two table rows, and move the line 204 sentence to the top of that section.

Verdict: partly

## Evidence

- Line 84-86: the toon and matcap section has no code and says "as the recipes below show". The toon recipe starts at line 133, after "Other materials", "Texture settings" and "Color spaces". The claim holds.
- Line 36 ("The recipe below samples it") and line 47 ("The recipe below cuts a mesh at a plane") have no link. The claim holds.
- Line 204 is the last line of "Recipes", after all four recipes. The matcap recipe (line 157) and the alpha map recipe (line 192) pass their own `textures`, and the clipping and alpha recipes (lines 173, 191) pass standard options (`alphaMode`, `alphaCutoff`). They all rely on that sentence. The claim holds.
- Line 15 tells the reader the order ("then the texture settings, then four recipes"), so the placement is signposted. That does not remove the cost: the toon section points forward over three sections.
- The limit of 6 matches the engine constant for custom textures (packages/engine/src/generated/core.ts:352). No page links to this page's "#recipes" anchor, so the rename breaks no link.

## What is wrong with the proposed edit

- If the toon and matcap recipes move up, the matcap recipe (which passes its own texture) then comes before the line 204 sentence, even after that sentence moves to the top of the clipping and alpha section. The edit keeps the problem it names for one recipe. The sentence must go where custom materials first appear: the toon and matcap section, before its code.
- The toon recipe's lead line (133) repeats line 86 ("a surface function cannot read the scene's lights"). After the move, the two sit side by side; drop one.
- Line 15 says "then four recipes". It must change when two recipes move.

## Corrected edit

1. In "MeshToonMaterial and MeshMatcapMaterial", open with the line 204 sentence (a custom material takes every standard option but the texture maps, and up to 6 textures of its own). Then put the toon recipe right after the sentence about the light's direction as a uniform, and the matcap recipe after the sentence about the view-space normal. Drop the repeated lead line of the toon recipe. The lobe-function detail in that paragraph (line 86) can go in a `<details>` block "Technical details: toon bands from every light", so the main text stays short with the block closed.
2. Rename "Recipes" to "Recipes for clipping planes and alpha maps". Keep the clipping and alpha recipes there, with one short line that points back to the custom-material sentence.
3. In rows 36 and 47, change "The recipe below" to a link: [The alpha map recipe](#recipes-for-clipping-planes-and-alpha-maps) and [The clipping recipe](#recipes-for-clipping-planes-and-alpha-maps).
4. Change line 15 to say the page ends with recipes for clipping planes and alpha maps.
