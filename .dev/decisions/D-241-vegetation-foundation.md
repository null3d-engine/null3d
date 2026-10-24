# D-241: A vegetation foundation add-on, with GPU grass, generated plants and wind on custom materials

Status: decided by the owner on 24 October 2026. Not built yet: planned as M3-V1 to M3-V12. Open: which wind method trees use by default, per vertex or by branch poses, which M3-V10 measures for the owner's ruling. Date: 2026-10-24.

Summary: Vegetation becomes the eleventh foundation add-on. It grows trees, shrubs, ferns, flowers and grass from a few numbers per species at first use, and places them by ecological rules. It draws grass on the GPU, moves every plant in one wind field and hands far trees to impostors. Creek is its first user and drops its Blender plant models, about 3.1 MB. Wind stays in custom materials' vertex offsets. Custom materials gain the standard material's alpha to coverage, alpha hash, level and band fades and cut-out shadows.

## Question

Creek dresses about 5% of its valley, with three tree kinds in fixed counts, and only its grass moves. The owner asked for complex, varied trees, shrubs and grass over the whole landscape, in Creek and in every other plant demo. Where does that work live, does GPU grass come back, and do Creek's Blender plants stay? How does wind reach masked leaf cards without losing their edges, fades and shadows?

## Rule

- Each feature lives in one place, and add-ons reach the engine only through public entry points (AGENTS.md rules 11 and 12, [D-173](D-173-addon-hooks.md)).
- A later add-on is a foundation when other add-ons or many kinds of project build on it (D-173 ruling 4).
- Built-in assets are generated in the browser at first use, and both GPU paths draw the same scene, or the docs state the fallback.

## Data

A research session on 24 October 2026 read the literature, shipped games, other engines and null3D's own code.

**Creek and the other demos.**

- Creek has 17 trees (oaks, beeches and birches) and about 200 ferns, hostas, shrubs and flower clumps. A Blender script builds them into about 3.1 MB of files, in the same counts on every preset.
- Its grass is 3,000 to 27,000 tufts of 13 blades in a strip about 44 m long, about 5% of the 160 m land.
- Only the grass and the water move.
- On an M5 Max at Medium, WebGL2 draws 7.1 to 7.6 million triangles a frame. Every tuft draws at full detail at every distance ([examples.md, Creek](../examples.md#creek)).
- About a dozen demos write their own plants: at least five pine or fir generators, three grass versions and three leaf meshes. The only shared plant code is `examples/lib/pines.ts`.

**Why custom materials lose their cut-out features.** Custom materials build into the standard material's lit template (`crates/null3d-shaders/shaders.toml`, `[shaders.lit]`), but they leave out several of its builds:

- The template has `ALPHA_COVERAGE`, `SAMPLE_MASK`, `ALPHA_HASH` and `LOD_FADE` builds, and custom materials build none of them. Their levels and distance bands switch at once, and `materials.shader` refuses `alphaToCoverage` and the `'hash'` mode with E1217.
- A custom material's shadow caster builds (`caster_variant` in `crates/null3d-shaders/src/material.rs`) have no fragment stage, so a masked custom material casts its whole shape. Its motion builds cut no holes either ([D-140](D-140-motion-vectors.md)).
- `ROW_VALUES` is kept apart from `ALPHA_COVERAGE` and `ALPHA_HASH` (`APART` in `crates/null3d-gpu/src/drawlist.rs`). A batch with row colors or values therefore tests a plain cutoff, for the standard material too.
- A vertex offset's `VertexInput` holds the position, the normal, two sets of texture coordinates and the row, but not the vertex color.

**Other engines and shipped games.**

- **Horizon Zero Dawn** placed more than 100,000 objects of more than 500 types by rules on the GPU. This took about 250 µs a frame on a PS4.
- **What the best games share:** Horizon, Ghost of Tsushima and Far Cry 5 use a few good species and rule-based placement. Their plants thin with distance, light passes through their leaves, and everything moves in the wind.
- **Unreal 5.7 and 5.8** drive Nanite Foliage's wind with bones, at about 100,000 bones in about 0.1 ms. Epic's reason is tight cluster bounds and the fixed-function rasterizer, which world-position offset loses under Nanite.
- **Unreal's cached shadows:** Epic's virtual shadow map docs say that cached pages redraw every frame under geometry that moves. Skeletal animation and world-position offset both cause it.

## Decision

The owner ruled on 24 October 2026:

1. **An official foundation add-on.** Vegetation is the eleventh foundation, its own npm package. Its working name is `@null3d/vegetation`, to confirm in M3-V4. It passes ruling 4's test: many kinds of project use plants, and other developers' style packs build on it.
   - **What it holds:** the species generator, the texture baker, the scatter and the grass. It also holds the leaf material, the wind, the hand-off to far-tree impostors and a small built-in set of species. Each species is a short record of numbers.
   - **What other developers make:** themed species packs, such as tropical, autumn or stylised plants. They are content, the "vegetation styles" that D-173 left to other developers on 14 October.
   - **Reuse:** it reuses the terrain and impostors foundations and copies neither.
2. **GPU grass returns.** Creek's hills are the "vegetation-heavy ground" that [D-179](D-179-technique-rulings-2026-10-15.md)'s addendum of 21 October names as the trigger. GPU grass is built in M3, inside the vegetation add-on, not as a separate content pack.
   - **WebGPU:** a compute pass makes and culls the blades, and H2 draws them in the main view and the shadow views.
   - **WebGL2:** the CPU builds grass tiles of instance batches, which the engine culls in groups of 64 rows, with distance bands.
3. **Generated plants replace Creek's Blender models.** Creek's trees, ferns, hostas, shrubs and flowers come from the add-on's generator at first use. The Blender script, its manifest entries and its files go. The other plant demos move to the add-on after Creek.
4. **Wind on custom materials, which keep their cut-out features.** Wind stays a custom material's vertex offset, as [D-117](D-117-showcase-features-before-1-0.md) has it. Custom materials gain:
   - alpha to coverage and the alpha hash;
   - fades between levels and at the edges of distance bands;
   - a masked shadow caster that runs the material's alpha;
   - motion builds that cut the material's holes.

   Batches with row values may also take alpha to coverage and the hash. `VertexInput` gains the vertex color for wind data. The coverage and hash builds go only to WGSL that sets or reads the surface's alpha, as transmission's builds do. This holds build time and size. The task measures build time and shader file size before and after.

## Wind by bones

The owner asked on 24 October 2026 what wind driven by bones would take in null3D, and whether it is better.

**What it is.** Each tree has a skeleton of branches. A pass computes each branch's pose once per frame, and each vertex follows its branch.

**What null3D needs.** The core needs no skinning of instance batches. The add-on runs an H1 compute pass ([D-240](D-240-compute-passes.md)), with its fragment form on WebGL2. The pass writes each near tree's branch poses into a texture, for this frame and the last. The leaf and bark materials' vertex offsets then read their branch's pose with `textureLoad`. Three engine changes make this sound (M3-V3):

- A vertex offset reads a compute pass's output in every build that runs it: the main, shadow caster, motion and pick builds.
- The render graph orders such a pass before every pass that draws the material, the shadow views included. No shadow then shows the last frame's pose.
- The motion builds' call for the last frame can tell that it is that call, so it reads the last frame's poses. Today D-140 counts uniforms and row values as unchanged since the last frame.

**What it gains.**

- **Less vertex work:** the sway is computed once per branch, not once per vertex in each pass that draws the tree. Those passes are the main view, the motion pass (which runs the offset twice), each shadow cascade and the reflections.
- **Branches that react:** branches can hold state, so they spring back after a gust and give way to a character.

**What it does not gain.**

- Shadows of moving trees still redraw every frame, as Epic's docs say for Unreal.
- Unreal's main reasons, cluster bounds and its rasterizer, do not apply to null3D's renderer.
- Leaf flutter, grass and small plants stay per vertex in either design.

No source gives phone figures for either method on the web. So M3-V10 builds branch poses beside the per-vertex wind of M3-V7 and measures both on the Mac, the iPad and an S24-class phone. The owner then picks the trees' default from the figures.

## Options rejected

- **Creek-only vegetation.** It is the fastest path to a better Creek. But it would make a sixth pine generator, a fourth grass and a fourth leaf mesh, where rule 11 asks for one place.
- **An example add-on that is never published.** Its interface could change freely. But versions before 1.0 allow that anyway, and other developers are meant to build plant packs on it.
- **A vertex-offset hook on the standard material.**
  - It would be a second API for what custom materials' vertex offsets already do.
  - Leaves need custom shading anyway: crown-bent normals, crown occlusion and a tint per leaf.
  - The row-value exclusion would still take alpha to coverage away from batched trees.
- **Skinning of instance batches in the core.** Each row of a batch would get its own joint palette, through the skin, caster, motion, fade and row-value builds of both paths. It is a large core change for what an H1 pass and a vertex offset give.
- **One sine sway for each tree.** It loops visibly, and viewers judge wind by its frequencies and amplitudes.

## Consequences

- AGENTS.md rule 13 lists vegetation among the foundation add-ons.
- [D-173](D-173-addon-hooks.md) and [D-179](D-179-technique-rulings-2026-10-15.md) gain addenda that point here. D-117's rule that wind is a recipe on vertex offsets still holds. The recipe now lives in one place, the vegetation add-on.
- `.dev/examples.md` records the planned move of Creek's plants and the change to the showcase rule on plant models.
- M3 gains tasks M3-V1 to M3-V12. M3-E9's GPU-written draws must also work in the shadow views, because near grass casts shadows. The impostors' bake helper comes into M3 for the far trees, which are baked at first use.
- No engine code changes with this record.

## Addendum: the eight choices the design left open

The design for the vegetation family raised eight questions that this record does not settle. The owner answered them on 24 October 2026, all as the design recommended. This addendum records them, so the tasks can start without asking again.

- **The package.** `@null3d/vegetation` holds the built-in species set, as well as the generator, the scatter, the grass, the materials and the impostor hand-off. The species set is the smallest thing that makes the package useful on its own.
- **Where the leaf-card level rule lives.** The generator builds its own levels from its skeleton, and one shared test holds the rule. The command-line tool's thinner is not importable by an add-on, and a generator that knows its skeleton keeps the crown full.
- **Repeat visits.** A page bakes its atlases and impostors and keeps them for that visit only. It keeps them across visits only if the bake measures over about a second on the slowest device.
- **How far Creek's dress goes.** The whole 160-metre valley, not the stream strip alone. Distance falloff, wider blades far off and impostors soften the edge.
- **Variety.** Six variants for each species and one impostor for each species. Ten variants would exceed the batch and memory limits.
- **The trees' wind method.** Per-vertex wind ships first, and M3-V10's figures decide whether a preset switches. The vertex format stays the same for both methods, so a later switch costs one redraw of the references.
- **Which demos move.** All nine move to the add-on, one at a time after Creek meets the quality bar. A demo whose style the generator cannot match gets a recorded exception, never a second generator.
- **A themed species pack.** One small example comes after the other demos move, if time allows. It is not on Creek's critical path.
- **Wind in Creek.** The owner asked again on 24 October 2026 that the Creek showcase shows wind on its plants: the trees sway, the grass and shrubs move, and the floating leaves ride the same wind field. A still valley does not meet the bar. Per-vertex wind is the default and M3-V10's figures decide whether a preset switches to branch poses.


## Addendum: the four devices' figures, and the budgets they set

M3-V1 measured Creek and the forest demo on 24 October 2026. It ran on four cloud devices: the
iPhone 17, the iPad Pro 13 2025, the Galaxy S24 and the Galaxy Tab A9 Plus. Each page fixed its GPU path and its preset.
It also set the quality governor's target at 1 frame a second, so the render scale stayed at 1. The
figures are in [tested devices](../tested-devices.md#vegetation-on-four-cloud-devices-24-october-2026).
Three rules shape them.

- WebGL2 and compatibility mode cap the preset at Medium ([the chooser](../../packages/engine/src/quality/chooser.ts)).
  So High and Ultra ran on core WebGPU only.
- Creek at Low on WebGPU stalls an Apple device's page after its first frame
  ([Driver bug reports](../driver-bugs.md)). Creek therefore has WebGL2 figures on the iPhone and
  the iPad, and no WebGPU figure there.
- The Galaxy Tab A9 Plus reports no compatibility mode. Its compatibility pages were skipped.

**Frame time.** The figures below are the frame interval in milliseconds. They are the ceiling that
every later vegetation task must keep the demo within, at the same device, path and preset.

| Demo and preset | iPhone 17 | iPad Pro 13 | Galaxy S24 | Tab A9 Plus |
| --- | --- | --- | --- | --- |
| Creek Low, WebGL2 | 15.7 | 30.8 | 33.3 (30 Hz display) | 1,268.5 |
| Creek Medium, WebGL2 | 43.9 | 90.8 | 33.3 (30 Hz display) | no frame in 5.5 s |
| Forest Low, WebGPU | 15.6 | 15.6 | no WebGPU | no WebGPU |
| Forest Low, compatibility | 15.6 | 15.6 | no WebGPU | no compatibility mode |
| Forest Low, WebGL2 | 15.5 | 15.5 | 33.3 (30 Hz display) | 385.2 |
| Forest Medium, WebGPU | 62.1 | 54.8 | no WebGPU | no WebGPU |
| Forest Medium, WebGL2 | 60.6 | 46.6 | 33.3 (30 Hz display) | 1,820.8 |
| Forest High, WebGPU | 62.5 | 67.1 | no WebGPU | no WebGPU |
| Forest Ultra, WebGPU | 99.0 | 71.1 | no WebGPU | no WebGPU |

**GPU time per pass.** Only the WebGPU path times its passes. Forest Low spends 6.6 to 6.9 ms of
GPU time on the iPad and the iPhone. That is 7 render passes, and the first is a copy. Forest
Medium spends 45.4 ms on the iPad, High 58.3 ms and Ultra 63.2 ms. The last render pass takes most
of it at High and Ultra, because it draws the far cards. WebGL2 on a phone offers no timer, so its
rows give the CPU time of the busiest thread instead.

**Triangles.** Forest Low draws 3.5 to 13.8 million triangles, depending on the path. Medium draws
23 to 111 million, High 61.6 to 297.1 million, and Ultra 29.0 to 107.5 million. Each preset picks
its own levels, so High draws more than Ultra on both Apple devices.

**Memory.** Creek at Low takes 60.8 MiB of GPU textures on the iPhone and 120.6 MiB on the iPad. At
Medium it takes 163.9 and 537.5 MiB. Forest Low on WebGPU takes 30.9 to 57.4 MiB of textures and
34.4 MiB of buffers, and its WebAssembly memory grows to 328.8 MiB. At Ultra it reaches 864 MiB.

**Tree generation.** A worker built a stand-in parametric tree in the style of Weber and Penn. It ran at
each preset's detail, for four species and six seeds each. The set of 24 variants took 14 to 23 ms
on the iPhone and the iPad. It took 33 to 47 ms on the S24, and 49 to 94 ms on the tablet. The arrays take
7.0 MB at Low and 22.7 MB at Ultra, and the triangles run from 123,876 to 474,096. The slowest
single variant was an oak at Ultra on the tablet: 5.42 ms for 27,090 triangles. This is a stand-in;
M3-V4's generator replaces it, and its figures set the shape of the budget.

**The budgets that M3-V4 to M3-V11 take.**

- **Frame time:** the dressed Creek and forest must stay within the frame interval of the same
  preset, device and path in the table above. A preset that falls to a lower one at the same page
  fails.
- **The add-on's own GPU time at Low:** at most 5 ms on the Apple devices. The forest's whole
  WebGPU draw takes 6.6 to 6.9 ms of a 16.7 ms frame there. At Medium, 12 ms. These leave room for the
  scene beside the plants.
- **Generation:** the whole tree variant set at any preset must build in under 200 ms on the
  slowest measured device. On the iPhone and the iPad it must build in under 60 ms. A set of 54 variants, for the
  add-on's nine species, is about twice the measured 24, so the tablet's Ultra figure leaves that
  headroom.
- **Memory:** the variant arrays may take the measured 7.0 to 22.7 MB. The GPU textures must stay
  within the measured figures for the same demo and preset, which the add-on shares with the scene.
  Creek's 3.1 MB of Blender models leave, and the arrays replace them.

## Addendum: the package name, confirmed, and the generator's shape

M3-V4 built the add-on as `@null3d/vegetation`, confirming the working name. The generator follows
this record's look and answers four questions the record left to the build.

- **The leaf-card level rule lives in the generator, as Q2's option A had it.** The asset tool keeps
  its own step for meshes from files. One test holds both to the rule (`tests/lib/leaf-card-rule.test.ts`):
  the cards take a space-filling order through their middles. Every second card of the level above
  is kept, and each kept card grows about its middle by the square root of that step. The largest
  dropped card is the level's error. The generator's curve key is coarser than the tool's, which
  orders the same way and costs less at grow time.
- **A rosette thins its leaves the same way and widens a kept leaf.** Lengthening it would move the
  tip past the crown's bounds, and the design requires that a level switch never moves the bounds.
- **A plant keeps at most 255 branches.** A vertex names its branch's wind record with eight bits.
  A species record whose counts would exceed that stops growing, and the built-in records stay well
  under it.
- **A conifer's needle card stands for a spray of needles.** The first pictures showed a bare trunk
  with a few specks. A card 0.05 m wide and 0.3 m tall is less than half a pixel wide at the
  picture's framing. The card is 0.35 m wide and 0.7 m tall now, with 24 to a twig. The branch
  record is unchanged, so the crown keeps its taper. The conifer's asset grows from 498 to 627 KB.
  The needle atlas of M3-V5 draws the needles inside the card, and a card too small for its spray
  could not carry them.
- **The asset is one merged mesh for each part at each level, not a set of shared twig modules.**
  The shared-twig idea from the research would need one draw for each module. A scene's 256 batches
  cannot hold the tree variants beside the grass and the impostor cards. The merged parts keep the
  measured memory. A tree takes about 0.3 to 0.5 MB over its levels, and the add-on's 78 variants
  take about 18 MB.

The built-in set holds thirteen species and six variants each. It grows on the calling thread or in
one of the engine's job workers, with the same asset either way. Every choice comes from the
integer hash that the shaders' `pcg` also computes.

## Addendum: how the scatter places plants

M3-V6 built the placement half of the add-on. The record above named what it must do; this addendum
records the choices that the build made, and the figures that shaped them.

**What it does.** `groundMaps` reads the ground once into flat grids: height above the water,
distance to the water, slope, aspect, northness and eastness, curvature, wetness from the water's
flow and from the hollows, and the shares that paths, rocks and cave mouths cover. A rule holds one
tolerance curve for each input and scores a place by the lowest curve, the `EcoBrush` rule that the
research recommended. `scatterVegetation` places six layers in order, canopy first and dead wood
last, and returns flat arrays of nine floats for each point.

**The choices, and why.**

- **The placement path uses no transcendental function.** Position, rotation, scale, variant,
  tint and lichen all come from the integer hash, and the rotation is stored as a share of a whole
  turn rather than an angle in radians. A point list therefore matches bit for bit on every device,
  with no tolerance to argue about. A strict comparison across devices needed this: `Math.sin` and
  `Math.atan2` are allowed to differ in their last bit between engines, and a position built from
  them would not compare equal.
- **The tiles cannot change the result.** A candidate's cell is indexed over the whole square, not
  over the tile, and the build walks the cells of the tiles added in one row-by-row order. The first
  plant to claim a place keeps it. Both the order that the tiles arrive in and the tile size
  therefore leave the points identical, and the test checks all three. The first version walked the
  tiles one after another, which placed each tile band's rows before the next tile band's, so a
  larger tile won other shared places.
- **The occupancy grid records the layer, and a rule names the layers it must avoid.** The default
  is every layer. A sapling names only its own layer, so it stands under the crown that shelters
  it; ground cover and shrubs do the same. Without this the young layer placed 12 plants in Creek's
  valley, because every sapling stood inside its parent's crown radius.
- **Wetness is normalized at the flow's 95th percentile, not its maximum.** Flow gathers by a power
  law, so one channel holds most of it and the maximum left the rest of the ground at 0.06. The
  percentile gives the channels 1 and the slopes near 0, which is what a species' curve can use.
- **The curves were fitted to Creek's measured ground.** The first set was written from the general
  shape of a valley and placed 57 plants in Creek, with nothing in the ground layer at all: the
  bounds were narrower than the ground's own bands. The built-in rules now follow the measured
  percentiles of each input over the valley. A scene on other terrain moves the numbers that differ.

**Figures.** Creek's 160 m valley, placed with its eight species at seed 7: 951 points, in 51 ms on
an Apple M5 Max laptop. The layers hold 104 canopy trees, 178 saplings, 645 ground plants and 24
dead wood. The checksum of that placement is 232657082, which the device page compares on every
device and both GPU paths.

**Options rejected.**

- **Float noise for the point source.** It draws other plants on other GPUs, which hard rule 29
  already refuses for shaders.
- **A hard cutoff instead of a score.** A tolerance curve that accepted or refused a place outright
  gave hard band edges, where the density jumped from one species to none. The score as the chance
  that a candidate grows fades each species into its neighbor's ground.
- **Occupancy resolved per tile.** A tile that arrived later would have seen another tile's plants
  and refused its own, so the result would follow the streaming order.
