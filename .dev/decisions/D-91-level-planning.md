# D-91: How the asset tool plans levels of detail, and merges copies

Status: decided. Built: the level planner and the merging of copies in `assets optimize`. Task: M2-B8.

Summary: `assets optimize --lod` plans levels as Godot does, with normals and colors in the error, and stores each level's error in the mesh's units. 162 of the 213 Kenney models get levels, and 502 of 518 switch cases show no change wider than a pixel's edge. Levels halve the mesh down to about 32 triangles, in up to 15 levels. A desert pebble of 20,480 triangles now ends at 40, not 320. The tool also merges equal meshes, materials, textures and accessors, and takes `--simplify` with an error limit.

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
60,000 times in instance batches, then ended at 320 triangles, and a boulder at 1,280. From about
21 m out, every pebble drew those 320 triangles while it covered 1 to 3 pixels. The size rule hid
it only at about 311 m. That came to about 19 M of null3D's 25.3 M triangles in the aerial view.
In the walk view it was 5 M to 7 M of 13.5 M.

So the planner now halves down to a floor of 32 triangles. A level of fewer than 64 triangles ends
the levels, since one more would save too little. The engine takes up to 15 levels below a mesh
([D-137](D-137-lod-groups.md#how-many-levels-a-mesh-takes)). Halving takes a mesh of about a
million triangles to the floor in 15 levels. The levels still stop early when a level keeps more
than three quarters of the level above, as where a locked border stalls the simplifier, or when
its error reaches the mesh's size.

| Mesh, first of each kind | Base | Six halving levels | Halving to the floor now |
| --- | --- | --- | --- |
| Pebble | 20,480 | 10,240 > 5,120 > 2,560 > 1,280 > 640 > 320 | 10,240 > ... > 320 > 160 > 80 > 40 |
| Boulder | 81,920 | 40,960 > ... > 2,560 > 1,280 | 40,960 > ... > 1,280 > 640 > 320 > 160 > 80 > 40 |
| Column | 518,688 | 259,344 > ... > 16,208 > 8,104 | 259,344 > ... > 8,104 > 4,052 > 2,026 > 1,012 > 506 > 306 |
| Arch | 1,023,360 | 511,680 > ... > 31,980 > 15,990 | 511,680 > ... > 15,990 > 7,994 > 3,996 > 1,998 > 998 > 658 |

| Errors in the mesh's integer steps | Halving to the floor now |
| --- | --- |
| Pebble | 42.3, 83.1, 172, 339, 635, 953, 1,490, 2,440, 3,660 |
| Boulder | 31.0, 59.9, 139, 285, 522, 873, 1,470, 2,240, 3,360, 5,040, 7,560 |

The pebble takes 9 levels, and the boulder, the column and the arch take 11 each. The column stops
at 306 triangles and the arch at 658, whose errors are 93% and 98% of their size. A next level
would err by more than the mesh's size, which ends the levels.

#### Steeper steps instead of more levels

The engine first took only seven levels below a mesh. So the planner tried halving while the
levels left could still reach the floor in steps of an eighth, then took steeper steps. That option
is rejected: the steep steps sat in the middle of the chain, where copies draw at mid distance. A
boulder went from 5,120 straight to 942, and an arch from 127,920 to 16,086. So the mid level stayed
in use much farther out. On the desert benchmark's walk view, the pebbles fell from 3.47 M to
2.19 M triangles, but the boulders rose from 2.57 M to 3.69 M, the arches from 5.15 M to 5.88 M and
the columns from 0.96 M to 1.07 M, against six halving levels. The coordinator measured those
figures. A steep step that the simplifier cannot take was also worse than halving. The streamed
heightfield test model, whose open border stops the simplifier near 516 triangles, stored an
error of 4,584 steps for those triangles, where halving stores 3,558.

The desert benchmark with the steep chain and with halving to the floor, both on the engine that
takes 15 levels, gives [D-137](D-137-lod-groups.md#how-many-levels-a-mesh-takes)'s figures.

How the data was produced: `bun packages/cli/bin/null3d.js assets optimize` with `--lod` on the
desert benchmark's raw props file, through `bench/meshlets/build.ts` of the comparison's checkout,
on the owner's Mac with no other run beside it. A script read each node's `MSFT_lod` levels and
`NULL3D_lod_error` from the written file. A unit test in `levels.test.ts` halves a closed sphere of
32,512 triangles past seven levels down to the floor, with each error at least 1.5 times the one
above.

## Decision

The tool plans levels with the settings that the task names, and the data meets the rule:

- 162 models get levels, against 91 with positions only.
- At weight 1.0, 502 of 518 cases show no change wider than a pixel's edge. The 16 others change 82 pixels in all, 0.018% of the pixels that the models cover. A lower normal weight brings levels nearer, but the shading jumps in 150 cases, so the normals keep weight 1.0, as in Godot.
- The Knight's levels show no thick change in any of 37 cases.

Settings:

- Meshes of 64 triangles or more get levels. Below that, a level saves too little vertex work for its extra draw.
- Each level aims for half the triangles of the level above. The levels stop at a floor: a level of fewer than 64 triangles ends them ([How far the levels go](#how-far-the-levels-go)). They also stop after 15 levels, when a level keeps more than three quarters of the level above, or when its error reaches the mesh's size.
- Welding merges vertices at one place with equal texture coordinates, colors and tangent handedness, and normals within 20 degrees.
- Texture and color seams hold (lock value 2) when normal seams move.
- Skinned and morphed meshes add `Regularize`.
- Each node with levels stores the errors in its extras as `NULL3D_lod_error`, one per level in `MSFT_lod`'s order. The engine reads them for the screen-error rule. The tool also writes `MSFT_screencoverage` for other readers, for a screen 1,080 pixels high.
- `--simplify` keeps the default error limit of 0.01, as gltfpack's, and `--simplify-error` raises it. S5 keeps its full Knight: at 0.05 the crowd's image changes in 0.65% of its pixels.
- The tool merges equal textures, materials, meshes and mesh accessors, with no option. Accessors merge again after the reorder and quantize steps, which give a shared stream a copy for each mesh.

## Consequences

- The planner lives in `packages/engine/levels/planner.js`, a plain module that the engine exports as `@null3d/engine/levels-planner`. The asset tool runs it from `packages/cli/src/assets/levels.js`, which reads a file's accessors and writes the levels, and the engine runs it on its job workers for meshes made in code ([D-310](D-310-runtime-levels.md)). Both hand it meshoptimizer's simplifier of the pinned version, so one mesh gets one set of levels. `dedup.js` holds the merging. The command and the Vite plugin document `--lod`'s rule, and take `--simplify` and `--simplify-error`.
- `docs/guides/assets-pipeline.md`, `docs/cli/null3d.md` and `docs/concepts/lod.md` (experimental) describe the levels and the stored error.
- The engine boxes a loaded skinned model as its joints place it at rest ([D-93](D-93-skinned-meshes-in-batches.md)). A box from the node alone would make the Knight's bounds about 16,000 units wide.
- M2-I4's screen-error rule reads `NULL3D_lod_error`.
