# D-91: How the asset tool plans levels of detail, and merges copies

Status: decided. Date: 2026-10-07. Task: M2-B8.

Summary: `assets optimize --lod` plans levels as Godot does. It welds vertices, counts normals and colors in the error at weight 1.0, halves each level, and stores each level's error in the mesh's units. 162 of the 213 Kenney models get levels, against 91 before. At each switch distance, 502 of 518 cases draw the full meshes' image but for edges that move by a pixel. The tool also merges equal meshes, materials, textures and accessors, and takes `--simplify` with an error limit.

## Question

`assets optimize --lod` simplified positions only. It skipped files whose positions were already integers, and it stored a screen coverage for a screen 1,080 pixels high. 122 of the 213 Kenney city models got no levels. How should the tool plan levels, and what should it store, so that the engine can pick levels by their error in pixels? Should the tool also merge equal meshes, materials and textures? How far can `--simplify` lower S5's Knight?

## Rule

Prototype A3:

- More of the 213 Kenney models get levels than the 91 of the old tool.
- At each distance where a level switches in, the picked levels draw the full meshes' image, but for edges that move by a pixel.
- The levels suit S5's Knight, a skinned model.
- Merging copies changes no image.

## Data

All runs were on the owner's Mac on 7 October 2026, with images from Chrome 155 on the Mac's GPU. The models are the four Kenney city kits of the sample content (213 models) and the KayKit Knight.

### Which models get levels

| Measure | Old tool | New tool |
| --- | --- | --- |
| Kenney models with levels | 91 of 213 | 162 of 213 |
| Models of 256 triangles or more | 91 of 91 | 91 of 91 |
| Models of 128 to 255 triangles | 0 of 48 | 48 of 48 |
| Models of 64 to 127 triangles | 0 of 29 | 23 of 29. The other 6 are flat road pieces that cannot lose a quarter of their triangles |
| Models under 64 triangles | 0 of 45 | 0 of 45 |
| Knight meshes with levels | 14 | 14 of 14 (one copy merged away) |
| Lower levels per Kenney mesh | 3 or fewer | 1: 18 meshes, 2: 64, 3: 32, 4: 26, 5: 9, 6: 15 |
| Planning time, all 214 models | | 0.74 s in all; the Knight 52 ms |

### Errors and images

The error is the simplifier's own: the largest distance between the level's surface and the full mesh's. It counts the normal and color differences as distances too. A test page drew each model twice at each distance where some level switches in. One image had the full meshes, and one had the levels that the rule picks just past that distance. The page counted the pixels whose color changed by more than 24 of 255. Among them, it counted the "thick" ones: changed pixels whose four neighbours also changed. An edge that moves by up to a pixel changes thin lines of pixels. A thick pixel shows a wider change.

| Setting | Cases | Cases with thick pixels | Thick pixels of covered pixels | First level's error, median, as a share of the mesh's size |
| --- | --- | --- | --- | --- |
| Normals weight 1.0 (chosen) | 518 | 16 | 82 of 462,856 | 7.8% |
| Normals weight 0.05 when normal seams may move | 543 | 150 | 1,254 of 801,284 | 2.3% |
| The Knight, weight 1.0 | 37 | 0 | 0 of 23,254 | First switch at 12.8 m |
| The Knight, weight 0.05 | 37 | 0 | 0 of 57,441 | First switch at 4.1 m |

At weight 1.0, the worst case is a road bend whose sidewalk edge follows a texture seam: 17 thick pixels of 9,178. Next is a chimney whose thin orange band thins out at 18 pixels tall: 16 of 295. At weight 0.05 the levels switch in nearer. But flat faces then take each other's normals across the edges that move, and the shading jumps.

The old tool's levels had smaller errors, a median of 1.3%, because its error left out the normals. On Kenney's `building-a`, a position-only level of 621 triangles moved the surface by 1.75%, measured on the mesh. The normals that such a level moves show the same shading jumps.

Each simplification tries four ways: plain, with pruning of small parts, with normal seams free to move, and both. It keeps the least error among the results that reach the target or come within half the cut. Against one plain try with a permissive retry, the first level's mean error halved, from 22% to 12% of the mesh's size.

### The error that the engine reads

The simplifier works on the stored positions, after the tool quantizes them. So the errors are in the units of the file's mesh: a mesh of 4 m in 16,383 steps stores errors in steps. A unit test plans a grid from floats and from its quantized copy. Their errors agree within 30%, as a share of the grid's size. A skinned mesh plans in its skeleton's rest pose, as Godot does. Its errors are in the units of the scene that holds the skeleton. A skeleton scaled 100 times gave errors 100 times larger.

### `--simplify` on the Knight

| Error limit, share of each mesh's size | Share kept | S5's Knight (vertices, triangles) |
| --- | --- | --- |
| None | 1 | 4,957, 5,296 |
| 0.01 (the default, as gltfpack's) | 0.5 or 0.25 | 4,873, 5,180 |
| 0.02 | 0.5 or 0.25 | 4,378, 4,520 |
| 0.05 | 0.5 | 2,951, 2,740 |
| 0.05 | 0.25 | 2,713, 2,398 |
| 0.1 | 0.25 | 2,166, 1,748 |

S5's image test with the Knight at `simplify: 0.5, simplifyError: 0.05` changed 0.64% to 0.67% of the pixels on all three GPU paths. The changes are single pixels spread over the crowd. The test allows 0.1%. At 0.25 the figures are 0.64% to 0.65%.

### Merging copies

Over the 214 models, merging joined 26 materials. In the Knight, it joined two equal sword meshes and their 3 accessors. In the tool's test scene, the stand and the posts share 4 accessors. S5's image test and the test scene's image tests passed with the merged files, on the Mac's GPU and on SwiftShader. No reference changed.

How the data was produced: on 7 October 2026, scripts beside the branch ran the tool's steps on each model (`count.mjs`, `variants.mjs`). A page drew each model at a distance in Chrome (`proto-a3-images.ts`), through the shared run slots. A script that ran the merge, `--simplify` and reorder steps gave the Knight's sizes. S5's images came from `bun run test:images -g " s5 on"`, with the Vite plugin's `assets` option set.

## Decision

The tool plans levels with the settings that the task names, and the data meets the rule:

- 162 models get levels, against 91.
- At weight 1.0, 502 of 518 cases show no change wider than a pixel's edge. The 16 others change 82 pixels in all, 0.018% of the pixels that the models cover. A lower normal weight brings levels nearer, but the shading jumps in 150 cases, so the normals keep weight 1.0, as in Godot.
- The Knight's levels show no thick change in any of 37 cases.

Settings:

- Meshes of 64 triangles or more get levels. Below that, a level saves too little vertex work for its extra draw.
- Each level aims for half the triangles of the level above. The levels stop when one keeps over three quarters, or its error reaches the mesh's size, or after 6 levels.
- Welding merges vertices at one place with equal texture coordinates, colors and tangent handedness, and normals within 20 degrees.
- Texture and color seams hold (lock value 2) when normal seams move.
- Skinned and morphed meshes add `Regularize`.
- Each node with levels stores the errors in its extras as `NULL3D_lod_error`, one per level in `MSFT_lod`'s order. The engine reads them for the screen-error rule. The tool still writes `MSFT_screencoverage` for other readers, for a screen 1,080 pixels high.
- `--simplify` keeps the default error limit of 0.01, as gltfpack's, and `--simplify-error` raises it. S5 keeps its full Knight: at 0.05 the crowd's image changes in 0.65% of its pixels.
- The tool merges equal textures, materials, meshes and mesh accessors, with no option. Accessors merge again after the reorder and quantize steps, which give a shared stream a copy for each mesh.

## Consequences

- `packages/cli/src/assets/levels.js` holds the planner, `dedup.js` the merging. `--lod` documents its new rule, and `--simplify` and `--simplify-error` are new, in the command and the Vite plugin.
- `docs/guides/assets-pipeline.md`, `docs/cli/null3d.md` and `docs/concepts/lod.md` (now experimental) describe the levels and the stored error.
- The engine took a loaded skinned model's bounds from its node, not its skin. So the Knight's bounds were about 16,000 units wide. D-93 fixes it.
- The engine does not read `NULL3D_lod_error` yet. M2-I4's screen-error rule reads it.
