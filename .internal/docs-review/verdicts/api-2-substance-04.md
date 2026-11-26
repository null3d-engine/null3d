# Verdict on api-2-substance-04

## The finding as given

- id: api-2-substance-04 (slice api-2, role substance)
- page: api/materials
- anchor: heading outline, ## Transmission to ## Texture maps
- category: scan-order
- severity: medium
- claim: The page is 13,672 words long. A newcomer who wants texture maps, colors, set, alpha modes or blending must first scroll past transmission, diffuse transmission, subsurface light, clear coat, sheen, iridescence, anisotropy and decals. Texture maps starts at line 420 and Alpha modes at line 570.
- evidence: stats.json headings for api/materials; docs/api/materials.md:131-418 against 420-700.
- proposedEdit: Reorder the page: The materials, Standard values, Color, Texture maps, Texture coordinate transform, Changing a material, Destroying a material, Options fixed at creation, Alpha modes, Blending, Depth bias, Shadow catchers. Then the advanced surfaces (Transmission, Light through thin surfaces, Light under the surface, Clear coat and sheen, Iridescence and anisotropy, Relief, Decals), then Custom materials, Ranges, Limits. Add a contents line under the intro, or split the advanced surfaces into a page of their own.
- generatedSource: (none; the page is hand-written)

Verdict: partly

## Evidence

- The facts hold. stats.json gives 13,672 words. docs/api/materials.md has `## Texture maps` at line 420, `## Alpha modes` at 570, `## Color` at 518 and `## Changing a material` at 522. Transmission (131), Light through thin surfaces (176), Light under the surface (219), Clear coat and sheen (252), Iridescence and anisotropy (308) and Decals (362) all come first.
- The cost to a reader is real. The Standard values table (lines 65-108) links to `#color` in many rows, but the Color section sits about 450 lines lower. `set`, the first thing a reader of the intro example uses (line 29), is explained only at line 524.
- The page has no contents line under the intro (lines 9-32).
- The concept page docs/concepts/materials.md does not fill the gap: it covers pipelines, alpha modes and the transparent pass, not texture maps, color input or `set`.

## What does not hold in the proposed edit

1. The proposed order leaves out three sections of level two: "Specular reflection and index of refraction" (line 112), "Invisible surfaces that hide" (610) and "Double-sided blended surfaces" (624). They must have a place. Specular goes with the advanced surfaces (or right after Standard values). The two others go between Alpha modes and Blending, where they are now.
2. The last paragraph of Standard values (line 110) says "The next sections explain the specular, transmission, diffuse transmission and layer values." After the reorder that is false. Rewrite it to point to the advanced sections by link.
3. Relief (474) covers the normal, bump and displacement maps, whose scales are core Standard values (`normalScale`, `bumpScale`, `displacementScale`). It belongs right after Texture maps, not in the advanced group.
4. The split option has a cost the finding does not name. Other pages link to the advanced anchors: `materials.md#transmission` (3 links), `#clear-coat-and-sheen` (2), `#iridescence-and-anisotropy` (2), `#light-through-thin-surfaces` (2), `#light-under-the-surface`, `#decals`, `#mirrors-polished-floors-and-water`, `#the-scene-behind-a-surface` (5). A split must update every one of them. A reorder in the same page keeps all anchors, so prefer the reorder plus a contents line.

## Corrected claim

The page is 13,672 words long, has no contents line, and puts the advanced surfaces (lines 112-418) before the everyday material sections. Texture maps starts at line 420, Color at 518, `set` at 522 and Alpha modes at 570, although the Standard values table and the intro example rely on Color and `set`.

## Corrected edit

Keep one page and reorder it: The materials, Standard values, Color, Texture maps, Relief, Texture coordinate transform, Changing a material, Destroying a material, Options fixed at creation, Alpha modes, Invisible surfaces that hide, Double-sided blended surfaces, Blending, Depth bias, Shadow catchers. Then the advanced surfaces: Specular reflection and index of refraction, Transmission, Light through thin surfaces, Light under the surface, Clear coat and sheen, Iridescence and anisotropy, Decals. Then Custom materials, Ranges, Limits, Related pages, API reference. Rewrite the closing sentence of Standard values to link to the advanced sections. Add a one-line contents list under the intro that names the everyday sections and the advanced group. Do not split the page unless every inbound anchor on other pages is updated in the same change.
