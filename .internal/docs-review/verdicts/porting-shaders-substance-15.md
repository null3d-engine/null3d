# porting-shaders-substance-15

## Finding as given

- page: porting/threejs-materials, porting/threejs-unsupported, porting/threejs-overview, porting/threejs-mapping
- anchor: materials line 86 (toon/lobe) and line 47 (clipShadows); unsupported line 38 (MeshToonMaterial) and line 43 (Clipping planes); mapping rows MeshToonMaterial and renderer.clippingPlanes
- category: duplication
- severity: medium
- claim: The same sentences about the lobe function, fill and area lights, and clipShadows: false appear on four pages. They will drift, and the unsupported page's cells turn into paragraphs.
- proposedEdit: Keep the full text on porting/threejs-materials. In the unsupported page, cut each cell to one sentence and a link, such as 'A toon surface function, or a lobe function ([Porting materials](threejs-materials.md#meshtoonmaterial-and-meshmatcapmaterial))'. Shorten the mapping notes the same way.
- generatedSource: docs/data/threejs-mapping.json

Verdict: partly

## Evidence

- docs/porting/threejs-materials.md:47 and :86 hold the full clipShadows and toon/lobe text. This is the right home.
- docs/porting/threejs-unsupported.md:38 is a five-sentence cell that repeats the lobe text, the black base color and roughness 1, and the missing lobe for fill and area lights. Line 43 repeats the clipShadows: false text. This duplication is real, and cutting these cells to one sentence plus a link is right.
- docs/porting/threejs-overview.md:75 and :78 are one-line rows ("A surface function that steps the light into bands", "A surface function with alphaMode: 'mask'") that link to the materials page. They repeat none of the lobe, fill-light or clipShadows sentences. So the text is on three pages, not four.
- docs/porting/threejs-mapping.md:143 and :164 come from docs/data/threejs-mapping.json (entries mat-toon at line ~964 and the clipping entry at line ~1197). That JSON is not just a docs page source. tools/lib/docs.ts:596 writes it into the porting skill's references/api-mapping.md, and skills/null3d-port-threejs/scripts/analyze-threejs.mjs:239 prints each entry's notes in the scanner report. skills/null3d-port-threejs/SKILL.md:32 says a mapping note names what the null3D equivalent does not do. AGENTS.md "Docs and skills stay in sync" rule 1 names this JSON as the one source for the three.js mapping.
- A relative link such as threejs-materials.md#... inside a JSON note does not resolve in the skill copy or in the scanner's report. Each entry already has a docs field with a doc ID for that purpose.

## Corrected claim

The lobe, fill-light and clipShadows text repeats on three pages: porting/threejs-materials, porting/threejs-unsupported and porting/threejs-mapping. porting/threejs-overview only has short pointer rows. The unsupported page's cells at lines 38 and 43 are paragraph-length copies and should be cut. The mapping notes are the data source for the porting skill and its scanner, which read them away from the docs pages, so they must keep the full facts.

## Corrected edit

- porting/threejs-unsupported.md (hand-written): line 38 workaround becomes "A toon surface function with the light's direction as a uniform, or a lobe function that follows each light ([Porting materials and textures](threejs-materials.md#meshtoonmaterial-and-meshmatcapmaterial))". Line 43 becomes "A surface function with `alphaMode: 'mask'` ([Porting materials and textures](threejs-materials.md))". If the fill and area light limit should stay visible on this page, keep it as one short clause, because this page lists limits.
- docs/data/threejs-mapping.json: keep the notes for mat-toon and the clipping entry as full text, with no relative links. At most tighten mat-toon by one sentence (for example, drop "So bands made there follow every such light and its shadows."). Do not cut them to a link.
- porting/threejs-overview.md: no change.
