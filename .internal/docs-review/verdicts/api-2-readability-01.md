# Verdict: api-2-readability-01

## The finding as given

- page: api/materials
- anchor: # Materials (whole page)
- category: split-page
- severity: high
- claim: The page has 13,672 words and 50 headings across five topics: the standard material, special surfaces, decals, transparency and custom materials. A newcomer must scroll past glass, skin and moment transparency to find the basics, and custom WGSL starts at line 711.
- evidence: stats.json api/materials: words 13672, 50 headings, 29 long paragraphs. '## Decals' is at line 362, '## Alpha modes' at line 570, '## Custom materials' at line 711.
- proposedEdit: Split the page into five: api/materials (intro to Limits, minus the topics below), api/material-surfaces (Transmission, Light through thin surfaces, Light under the surface, Clear coat and sheen, Iridescence and anisotropy), api/decals, api/transparency (Alpha modes to Depth bias) and api/custom-materials. Add each to PAGES in tools/lib/docs.ts. Leave a short pointer list near the top of the old page so the anchors still resolve.

Verdict: partly

## Evidence

What holds:
- docs/api/materials.md is a hand-written page, not a generated one. It is the largest API page by far: about 13,700 words. The next largest, api/scene, has about 8,700.
- The heading lines that the finding gives are correct: Decals at 362, Alpha modes at 570, Custom materials at 711.
- Basic topics sit behind special surfaces. Texture maps (line 420), Changing a material (522), Destroying a material (530) and Options fixed at creation (536) come after about 4,900 words on transmission, thin surfaces, subsurface light, clear coat, iridescence and decals.

What does not hold:
- "Scroll past ... moment transparency to find the basics" is wrong. Moment transparency (line 680) comes after texture maps, changing and destroying a material. A reader scrolls past glass, skin, clear coat, iridescence and decals, but not past transparency.
- "Leave a short pointer list near the top of the old page so the anchors still resolve" is wrong. A list of links does not make anchors resolve. About 30 links in other pages point to anchors that would move. Examples: #the-scene-behind-a-surface (5 links), #moment-transparency (4), #weighted-blending (3), #transmission, #alpha-modes, #decals, #custom-materials, in guides/performance, guides/custom-passes, concepts/materials, concepts/quality-presets, shaders/surface-functions, porting/threejs-materials, api/scene, api/objects, api/features and others. Each link must be rewritten.
- Two of the five new pages would duplicate pages that exist now:
  - api/custom-materials: guides/custom-shaders.md has a "Custom materials" section with nearly the same rings example (lines 24-44). shaders/surface-functions.md (about 7,600 words) holds the WGSL detail: scene depth, coverage, shadow offset, reflections, lobes. The 1,927-word Custom materials section on api/materials repeats much of that. A fourth home makes the duplication worse.
  - api/transparency: concepts/materials.md already has "Alpha modes" and "The transparent pass".
- Rule 5 in AGENTS.md says each written API page gets a generated reference page from `@category api/<page>` TSDoc tags. 30 exports are tagged api/materials. A split needs those tags moved to the new pages in packages/*/src, or the new pages have no reference. The finding does not say this.

## Corrected claim

api/materials is the longest API page (about 13,700 words, 50 headings). The standard basics (texture maps, changing, destroying and fixed options) come after about 4,900 words on special surfaces and decals. The custom-materials section (about 1,900 words) repeats guides/custom-shaders and shaders/surface-functions.

## Corrected edit

Do this in place of a five-way split:
1. Reorder the page. Put Texture maps, Relief, Texture coordinate transform, Color, Changing a material, Destroying a material and Options fixed at creation right after Standard values and Specular reflection. The special surfaces, decals and transparency then follow the basics.
2. Wrap the eleven "How it draws" and "Cost of ..." subsections in `<details><summary>Technical details: ...</summary>` blocks. Turn each `###` heading into the block's summary, because a block holds no heading. Keep one plain sentence on cost in the main text where the cost matters to a choice.
3. Cut the Custom materials section down to the `materials.shader` options (`wgsl`, `uniforms`, `textures`, `sceneInputs`, `swayDistance`) and the errors it throws. Move the WGSL detail (scene depth, coverage, shadow offset, reflections) to shaders/surface-functions.md, which already covers most of it, and link there.
4. If the page is still too long after steps 1-3, split out one page only: decals (`materials.decal`) as api/decals. It has its own factory and about 870 words. Add it to PAGES in tools/lib/docs.ts, move the `@category` tag of its exports to api/decals, and rewrite the one inbound #decals link in the same change.
