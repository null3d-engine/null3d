# porting-shaders-readability-27

## Finding as given

- Page: porting/threejs-unsupported
- Anchor: ## Materials and shaders rows MeshToonMaterial (line 38) and Clipping planes (line 43)
- Category: duplication. Severity: low.
- Claim: The toon workaround cell is about 70 words and repeats the lobe rules from porting/threejs-materials. The clipping cell repeats the clipShadows detail. In a list of gaps, the workaround should be one line.
- Evidence: threejs-unsupported.md lines 38 and 43; threejs-materials.md lines 47 and 86.
- Proposed edit: Toon: "A surface function or a lobe function that steps the light into bands ([Porting materials and textures](threejs-materials.md#meshtoonmaterial-and-meshmatcapmaterial))". Clipping: "A surface function with `alphaMode: 'mask'` ([recipe](threejs-materials.md#recipes))".

Verdict: partly

## Evidence

- Toon part holds. docs/porting/threejs-unsupported.md:38 gives the uniform approach, the lobe approach, the black base color and roughness 1 rule, and the fill and area light limit. docs/porting/threejs-materials.md:86 says all of this, and the heading at line 84 gives the anchor `#meshtoonmaterial-and-meshmatcapmaterial`, which resolves. The "In null3D" column of the row already says that surface functions cannot read the lights, so the short cell still makes sense. The proposed toon edit is fine.
- Clipping part fails as proposed. The `fn coverage` note for three.js's default `clipShadows: false` lives only in the `clippingPlanes` table row, docs/porting/threejs-materials.md:47, under `## MeshStandardMaterial` (line 17). The clipping recipe under `## Recipes` (lines 169-184) has no word about shadows. So the proposed link to `#recipes` drops the one fact a porter needs to match three.js's default shadow. A reader who follows that link gets a shadow cut at the plane, which three.js does not do by default. That is a real behavior gap, not polish.
- The clipping cell (line 43) is about 40 words, not a long cell. Its extra sentence is short and it prevents a wrong result.
- stats.json lists no long paragraphs on this page; the cells are table cells, so the finding is about table density only.

## Corrected claim

The toon cell repeats the lobe rules from the materials page and can shrink to one line with a link. The clipping cell's shadow note is not repeated by the recipe it would link to; it appears only in the `clippingPlanes` row of the materials page. Cutting it with a link to `#recipes` loses the fix for three.js's default `clipShadows: false`.

## Corrected edit

- Toon (line 38): keep the proposed edit. "A surface function or a lobe function that steps the light into bands ([Porting materials and textures](threejs-materials.md#meshtoonmaterial-and-meshmatcapmaterial))"
- Clipping (line 43): keep the shadow fact in short form, or link to the section that holds it. "A surface function with `alphaMode: 'mask'` ([recipe](threejs-materials.md#recipes)). To keep the whole shadow, as three.js's default does, return `1.0` from `fn coverage` ([Porting materials and textures](threejs-materials.md#meshstandardmaterial))"
