# concepts-1-substance-10

## Finding as given

- Page: concepts/lod
- Anchor: Whole page; line 237 "the demo `examples/impostors` draws a forest three ways by distance"
- Category: missing-content. Severity: medium.
- Claim: This page has no demo links and no 'Related pages' section, which the other nine concept pages have. The forest demo shows the page's main ideas: trees made in code at four levels, a per-object bias, and an understory that fades at its own distance. The impostors demo is named only as plain text.
- Evidence: stats.json concepts/lod exampleLinks is empty; examples/demos.ts:952-968 (forest, code forest/, key B toggles the hero fir's bias, key L toggles levels); examples/demos.ts:970 (impostors, code impostors/).
- Proposed edit: Under '## Levels of meshes made in code', add '[The levels of detail demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest/) plants 56,000 trees made in code at four levels.' At line 237, link '[the impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors/)'. Add '## Related pages': geometry, quality presets, asset pipeline, impostors, culling, shadows.

Verdict: partly

## Evidence

- The core holds. docs/concepts/lod.md has no GitHub demo link (stats.json exampleLinks is []) and no "## Related pages" heading. It ends with "## API reference" (line 239). Line 237 names `examples/impostors` as plain code text, not a link.
- The forest demo matches the page: examples/demos.ts:952-968 (code 'forest/', title "Levels of detail", key B for the hero fir's bias, key L for levels on/off). examples/forest/woods.ts:283-288 calls `setLevelBias`; examples/forest/planting.ts:85 calls `setDrawRange` on the understory. The impostors demo is at demos.ts:970-983 with code 'impostors/'. Both demos have reference images under tests/image/references/chrome-real-gpu/{webgpu,compat,webgl2}/.
- Wrong: "which the other nine concept pages have". Many concept pages have no demo link: architecture, backends, handles, materials, particle-buffer, post-processing, quality-presets, static-dynamic (and assets). Most concept pages do have "## Related pages" (assets.md and the generated quality-preset-tables.md do not). So the gap is real for Related pages but not a uniform rule for demo links.
- Wrong place for the forest link. The proposed edit puts it under "## Levels of meshes made in code", which describes levels that the engine plans by itself. The forest demo does not use that plan. examples/lib/trees.ts:200-206 builds four levels with their own errors and calls `base.mesh.setLevels(coarser)`; examples/forest/sketch.ts:3-4 says "each base mesh names its three coarser levels with their errors". Under the planning section, the link would tell a reader the demo shows automatic levels. It shows levels given by hand, the per-object bias and a distance band.
- The 56,000 figure is for desktop only. The demo draws 8,000 trees on phones (demos.ts summary; sketch.ts:8).

## Corrected claim

The page has no demo links and no "Related pages" section, unlike most concept pages. The forest demo shows levels given by hand with their errors, the per-object bias and a distance band on the understory. The impostors demo is named only as plain text at line 237.

## Corrected edit

- Under "## Give a mesh its levels by hand" (after the paragraph that ends "as the next section shows."), add: "[The levels of detail demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest/) gives four kinds of tree made in code four levels each, with their errors, over 56,000 trees (8,000 on phones). Press B to turn the hero fir's bias on and off, and L to turn levels off."
- At line 237, replace "the demo `examples/impostors` draws a forest three ways by distance" with "[the impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors/) draws a forest three ways by distance".
- After "## API reference", add "## Related pages" with links to ../api/geometry.md#levels-of-detail, quality-presets.md, ../guides/assets-pipeline.md#levels-of-detail, ../api/impostors.md, culling.md and shadows.md, each with a short reason, in the style of culling.md's list.
