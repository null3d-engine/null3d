# api-3-readability-04

## The finding as given

- Page: api/terrain
- Anchor: ## How it works, lines 68-106
- Category: missing-content
- Severity: high
- Claim: createTerrain's options appear only inside prose: size, height, camera, layers (map, tile, roughness, heightFrom, contrast), splat, error, maxLevel, bakedNormals, steepFaces, morph, blocksPerUpdate, maxBlocks. The terrain object's members (update, heightAt, normalAt, building, setVisible, setTint) are spread over two sections. A reader cannot scan for an option or its default.
- Evidence: line 76 'The error option sets the allowed error in pixels.'; line 104 'terrain.setVisible(false) hides the ground ... terrain.setTint(color) multiplies the ground's own colors'. The water, sprites and render pages give an options table for each create call.
- Proposed edit: After the example, add '## Options' (Option | Takes | Default | What it sets) with every option above, and '## The terrain object' (Member | What it does). Then cut the option definitions from the prose in How it works, Layers and the splat map, and Speed, and keep only what each part does.

Verdict: partly

## Evidence

- True: docs/api/terrain.md has no table. Options are named only in prose (lines 76, 80, 82, 92, 94, 104). Members are spread over lines 62, 70, 98 and 104, not two sections but three or four. Sibling pages do give a table on the written page: water.md:96 and :125, sprites.md:81, render.md:42, particles.md:67.
- False: "A reader cannot scan for an option or its default." The generated page docs/api/reference/terrain.md has full scannable tables with every default: `TerrainOptions` (19 options), `TerrainLayer` (map, tile default 8, roughness, contrast, heightFrom) and `Terrain` (every member). The written page links it under "## API reference" (terrain.md:116-118). So the gap is one of placement and discovery, not missing content. Severity high ("blocks a newcomer") is overstated; medium fits.
- The finding's option list is incomplete. The page and the proposed table would omit resolution, splatResolution, chunkQuads, skirt, metalness, castShadows and receiveShadows. The member list omits setMorph, destroy, drawn, triangles and heightfield. A table of "every option above" would look complete and is not.
- The proposed cut is wrong. The prose at lines 74-82 and 104 explains why each option behaves as it does (screen error through the field of view, the morph toward the parent, the mesh pool). That is "how it works" content, and a table cannot carry it.
- AGENTS.md "Docs and skills stay in sync", rule 1: one source per fact, and the API reference comes from TSDoc. A hand-written defaults column repeats the TSDoc defaults (for example `error` = 35 times `lodThreshold`, `maxBlocks` 512, `tile` 8) and can drift. The sibling pages accept this cost, so it is a risk, not a ban.

## Corrected claim

The terrain page names its options and the terrain object's members only in prose, spread over several sections, and gives no table, unlike water, sprites, render and particles. The full option and member tables with defaults exist on the linked API reference page, but the written page points to them only at its end. Severity: medium.

## Corrected edit

1. Right after the example, add one sentence that links the tables: "[`TerrainOptions`](reference/terrain.md#terrainoptions) lists every option with its default, [`TerrainLayer`](reference/terrain.md#terrainlayer) every layer field, and [`Terrain`](reference/terrain.md#terrain-1) every member of the object that `createTerrain` returns." (Check the generated anchor of the `Terrain` heading; it may be `#terrain`.)
2. If a table on the page is wanted for parity with water and sprites, add "## Options" with Option | What it sets | Explained in, covering all 19 options, and "## The terrain object" with every member, including setMorph and destroy. Leave the default column out and let the reference page hold the defaults, or, if defaults go in, copy every one exactly from the TSDoc in packages/terrain/src.
3. Keep the prose in How it works, Layers and the splat map, and Speed. Do not cut it. Where it is dense (the morph paragraph at line 82, the build paragraph at line 104), move the implementer detail into a closed `<details>` block, "Technical details: ...", so the main text still reads with the block shut.
