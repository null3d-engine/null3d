# guides-1-readability-23

## Finding as given

- page: guides/baked-light-data
- anchor: ## Needle light maps (line 126), line 137
- category: structure
- severity: medium
- claim: The page is the reference of the null3D baked light file, but '## Needle light maps' describes a glTF extension that the glTF loader reads. It breaks the load, save, check order. Line 137 (both calls throw E1434) belongs with '## What the loader checks' but ends the Needle section.
- evidence: line 128 'carries its light maps in glTF's `NEEDLE_lightmaps` extension'; line 137 'Both calls throw [E1434](../errors/E1434.md) for a file that the engine cannot read.'
- proposedEdit: Move line 137 to the top of '## What the loader checks'. Move the Needle section to the end of the page as 'Light maps in Needle models', or to the glTF loading page with a link from here.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/guides/baked-light-data.md:137 is about the null3D file loaders (`loadLightProbeGrid`, `loadLightMap`) and E1434. It sits under "## Needle light maps" (line 126). There, "Both calls" has no referent: the Needle section names no calls, and the two calls were last named in "## Load a file" (lines 120-122). A reader can think the Needle loader throws E1434. This part of the claim holds.
- Line 137 also repeats the opening of "## What the loader checks" (line 159, "Each fault comes with a message that names it") and two items of its list (version, lines 162; cut-short download, line 164; payload count, lines 166-169). So the sentence belongs there.
- The Needle section is out of the file's load, save, check flow, and the page summary (frontmatter line 6) does not mention it. Moving it to the end of the page holds.
- The section is on this page on purpose. docs/api/assets.md:95 (the hand-written glTF loader table, the "glTF loading page") gives the one-row summary of `NEEDLE_lightmaps` and links here for the detail with the anchor `../guides/baked-light-data.md#needle-light-maps`. docs/concepts/assets.md:43 only lists the extension. Moving the section to the glTF page would put a bulleted section into a page that covers each extension in one table row, and it would remove the detail target of that link. That option is weaker.
- The proposed new heading "Light maps in Needle models" changes the anchor to `#light-maps-in-needle-models`. That breaks the link at docs/api/assets.md:95 unless that link is updated too. The finding does not say so.
- Moving line 137 unchanged to the top of "What the loader checks" keeps the "Both calls" problem: that section follows "## Save a grid that the engine baked", which names `lightProbeGridFile`, a third call. The sentence must name the two calls.

## Corrected claim

Line 137 is misplaced: it describes the null3D file loaders and E1434, but it ends the Needle section, where "Both calls" has no referent and seems to apply to the glTF loader. It also repeats line 159 and the list under "What the loader checks". The Needle section is out of the load, save, check order and fits better at the end of the page. It should stay on this page, because docs/api/assets.md:95 links to it as the detail of its one-row summary.

## Corrected edit

1. Delete line 137. Replace line 159 with one opening that names the calls: "`loadLightProbeGrid` and `loadLightMap` throw [E1434](../errors/E1434.md) for a file whose contents do not agree with its own members. The message names the fault, which is one of these:"
2. Move "## Needle light maps" (lines 126-135) to the end of the page, after "## Limits". Keep the heading text, so the anchor `#needle-light-maps` that docs/api/assets.md:95 uses still works. If the heading is renamed, update that link in docs/api/assets.md in the same change.
3. Do not move the section to docs/api/assets.md.
