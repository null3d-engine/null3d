# D-241: A vegetation foundation add-on, with GPU grass, generated plants and wind on custom materials

Status: decided by the owner. Built: the `@null3d/vegetation` package with its generator and built-in species (M3-V4), the bark and leaf atlases (M3-V5), the scatter (M3-V6), and the leaf and bark materials that sway in the wind add-on's field (M3-V7). The engine's vertex offsets read a compute pass in every pass (M3-V3), custom materials have the standard material's cut-out features (M3-V2), and the wind add-on's first stage is built (M3-V15, D-265). Not built yet: GPU grass (M3-V8) and far-tree impostors (M3-V9). Branch poses (M3-V10) and Creek's move to the add-on (M3-V11) are not built yet either. Open: which wind method trees use by default, per vertex or by branch poses, which M3-V10 measures for the owner's ruling. The generated leaves wait for the owner's judgment. Tasks: M3-V1 to M3-V17.

Summary: Vegetation is the eleventh foundation add-on, `@null3d/vegetation`, which grows plants at first use and places them by ecological rules. It draws grass on the GPU, sways plants in the wind add-on's field and hands far trees to impostors. Creek drops its 3.1 MB of Blender plants for it, and custom materials, whose vertex offsets carry the wind, gain the standard material's cut-out features.

## Question

Creek dresses about 5% of its valley, with three tree kinds in fixed counts, and only its grass moves. The owner wants complex, varied trees, shrubs and grass over the whole landscape, in Creek and in every other plant demo. Where does that work live, does GPU grass come back, and do Creek's Blender plants stay? How does wind reach masked leaf cards without losing their edges, fades and shadows?

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

1. **An official foundation add-on.** Vegetation is the eleventh foundation, its own npm package, `@null3d/vegetation`. It passes ruling 4's test: many kinds of project use plants, and other developers' style packs build on it.
   - **What it holds:** the species generator, the texture baker, the scatter and the grass. It also holds the leaf material, the wind on the plants, the hand-off to far-tree impostors and a small built-in set of species. Each species is a short record of numbers.
   - **What other developers make:** themed species packs, such as tropical, autumn or stylized plants. They are content, the "vegetation styles" that D-173 leaves to other developers.
   - **Reuse:** it reuses the terrain and impostors foundations and copies neither.
2. **GPU grass returns.** Creek's hills are the "vegetation-heavy ground" that [D-179](D-179-technique-rulings.md), ruling 20, names as the trigger. GPU grass is built in M3, inside the vegetation add-on, not as a separate content pack.
   - **WebGPU:** a compute pass makes and culls the blades, and H2 draws them in the main view and the shadow views.
   - **WebGL2:** the CPU builds grass tiles of instance batches, which the engine culls in groups of 64 rows, with distance bands.
3. **Generated plants replace Creek's Blender models.** Creek's trees, ferns, hostas, shrubs and flowers come from the add-on's generator at first use. The Blender script, its manifest entries and its files go. The other plant demos move to the add-on after Creek.
4. **Wind on custom materials, which keep their cut-out features.** Wind stays a custom material's vertex offset, as [D-117](D-117-showcase-features-before-1-0.md) has it. Custom materials gain:
   - alpha to coverage and the alpha hash;
   - fades between levels and at the edges of distance bands;
   - a masked shadow caster that runs the material's alpha;
   - motion builds that cut the material's holes.

   Batches with row values may also take alpha to coverage and the hash. `VertexInput` gains the vertex color for wind data. The coverage and hash builds go only to WGSL that sets or reads the surface's alpha, as transmission's builds do. This holds build time and size. The task measures build time and shader file size with and without them.

## The choices the design left open

The owner settled the design's open questions, all as the design recommended, so the tasks start without asking again.

- **The package.** `@null3d/vegetation` holds the built-in species set, as well as the generator, the scatter, the grass, the materials and the impostor hand-off. The species set is the smallest thing that makes the package useful on its own.
- **Where the leaf-card level rule lives.** The generator builds its own levels from its skeleton, and one shared test holds the rule. The command-line tool's thinner is not importable by an add-on, and a generator that knows its skeleton keeps the crown full.
- **Repeat visits.** A page bakes its atlases and impostors and keeps them for that visit only. It keeps them across visits only if the bake measures over about a second on the slowest device.
- **How far Creek's dress goes.** The whole 160-meter valley, not the stream strip alone. Distance falloff, wider blades far off and impostors soften the edge.
- **Variety.** Six variants for each species and one impostor for each species. Ten variants would exceed the batch and memory limits.
- **The trees' wind method.** Per-vertex wind ships first, and M3-V10's figures decide whether a preset switches. The vertex format stays the same for both methods, so a switch costs one redraw of the references.
- **Which demos move.** All nine move to the add-on, one at a time after Creek meets the quality bar. A demo whose style the generator cannot match gets a recorded exception, never a second generator.
- **A themed species pack.** One small example comes after the other demos move, if time allows. It is not on Creek's critical path.
- **Wind in Creek.** The owner requires the Creek showcase to show wind on its plants. The trees sway, the grass and shrubs move, and the floating leaves ride the same wind field. A still valley does not meet the bar. Per-vertex wind is the default, and M3-V10's figures decide whether a preset switches to branch poses.

## Wind by bones

This section says what wind driven by bones takes in null3D, and whether it is better.

**What it is.** Each tree has a skeleton of branches. A pass computes each branch's pose once per frame, and each vertex follows its branch.

**What null3D needs.** The core needs no skinning of instance batches. The add-on runs an H1 compute pass ([D-240](D-240-compute-passes.md)), with its fragment form on WebGL2. The pass writes each near tree's branch poses into a texture, for this frame and the last. The leaf and bark materials' vertex offsets then read their branch's pose with `textureLoad`. Three engine changes make this sound, and M3-V3 builds them:

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

## Options rejected

- **Creek-only vegetation.** It is the fastest path to a better Creek. But it would make a sixth pine generator, a fourth grass and a fourth leaf mesh, where rule 11 asks for one place.
- **An example add-on that is never published.** Its interface could change freely. But versions before 1.0 allow that anyway, and other developers are meant to build plant packs on it.
- **A vertex-offset hook on the standard material.**
  - It would be a second API for what custom materials' vertex offsets already do.
  - Leaves need custom shading anyway: crown-bent normals, crown occlusion and a tint per leaf.
  - The row-value exclusion would still take alpha to coverage away from batched trees.
- **Skinning of instance batches in the core.** Each row of a batch would get its own joint palette, through the skin, caster, motion, fade and row-value builds of both paths. It is a large core change for what an H1 pass and a vertex offset give.
- **One sine sway for each tree.** It loops visibly, and viewers judge wind by its frequencies and amplitudes.
- **The wind field inside the vegetation add-on.** A page with flags and smoke but no plants would then need the vegetation add-on for its wind. [Fluid wind is an add-on of its own](#fluid-wind-is-an-add-on-of-its-own) gives the reasons.

## Consequences

- AGENTS.md rule 13 lists vegetation among the foundation add-ons.
- [D-173](D-173-addon-hooks.md) and [D-179](D-179-technique-rulings.md) point here. D-117's rule that wind is a recipe on vertex offsets holds, and the recipe lives in one place, the vegetation add-on.
- `.dev/examples.md` records the planned move of Creek's plants and the showcase rule on plant models.
- M3 holds this work as tasks M3-V1 to M3-V17. M3-E9's GPU-written draws must also work in the shadow views, because near grass casts shadows. The impostors' bake helper is in M3 for the far trees, which are baked at first use.

## The four devices' figures, and the budgets they set

M3-V1 measured Creek and the forest demo on four cloud devices. They are the iPhone 17, the iPad
Pro 13 2025, the Galaxy S24 and the Galaxy Tab A9 Plus. The Galaxy S25 measured Creek's WebGPU path
and the package's generator in runs of their own. Each page fixed its GPU path and its preset.
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

**Creek on WebGPU.** The Galaxy S25 draws Creek on core WebGPU, which the Apple devices cannot. The
owner ruled that this phone stands in for the S24 class, whose own device has no WebGPU adapter and
no WebGL2 GPU timer. The figures come from one run of the plan.

| Preset | Frame ms | GPU ms | Busiest pass | Its ms | Triangles | Draws |
| --- | --- | --- | --- | --- | --- | --- |
| Low | 33.3 | 26.28 | opaque | 20.38 | 1,524,500 | 182 |
| Medium | 166.6 | 149.88 | opaque | 141.16 | 4,387,400 | 174 |
| High | 208.3 | 213.61 | ambient occlusion 1 | 164.72 | 6,798,700 | 288 |
| Ultra | 499.8 | 468.19 | ambient occlusion 1 | 279.38 | 11,100,000 | 303 |

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

**Tree generation.** A worker built a stand-in parametric tree in the style of Weber and Penn. It ran at
each preset's detail, for four species and six seeds each. The set of 24 variants took 14 to 23 ms
on the iPhone and the iPad. It took 33 to 47 ms on the S24, and 49 to 94 ms on the tablet. The arrays take
7.0 MB at Low and 22.7 MB at Ultra, and the triangles run from 123,876 to 474,096. The slowest
single variant was an oak at Ultra on the tablet: 5.42 ms for 27,090 triangles. M3-V4's generator
replaces the stand-in, and the stand-in's figures set the shape of the budget.

The package's own generator ran on the S25, at 78 variants for each preset. Before the leaf morph
data, the set took 163.0 ms at Low, 137.9 at Medium, 156.9 at High and 148.9 at Ultra ([its run](../tested-devices/galaxy-s25-sm-s931b-chrome/20261027-002251-tree-generation.md)).
With that data it takes 198.6, 164.9, 161.9 and 172.4 ms on a second run after the phone cooled
([its run](../tested-devices/galaxy-s25-sm-s931b-chrome/20261030-021612-tree-generation.md)), inside
the 200 ms line at Low by 0.7 per cent. The first run with that data read 213.4 ms at Low while the
cloud reported the phone hot, and it is discarded as an upper bound
([its run](../tested-devices/galaxy-s25-sm-s931b-chrome/20261030-015719-tree-generation.md)). The
same generator ran on the iPad Pro 13, where the set took 77.6 to 105.2 ms and the arrays take 20.5
and 24.5 MB ([its run](../tested-devices/ipad-pro-13-safari/20261030-014425-tree-generation.md)).
The page draws nothing and asks for no GPU path, so these are the JavaScript engine's and the
worker's figures, not a GPU's.

**The budgets that every later V task takes, by preset.** The frame and generation figures come
from measured rows above. The add-on's own GPU time keeps room beside the scene. A later task states
its budget per preset from this table.

| Preset | Frame ceiling, iPhone 17 and iPad Pro 13 | Frame ceiling, S24 class | Frame ceiling, Tab A9 Plus | The add-on's GPU time, Apple |
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
those presets draw on core WebGPU only, and the tablet offers no WebGPU adapter.

- **Frame time:** the dressed Creek and forest must stay within the frame interval of the same
  preset, device and path. A preset that falls to a lower one at the same page fails.
- **The add-on's own GPU time:** at most 5 ms at Low and 12 ms at Medium on the Apple devices. These
  two are chosen allowances inside the measured draw; the forest's whole WebGPU draw takes 6.6 to
  6.9 ms at Low and 45.4 to 53.7 at Medium, both above the allowance beside them. At High and Ultra
  the figure is measured: the far cards' pass takes 43.5 to 49.0 and 49.2 to 62.5 ms, and each
  budget takes the larger Apple figure.
- **Generation:** the whole tree variant set at any preset must build in under 200 ms on the
  slowest measured device, and under 150 ms on the iPad. The stand-in's 24 variants took 14 to
  23 ms on the iPhone and the iPad. The package's 78 variants take 77.6 to 105.2 ms on the iPad and
  161.9 to 198.6 ms on the S25, inside the 200 ms line at Low by 0.7 per cent on a second run after
  the phone cooled. A first S25 run read 213.4 ms at Low on a hot phone, and it is discarded as an
  upper bound.
- **Memory:** the budget is 20.5 MB at Low and Medium and 24.5 MB at High and Ultra. The owner set
  it, because every leaf vertex carries the next level's place for the material's morph. The
  stand-in took 7.0 to 22.7 MB. The GPU textures must stay within the measured figures for the same
  demo and preset, which the add-on shares with the scene. Creek's 3.1 MB of Blender models leave,
  and the arrays replace them.

## The generator's shape

M3-V4 builds the add-on as `@null3d/vegetation`. The generator follows this record's look and
settles four questions that the record leaves to the build.

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
- **A conifer's needle card stands for a spray of needles.** A card 0.05 m wide and 0.3 m tall is
  less than half a pixel wide at the picture's framing. The tree then reads as a bare trunk with a
  few specks. The card is 0.35 m wide and 0.7 m tall, with 24 to a twig. The branch record is the
  same for both sizes, so the crown keeps its taper. The wide cards bring the conifer's asset to
  627 KB, against 498 KB with the narrow ones. The needle atlas of M3-V5 draws the needles inside
  the card, and a card too small for its spray could not carry them.
- **The asset is one merged mesh for each part at each level, not a set of shared twig modules.**
  The shared-twig idea from the research would need one draw for each module. A scene's 256 batches
  cannot hold the tree variants beside the grass and the impostor cards. The merged parts keep the
  measured memory. A tree takes about 0.3 to 0.5 MB over its levels, and the add-on's 78 variants
  take about 18 MB.

The built-in set holds thirteen species and six variants each. It grows on the calling thread or in
one of the engine's job workers, with the same asset either way. Every choice comes from the
integer hash that the shaders' `pcg` also computes.

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
  hash, for every material. A tree drawn in a batch now takes alpha to coverage, which the
  vegetation add-on needs.
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
  with no tolerance to argue about. A strict comparison across devices needs this: `Math.sin` and
  `Math.atan2` are allowed to differ in their last bit between engines. A position built from them
  would not compare equal.
- **The tiles cannot change the result.** A candidate's cell is indexed over the whole square. It
  is not indexed over a tile. The build walks the cells of the tiles added in one row-by-row order.
  The first plant to claim a place keeps it. Both the order that the tiles arrive in and the tile size
  therefore leave the points identical, and the test checks all three. A walk of the tiles one
  after another would place each tile band's rows before the next tile band's, so a larger tile
  would win other shared places.
- **The occupancy grid records the layer, and a rule names the layers it must avoid.** The default
  is every layer. A sapling names only its own layer, so it stands under the crown that shelters
  it; ground cover and shrubs do the same. Without this the young layer places 12 plants in Creek's
  valley, because every sapling stands inside its parent's crown radius.
- **Wetness is normalized at the flow's 95th percentile, not its maximum.** Flow gathers by a power
  law, so one channel holds most of it, and the maximum leaves the rest of the ground at 0.06. The
  percentile gives the channels 1 and the slopes near 0, which is what a species' curve can use.
- **The curves fit Creek's measured ground.** The built-in rules follow the measured percentiles
  of each input over the valley. Curves written from the general shape of a valley place 57 plants
  in Creek, with nothing in the ground layer. Their bounds are narrower than the ground's own
  bands. A scene on other terrain moves the numbers that differ.

**Figures.** Creek's 160 m valley, placed with its eight species at seed 7, holds 955 points. They
are 104 canopy trees, 174 saplings, 651 ground plants and 26 dead wood. The checksum of that placement is
916344353. The device page compares it on every device and both GPU paths. On the Mac the scatter
takes about 10 ms in Chrome and the ground maps about 45 ms.

The `vegetation-scatter` plan ran on two cloud phones, each page reporting the middle of three
timed placements.

| Device | Plants | Checksum | Placement | Ground maps | Display |
| --- | --- | --- | --- | --- | --- |
| Galaxy S24, Chrome, WebGL2 page | 955 | 916344353 | 9.0 ms | 85.9 ms | 30 Hz |
| Galaxy S24, Chrome, WebGPU page | 955 | 916344353 | 11.7 ms | 60.0 ms | 30 Hz |
| Galaxy S25, Chrome, WebGL2 page | 955 | 916344353 | 9.8 ms | 51.3 ms | 30 Hz |
| Galaxy S25, Chrome, WebGPU page | 955 | 916344353 | 5.9 ms | 50.9 ms | 30 Hz |

The placement runs on the CPU and starts no engine, so both pages of a device run the same work.
The S24 has no WebGPU adapter, so its second page named a path that it did not start. Both displays
ran at 30 Hz, and the cloud reported each phone hot, so read the times as upper bounds. The run
files are [the S24's](../tested-devices/galaxy-s24-sm-s921b-chrome/20261024-202948-vegetation-scatter.md)
and [the S25's](../tested-devices/galaxy-s25-sm-s931b-chrome/20261024-203522-vegetation-scatter.md).

**Options rejected.**

- **Float noise for the point source.** It draws other plants on other GPUs, which hard rule 29
  already refuses for shaders.
- **A hard cutoff instead of a score.** A tolerance curve that accepts or refuses a place outright
  gives hard band edges, where the density jumps from one species to none. The score as the chance
  that a candidate grows fades each species into its neighbor's ground.
- **Occupancy resolved per tile.** A tile that arrived after another would see that tile's plants
  and refuse its own, so the result would follow the streaming order.

## The bark and leaf atlases, and why the browser paints them

M3-V5 builds the atlases that give a plant its bark and its leaves. `bakePlantAtlases` paints four
textures from integer hashes in the browser, the first time a page asks for them, and `plantMaterial`
draws a trunk or a crown from them. The plan asks for the atlas to be painted on the GPU and kept.
The need to keep it is what decides where it is painted.

**What the atlases hold.** The bark block is 256 texels square and tiles around and along a branch:
stretched Voronoi plates, warped by fractal noise, with cracks between them and fibers up the trunk.
The leaf block is 512 by 256 texels, in eight cells of 128: four leaf clusters, a needle spray, a
frond, a blade and a broad leaf. A leaf comes from an outline with veins written into a height field,
and the gradient of that field gives the normal map. Each atlas has a color map, in sRGB, whose
values multiply the species' own color, and a linear surface map: the normal in red and green, the
leaf's coverage or the bark's roughness in blue, and the leaf's thickness in alpha.

**A pass texture keeps no image once its pass stops drawing.** A full-screen pass that paints the
atlas once and then waits, through `every` or through `render.setPassEnabled(pass, false)`, leaves
the materials that sample its texture with nothing: every picture comes out black. The engine's
documentation promises that a pass keeps its last image, and the render graph keeps the same
resource, so it is the image that is lost rather than the binding. Painting the atlas in every frame
that a plant draws is the only way a pass texture would hold it, and that is far too slow: on
CI's software GPU the vegetation pages then take more than sixty seconds and time out.

**A pass texture keeps no alpha either.** A fragment shader's alpha does not reach a material that
samples the pass's texture: a leaf's cut-out draws as a filled square. Even the per-frame route
would need the coverage moved into a color channel.

**The alpha half, and its fix in M3-V13.** The HDR path packs the scene color into 11, 11 and 10
bits, with no alpha, and a full-screen pass's target took that format, so the shader's alpha had
nowhere to go and every sampled alpha read 1. A full-screen pass's target now takes rgba16float
there, whose fourth channel holds the alpha, and a Rust test fails when the packed format comes
back. The 8-bit path's target already had one, so compatibility mode and WebGL2 never have the
packed target and cannot show the fault; the page check proves it on the WebGPU HDR path, where the
old format reads a coverage of 234. The compute pass keeps its alpha in its own rgba16float target.

**The image half.** The new cases stop a full-screen pass and a compute pass, and keep their image
and their zero coverage on all three GPU paths; a case added late that paints once keeps its image
too. They do not reproduce M3-V5's own route, so this record fixes the alpha half and shows the
image holds on the routes it tests. It does not name a cause for M3-V5's lost image.

**So the browser paints, and the engine keeps.** The pixels come from the same integer hashes that
the shaders would use, so every device paints the same atlas and no file is downloaded. The engine
makes each texture's mip levels, whose average alpha is the leaf's coverage, and a masked material
fades its cut edges with alpha to coverage. That keeps a shrinking card's coverage without a
pyramid of levels painted by hand. A test holds the property: three leaf cards of one square of the
atlas, at 12, 24 and 48 meters from one camera, cover the same share of their own boxes.
`tests/image/leaf-card-coverage.spec.ts` runs it on all three GPU paths, and the
`vegetation-coverage` picture shows the same for three crowns at three distances.

**Owed.** The paint's time on each device, which the device record keeps, and the owner's judgment
of the generated leaves beside Creek's painted textures, which the `vegetation-versus-creek` picture
shows side by side.

## What each leaf cell holds

A leaf cell must hold many leaves that differ in tone, shape and edge, as Creek's painted oak does.
One smooth outline repeated along a twig passes the coverage test, yet a crown of such cards reads
as a pale tiled slab. That gap is what M3-V5's judgment asks about.

**Each leaf's width follows its aspect.** The painter multiplies a leaf's half width by the leaf's
aspect. Without that, every leaf paints between three and twenty times too wide for the shape its
family describes. A single cell still looks like a leaf, because a leaf that is too wide is still a
leaf. A crown does not: its cards merge into slabs, and no outline can be seen. Whoever changes a
painter should check it on a repeated card as well as on one cell, since one cell hides this fault.
A unit test holds each cluster cell's cover between 0.35 and 0.8 of its square, which a painter of
too-wide leaves cannot reach.

**What a cell holds.** A cluster cell carries 20 to 24 leaves, so a card presents leaves over
most of its square. A family sets each leaf's outline. That outline has a width profile along
the midrib and teeth along the edges. A family may also give the lobes of an oak or a hosta, and the
veins. Each leaf of a card then draws its own numbers from its seed. These cover its profile and
aspect, and its tooth count and depth. They also cover its lobe depth, vein count and strength, a bow
of its midrib and a narrower side. Its brightness and its lean to yellow come from them too. One leaf
in five has a round bite out of an edge, so a crown never reads as a pattern. The cells keep their
eight kinds. Four are broadleaf sprays: an oak's lobes, a beech's fine teeth, a birch's small teeth
and a willow's narrow blade. The fifth is a conifer spray of needle pairs, and the sixth a fern's
frond of lobed pinnae. The seventh is a clump of eleven grass blades. The eighth is a broad hosta
leaf, with a smaller one behind it.

**The color map.** A leaf runs from darker at its base to lighter at its tip. A slow blotch mottles
its blade, its veins take a line of shade or light, and its rim darkens by half. That rim lets two
overlapping leaves read apart, as a painted card's dark edges do. A leaf also darkens where another
leaf lies over it, as a pile of leaves shades itself. The channels are scaled so that the brightest
one stays under white. A warm leaf then shows its hue instead of clipping to a pale pink or blue.
Across a cell, the green channel spreads with a standard deviation of 22 to 26 of 255. The darkest
leaf lies near 128.

**What takes no leaf.** A texel that no leaf covers takes its cell's mean leaf color and mean height.
Mip levels average color without weighting by alpha. A background of its own would therefore pull a
distant crown's hue toward it. A height of its own would bend the normal at every silhouette.

**A card's fill is what closes a crown.** At a fill of 0.34 of a card's square, the
`vegetation-versus-creek` picture shows cards of leaf with sky between them. A crown then reads as
several bunches rather than one crown. The card count is not the cause. The oak generator places 960
cards of 0.8 by 0.72 meters for the crown. Creek's painted oak holds about 4,550 leaf quads over a
crown of 9 by 7 by 10 meters. In leaf area the generated crown carries more than the painted one. At
a fill of 0.46, with 20 to 24 leaves of their own size in each cell, the same crown closes. A fill of
0.62 closes it no further, and it costs the leaves their own shapes. Leaves grown until they near the
card's rim make each card read as one huge leaf, which is the same fault at another scale. So the
fill comes from more leaves, never from longer ones.

**The coverage property holds.** A cluster cell covers 0.45 to 0.48 of its square. The coverage test
reads 0.490, 0.496 and 0.498 of a card's box at 12, 24 and 48 meters, on all three GPU paths. A card
therefore keeps its share as it shrinks.

**The bake's time.** `paintLeaf` takes about 230 ms, and `paintBark` about 160 ms, on an Apple M5 Max
laptop under load. Each leaf rejects a texel outside a box around its outline before it works out the
outline. That holds down the cost of a cell of many leaves.

**What the pictures show.** The `vegetation-atlas` picture's leaf card is a twig of lobed leaves that
fills its square. The `vegetation-versus-creek` picture shows the generated oak beside Creek's
painted one, and the leaves there have outlines, veins and tones of their own. That picture shows a
gap: the generated crown is paler and flatter than Creek's. The atlas is a map that multiplies a
species' color. The crown is lit by one uniform light with no crown occlusion, so the leaves differ
by their own paint alone. Creek's texture carries painted shadowing as well. The rest of that gap
belongs to M3-V7, not to the atlas. That task adds the leaf material with crown-bent normals, a tint
for each tree and crown occlusion.

**The leaf's normals.** M3-V7 lights a leaf's diffuse and ambient light by a normal of its own,
`s.diffuseNormal`, and keeps the leaf's own normal for its gloss and the light through it. The
crown's normal is radial from the crown's center. An ellipsoid normal would bend it by the crown's
shape instead, but it needs two more numbers in the plant material's uniforms. That row holds 26
numbers with the material's six textures, and the current layout ends at 26 of 26; a repack into six
four-number groups would fit them at 24. The gain did not pay for the repack, and the research
report lists a normal from the crown's center as a valid crown normal. The second normal itself costs
no uniform: it is a field of the shader's Surface record, so a material that never names it keeps the
template's single-normal path.

## Fluid wind is an add-on of its own

The M3 plan measures fluid-simulation wind, settable by preset and adjusted by the governor. The
owner ruled that the wind is an add-on of its own, which the plants read. The reasons:

- Plants are not the wind's only readers. The plan also gives the field to dust, smoke and rain in
  the particles add-on (M3-V17), and to flags and water surfaces, which M3-V14 times. The battle
  demo's flags read it too, because M3-V12 moves each demo's own wind formula to the field. So do
  Creek's floating leaves.
- It passes [D-173](D-173-addon-hooks.md) ruling 4's test, because other add-ons build on it.
- A page pays nothing for a feature that it does not use ([D-54](D-54-addon-modules.md)). A game
  with flags and smoke but no plants must not need the vegetation add-on to get wind.
- A split before the API freezes in M4 breaks no page. The same split after the freeze
  would.

The cost is one more package to publish, version and document. Vegetation is also the first add-on
that depends on another add-on. [D-173](D-173-addon-hooks.md) gives the rule for that.

| The wind add-on, `@null3d/wind` | The vegetation add-on |
| --- | --- |
| The analytic field of place and time. It is the whole field on the lowest tier, and the far field and the grid's inflow on every tier | Wind per vertex (M3-V7), and branch poses with their springs (M3-V10) |
| The grid that follows the camera, the solver and the fixed step | The grass's compute pass, which reads the field (M3-V8) |
| The base wind, gusts and pushes at a point | The wind bytes in each plant's vertex colors, and the branch records |
| The one sampling function, in the wind add-on's own WGSL namespace (M3-D8) | The scatter's grid of canopy cover, which it gives the wind as a drag input |
| Its feature's settings, budgets, governor steps and overlay row. Its budget is its own, not a share of the vegetation add-on's | The falling and drifting leaves, which ride the field (M3-V17) |

- Vegetation lists the wind add-on as a dependency, so one install still gives plants that move.
- Other readers take a plain input in the plan: the wind texture and its box. Examples are the
  particles add-on (M3-V17), water ripples and a flag. The page connects the two. A sample
  is one texture read through the box, so they need no code from the wind add-on and no dependency
  on it. M3-V14 times that read.
- The engine changes stay engine hooks that any add-on may use, such as M3-V13's compute passes that
  keep their state between frames.
- M3-V15 builds the wind add-on, and M3-V16 declares the wind's feature in it.
