# porting-shaders-readability-02

## Finding as given

- page: shaders/surface-functions
- anchor: "## A normal for the diffuse light" (line 130) to "## A material's own lobe" (line 183), before "## Uniforms" (line 211)
- category: split-page
- severity: high
- claim: The page is 7,509 words with 23 H2 sections. Four advanced lighting controls (second normal, sky normal, occlusion by minimum, custom lobe) come before uniforms and textures, which every newcomer needs for a first material. The page should reorder and split.
- evidence: stats.json heading order: The surface, Unlit surfaces, A normal for the diffuse light, A normal for the sky's light, Occlusion counted once, A material's own lobe, Uniforms, Textures, Reflections, The scene's depth, Transmission, Light through thin surfaces, Clear coat and sheen, Vertex offsets, Shadows, Cut-out shapes, ...
- proposedEdit: Keep here, in order: Make a custom material, The surface input, The surface, Unlit surfaces, Uniforms, Textures, Vertex offsets, Cut-out shapes, Shadows, Built-in values, Library functions, Rules. Move to a new page "Advanced surface outputs" (shaders/surface-outputs): the two extra normals, occlusion counted once, a material's own lobe, reflections, the scene's depth, transmission (with water seen from below), light through thin surfaces, clear coat and sheen. Add it to PAGES in tools/lib/docs.ts, link it from The surface and Related pages, and fix inbound anchors such as surface-functions.md#a-materials-own-lobe in porting/threejs-materials.

Verdict: partly

## Evidence

- The order holds. docs/shaders/surface-functions.md has "A normal for the diffuse light" (130), "A normal for the sky's light" (148), "Occlusion counted once" (166) and "A material's own lobe" (183) before "Uniforms" (211) and "Textures" (252). These four sections are niche (the examples are tree crowns and leaves). Uniforms and textures are what almost every custom material needs.
- The H2 count is wrong. The page has 22 H2 headings and one H3 ("Water seen from below"), not 23 H2. The word count (7,509) is from stats.json and stands.
- Severity is overstated. Nothing on the page misleads, and a newcomer is not blocked: docs/guides/custom-shaders.md (lines 24 to 43, and "Typed uniforms" at 233) is the entry path. It already teaches `struct Uniforms`, `set()`, textures and texture arrays, and links here. The page is a reference with a heading outline, so a reader can jump to "Uniforms". This is "clearly harder to read", which is medium.
- The split is reasonable for a 7,509-word page, but the edit list is incomplete:
  - Skills link to docs by page ID (AGENTS.md, "Docs and skills stay in sync", rule 1). The skills hold 32 references to `shaders/surface-functions`, several for topics that would move: reflections and transmission in skills/null3d-develop/SKILL.md (lines 207, 209, 212, 213), skills/null3d-develop/references/shaders.md (lines 421 to 429), references/recipes.md (701), references/testing-and-debugging.md (250) and references/api-quickref.md (442, 443, 743). Each must name the new page ID.
  - Docs pages hold 13 anchor links into moved sections: #reflections (4), #a-materials-own-lobe (4), #the-scenes-depth (2), #water-seen-from-below (1), #clear-coat-and-sheen (1), #a-normal-for-the-skys-light (1). All need the new path, not only the one in porting/threejs-materials.
  - In-page links break too: the "Make a custom material" bullet links #a-materials-own-lobe, and the Surface table links each moved section (diffuseNormal, ambientNormal, occlusionByMinimum, lobe, reflection, transmission, diffuseTransmission, clearcoat).
  - The keep list drops "Related pages". It must stay.
  - The PAGES summary for this page in tools/lib/docs.ts (line 176) is stale ("per-instance attributes"), and the front-matter summary lists the moved topics. Both need new text, and the new page needs its own entry and front matter (rules 3 and 4).
  - `fn lobe` is a separate function, not a field the surface outputs, so "Advanced surface outputs" fits it poorly. "Advanced lighting in surface functions" (shaders/surface-lighting) covers both.

## Corrected claim

The page (7,509 words, 22 H2 sections) puts four niche lighting controls (second normal, sky normal, occlusion by minimum, custom lobe) before uniforms and textures, which almost every custom material needs. This makes the reference harder to scan. It does not block a newcomer, because the Custom shaders guide teaches uniforms and textures first. Severity: medium.

## Corrected edit

Minimum fix: reorder this page so that Uniforms and Textures come right after Unlit surfaces, and the advanced sections come after Cut-out shapes.

Fuller fix, if the page is split: keep Make a custom material, The surface input, The surface, Unlit surfaces, Uniforms, Textures, Vertex offsets, Shadows, Cut-out shapes, Built-in values, Library functions, Rules and Related pages. Move the two extra normals, Occlusion counted once, A material's own lobe, Reflections, The scene's depth, Transmission (with Water seen from below), Light through thin surfaces, and Clear coat and sheen to a new page, "Advanced lighting in surface functions" (shaders/surface-lighting). Then:
- add its PAGES entry and front matter, and rewrite both summaries of this page;
- point the Surface table rows and the in-page lobe link to the new page;
- update all 13 docs anchor links into the moved sections;
- update the skill references for moved topics (SKILL.md, references/shaders.md, recipes.md, testing-and-debugging.md, api-quickref.md) to the new page ID;
- link the new page from "The surface" and "Related pages".
