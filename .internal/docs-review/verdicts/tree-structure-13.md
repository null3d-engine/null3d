# tree-structure-13

## The finding as given

- page: api/materials
- anchor: # Materials
- category: split-page
- severity: medium
- claim: api/materials is the largest written page: 13,672 words, 27 sections, 21 subheadings and 29 long paragraphs. The physical layers are a topic of their own.
- evidence: stats.json api/materials words=13672, 29 long paragraphs, 21 h3. Sections include Transmission, Light through thin surfaces, Light under the surface, Clear coat and sheen, Iridescence and anisotropy, Relief.
- proposedEdit: Split into api/materials (materials, shadow catchers, standard values, texture maps, UV transform, color, changing, destroying, fixed options, alpha modes, hidden and double-sided surfaces, blending, depth bias, custom materials, ranges, limits) and api/material-layers NEW (specular and IOR, transmission, thin surfaces, subsurface, clear coat and sheen, iridescence and anisotropy, relief). Retag moved symbols. Put dense ranges and formulas in <details> blocks.
- generatedSource: tools/lib/docs.ts (PAGES); @category tags in packages/engine/src

Verdict: partly

## Evidence

The counts hold:
- stats.json: api/materials has 13,672 words and 29 long paragraphs. Only porting/threejs-mapping is larger (21,943), and that page is generated from docs/data/threejs-mapping.json. So api/materials is the largest hand-written page.
- The heading outline has 27 `##` sections and 21 `###` subheadings.
- Lines 112-361 of docs/api/materials.md (specular and IOR, transmission, thin surfaces, subsurface, clear coat and sheen, iridescence and anisotropy) form one coherent block of optional physical layers. Each has its own "How it draws" and "Cost of" subsections. A newcomer who wants a painted box must scroll past this block to reach texture maps, alpha modes and blending. A split is reasonable.

The proposed edit has four errors:
1. It drops Decals. "## Decals" (line 362, with three subsections at 393, 405 and 416) is in neither list. Decals is a separate material kind (`materials.decal`), not a layer. Keep it on api/materials, or give it its own page.
2. Relief is not a physical layer. "## Relief" (line 474) covers `bumpMap`, `displacementMap` and `parallax`: geometry and normal maps that any standard material takes. It belongs next to "Texture maps" on api/materials, not on the layers page.
3. "Retag moved symbols" has nothing to retag. The layer options are fields of shared types: StandardBaseOptions, StandardMaps, StandardValues and MaterialFeatures (docs/api/reference/materials.md, lines 184-281). Those types also hold the base options, so they cannot move to a new @category. The new page should have no reference page of its own and should link to reference/materials.md. tools/lib/docs.ts (referenceLinkProblems, line 671) asks for a reference link only when a generated reference page exists, so a page without tagged exports is allowed.
4. The source is wrong. docs/api/materials.md is written by hand. tools/lib/docs.ts PAGES (line 117) only lists it. The edit is to the Markdown file plus a new PAGES entry, not to a generator.

The split also leaves work that the edit does not name:
- The "Standard values" table (lines 65-105) has about 20 rows of layer options (ior to anisotropyRotation). Move those rows to the new page, or keep one short row per layer with a link.
- The "Ranges" paragraph (line 857) lists layer values. Split it the same way.
- Three pages link to anchors that would move: docs/concepts/materials.md, docs/shaders/surface-functions.md and docs/api/assets.md (transmission, light-through-thin-surfaces, clear-coat-and-sheen, iridescence-and-anisotropy and others). The skills under skills/ that cite these anchors also need updating, as the "Docs and skills stay in sync" rule requires.

The `<details>` part is sound. The "How ... draws" subsections are implementer detail that can be folded. But it repeats the long-paragraph findings for this page; it is not part of the split.

## Corrected claim

api/materials is the largest hand-written docs page (13,672 words, 27 sections, 21 subheadings, 29 long paragraphs). The six physical-layer sections (lines 112-361) are a coherent topic that can move to a page of their own. Decals and Relief are not part of that topic.

## Corrected edit

Edit docs/api/materials.md by hand and add one entry to PAGES in tools/lib/docs.ts. Create api/material-layers with: specular reflection and IOR, transmission, light through thin surfaces, light under the surface, clear coat and sheen, iridescence and anisotropy. Fold each "How ... draws" subsection into a `<details>` block.

Keep on api/materials: the materials, shadow catchers, standard values (base rows only, plus one link row per layer), decals, texture maps, relief, texture coordinate transform, color, changing, destroying, fixed options, alpha modes, hidden and double-sided surfaces, blending, depth bias, custom materials, ranges (base values), limits, related pages and the API reference link.

Do not retag any exports. The new page links to reference/materials.md for the option types. Update the anchor links in docs/concepts/materials.md, docs/shaders/surface-functions.md, docs/api/assets.md and the matching skills.
