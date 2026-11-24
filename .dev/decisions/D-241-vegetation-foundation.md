# D-241: GPU grass, wind on custom materials, and the vegetation's frame budgets

Status: decided by the owner. Built: the grass, `@null3d/grass`, with near shadows and the per-view cull ([below](#the-grasss-two-halves)). A compute pass builds and counts its blade list on WebGPU, and an instance batch draws its rows on WebGL2. The engine's vertex offsets read a compute pass in every pass (M3-V3), custom materials have the standard material's cut-out features (M3-V2), and the wind add-on's first stage is built (M3-V15, D-265). Far-tree impostors (M3-V9) are built ([D-274](D-274-impostors.md)). Settled by the owner: the wind moves the trees per vertex, where branch poses were measured and set aside. The plant generator, its species, its scatter and its leaf material were the vegetation add-on's, which the repository no longer holds ([D-378](D-378-vegetation-add-on-removed.md)). Tasks: M3-V1 to M3-V17.

Summary: GPU grass is a foundation add-on of its own, `@null3d/grass`. A compute pass builds and culls its blades on WebGPU, and the CPU fills instance batches on WebGL2. Plants sway in the wind add-on's field through custom materials' vertex offsets, and custom materials gain the standard material's cut-out features. Creek and the forest demo, measured on four cloud devices, set each preset's frame ceiling. The vegetation's own GPU time takes at most 5, 12, 49 and 62.5 ms from Low to Ultra on the Apple devices.

## Question

Creek dresses about 5% of its valley, with three tree kinds in fixed counts, and only its grass moves. The owner wants complex, varied trees, shrubs and grass over the whole landscape, in Creek and in every other plant demo. Where does that work live, and does GPU grass come back? How does wind reach masked leaf cards without losing their edges, fades and shadows? What frame may each preset take?

## Rule

- Each feature lives in one place, and add-ons reach the engine only through public entry points (AGENTS.md rules 11 and 12, [D-173](D-173-addon-hooks.md)).
- A later add-on is a foundation when other add-ons or many kinds of project build on it (D-173 ruling 4).
- Built-in assets are generated in the browser at first use, and both GPU paths draw the same scene, or the docs state the fallback.

## Data

A research session read the literature, shipped games, other engines and null3D's own code.

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

The owner ruled:

1. **GPU grass is a foundation add-on of its own,** `@null3d/grass`. Creek's hills are the "vegetation-heavy ground" that [D-179](D-179-technique-rulings.md), ruling 20, names as the trigger. Many kinds of project draw grass, and the demos draw it, so a reader can install what a demo shows ([D-378](D-378-vegetation-add-on-removed.md)). It is built in M3, not as a separate content pack.
   - **WebGPU:** a compute pass makes and culls the blades, and H2 draws them in the main view and the shadow views.
   - **WebGL2:** the CPU builds grass tiles of instance batches, which the engine culls in groups of 64 rows, with distance bands.
2. **The demos make their own plants.** The feature demos grow theirs in code, and the showcase scenes load models that a script builds in Blender ([D-378](D-378-vegetation-add-on-removed.md)). No plant generator ships.
3. **Wind on custom materials, which keep their cut-out features.** Wind stays a custom material's vertex offset, as [D-117](D-117-showcase-features-before-1-0.md) has it. Custom materials gain:
   - alpha to coverage and the alpha hash;
   - fades between levels and at the edges of distance bands;
   - a masked shadow caster that runs the material's alpha;
   - motion builds that cut the material's holes.

   Batches with row values may also take alpha to coverage and the hash. `VertexInput` gains the vertex color for wind data. The coverage and hash builds go only to WGSL that sets or reads the surface's alpha, as transmission's builds do. This holds build time and size. The task measures build time and shader file size with and without them.

## The choices the design left open

The owner settled the design's open questions that still hold, as the design recommended.

- **The trees' wind method.** The trees sway per vertex at every preset. M3-V10 measured branch poses beside it, and the owner set them aside ([below](#wind-by-branch-poses-built-and-measured)).
- **Wind in Creek.** The owner requires the Creek showcase to show wind on its plants. The trees sway and the grass and shrubs move. A still valley does not meet the bar.

## Wind by bones

This section says what wind driven by bones takes in null3D, and whether it is better.

**What it is.** Each tree has a skeleton of branches. A pass computes each branch's pose once per frame, and each vertex follows its branch.

**What null3D needs.** The core needs no skinning of instance batches. The plants' code runs an H1 compute pass ([D-240](D-240-compute-passes.md)), with its fragment form on WebGL2. The pass writes each near tree's branch poses into a texture, for this frame and the last. The leaf and bark materials' vertex offsets then read their branch's pose with `textureLoad`. Three engine changes make this sound, and M3-V3 builds them:

- A vertex offset reads a compute pass's output in every build that runs it: the main, shadow caster, motion and pick builds.
- The render graph orders such a pass before every pass that draws the material, the shadow views included. No shadow then shows the last frame's pose.
- The motion builds' call for the last frame can tell that it is that call (`lastFrame`), so it reads the last frame's poses. D-140 counts uniforms and row values as unchanged since the last frame, so they cannot tell it.

**What it gains.**

- **Less vertex work:** the sway is computed once per branch, not once per vertex in each pass that draws the tree. Those passes are the main view, the motion pass (which runs the offset twice), each shadow cascade and the reflections.
- **Branches that react:** branches can hold state, so they spring back after a gust and give way to a character.

**What it does not gain.**

- Shadows of moving trees still redraw every frame, as Epic's docs say for Unreal.
- Unreal's main reasons, cluster bounds and its rasterizer, do not apply to null3D's renderer.
- Leaf flutter, grass and small plants stay per vertex in either design.

No source gives phone figures for either method on the web. So M3-V10 builds branch poses beside the per-vertex wind of M3-V7 and measures both on the Mac, the iPad and an S24-class phone. The owner then picks the trees' default from the figures.

## Wind by branch poses, built and measured

M3-V10 built the pass that "Wind by bones" asks for, measured it beside the per-vertex sway, and
removed it on the owner's ruling.

**What a page gave it.** A page made the pass for a variant with `plantPoses`. It gave the pass the copies of that variant that the scene places. It also gives the most of them that stand within
the sway distance at once. In each frame the page chooses a slot for each copy inside the distance. It also
sends the pass the trees' places and normal matrices. The pass writes an instance header, the
field's settings and one row of pose texels for each slot. The leaf and bark offsets read the turn
of their own branch, from the row of their copy's slot. A copy without a slot therefore stands
still. A device that keeps no 16-bit float target draws no poses, and the plants keep the
per-vertex sway.

**The spring.** A branch's turn follows the steady sway through a spring, whose rate grows with the
branch's level. The pass keeps its state across runs, as the wind grid's pass does. A branch
therefore reads the turn and the speed of the run before. A gust leaves the branch lagging and
overshooting, and the branch settles after the air stops. The pose table keeps two states too, so
the motion pass reads the frame before's pose and a leaf keeps its motion data.

**What stays per vertex.** The trunk's cantilever bend and the leaves' flutter stay in the offset in
either method. The two methods therefore differ only in the branch turns. The pass reads the air
once at the tree's base and turns the whole tree from it. The per-vertex method reads the air at
each vertex.

**What it does not gain.** Moving branches redraw their shadows every frame, as they do per vertex.
Leaf flutter, grass and small plants stay per vertex. The pass adds a compute dispatch and a small
upload in the frame. A page pays those beside the vertex work that it saves.

**The pictures.** Four tests draw the pose method on WebGPU, compatibility mode and WebGL2: the
grove through the pose materials at two hold times, its motion view, and a still that borrows the
per-vertex method's reference. The nine reference pictures pass in all 12 runs of
`CI=1 bun run test:images -g "vegetation-poses"`. The spring test also reads the pose pass live, so
it shows a branch turning on after the air stops and settling back. The owner's ruling removes the
pass, so these four tests and their nine references are deleted with it.

**The owner's ruling.** The owner ruled that wind per vertex is the trees' default, with no
preset switch, and that the branch-pose path is removed. The figures below measure
both methods on the same grove, and they are the comparison that led to the ruling. A preset may
switch only when its figure holds D-241's frame ceiling.

**Guides from a loaded machine.** These single runs were taken while other sessions used the Mac, so
they direct the work and are not the record's figures. The grove was dense, as the page's measurement
places it. The quarter-scale rows drew with the sun's shadows off.

| Device, path, preset | Frame, per vertex (ms) | Frame, poses (ms) | Vertex view, per vertex (ms) | Vertex view, poses (ms) |
| --- | --- | --- | --- | --- |
| Mac, WebGPU, High | 6.75 | 6.62 | 3.87 | 2.85 |
| Mac, WebGL2, Medium | 15.05 | 17.71 | - | - |
| iPad, WebGPU, Low | 6.14 | 6.62 | 4.49 | 5.56 |
| iPad, WebGPU, Medium | 33.91 | 34.93 | 6.24 | 6.30 |
| iPad, WebGPU, High | 43.36 | 44.68 | 6.48 | 6.18 |
| iPad, compatibility, Low | 6.40 | 6.38 | - | - |
| iPad, compatibility, Medium | 38.01 | 51.74 | - | - |

The Mac's vertex view is where the method saves the most, at High: 3.87 ms against 2.85 ms. Its
opaque pass reads 2.92 against 1.41 ms. At Low on the iPad, few trees stand inside the eight meter
sway distance. The pass's own work then costs more than the branches save, so the pose method is
slower. The compatibility mode rows at Medium came from unpaired pages of the cancelled first plan.
They are guides only, and the record's runs place the methods in turns.

**The record's runs.** The Mac, the iPad Pro 13 and the Galaxy S25 ran both methods in turns at each
preset and path. The Galaxy S25 stands in for the S24 class, by the owner's ruling. WebGL2 and
compatibility mode cap the preset at Medium, so their rows stop there. Each figure is the median GPU
time per frame over five seconds, after a three second settle. The vertex view is the same page at a
quarter of the render scale with the sun's shadows off. Its frame then follows the vertex work that
the two methods differ in. The Mac ran with the machine to itself. The iPad and the S25 are cloud
sessions, whose heat and refresh rate are not controlled. Their rows are close comparisons in turns,
not tight budgets. The run files are the `vegetation-poses` runs `20261031-021631` on the Mac and
`20261031-020718` on the iPad and the S25, which main's commit `cbdd718e4` holds in the tested-devices
folder.

| Device and path | Preset | Frame, per vertex (ms) | Frame, poses (ms) | Vertex view, per vertex (ms) | Vertex view, poses (ms) |
| --- | --- | --- | --- | --- | --- |
| Mac, WebGPU | Low | 4.52 | 4.13 | 3.41 | 3.80 |
| Mac, WebGPU | Medium | 4.33 | 4.52 | 3.74 | 4.13 |
| Mac, WebGPU | High | 4.72 | 5.11 | 4.00 | 3.87 |
| Mac, WebGPU | Ultra | 4.85 | 5.18 | 4.13 | 4.13 |
| Mac, compatibility | Low | 4.33 | 4.46 | - | - |
| Mac, compatibility | Medium | 4.46 | 4.46 | - | - |
| Mac, WebGL2 | Low | 7.82 | 10.47 | 2.41 | 3.95 |
| Mac, WebGL2 | Medium | 14.44 | 16.84 | 2.60 | 6.71 |
| iPad, WebGPU | Low | 6.14 | 6.62 | 4.49 | 5.56 |
| iPad, WebGPU | Medium | 33.91 | 34.93 | 6.24 | 6.30 |
| iPad, WebGPU | High | 43.36 | 44.68 | 6.48 | 6.18 |
| iPad, WebGPU | Ultra | 43.90 | 47.54 | 5.95 | 6.22 |
| iPad, compatibility | Low | 6.56 | 6.89 | - | - |
| iPad, compatibility | Medium | 37.98 | 38.69 | - | - |
| Galaxy S25, WebGPU | Low | 25.69 | 25.89 | 13.96 | 14.71 |
| Galaxy S25, WebGPU | Medium | 328.53 | 335.15 | 26.61 | 26.87 |
| Galaxy S25, WebGPU | High | 379.06 | 508.56 | 26.97 | 25.46 |
| Galaxy S25, WebGPU | Ultra | 405.93 | 548.08 | 26.21 | 25.40 |
| Galaxy S25, compatibility | Low | 25.76 | 25.85 | - | - |
| Galaxy S25, compatibility | Medium | 406.06 | 372.97 | - | - |

The S25's frames at Low sit near its 30 Hz display's period, and the higher presets run far past
it, so the runner marks its timings unreliable; its rows compare the methods in turns only, and the
pick does not rest on them.

The iPad's and the S25's WebGL2 pages give the CPU time of the busiest thread instead of a GPU time.
It does not separate the methods: 1.24 to 3.47 ms on the iPad and 0.71 to 0.99 ms on the S25, across
both methods and both presets. The Mac's WebGL2 timer gives the answer there.

**What the figures say.** The pose method wins in some cells and loses in others, and the figures do
not support a preset switch. On the Mac's WebGPU at Low its frame is 4.13 ms against 4.52 ms, 8.7
per cent faster, while its vertex view is 11.5 per cent slower. At High its vertex view is 3.87 ms
against 4.00 ms, 3.3 per cent faster, while its frame is 8.3 per cent slower. Its frame is 4.6 to
8.3 per cent slower at the Mac's other WebGPU presets. On the iPad its frames are 1.9 to 8.3 per
cent slower, and its vertex view is 23.9 and 1.0 per cent slower at Low and Medium, 4.6 per cent
faster at High and 4.6 per cent slower at Ultra. The S25's rows are marked unreliable, and they
show no more: its vertex view is 5.4 and 1.0 per cent slower at Low and Medium, and 5.6 and 3.1
per cent faster at High and Ultra. The compatibility mode rows in the Mac's run read the same
figure twice, within its timer's steps. On WebGL2 the pose method is clearly slower: 34 and 16.6
per cent on the frame, and 63.6 and 158 per cent in the vertex view.

The WebGL2 form explains its own cost. It draws one fragment for every pose texel. Each of the two
texels that hold a branch's turn recomputes the whole ancestor chain, with a spring step at each
ancestor. A branch of depth four therefore pays eight integrations and its texture reads for each of
the two texels. The grove's four variants then cost the 1.3 to 2.6 ms that the WebGL2 vertex views
show. A history pass also keeps three copies of the table on WebGL2 and copies one state in each
run. That is small beside the fragment work.

**Why the posing lost.** The look review found the pose method's motion better: boughs bend and
spring instead of the canopy sliding. Its cost and its softening did not carry the pick. Its two
wins sit inside the noise of the devices it was measured on, and its cost is clear wherever many
trees stand near the camera or the WebGL2 form runs. Its pictures also carried about a quarter less
leaf-edge energy at both holds, and its WebGL2 grove moved about a quarter as much a frame as the
other two paths. The branch-pose pass, its two shaders, its plan, its spring test and its picture
tests and references are removed, so the per-vertex offset is the trees' only path,
and the trees' own figures above are the ceiling that each preset keeps.

## Options rejected

- **Grass for Creek alone.** It is the fastest path to a better Creek. But it would make a fourth grass, where rule 11 asks for one place.
- **A vertex-offset hook on the standard material.**
  - It would be a second API for what custom materials' vertex offsets already do.
  - Leaves need custom shading anyway: crown-bent normals, crown occlusion and a tint per leaf.
  - The row-value exclusion would still take alpha to coverage away from batched trees.
- **Skinning of instance batches in the core.** Each row of a batch would get its own joint palette, through the skin, caster, motion, fade and row-value builds of both paths. It is a large core change for what an H1 pass and a vertex offset give.
- **One sine sway for each tree.** It loops visibly, and viewers judge wind by its frequencies and amplitudes.
- **The wind field inside a plant add-on.** A page with flags and smoke but no plants would then need that add-on for its wind. [Fluid wind is an add-on of its own](#fluid-wind-is-an-add-on-of-its-own) gives the reasons.

## Consequences

- AGENTS.md rule 13 lists the grass and the wind among the foundation add-ons.
- [D-173](D-173-addon-hooks.md) and [D-179](D-179-technique-rulings.md) point here. D-117's rule that wind is a recipe on vertex offsets holds. The recipe's sampling lives in one place, the wind add-on's `field.wgsl`, and the wind add-on's own test holds each reader's copy equal to it.
- `.dev/examples.md` gives the showcase rule on plant models.
- M3 holds this work as tasks M3-V1 to M3-V17. M3-E9's GPU-written draws must also work in the shadow views, because near grass casts shadows. The impostors' bake helper is in M3 for the far trees.

## The four devices' figures, and the budgets they set

M3-V1 measured Creek and the forest demo on four cloud devices. They are the iPhone 17, the iPad
Pro 13 2025, the Galaxy S24 and the Galaxy Tab A9 Plus. The Galaxy S25 measured Creek's WebGPU path
in a run of its own. Each page fixed its GPU path and its preset.
It also set the quality governor's target at 1 frame a second, so the render scale stayed at 1. The
figures are in [tested devices](../tested-devices.md#vegetation-on-the-five-cloud-devices).
Three rules shape them.

- WebGL2 and compatibility mode cap the preset at Medium ([the chooser](../../packages/engine/src/quality/chooser.ts)).
  So High and Ultra ran on core WebGPU only.
- Creek at Low on WebGPU stalls an Apple device's page after its first frame
  ([Driver bug reports](../driver-bugs.md)). Creek therefore has WebGL2 figures on the iPhone and
  the iPad, and no WebGPU figure there. The Galaxy S25 draws Creek on core WebGPU at every preset,
  and the owner ruled that this phone stands in for the S24 class.
- The Galaxy Tab A9 Plus reports no compatibility mode. Its compatibility pages were skipped.

**Frame time.** The figures below are the frame interval in milliseconds. They are the ceiling that
every vegetation task must keep the demo within, at the same device, path and preset.

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

**Two cells that a later reader must read carefully.** The iPad's Creek Low cell reads 30.8 ms, and
the milestone head `fcafb9cd7` reads 31.06 ms on it with no wind reader in the scene at all
([the head's run](../tested-devices/ipad-pro-13-safari/20261101-091901-vegetation.md)). The cell is
therefore at or just over its own ceiling before any wind work. A later miss of a fraction of a
millisecond there is the scene's, and it is not the wind's.

These forest cells come from a scene with no wind reader. The vegetation branch's own forest rows
at Medium and above read 9 to 19 per cent over them. The forest was not measured at `fcafb9cd7` on
the same rows, so whether the wind's share sits inside those ceilings is open. It needs that head
run before anyone reads those rows as the wind's cost or as headroom.

**Creek on WebGPU.** The Galaxy S25 draws Creek on core WebGPU, which the Apple devices cannot. The
owner ruled that this phone stands in for the S24 class, whose own device has no WebGPU adapter and
no WebGL2 GPU timer. The figures come from one run of the plan.

| Preset | Frame ms | GPU ms | Busiest pass | Its ms | Triangles | Draws |
| --- | --- | --- | --- | --- | --- | --- |
| Low | 33.3 | 26.28 | opaque | 20.38 | 1,524,500 | 182 |
| Medium | 166.6 | 149.88 | opaque | 141.16 | 4,387,400 | 174 |
| High | 208.3 | 213.61 | ambient occlusion 1 | 164.72 | 6,798,700 | 288 |
| Ultra | 499.8 | 468.19 | ambient occlusion 1 | 279.38 | 11,100,000 | 303 |

**The S25-class Ultra ceiling is 511 ms.** The owner ruled that a class ceiling includes the wind's
share, because a ceiling is a measured frame and the wind is part of the frame that a page draws.
This cell is therefore the only ceiling here that is not a measured frame alone: it is the run's
499.8 ms plus the wind's modelled 11.08 ms, which doubles the measured 5.243 ms of the volume's 40
steps and adds the advection and projection floor, because the 30 Hz display owes two field cycles
a frame. The table above keeps the measured 499.8 ms as the run gives it. D-283 records the ruling
and the two alternatives that the owner declined.

The pages ran from a worktree at `6a0a3215f`, and its engine build was made from that commit's
sources. The engine's start check accepted the build on the device. Chrome on Android reports no
WebGL2 GPU timer, so this phone gives no WebGL2 figure. Its WebGPU times come from the GPU's timer.
The display ran at 30 Hz, and every frame interval except Low is longer than that cap. So those
frames are the device's own. The run files are [the S25's](../tested-devices/galaxy-s25-sm-s931b-chrome/20261029-200013-vegetation.md)
and, for the earlier whole-frame figures, [its 27 October run](../tested-devices/galaxy-s25-sm-s931b-chrome/20261027-002402-vegetation.md).

**GPU time per pass.** Only the WebGPU path times its passes. Forest Low spends 6.6 to 6.9 ms of
GPU time on the iPad and the iPhone. That is 7 render passes, and the first is a copy. Forest
Medium spends 45.4 ms on the iPad, High 58.3 ms and Ultra 63.2 ms. The last render pass takes most
of it at High and Ultra, because it draws the far cards. WebGL2 on a phone offers no timer, so its
rows give the CPU time of the busiest thread instead.

Creek on the S25 spends most of each frame in one pass. At Low the opaque pass takes 20.38 ms of the
whole 26.28, and at Medium 141.16 of 149.88. High and Ultra turn on ambient occlusion, which splits
the depth prepass from the opaque pass. The prepass takes 45.74 and 182.19 ms there, and the pass
that draws with ambient occlusion 164.72 and 279.38. The two shadow cascades and the copies stay
under 3 ms at every preset.

**Triangles.** Forest Low draws 3.5 to 13.8 million triangles, depending on the path. Medium draws
23 to 111 million, High 61.6 to 297.1 million, and Ultra 29.0 to 107.5 million. Each preset picks
its own levels, so High draws more than Ultra on both Apple devices.

**Memory.** Creek at Low takes 60.8 MiB of GPU textures on the iPhone and 120.6 MiB on the iPad. At
Medium it takes 163.9 and 537.5 MiB. Forest Low on WebGPU takes 30.9 to 57.4 MiB of textures and
34.4 MiB of buffers, and its WebAssembly memory grows to 328.8 MiB. At Ultra it reaches 864 MiB.

**The budgets that every later V task takes, by preset.** The frame figures come from measured
rows above. The vegetation's own GPU time keeps room beside the scene. A later task states
its budget per preset from this table.

| Preset | Frame ceiling, iPhone 17 and iPad Pro 13 | Frame ceiling, S24 class | Frame ceiling, Tab A9 Plus | The vegetation's own GPU time, Apple |
| --- | --- | --- | --- | --- |
| Low | 15.5 to 30.8 | 33.3 | 1,268.5 | 5 |
| Medium | 43.9 to 90.8 | 166.6 | 1,820.8 | 12 |
| High | 62.5 to 67.1 | 208.3 | no row | 49.0 |
| Ultra | 71.1 to 99.0 | 499.8 | no row | 62.5 |

The S24's own frame interval reads 33.3 ms at Low and Medium, which is its display's cap rather
than its work. The class's Medium ceiling is the S25's, which is the only real figure there.

Two figures are owed by a device rather than left out by choice. No run gives Creek on WebGPU on
the iPhone or the iPad, because its Low page stalls there, which is a recorded driver fault
([Driver bug reports](../driver-bugs.md)). The Galaxy Tab A9 Plus has no High or Ultra row, because
those presets draw on core WebGPU only, and the tablet offered no WebGPU adapter when the table was
set. The tablet's own run reports the WebGPU tier at all four presets, so the reason no longer holds and a ceiling for its High and Ultra rows is owed; until then those figures have no
budget to compare. The rows still do not draw: Creek at High fails one custom material's pipeline
with E1404 and VK_ERROR_UNKNOWN on that device, on this build and on the commit before the reflection
landing ([Driver bug reports](../driver-bugs.md#adreno-619-a-pipeline-fails-to-build-with-vkerrorunknown-at-creeks-density)), so the ceiling waits on that fault.

- **Frame time:** the dressed Creek and forest must stay within the frame interval of the same
  preset, device and path. A preset that falls to a lower one at the same page fails.
- **The vegetation's own GPU time:** the time that a scene's plants and grass take on the GPU. It is
  at most 5 ms at Low and 12 ms at Medium on the Apple devices. These
  two are chosen allowances inside the measured draw; the forest's whole WebGPU draw takes 6.6 to
  6.9 ms at Low and 45.4 to 53.7 at Medium, both above the allowance beside them. At High and Ultra
  the figure is measured: the far cards' pass takes 43.5 to 49.0 and 49.2 to 62.5 ms, and each
  budget takes the larger Apple figure.
- **Memory:** the GPU textures must stay within the measured figures for the same demo and preset.

### M3-V7's cost per preset, on the Mac

M3-V7's look is a grove of grown oaks in the wind add-on's field, with the leaf and bark materials
swaying and the sun's shadows following. Its page is `tests/pages/vegetation-cost.html`, run with
the governor's target at one frame a second so the render scale stays at 1. The page and the grove's
four pictures no longer exist, so the figures below record a run that cannot be repeated. The Mac's Chrome drew
it at 1280 by 720 at each preset and path
([its run](../tested-devices/macbook-pro-m3-max-chrome/20261030-1700-vegetation-wind.md)). The
machine was shared and the load sat between 4 and 7, so a row within about a millisecond of its
neighbour is not a separate cost.

| GPU path | Preset drawn | Whole frame (ms) | Shadow cascades (ms) | Ambient occlusion (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 6.29 | 3.21 | 0 | 26 |
| WebGPU | Medium | 7.37 | 2.82 | 0 | 26 |
| WebGPU | High | 7.44 | 2.39 | 10.55 | 38 |
| WebGPU | Ultra | 6.55 | 2.13 | 6.39 | 42 |
| compatibility | Low | 6.46 | 3.28 | 0 | 26 |
| compatibility | Medium | 8.22 | 2.88 | 0 | 25 |
| WebGL2 | Low | 11.48 | no timer | no timer | 53 |
| WebGL2 | Medium | 15.40 | no timer | no timer | 56 |

These are whole-frame figures: they carry the ground, the sky and the final pass as well as the
plants. D-241's 5, 12, 49.0 and 62.5 ms are the vegetation's own GPU time, which the benchmark isolates
with `bun run bench:gpu-check`. The frame stays under every preset's ceiling here, and the highest
reading, WebGL2 at Medium, is 15.4 ms against that preset's 43.9 to 90.8. The sway's distance grows
with the preset, so a heavier preset draws more of the grove: 26 calls a frame at Low and Medium on
WebGPU, 38 at High and 42 at Ultra. The number of plants is small next to Creek's valley, so these
are the look's cost on one screenful, not the dressed valley's.

## Addendum: how custom materials cut their shape

M3-V2 built ruling 4's cut-out features. The owner's focus holds the build time and the shader
files' sizes. So the work keeps a custom material's builds as few as it can. These
are the choices the task left open, and the reasons for them.

- **The alpha in the WGSL gates the builds.** The compiler of custom materials looks for `.alpha` in
  a material's tokens. Only such a material builds alpha to coverage, the alpha hash, their sample
  mask, and a shadow caster that runs the surface's alpha. A material with a vertex offset gains a
  motion build that runs it too; one without an offset has no motion build, so the motion pass cuts
  no holes of its own. A coverage-only material that moves by its object's transform therefore
  writes motion in its holes: the generic motion build tests no coverage function, since the motion
  pass has no light to give it. A material whose WGSL never names the alpha keeps the builds it had,
  plus the fading level of detail's. A development build refuses `alphaToCoverage` and the `hash`
  mode for such a material with E1217; a production build does not, and draws it at the cutoff,
  with the `hash` mode as the mask mode and no alpha to coverage. This mirrors the rule for
  `transmission`, whose builds only WGSL that sets it has.
- **A coverage function stays the caster's own hook.** A material that declares `fn coverage` casts
  that function's shape, which reads the light's view. The two hooks agree: the feature that marks
  a material for the renderer is set by either, and the coverage wins where both exist. The
  impostor cards declare both, and their coverage samples the crown from the side that the light
  sees.
- **The caster and the motion test the cutoff.** A shadow map holds one depth for each pixel, and
  the motion target holds one value. Neither can hold a share of them. A masked custom material's
  caster and motion therefore test the surface's alpha against the material's cutoff, and against
  the alpha hash where the material tests it. Alpha to coverage keeps its fade in the camera's view
  alone. Those builds bind no copy of the camera's depth, so a surface that reads the depth with
  `sceneDepth` or `sceneDistance` reads the stand-in there, 0 and the far plane, and cuts another
  shape in its shadow.
- **One feature marks the material for the renderer.** `feature::CASTER_COVERAGE` is set from the
  compiled WGSL, for the surface's alpha or for a coverage function, and the frame builders read it
  before they choose a custom caster or a custom motion build. The feature word's 32 bits are all
  taken, so the surface's alpha does not add a bit of its own: the coverage flag already says that
  the caster and the motion cut their shape, and this task widens what sets it. A material without
  it casts its mesh's whole shape, as it did before.
- **WebGPU runs the caster's fragment stage.** The custom template takes `depthFragment` for a
  material that names the alpha or a coverage. The engine's masked caster templates do the same. Its
  prepass keeps no fragment stage, since a prepass that drops pixels is no prepass. WebGL2 needed no
  change: its depth pass always compiled the template's fragment shader.
- **The depth and motion layouts reach the fragment stage.** A masked custom material's caster
  and its motion build run the surface function in a fragment stage, and that function reads the
  material's custom values, the table that holds its uniforms and its texture layers. The depth
  layout and the motion layout showed that texture to the vertex stage alone, because only a
  vertex offset had read it. A textured or a uniform-driven material therefore failed to build
  its caster's pipeline with E1408 on WebGPU, while a leaf of plain values built. Both layouts
  show the texture to the fragment stage too, where the bind group already held it.
- **The masked builds give the surface the same inputs.** A masked custom material's caster, and
  its motion build where it has a vertex offset, run the surface function, so they give it the
  inputs that
  [Surface functions](../../docs/shaders/surface-functions.md#cut-out-shapes) documents. Several
  faults broke that. The caster wrote no object matrices into `object`, though its vertex stage
  passed them. It placed the fragment in the shadow map's pixels, where the surface reads the
  camera's. The motion build passed the mesh's normal, not the world's. And the motion build never
  set `frontFacing`. Both also read the light where the surface reads the camera's `viewDirection`.
  The built-in `camera` and `frame.resolution` were the shadow view's and the shadow map's.
  The surface now sees the scene camera's view-projection, view, projection, near and far, target
  size and eye in light views, carried in the shadow frame. The frame's uniform data grows by 96
  bytes, and `FRAME_UNIFORM_BYTES` rises from 992 to 1,088. The caster fills the object's matrices,
  places the fragment in the camera's pixel, and reads the camera's place for `viewDirection`. The
  motion build passes the world normal and the face it draws. A surface that reads any of them
  therefore cuts the same holes in its shadow and its motion as where it shades. The
  `custom-surface-inputs` test compares a card whose alpha reads all of them against the same card
  without them, in the shadow and in the motion view. A shadow caster draws the triangles that face
  away from the light, so `frontFacing` and the side that `normal` faces can be the caster's own, as
  the surface docs say. A caster and a motion build bind no copy of the camera's depth, so a surface
  that reads `sceneDepth` or `sceneDistance` still cuts another shape there, as the docs now say.
- **Row values keep the mask's own test.** `ROW_VALUES` is no longer kept apart from
  `ALPHA_COVERAGE` or `ALPHA_HASH` in `APART`. The frame builder also stops exempting a batch's
  rows from the mask's own test. So a batch's rows test a mask by the cutoff, by coverage or by the
  hash, for every material. A tree drawn in a batch now takes alpha to coverage.
- **`VertexInput.colors` costs one attribute.** A vertex offset reads the mesh's vertex color, which
  the compiler grants only to WGSL that names it. The material then needs a mesh with colors, and
  nothing else pays for it. The field is `colors`, so it does not read as the surface input's
  `vertexColor`, whose value the row color multiplies.

The cost of the work, measured on this branch:

- **The engine's start and feature files.** `surface_place` builds the surface input's code for a
  custom material's masked caster and motion builds, under the custom def alone, so an engine lit
  build carries none of it. The start's files still grow, for the material gating that reads the
  compiled WGSL and the custom template's depth stage. The engine's own builds rose too: a batch
  whose rows bring values now takes its mask's own test, so the lit templates build each mask
  family over the row bit. The shader build budget rises with them
  ([Implementation notes](../implementation-notes.md#the-count-the-manifest-may-not-pass)).
- **A custom material's builds.** A material that names the alpha gains the builds of coverage, the
  hash and the sample mask, each of which picks up the template's other bits, and the masking of
  its caster and motion. The Vite plugin's build time and the page's module grow for such a
  material, and not for one that never cuts its shape.

### Measured

The Vite plugin's build time is the time its shader compiler takes for one custom material,
measured through `compileWgsl`, 5 runs after a warm-up:

| Material | Before | After |
| --- | --- | --- |
| a surface function that never names the alpha | 4,071 ms, 144 builds | 6,531 ms, 240 builds |
| a leaf: vertex offset, surface with alpha (and the vertex color after) | 4,999 ms, 177 builds | 18,178 ms, 625 builds |

The build counts do not depend on the machine's load: the landing's compiler builds the same 240 and 625 variants. A compile of the same two materials took 9,113 ms and 22,719 ms in a busy window there, so the times follow the load. Two things raise a material's builds. The
fading level of detail's builds double every material's shading builds, because they load with the
material's first use. Alpha to coverage, the alpha hash and their sample mask then multiply the
builds of a material that names the alpha, and its caster and motion gain the mask's test. The
figures for the manifest's count and the start's files sit in
[Implementation notes](../implementation-notes.md#the-count-the-manifest-may-not-pass) and
[D-14](D-14-js-budget.md).

## Fluid wind is an add-on of its own

The M3 plan measures fluid-simulation wind, settable by preset and adjusted by the governor. The
owner ruled that the wind is an add-on of its own, which the plants read. The reasons:

- Plants are not the wind's only readers. The plan also gives the field to dust, smoke and rain in
  the particles add-on (M3-V17), and to flags and water surfaces, which M3-V14 times. The battle
  demo's flags read it too, because M3-V12 moves each demo's own wind formula to the field.
- It passes [D-173](D-173-addon-hooks.md) ruling 4's test, because other add-ons build on it.
- A page pays nothing for a feature that it does not use ([D-54](D-54-addon-modules.md)). A game
  with flags and smoke but no plants must not need a plant package to get wind.
- A split before the API freezes in M4 breaks no page. The same split after the freeze
  would.

The cost is one more package to publish, version and document. The grass depends on the wind
add-on, and [D-173](D-173-addon-hooks.md) gives the rule for one add-on that depends on another.

| The wind add-on, `@null3d/wind` | Its readers |
| --- | --- |
| The analytic field of place and time. It is the whole field on the lowest tier, and the far field and the grid's inflow on every tier | The grass's blades, which read the field at their roots (M3-V8) |
| The grid that follows the camera, the solver and the fixed step | The demos' plant material, which reads the field per vertex (`examples/lib/sway.ts`) |
| The base wind, gusts and pushes at a point | The engine's particles, which read the field once for each particle |
| The one sampling function, in the wind add-on's own WGSL namespace (M3-D8) | Each reader's copy of that function, which the wind add-on's own test holds equal to it |
| Its feature's settings, budgets, governor steps and overlay row. Its budget is its own, not a share of the vegetation's | |

- The grass lists the wind add-on as a dependency, so one install gives grass that moves.
- Other readers take a plain input in the plan: the wind texture and its box. Examples are the
  particles add-on (M3-V17), water ripples and a flag. The page connects the two. A sample
  is one texture read through the box, so they need no code from the wind add-on and no dependency
  on it. M3-V14 times that read.
- The engine changes stay engine hooks that any add-on may use, such as M3-V13's compute passes that
  keep their state between frames.
- M3-V15 builds the wind add-on, and M3-V16 declares the wind's feature in it.

## The wind add-on's cost and budget

The wind's own cost at each preset, and the rows and the budget that each preset proposes, are in
[D-283](D-283-fluid-wind-cost.md). That record is the plan's addendum for the fluid wind: it gives
the field's cost on the Mac, the iPhone 17 and the Galaxy S24, the readers on the grove, and what
each figure is, whether measured, modelled from measured parts or a bound. It also names the rows
that M3-V16 declares, and what the look runs and the owner's ruling still owe.

## The grass's two halves

M3-V8's first slice builds the CPU half of the plan's two paths: `createGrass` places tufts on a
height function by integer hash and draws the hill in one instance batch for each tuft shape. A
preset draws its share: 0.35, 0.6, 1 or 1.25. The engine culls each batch's rows in groups. The
blades read the wind add-on's field at their roots, so one field moves the grass and the plants
together. The field's steady-air and sampling blocks are copied verbatim from the wind add-on's
`field.wgsl`, and a test fails when one copy is edited alone. The material takes the field's newest
layer each frame through `grass.setWindLayer`, which the page calls in its update.

**The far band's first build thinned, and a look review rejected it.** That build placed a quarter of
the near band's tufts past the first edge, gave their blades a single segment and widened them by
two. The review measured the crest's blade-green pixels at 36.2 to 18.3 per cent on WebGPU, 26.1 to
14.4 in compatibility mode and 20.9 to 11.6 on WebGL2, and saw wide sticks, a dotted lattice and a
density arc where the bands met. The arithmetic is why. A band's cover is its blades per area times
its blade width, so a band with a quarter of the tufts needs blades four times as wide, not twice;
the square root that the plan's line implies holds only when a blade grows in both its width and its
length, and only the width grew. The widening also lands where the ground hides it: a blade of one
segment is a triangle that tapers to a point, so its extra width sits at its root. The lattice is
the same two faults: single-segment blades are sub-pixel at the crest and rasterize as single
pixels, and every far row began to draw at one distance, so the engine's ordered fade dither fell in
one ring.

**The second build looked right and saved nothing, so the split left the code.** That build placed
every band's tufts at the same blade width and took the saving from the segments alone, 39 triangles
a tuft past the first edge against 65. It drew the hill at 3.54 ms at High on the Mac, a little
above the 3.47 ms of one band, because the far rows fell only to 60 per cent of the triangles while
the second batch and its band test cost the frame their own share. The review's rule was that a
saving which cannot hold the hill's look at its price is not taken, and this one cannot hold its
price at all. So the distance bands were removed rather than shipped unused: no page asked for them,
and a picture of the split would have recorded the rejected look as expected output. The record of
both attempts stays, because the arithmetic is the value that the work produced.

**What it costs.** The default hill holds 20,000 tufts at the High count, and Chrome on the Mac drew
it at 960 by 540 drawing pixels at each preset and path that its tier offers
([its run](../tested-devices/macbook-pro-m3-max-chrome/20261030-131312-vegetation-grass.md)).
WebGPU took 1.38, 2.36, 3.47 and 4.19 ms a frame from Low to Ultra at the median, with the wind
add-on's compute pass 0.07 to 0.13 ms of that, and the opaque pass at High carried about 1.3 million
triangles. The split hill's own runs are the two above, 2.59 ms for the rejected thinning and
3.54 ms for the look-preserving split, with their rows allocated once for Ultra's share: 43,750 rows
of 64 bytes. The default's High reading sits inside the vegetation's own 49.0 ms budget on the Apple
devices. The iPad, the S24 class and the Tab A9 Plus rows are owed. The picture holds the air still,
so its blades stand straight, and its references hold the three tiers of both sets.
`createGrass` draws on WebGL2 too, where the field's grid costs extra draws.

**The compute half.** On WebGPU and compatibility mode a compute pass builds the blade list and
writes its count. `createGrass` keeps the CPU's integer-hash placement, so both paths place the same
tufts, and uploads the placed tufts in a data texture of two texels each: the place rounded to whole
meters with the turn, then the rest of the place with the size. One workgroup of the pass loops over
the preset's share, writes each tuft's world matrix and ids into the draw's instance buffer, and
adds each one to the count word. The engine copies that word into the main view's indirect entry and
every drawn shadow view's (M3-E9), so the near cascades draw the same list and count as the camera's
view. The draw casts and receives shadows on both paths, and the blades' sway fades to nothing at
the distance that the page gives, so a far cascade that only the grass reaches keeps its cached
layer. The blades' tint comes from a hash of the tuft's root place on both paths, not from row
values, so one shader serves the compute draw and the batch alike. WebGL2 keeps the instance batch,
which the CPU fills.

**The view cull and the distance bands.** The pass culls each 4 meter tile against the camera's
frustum. It keeps a share of the far tufts from their roots' hashes. The fade reaches its floor at 24.31
meters, shortened from the authored 45: under 10 meters from the camera it keeps all of them; at 10
to 20 meters, 71 per cent; at 20 to 30, 28; and past 30, 25. A kept far tuft's blades widen by the
inverse of its share, so the cover stays the same. The shortening removes 36.9 per cent of the drawn
tufts, and it costs 0.768 per cent of the hill crest's pixels and 0.085 per cent of the demo's
horizon against the pictures at the authored distance. The draw shader holds
the same block, so WebGL2's batch collapses the tufts that the share leaves out. Both paths then draw
one hill. On the hill of 20,000 tufts at High the share keeps 8,452.

Each view then culls the kept list to its own box in the draw shader, from the frame's own matrix. The
camera's view draws its frustum. A light's view draws its cascade, whose box reaches toward the light
over the casters, so the near cascades no longer draw the whole kept list. A tuft's root and a point a
tuft's reach away go through the view's matrix, so the margin that a blade crossing the edge needs comes
from the view's own scale. The list stays the one that the compute pass writes; no second list and no
second count.

**The stress hill and the rows that compare.** The 20,000 tuft hill is a stress case: 17.3 tufts on
each square meter, and its rows hold no ceiling. On the Tab A9 Plus its High row is 961.54 ms with
the near shadows and 283.97 without. The rows that D-241's ceilings compare draw the hill at Creek's
own density. On the same tablet, 2,312 tufts, its valley's 2.0 on each square meter, take 306.09 ms
with the view cull and the far share and 318.77 without. 6,820 tufts, its bank strip's 5.9, take
490.73 and 527.17. The cull takes 4.0 per cent back at the valley's density and 6.9 at the strip's.
Neither row reached 208.3, the S24 class's High ceiling, which these rows were measured against as a
target because the tablet has no row above Medium. The same page with the grass switched off
measures 179.18 ms, which is 29.12 ms inside that target, so the base scene does not break it: the
grass at the valley's density adds 126.91 ms and at the strip's 311.55. The frame's own cost sits mostly in its opaque pass: with
the sun's contact shadows and the bounce light off, the scene measures 143.49 ms and the timer names the
opaque pass at 138.94. The timer times the frame's first seven passes one by one and adds every pass after them to
the last of those, so the 176.36 ms that it gave ambient occlusion's denoise was the opaque pass
and the rest of the frame in that slot. The three ambient
occlusion passes, which the contact shadows and the bounce light keep, cost about 43 ms: the same
scene measures 186.25 with the contact shadows on. The pictures show that neither effect changes what
the hill looks like: the four drawings, with either effect off and with both, are pixel for pixel the
same. With both off the hill at Creek's density measures 235.41 ms, 27.11 ms past the target, so the
effects' 43 ms does not close the gap either. The grass's fixed cost, its shadow pass and draw
setup, adds about 33 ms on top of the per-tuft cost. The owner ruled that the demo draws without the
two effects: their pictures are the same at Low, Medium and High, and the Creek sketch pins the
settings so a preset change does not bring them back. The far cover then closed the gap: at 24.31
meters the row measures 209.72 and 196.02 ms, mean 202.87, while 25.59 meters gives 217.45 and
216.60. The base page bracketed that block at 162.27 and 156.30, so the machine drifted about 6 ms
within it, and the 208.3 target sits inside the row's spread at the chosen distance rather than outside it.
The fit through two tuft counts first put the base at 211.9 ms and was read as the scene's own cost. A
fitted intercept is not a base frame: it carries everything the removal would also take away, whether or
not that cost varies with the count, and only switching the thing off gives the base. Every view culls the
kept list to its own box, the cascades among them, so a shadow view draws only the tufts inside its
cascade. It reads the frame's own matrix and the one count that the compute pass writes. On the
tablet the cull takes little back, because the cascades were never the large part: three runs at
2,312 tufts measure 288.75, 294.98 and 298.22 ms against 306.09 before, 3 to 6 per cent, and at
6,820 they straddle the earlier 490.73 at 466.35 to 497.68. The three cascade passes together time
at 2.1 to 2.2 ms a frame at the valley's density and 6.3 at the strip's. The row still misses that
target by about 87 ms, and the two places that could close it stand unchanged.
Two pictures hold the look. `vegetation-grass` holds the hill. `vegetation-grass-shadow` holds it at a
low sun, where the grass's shadows follow the count, so a view that drew the capacity would show the
rows past it.
