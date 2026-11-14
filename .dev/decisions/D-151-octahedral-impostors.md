# D-151: Octahedral impostors and merged far geometry

Status: proposed, for the owner's ruling once the figures are in. Built: the `@null3d/impostors` add-on is on main (`36e7451bc`), ahead of the ruling, with its demo and image tests and its docs page marked experimental. Not measured yet: the figures that the ruling needs. Task: M2-EX34. It answers [D-142](D-142-more-techniques-before-1-0.md), which moved the technique into M2.

Summary: A far object draws as an octahedral impostor card, which shows one stored view, or merges with its grid cell's copies into one mesh. Both ship as the opt-in `@null3d/impostors` add-on over sprite batches and `geometry.fromArrays`: no new engine shader, and no cost without the install. The figures are not measured yet, and the owner rules once they are in.

## Question

A forest, a skyline or a hill of trees costs one draw and many triangles per tree far away. There each tree covers few pixels. The engine picks simpler levels of detail. Those cut triangles but keep one draw per object. Should the engine go further, and draw a far object as a stored image? Should it merge a far grid cell's copies into one mesh? And how should both ship, when the engine's core is kept small and each optional feature loads on first use?

## Rule

[D-142](D-142-more-techniques-before-1-0.md) sets the bar. The technique ships with tests on all three GPU paths, or a stated fallback. It ships with image references, allocation and size checks, and its cost per preset. It costs near zero when no scene uses it. [D-117](D-117-showcase-features-before-1-0.md) and [D-132](D-132-showcase-look-and-features.md) add docs, skills, the three.js mapping and a feature demo. [D-54](D-54-addon-modules.md) says a niche feature with machinery of its own ships as an add-on module. It takes one install and one import, and loads its code on first use. [D-56](D-56-first-use-shader-files.md) says any shader the feature adds loads on first use. Speed is the first design principle. So the option that draws fastest on a phone wins, and a feature a page does not use adds nothing to its start.

## Data

Three ways were weighed for the impostor cards, and two for the merged geometry. The figures come from the Mac and from a phone, in both GPU paths. `bun run bench:allocation` measures the allocation. `bun run bench:run` gives the cost per preset. `bun run build:check-size` measures the download.

| Option | How it draws | Cost when unused | Risk |
| --- | --- | --- | --- |
| A stand-in level inside `mesh.setLevels` | A new level kind that draws a card with an engine shader | The level's code and shaders sit in the engine, so a page that never uses it still downloads its build keys | Rust core and shader changes, and a new per-level kind in the culling and draw paths |
| An add-on package over sprite batches | The card is the engine's sprite, with the atlas in the sprite's map and the view in its frame | Zero: the package is a separate install, and no page downloads it unless it imports it | The view is picked on the sketch's thread each frame, one write per card |
| A card drawn by a package's own shader | A package shader billboards the card and blends the nearest views | Zero, but the package ships WGSL that the Vite plugin must compile | A second copy of the sprite shader, and a blend path to keep correct on both GPU paths |

| Merged geometry | How it draws | Cost when unused | Risk |
| --- | --- | --- | --- |
| `mergeFarGeometry`, a package function over `geometry.fromArrays` | One mesh per grid cell, from the copies' own arrays | Zero: a page without the package does not run it | The sketch holds the far level's arrays, since a mesh does not give its arrays back |
| A core merge call on `MeshGeometry` | The engine reads a mesh's arrays and merges copies | The merge code sits in the engine | A mesh keeps no copy of its arrays, so the core would need to keep them |

## Decision

Build both as the opt-in `@null3d/impostors` add-on, which uses only the engine's public extension points:

1. **The impostor cards are sprite batches.** `createImpostors` makes one sprite batch. Its map is the atlas, and its atlas is the octahedral grid. `update(eye)` writes each card's frame from the direction from the card toward the eye. Sprites already face the camera, cull, sort and draw on WebGPU and WebGL2. So the cards add no engine shader, and a page that does not import the package pays nothing. Blending the three nearest views instead of the one is a later step. This record says so until its figures are in.
2. **The merged geometry is a package function.** `mergeFarGeometry` writes copies of a mesh's arrays into the arrays of one mesh. Each copy moves by its own transform. `farCellGroups` groups copies by the grid cell of their centers. A large world then merges one mesh per cell.
3. **The atlas is a `Texture`.** The bake is the sketch's job or a tool's. The engine's scene passes already draw a mesh from a camera into a texture. So a sketch can bake the views and composite them, or a tool can write the atlas offline.
4. **No engine change.** The feature adds no Rust, no WGSL and no engine template. So it cannot slow a frame that does not use it, and it needs no GPU check.

The figures to measure before the owner rules:
- the download size of the package;
- the allocations per frame of the engine and the package, with 20,000 cards updating and drawing;
- the cost per preset of a forest of cards against the same forest drawn as level-of-detail meshes, on WebGPU and WebGL2;
- the draw calls that merging a grid cell saves;
- the look of the card against the mesh at the switch distance.

These figures follow in this task.

## How the add-on draws correctly

Each rule below has a unit test in the package. The image test `impostors` draws the cards and a merged row on every GPU tier.

- **The origin.** The sprite batch reads each card's position relative to the batch's `origin`. So `ImpostorBatch` keeps the origin and subtracts it from the eye. Taken as world positions, the cards of a forest far from the world's origin would all show one view.
- **The upload.** The batch is static, and `update` writes a frame only when it changes. It marks the changed cards dirty in ranges, joining cards that lie a few rows apart. It returns at once while the eye stays where it was. A sketch that moves cards calls `markDirty` on the impostor batch, which also makes the next `update` pick every view again. A dynamic batch would upload every card's row in every frame, about 880 KB for 20,000 cards, though only the frame numbers change.
- **The back pole.** The fold of the back half counts 0 as positive, as other octahedral encoders do, so the back pole lands on the corner (1, 1). The sign function, `Math.sign`, gives 0 for 0. With it, the back pole would land on the front pole's cell. Back directions with x or y at 0 would land on front or side cells.
- **Tangents and mirrored copies.** `mergeFarGeometry` turns each tangent by the copy's transform, so a turned copy lights its normal map from the right side. A copy whose transform has a negative determinant is mirrored. The merge reverses its triangles' winding and negates its tangents' fourth number, so its front faces stay outward.
- **The first frame's eye.** A sketch reads the eye with `camera.getPosition` while the camera has no parent, and the docs, the `update` comment and the demo do the same. The call `camera.getWorldPosition` reports the world matrix of the frame that last ran. A sketch's first update runs before any frame has, so that eye reads as the world's origin. Every card then picks the view from that direction. A camera far from the world's origin shows one cell on all its cards, which looks like a fault in the sprite batch's frame bits. The docs name the caveat, and the test page picks from its known camera position.
- **The sprite batch's frames.** The image test `sprite-origin` pins the sprite batch's own frame picking. It draws four columns and two rows of flat colors, with and without an origin, on all three GPU paths.

## Consequences

- **The package:** `@null3d/impostors`, with `createImpostors`, `ImpostorBatch`, `mergeFarGeometry`, `farCellGroups`, the octahedral functions and their types. Its code loads on first use, and a page that does not install it downloads none of it.
- **Docs and skills:** a page for the package, its API reference, the three.js mapping where a counterpart exists, and the porting skill's notes.
- **The demo:** `examples/impostors` draws one pine forest three ways by distance. Its look matches the forest demo's bar, and it has references on both sets and all three tiers.
  - The nearest band is the shared pine generator at four levels of detail in one instance batch.
  - The middle band is the same pine at its coarsest level, merged into one mesh per grid cell with `farCellGroups` and `mergeFarGeometry`.
  - The far band is one sprite batch of `createImpostors` cards. The atlas is drawn in code from the pine's own tiers. Each cell is one octahedral direction, shaded for the sun's side, so a card's picture follows the view of it.
  - The key `L` swaps the far band between the cards and detail meshes, so the look at the switch distance compares in one frame.
- **Later steps:** blending the nearest three views, a bake helper that uses the engine's scene passes, and an `assets impostor` command for the command line tool.
- **Related records:** [D-142](D-142-more-techniques-before-1-0.md) moved the technique into M2. [D-54](D-54-addon-modules.md) sets the add-on form. The level of detail that a merge builds on is [D-132](D-132-showcase-look-and-features.md)'s M2-I4.
