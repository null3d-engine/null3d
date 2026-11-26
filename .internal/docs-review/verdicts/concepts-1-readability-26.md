# Verdict: concepts-1-readability-26

## The finding as given

- Page: concepts/lod
- Anchor: "## API reference" (239-241); line 237 "the demo `examples/impostors`"
- Category: example-placement. Severity: medium.
- Claim: This is the only page in the slice with no Related pages section. It names a demo as plain code text, not a link. The forest demo (titled "Levels of detail") is not linked anywhere.
- Evidence: lod.md:237, 239-241; examples/demos.ts:955 forest/ "Levels of detail", 973 impostors/, 894 terrain/
- Proposed edit: Rename "## API reference" to "## Related pages". List the geometry reference, quality page, asset pipeline#levels-of-detail, impostors API and shadows, plus https://github.com/null3d-engine/null3d/tree/main/examples/forest/, .../examples/impostors/ and .../examples/terrain/. At line 237, link the impostors demo. Add the forest demo link under "Levels from the asset tool".

Verdict: partly

## Evidence

- "Only page in the slice with no Related pages section" is wrong. The slice holds ten pages (findings/concepts-1-readability.md:3). A count of "## Related" headings gives 0 for concepts/lod and also 0 for concepts/assets. The assets page ends with "## Uploads and memory" (assets.md:122) and has no closing link list.
- The rest holds. lod.md:237 ends "the demo `examples/impostors` draws a forest three ways by distance": plain code text, no link. stats.json gives exampleLinks = [] for concepts/lod. No page under docs/ links examples/forest; the only mention is plain text in docs/api/wind.md:326. The forest demo has code "forest/" and title "Levels of detail" in examples/demos.ts, and a reference image exists (tests/image/references/chrome-real-gpu/<tier>/demo-forest.png).
- lod.md:239-241 "## API reference" holds one sentence with two links. Every other concept page in the slice with a closing list calls it "## Related pages" (culling.md:221, shadows.md:441 and others), so the rename fits the docs.
- The proposed placement of the forest link is wrong. The forest demo does not use the asset tool. examples/forest/sketch.ts:1-9 says its trees "are made in code at four levels of detail each, and each base mesh names its three coarser levels with their errors". That is "## Give a mesh its levels by hand" (lod.md:41). Its hero fir keeps detail through its own bias, which is "## The bias of one object" (lod.md:151). Put under "Levels from the asset tool" (lod.md:77), the link would tell the reader the demo shows the asset tool.
- The terrain demo link is weak. The page mentions terrain once, for the morphing blocks (lod.md:184). It is a fair link in that paragraph, but not a core LOD demo for the closing list.

## Corrected claim

Two of the ten slice pages (concepts/lod and concepts/assets) have no Related pages section. On concepts/lod, the impostors demo appears as plain code text (line 237), and the forest demo, whose title is "Levels of detail", is not linked from the page or from any other docs page.

## Corrected edit

- Rename "## API reference" (239) to "## Related pages". Make it a list: the geometry reference (../api/reference/geometry.md), [the quality page](../api/quality.md), [the asset pipeline](../guides/assets-pipeline.md#levels-of-detail), [Impostors](../api/impostors.md), [Shadows](shadows.md), [the forest demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest/) (trees made in code with levels given by hand) and [the impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors/).
- At line 237, make "the demo `examples/impostors`" a link: "[the impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors/)".
- Put the in-text forest link in "## Give a mesh its levels by hand" (41), or in "## The bias of one object" (151) for its hero fir, not in "Levels from the asset tool". For example: "[The forest demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest/) gives each tree three coarser levels this way."
- The terrain demo link is optional. If used, put it beside the terrain morph sentence at line 184, not in the closing list.
- Give concepts/assets its own Related pages finding if wanted. It is not part of this one.
