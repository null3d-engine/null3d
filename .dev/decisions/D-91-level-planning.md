# D-91: How the asset tool plans levels of detail, and merges copies

Status: decided. Built: the level planner and the merging of copies in `assets optimize`. Task: M2-B8.

Summary: `assets optimize --lod` plans levels as Godot does, with normals and colors in the error, and stores each level's error in the mesh's units. 162 of the 213 Kenney models get levels, and 502 of 518 switch cases show no change wider than a pixel's edge. Up to seven levels halve the mesh and then take steeper steps. A desert pebble of 20,480 triangles now ends at 32, not 320. The tool also merges equal meshes, materials, textures and accessors, and takes `--simplify` with an error limit.

## Question

A planner that simplifies positions only skips files whose positions are already integers, and it stores a screen coverage for a screen 1,080 pixels high. With it, 122 of the 213 Kenney city models get no levels. How should the tool plan levels, and what should it store, so that the engine can pick levels by their error in pixels? Should the tool also merge equal meshes, materials and textures? How far can `--simplify` lower S5's Knight?

## Rule

Prototype A3:

- More of the 213 Kenney models get levels than the 91 that a planner of positions only gives.
- At each distance where a level switches in, the picked levels draw the full meshes' image, but for edges that move by a pixel.
- The levels suit S5's Knight, a skinned model.
- Merging copies changes no image.

## Data

All runs were on the owner's Mac, with images from Chrome 155 on the Mac's GPU. The models are the four Kenney city kits of the sample content (213 models) and the KayKit Knight.

### Which models get levels

| Measure | Positions only | This planner |
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

The error is the simplifier's own: the largest distance between the level's surface and the full mesh's. It counts the normal and color differences as distances too. A test page drew each model twice at each distance where some level switches in. One image had the full meshes, and one had the levels that the rule picks just past that distance. The page counted the pixels whose color changed by more than 24 of 255. Among them, it counted the "thick" ones: changed pixels whose four neighbors also changed. An edge that moves by up to a pixel changes thin lines of pixels. A thick pixel shows a wider change.

| Setting | Cases | Cases with thick pixels | Thick pixels of covered pixels | First level's error, median, as a share of the mesh's size |
| --- | --- | --- | --- | --- |
| Normals weight 1.0 (chosen) | 518 | 16 | 82 of 462,856 | 7.8% |
| Normals weight 0.05 when normal seams may move | 543 | 150 | 1,254 of 801,284 | 2.3% |
| The Knight, weight 1.0 | 37 | 0 | 0 of 23,254 | First switch at 12.8 m |
| The Knight, weight 0.05 | 37 | 0 | 0 of 57,441 | First switch at 4.1 m |

At weight 1.0, the worst case is a road bend whose sidewalk edge follows a texture seam: 17 thick pixels of 9,178. Next is a chimney whose thin orange band thins out at 18 pixels tall: 16 of 295. At weight 0.05 the levels switch in nearer. But flat faces then take each other's normals across the edges that move, and the shading jumps.

Levels of positions only have smaller errors, a median of 1.3%, because their error leaves out the normals. On Kenney's `building-a`, a position-only level of 621 triangles moves the surface by 1.75%, measured on the mesh. The normals that such a level moves show the same shading jumps.

Each simplification tries four ways: plain, with pruning of small parts, with normal seams free to move, and both. It keeps the least error among the results that reach the target or come within half the cut. Against one plain try with a permissive retry, the four ways halve the first level's mean error, from 22% to 12% of the mesh's size.

### The error that the engine reads

The simplifier works on the stored positions, after the tool quantizes them. So the errors are in the units of the file's mesh: a mesh of 4 m in 16,383 steps stores errors in steps. A unit test plans a grid from floats and from its quantized copy. Their errors agree within 30%, as a share of the grid's size. A skinned mesh plans in its skeleton's rest pose, as Godot does. Its errors are in the units of the scene that holds the skeleton. A skeleton scaled 100 times gives errors 100 times larger.

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

Over the 214 models, merging joined 26 materials. In the Knight, it joined two equal sword meshes and their 3 accessors. In the tool's test scene, the stand and the posts share 4 accessors. S5's image test and the test scene's image tests pass with the merged files, on the Mac's GPU and on SwiftShader. Their references come from the files without merging.

How the data was produced: scripts beside the branch ran the tool's steps on each model (`count.mjs`, `variants.mjs`). A page drew each model at a distance in Chrome (`proto-a3-images.ts`), through the shared run slots. A script that ran the merge, `--simplify` and reorder steps gave the Knight's sizes. S5's images came from `bun run test:images -g " s5 on"`, with the Vite plugin's `assets` option set.

### How far the levels go

The planner first stopped after six levels of halving. A pebble of the desert benchmark, drawn
60,000 times in instance batches, then ended at 320 triangles, and a boulder at 1,280. From about 21 m
out, every pebble drew those 320 triangles while it covered 1 to 3 pixels. The size rule hid it
only at about 311 m. That came to about 19 M of null3D's 25.3 M triangles in the aerial view. In
the walk view it was 5 M to 7 M of 13.5 M.

The engine takes at most seven levels below a mesh (`MAX_LEVELS` of 8 in
`crates/null3d-render/src/levels.rs`, and `MAX_LOWER_LEVELS` in the engine's `setLevels`). The
bucket keys give the level 3 bits, and a mesh's fading levels fit one byte. The culling shader's
level code for the levels view holds levels 0 to 7. So the planner uses all seven levels, and
takes larger steps at the coarse end where halving would stop above the floor. The fine levels,
which draw near the camera, still halve.

| Mesh, first of each kind | Base | Six halving levels | Seven levels now |
| --- | --- | --- | --- |
| Pebble | 20,480 | 10,240 > 5,120 > 2,560 > 1,280 > 640 > 320 | 10,240 > 5,120 > 2,560 > 1,280 > 640 > 142 > 32 |
| Boulder | 81,920 | 40,960 > ... > 2,560 > 1,280 | 40,960 > 20,480 > 10,240 > 5,120 > 942 > 172 > 32 |
| Column | 518,688 | 259,344 > ... > 16,208 > 8,104 | 259,344 > 129,672 > 64,836 > 9,662 > 1,440 > 324 |
| Arch | 1,023,360 | 511,680 > ... > 31,980 > 15,990 | 511,680 > 255,840 > 127,920 > 16,086 > 2,022 > 658 |

| Errors in the mesh's integer steps | Six halving levels | Seven levels now |
| --- | --- | --- |
| Pebble | 42.3, 83.1, 172, 339, 635, 953 | 42.3, 83.1, 172, 339, 635, 2,190, 4,830 |
| Boulder | 31.0, 59.9, 139, 285, 522, 873 | 31.0, 59.9, 139, 285, 1,470, 4,040, 8,070 |

The errors are the simplifier's own, as for every level, so a coarse level switches in only where
its error covers less than the threshold. A steep step that the simplifier cannot take is worse
than halving. The streamed heightfield test model shows it: its open border of 512 edges stops
the simplifier near 516 triangles. A steep try there stored an error of 4,584 steps for those 516
triangles, where halving stores 3,558. So a steep step that keeps more than three quarters of what
halving aims for halves instead, and that model's levels stay as they were. The column and the arch stop at six levels, at 324 and
658 triangles. Those levels already err by 81% to 99% of the mesh's size. A seventh level would
err by more than the mesh's size, which ends the levels. The
levels of all 16 props meshes take 0.89 to 0.98 times their base mesh's indices.

Raising the engine's limit to 16 levels is rejected for now. It needs a wider level field in the
bucket keys and a new bit layout for the shader's level code. The fade mask must widen through the
core, the WebAssembly entry point and the page API. Each level also adds a draw bucket and a fade
bucket for each pipeline key of each mesh with levels. So a deeper chain pays draws for every
mesh. In the props, the error rule ends the large meshes' levels before the limit does.

How the data was produced: `bun packages/cli/bin/null3d.js assets optimize props.glb out --lod
--clusters --no-blockers --bvh 0` on the desert benchmark's raw props file. It ran once with the
six-level planner and once with this one, on the owner's Mac with no other run beside it. A script read
each node's `MSFT_lod` levels and `NULL3D_lod_error` from the written file. The triangle figures of
the benchmark views come from the coordinator's desert benchmark run. A unit test in
`levels.test.ts` takes a closed sphere of 8,064 triangles to 32 in seven levels, with each error at
least 1.5 times the one above.

## Decision

The tool plans levels with the settings that the task names, and the data meets the rule:

- 162 models get levels, against 91 with positions only.
- At weight 1.0, 502 of 518 cases show no change wider than a pixel's edge. The 16 others change 82 pixels in all, 0.018% of the pixels that the models cover. A lower normal weight brings levels nearer, but the shading jumps in 150 cases, so the normals keep weight 1.0, as in Godot.
- The Knight's levels show no thick change in any of 37 cases.

Settings:

- Meshes of 64 triangles or more get levels. Below that, a level saves too little vertex work for its extra draw.
- Each level aims for half the triangles of the level above while the levels left can still reach a floor of 32 triangles in steps of an eighth. After that, each level aims for the even step that reaches the floor in the levels left, no steeper than an eighth. A steeper step that keeps more than three quarters of what halving aims for halves instead: the simplifier stopped short, as at a locked border, and the steep try errs more for the same triangles. The levels stop at the floor or after 7 levels ([How far the levels go](#how-far-the-levels-go)). They also stop when a level keeps more than halfway between its target and the level above, or when its error reaches the mesh's size.
- Welding merges vertices at one place with equal texture coordinates, colors and tangent handedness, and normals within 20 degrees.
- Texture and color seams hold (lock value 2) when normal seams move.
- Skinned and morphed meshes add `Regularize`.
- Each node with levels stores the errors in its extras as `NULL3D_lod_error`, one per level in `MSFT_lod`'s order. The engine reads them for the screen-error rule. The tool also writes `MSFT_screencoverage` for other readers, for a screen 1,080 pixels high.
- `--simplify` keeps the default error limit of 0.01, as gltfpack's, and `--simplify-error` raises it. S5 keeps its full Knight: at 0.05 the crowd's image changes in 0.65% of its pixels.
- The tool merges equal textures, materials, meshes and mesh accessors, with no option. Accessors merge again after the reorder and quantize steps, which give a shared stream a copy for each mesh.

## Consequences

- `packages/cli/src/assets/levels.js` holds the planner, `dedup.js` the merging. The command and the Vite plugin document `--lod`'s rule, and take `--simplify` and `--simplify-error`.
- `docs/guides/assets-pipeline.md`, `docs/cli/null3d.md` and `docs/concepts/lod.md` (experimental) describe the levels and the stored error.
- The engine boxes a loaded skinned model as its joints place it at rest ([D-93](D-93-skinned-meshes-in-batches.md)). A box from the node alone would make the Knight's bounds about 16,000 units wide.
- M2-I4's screen-error rule reads `NULL3D_lod_error`.
