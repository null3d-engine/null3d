# api-2-readability-03

## Finding as given

```json
{
 "page": "api/materials",
 "anchor": "lines 169-170, 296, 346, 462",
 "category": "duplication",
 "severity": "medium",
 "claim": "The rule for which maps share a texture array (transmission and thickness maps beside layer maps, and the E1217 pairs) appears four times with slightly different words. The diffuse transmission exclusions repeat three times. A reader cannot tell whether the copies differ.",
 "evidence": "line 170 '`clearcoatNormalMap` and `iridescenceThicknessMap` fill the array that the transmission map samples'; line 296 repeats it; line 346 repeats it for iridescence; line 462 repeats it under Texture maps. Diffuse transmission rules at lines 213, 294, 460.",
 "proposedEdit": "State the rule once, under '## Texture maps', as a table 'Maps that cannot share one material': map pair | why | result in development and production builds. Put the table inside <details><summary>Technical details: which maps share a texture array</summary>. Replace the other copies with one sentence and a link.",
 "generatedSource": "",
 "id": "api-2-readability-03",
 "slice": "api-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

The duplication is real. The page states the volume-map rule in six places, not four:

- Line 138 and line 142 (the Transmission table rows for `transmissionMap` and `thicknessMap`).
- Line 169 and line 170 (bullets under "How it draws").
- Line 296 (under "Maps of the layers").
- Line 346 (under "Maps of iridescence and anisotropy", only the iridescence and anisotropy half).
- Line 455, line 456 and line 462 (the Texture maps table and the paragraph after it).

Lines 170, 296 and 346 agree with each other and with the code. In `packages/engine/src/scene/resources.ts`, the maps that fill the transmission map's array are `clearcoatNormalMap` and `iridescenceThicknessMap` (lines 2862-2865). The maps that fill the thickness map's array are `sheenColorMap`, `sheenRoughnessMap` and `anisotropyMap` (lines 2868-2872). `checkLayerMaps` throws E1217 for each clash (lines 3725-3733).

The finding misses the worst part: one copy is wrong. Line 142 says a specular color map "may draw beside it when the two textures share an array". Line 169 and line 462 say the pair throws E1217. The code agrees with line 169: `resources.ts` lines 3636-3640 throw E1217 for `thicknessMap` with `specularColorMap`. So the copies really do differ, and a reader who reads only the Transmission table gets the wrong rule. The same wrong sentence is in the TSDoc of `thicknessMap` (`resources.ts` lines 2137-2141), so it is also in `docs/api/reference/materials.md`.

The diffuse transmission claim holds only in part. Lines 213 and 294 are true copies: a layered material takes no `diffuseTransmission`. Line 460 is a different rule: it is about the two diffuse transmission maps, and it also covers a material without `diffuseTransmission`. Line 213 also names the `weighted` blending, which no other copy gives. So two of the three are duplicates. The code has one more rule that no copy states: `transmissionMap` or `thicknessMap` with `diffuseTransmission` throws E1217 (`resources.ts` lines 3629-3633).

The proposed edit is mostly right. One table under "Texture maps" is a good home, and a details block suits the per-slot detail. Two changes are needed:

- The "production builds" column needs care. The page says what production does only for the layer and specular-map clash (line 294) and for the two layer families (line 346). It does not say what production does with a volume-map clash. The column must be filled from the code, or left out.
- The main text must still say, in one plain sentence outside the block, that some map pairs cannot be on one material and that development builds throw E1217 for them. The block can hold the list of pairs and the reasons.

## Corrected claim

The volume-map rule (which layer and specular maps cannot sit beside `transmissionMap` and `thicknessMap`) is stated at lines 138, 142, 169-170, 296, 346, 455-456 and 462. The copies at lines 170, 296 and 346 agree with the code. Line 142 contradicts lines 169 and 462 and the code: it says a specular color map may draw beside a thickness map, but that pair throws E1217. The same wrong sentence is in the `thicknessMap` TSDoc in `packages/engine/src/scene/resources.ts`, so it also shows on `api/reference/materials`. The diffuse transmission exclusion for layered materials is stated twice (lines 213 and 294). Line 460 is a separate rule about the diffuse transmission maps. Severity should be high, because line 142 misleads.

## Corrected edit

1. Fix line 142 now. Replace "so a specular color map may draw beside it when the two textures share an array" with "so a material with a thickness map takes no specular color map". Make the same change in the `thicknessMap` TSDoc in `packages/engine/src/scene/resources.ts`.
2. Under "## Texture maps", after the paragraph at line 462, keep one plain sentence: "Some maps sample the same texture array, so they cannot be on one material. Development builds throw E1217 for such a pair." Then add:

```
<details>
<summary>Technical details: which maps share a texture array</summary>

| Map | Cannot be given with | Why |
| --- | --- | --- |
| `transmissionMap` | `clearcoatNormalMap`, `iridescenceThicknessMap` | Both fill the specular intensity slot's array, which the transmission map samples |
| `thicknessMap` | `sheenColorMap`, `sheenRoughnessMap`, `anisotropyMap` | All fill the specular color slot's array, which the thickness map samples |
| `thicknessMap` | `specularColorMap` | One is linear and the other sRGB, and the two never share an array |
| `transmissionMap`, `thicknessMap` | `diffuseTransmission` | The diffuse transmission maps take the same slots |
| `diffuseTransmission` | A clear coat, a sheen, iridescence or anisotropy, or the `weighted` blending | The layers' maps take the slots that it needs |

A transmission map and a specular intensity map draw together when their images have one size and format.

</details>
```

Add a production-build column only after the code confirms what production does for each pair.

3. Make lines 169-170, 296 and 346 one sentence each with a link, for example: "A material with `transmission` keeps its transmission and thickness maps beside the layers, except for the pairs in [Texture maps](#texture-maps)." Keep lines 213 and 294 as one sentence each that links to the same table.
