# Verdict on api-3-readability-09

## The finding as given

```json
{
 "page": "api/water",
 "anchor": "## Waterfalls (line 272), ## The ocean (line 368), Mermaid diagram lines 13-32",
 "category": "split-page",
 "severity": "medium",
 "claim": "One page covers rivers and lakes, waterfalls and the open ocean. The diagram joins all three in 20 nodes, so it explains none at a glance. A reader who wants the ocean must read shapes, foam, wind, rain, tint and underwater first.",
 "evidence": "stats.json: 6,086 words, 18 headings; intro paragraphs at lines 34, 36 and 38 each describe a different product.",
 "proposedEdit": "Keep api/water for rivers and lakes. Move Waterfalls to a new api/waterfalls page and The ocean to a new api/ocean page. Give each its own short diagram and its own cost bullets (lines 459 and 471). If they stay together, split the diagram into three small ones, one at the top of each section.",
 "generatedSource": "tools/lib/docs.ts (PAGES entries, only if new pages are added)",
 "id": "api-3-readability-09",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: partly

## Evidence

The diagram part holds.
- docs/api/water.md lines 13-32 hold one flowchart with 19 nodes (not 20). It draws three flows that barely touch: river and lake (shape, body, mesh, material, bed), the ocean (spectrum, transform, sea's material) and the waterfall (lip, path, sheet, spray). Only the reflection pass and the preset link them, and the underwater node joins nothing. A reader cannot see one flow at a glance.

The page split does not hold.
- Every add-on API page covers one npm package: api/particles, api/terrain, api/grass, api/splats, api/sound, api/wind and api/water (tools/lib/docs.ts lines 138-145). api/controls covers orbit, fly and gizmo controls on one page in the same way. Two new pages for one package break that pattern.
- The page is not an outlier. In stats.json, api/water (6,086 words) is the 8th longest API page. api/materials has 13,672, api/scene 8,672, and api/debug, api/post, api/animation, api/render and api/assets are all longer.
- "A reader who wants the ocean must read shapes, foam, wind, rain, tint and underwater first" is wrong. The ocean has its own heading (line 368), and the intro (line 38) names createOcean. A reader can jump to the heading.
- A waterfall depends on a river. The waterfall example (lines 296-328) calls createWater and createWaterfall together, and line 330 says to end the river's surface at the lip. A separate waterfall page would have to repeat the river setup.
- The cost bullets share facts across the three products. "One water a page" (line 465) says the ocean is a separate feature, so a page may draw a river and a sea. The reflection cadence bullet covers both.
- The generatedSource is incomplete. The API reference splits by the TSDoc `@category api/<page>` tag. A split would also need new tags on the ocean and waterfall exports (packages/water/src/ocean.ts, spectrum.ts, waterfall.ts, fall.ts) and two new reference pages. A PAGES entry alone is not enough.

Not part of this finding, but noticed: the PAGES summary for api/water (tools/lib/docs.ts line 144) leaves out createWaterfall and createOcean. The page's front matter names both.

## Corrected claim

The single top diagram packs three mostly separate flows (river and lake, waterfall, ocean) into 19 nodes, so it explains none at a glance. The page itself is a normal one-package API page. Its sections already let a reader jump to the waterfall or the ocean.

## Corrected edit

Keep one api/water page. Do not add api/waterfalls or api/ocean.
1. Cut the top diagram down to the river and lake flow: shape, body, mesh, material, the reflection pass, the bed, and the camera under the surface for createUnderwater.
2. Put a small diagram at the top of "## Waterfalls" (lip, path of falling water, column, spray and mist, fall) and one at the top of "## The ocean" (spectra, transform, sea's material, reflection pass, sea).
3. In the intro paragraphs on createWaterfall (line 36) and createOcean (line 38), link to their sections ([Waterfalls](#waterfalls), [The ocean](#the-ocean)), so a reader who wants only one can jump there.
4. Keep the cost bullets in "## Costs and limits". They share facts across the products.

The source to edit is docs/api/water.md itself. It is a written page, not a generated one.
