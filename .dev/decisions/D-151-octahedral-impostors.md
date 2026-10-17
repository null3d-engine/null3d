# D-151: Octahedral impostors and merged far geometry

Status: proposed. Built anyway: the add-on landed on main (`36e7451bc`, 13 October 2026) before the owner's ruling, with its docs page marked experimental. The figures that the ruling needs are not measured yet. Date: 13 October 2026. Task: M2-EX34. It answers [D-142](D-142-more-techniques-before-1-0.md), which moved the technique into M2.

Summary: A far object can draw as a card that shows one stored view of it. That view is an octahedral impostor. Or the object can draw as one mesh merged from a whole grid cell of its copies. Both ship as the opt-in `@null3d/impostors` add-on. Both build on the engine's sprite batches and `geometry.fromArrays`, so both work on WebGPU and WebGL2 with no new engine shader. Neither costs anything in a page that does not install it. The figures are not measured yet. This record holds the design, the options and the measurement plan. The owner rules once the figures are in.

## Question

A forest, a skyline or a hill of trees costs one draw and many triangles per tree far away. There each tree covers few pixels. The engine picks simpler levels of detail. Those cut triangles but keep one draw per object. Should the engine go further, and draw a far object as a stored image? Should it merge a far grid cell's copies into one mesh? And how should both ship, when the engine's core is kept small and each optional feature loads on first use?

## Rule

[D-142](D-142-more-techniques-before-1-0.md) sets the bar. The technique ships with tests on all three GPU paths, or a stated fallback. It ships with image references, allocation and size checks, and its cost per preset. It costs near zero when no scene uses it. [D-117](D-117-showcase-features-before-1-0.md) and [D-132](D-132-showcase-look-and-features-2026-10-11.md) add docs, skills, the three.js mapping and a feature demo. [D-54](D-54-addon-modules.md) says a niche feature with machinery of its own ships as an add-on module. It takes one install and one import, and loads its code on first use. [D-56](D-56-first-use-shader-files.md) says any shader the feature adds loads on first use. Speed is the first design principle. So the option that draws fastest on a phone wins, and a feature a page does not use adds nothing to its start.

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
| A core merge call on `MeshGeometry` | The engine reads a mesh's arrays and merges copies | The merge code sits in the engine | A mesh keeps no copy of its arrays today, so the core would need to keep them |

## Decision

Build both as the opt-in `@null3d/impostors` add-on, which uses only the engine's public extension points:

1. **The impostor cards are sprite batches.** `createImpostors` makes one sprite batch. Its map is the atlas, and its atlas is the octahedral grid. `update(eye)` writes each card's frame from the direction from the card toward the eye. Sprites already face the camera, cull, sort and draw on WebGPU and WebGL2. So the cards add no engine shader, and a page that does not import the package pays nothing. Blending the three nearest views instead of the one is a later step. This record says so until its figures are in.
2. **The merged geometry is a package function.** `mergeFarGeometry` writes copies of a mesh's arrays into the arrays of one mesh. Each copy moves by its own transform. `farCellGroups` groups copies by the grid cell of their centres. A large world then merges one mesh per cell.
3. **The atlas is a `Texture`.** The bake is the sketch's job or a tool's. The engine's scene passes already draw a mesh from a camera into a texture. So a sketch can bake the views and composite them, or a tool can write the atlas offline.
4. **No engine change.** The feature adds no Rust, no WGSL and no engine template. So it cannot slow a frame that does not use it, and it needs no GPU check.

The figures to measure before the owner rules:
- the download size of the package;
- the allocations per frame of the engine and the package, with 20,000 cards updating and drawing;
- the cost per preset of a forest of cards against the same forest drawn as level-of-detail meshes, on WebGPU and WebGL2;
- the draw calls that merging a grid cell saves;
- the look of the card against the mesh at the switch distance.

The demo, the image references and these figures follow in this task.

## Consequences

- **The package:** `@null3d/impostors`, with `createImpostors`, `ImpostorBatch`, `mergeFarGeometry`, `farCellGroups`, the octahedral functions and their types. Its code loads on first use, and a page that does not install it downloads none of it.
- **Docs and skills:** a page for the package, its API reference, the three.js mapping where a counterpart exists, and the porting skill's notes.
- **The demo:** a forest of impostor trees with a merged far cluster. Its look matches the forest demo's bar, and it has image references on both sets.
- **Later steps:** blending the nearest three views, a bake helper that uses the engine's scene passes, and an `assets impostor` command for the command line tool.
- **Related records:** [D-142](D-142-more-techniques-before-1-0.md) moved the technique into M2. [D-54](D-54-addon-modules.md) sets the add-on form. The level of detail that a merge builds on is [D-132](D-132-showcase-look-and-features-2026-10-11.md)'s M2-I4.

## Addendum, 15 October 2026: review fixes

A code review of the first build found five faults. Each fix has a unit test in the package, and the image test `impostors` draws the cards and a merged row on every GPU tier.

- **The origin.** The sprite batch reads each card's position relative to the batch's `origin`, but `update` took those positions as world positions. A forest far from the world's origin then showed one view on every card. `ImpostorBatch` now keeps the origin and subtracts it from the eye.
- **The upload.** The batch was dynamic, so the engine uploaded every card's row in every frame, about 880 KB for 20,000 cards, though only the frame numbers change. The batch is static now. `update` writes a frame only when it changes, and marks the changed cards dirty in ranges, joining cards that lie a few rows apart. It returns at once while the eye stays where it was. A sketch that moves cards calls `markDirty` on the impostor batch, which also makes the next `update` pick every view again.
- **The back pole.** The fold of the back half used `Math.sign`, which gives 0 for 0. So the back pole landed on the front pole's cell, and back directions with x or y at 0 landed on front or side cells. The fold now counts 0 as positive, as other octahedral encoders do. The back pole lands on the corner (1, 1).
- **Tangents and mirrored copies.** `mergeFarGeometry` copied tangents without turning them, so a turned copy lit its normal map from the wrong side. It now turns each tangent by the copy's transform. A copy whose transform has a negative determinant is mirrored: the merge reverses its triangles' winding and negates its tangents' fourth number, so its front faces stay outward.
- **The docs.** The docs page, the doc comment of `update` and the develop skill called `update(camera.position)`, which does not exist. They now fill one kept array with `camera.getWorldPosition(eye)`.

## Addendum, 17 October 2026: the demo

The demo `examples/impostors` draws one pine forest three ways by distance. The nearest band is the shared pine generator at four levels of detail in one instance batch. The middle band is the same pine at its coarsest level, merged into one mesh per grid cell with `farCellGroups` and `mergeFarGeometry`. The far band is one sprite batch of `createImpostors` cards.

The atlas is drawn in code from the pine's own tiers. Each cell is one octahedral direction, shaded for the sun's side, so a card's picture follows the view of it. The key `L` swaps the far band between the cards and a batch of detail meshes. The look at the switch distance then compares in one frame. The demo has references on both sets and all three tiers.
