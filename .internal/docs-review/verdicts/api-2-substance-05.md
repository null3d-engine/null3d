# Verdict on api-2-substance-05

## The finding as given

- page: api/materials
- anchor: ### How it draws (169-170), ### Maps of the layers (294, 296), ### Maps of iridescence and anisotropy (346), ## Texture maps (460, 462)
- category: duplication
- severity: medium
- claim: The rule for which maps fill which texture array, and which pairs throw E1217, appears four times in different words. The rule that layer and diffuse-transmission maps take the specular maps' places appears three times (212-213, 294, 460). A reader cannot tell whether the versions differ.
- evidence: docs/api/materials.md:169-170, 212-213, 294, 296, 346, 460, 462.
- proposedEdit: Keep one statement under ## Texture maps: a table of slots (light map, specular intensity, specular color) against the maps that may use each, inside `<details><summary>Technical details: which maps share a texture slot</summary>`. Replace the other copies with one line: 'These maps share slots with other maps. See Texture maps.'
- generatedSource: (none; the page is hand-written)

Verdict: partly

## Evidence

- The rule that the transmission and thickness maps borrow the specular slots' texture arrays, and which layer maps clash with them, is stated four times: materials.md:169-170, 296, the last sentence of 346, and 462. Lines 169 and the first half of 462 are almost word for word the same. This part of the finding holds.
- The copies do not contradict each other or the code. The source in packages/engine/src/scene/resources.ts matches every copy: the transmission map clashes with `clearcoatNormalMap` and `iridescenceThicknessMap` (SPECULAR_INTENSITY_LAYER_MAPS, about line 2862); the thickness map clashes with `sheenColorMap`, `sheenRoughnessMap` and `anisotropyMap` (SPECULAR_COLOR_LAYER_MAPS, about line 2868); a thickness map with a specular color map throws E1217 (about line 3636). But the copies are worded differently: 170 says "the sheen's maps", 296 lists them, 346 gives only a subset, and 462 lists none. So a reader must compare four texts to learn that they agree. "Cannot tell whether they differ" is a fair cost, but the versions are in fact the same rule.
- The second claim is weaker. Line 212 is already a short pointer ("See Texture maps"), the shape the proposal asks for. Line 294 does not restate the diffuse transmission maps rule. It says a layered material takes no `diffuseTransmission` (the property), which repeats line 213, not line 460. That repeat is two lines in two sections, each the right place for its reader.
- The proposed edit goes too far in two places:
  1. "Replace the other copies with one line" would remove the main rule of the layers' sections. The first sentences of 294 (a layered material takes no `lightMap` or specular maps) and 346 (one family of layer maps per material) are not copies of the transmission rule. They must stay in the main text.
  2. Which pairs throw E1217 is user-facing behavior, not only detail. The website contract says the main text must make sense with every block closed. If the whole rule goes into a closed block, a reader with closed blocks does not learn that some pairs fail. One plain sentence must stay in the main text; the slot mechanism and the exact pairs can go in the block.
- Line 462 also holds one fact that no other copy gives: the two maps without `transmission` throw E1217 (code at about line 3624). That fact must stay when the copies are merged.

## Corrected claim

The rule for which maps clash with the transmission and thickness maps appears four times (169-170, 296, the end of 346, 462), in different words and with different lists of maps. The copies agree with each other and with the code, but a reader must compare four texts to see that. The diffuse transmission duplication is minor: 212 is already a pointer, and 294 repeats only 213's "a layered material takes no diffuseTransmission".

## Corrected edit

Under ## Texture maps, keep one main-text sentence at 462: "A material with `transmission` may take `transmissionMap` and `thicknessMap` beside the specular maps or the layers' maps, except for a few pairs that share a texture array. Development builds throw E1217 for those pairs, and for the two maps without `transmission`." After it, add one block:

<details>
<summary>Technical details: which maps share a texture array</summary>

| Array of the slot | Maps that may fill it | Clashes that throw E1217 |
| --- | --- | --- |
| Specular intensity | `specularIntensityMap`, `transmissionMap`, `clearcoatNormalMap`, `iridescenceThicknessMap` | `transmissionMap` with `clearcoatNormalMap` or `iridescenceThicknessMap` |
| Specular color | `specularColorMap`, `thicknessMap`, `sheenColorMap`, `sheenRoughnessMap`, `anisotropyMap` | `thicknessMap` with `specularColorMap` (sRGB and linear never share an array), or with a sheen map or `anisotropyMap` |

Two maps of one slot draw together only when their images have one size and format.

</details>

Then cut the second bullet at 170 and the second sentence onward of the 169 bullet, the whole of 296, and the last sentence of 346. Put one line in their place in each section: "The transmission and thickness maps share texture arrays with some of these maps. See Texture maps." Keep the first sentences of 294 and 346, and keep 212 and 213 as they are.
