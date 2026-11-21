# Creek: a garden on a cliff above the clouds

**Status: a plan. Do not implement yet.** First written on 2026-11-02 against the old milestone branch. Re-checked against `main` at `bb882f565` on 2026-11-20, and every finding below holds on that commit. The owner's rulings and answers of 2026-11-20 are in "Owner's rulings" and "Owner's answers" below. Nothing in this plan has been built.

## Context

The owner rebuilds Creek from the ground up (D-363). This garden is that rebuild. It replaces today's valley in place. It is not a second scene.

The garden shows the engine's water, wind, weather, particles and grass, and the hero models generated with Tripo3D and finished in Blender. No part of the garden uses the vegetation add-on (D-378).

The owner's setting:

- A rough circular cliff, like a stump, surrounded by clouds just below the rim that hide the ground.
- A creek across the diameter, falling over the edge at both ends as animated waterfalls.
- A big Buddha on one side, away from the creek and higher than it, reached by steps.
- A very beautiful garden over the rest of the top.

**Chosen look:** green bronze in an autumn garden (job 2b3da0a9-dbff-44af-b766-4f0113f73ad2).

**Concept picture:** `concept.png` beside this file, the chosen look, made with Higgsfield (model `gpt_image_2_5`, 16:9, 1344 by 752).

The four other concepts stay in the owner's Higgsfield gallery and are not in git: bronze at sunrise (09848ab5-4aa6-4222-b3ff-1b982a62bd42), stone terraces in a tropical garden (00b0bad0-0e31-4156-b5dc-f45dcd49822e), white granite in spring with the livelier creek (6d9afe7a-50b1-4d6c-816c-82ea63841227), and gold at dusk (a9162a07-a005-4971-b4eb-a38d8baa106c).

## Owner's rulings, 2026-11-20

- **Models come from Tripo3D and Blender.** Tripo3D generates the meshes, and a script in Blender finishes them for the engine. See "Models: Tripo3D and Blender".
- **Today's water carries over,** with the way it works with the camera. See section 3.
- **The creek falls off the edge as animated waterfalls.** See section 3.
- **Clouds surround the cliff.** See section 2.

These rulings widen the model rule of `.dev/examples.md` and D-378, which today allow only models built by script in Blender. The garden's decision record holds the change.

## What main changed since 2 November

| The 2 November plan said | Main now | Effect on this plan |
| --- | --- | --- |
| Creek becomes the vegetation add-on's full demo, with rocks and species added to the add-on | D-378: the add-on is private, ships nowhere and is off CI, and no demo draws its plants. Creek loads trees, bank plants and a cave that `creek.py` builds | Models come from Tripo3D and the Blender script. Small stones stay in code |
| Close M3 on today's valley first, and correct the status text in `tools/pr-status.ts` | M3 is complete: every task closed before the 0.2 release work (#549) merged. D-363 keeps today's Creek figures as a stated limit, with no further cost work. D-364 closes the vegetation cost tasks | Step dropped |
| Add a task in `tools/hooks/task-ids.txt` | D-379: the task list, the `Task:` footer and the status tool are gone. Each piece of work lands as its own pull request against main | Order of work and branch rewritten |
| The cave went with Blender | The cave is back, built in Blender from metaballs (`cave.glb`) | The garden leaves it out (owner's answer) |
| Levels of detail start off, so set `lod: true` | Since #549 the shared showcase code turns levels on unless a scene says `lod: false`. Mesh levels switch or fade with a dither. Only the terrain add-on morphs | Step dropped. "Morphing levels" now reads "dithered levels" |
| Falling leaves come from `createFloatingLeaves` | That call is in the private add-on only. Creek's falling and floating leaves are `@null3d/particles` systems with a tint for each mood (`air.ts`, `flora.ts`) | Autumn colors are new tints |
| Grass from the add-on, with `where` and `color` | `@null3d/grass`: `createGrass` with a mask function, and `swayDistanceFor`. Creek draws 34,000 bank tufts and 18,000 land tufts at High | Keep |
| Plants sway only within 8 to 32 m | That is the grass alone. Trees and plants sway through `examples/lib/sway.ts` out to 120 m at every preset | The wind-reach question is about grass only |
| Memory: the add-on's set takes 29.75 MiB of a 30 MB ceiling | Gone: that ceiling budgets the add-on's generated plants. Today's three Creek model files total about 5.45 MB. D-12's memory budgets and the sample-file limits apply | Measure the model files and the page's memory |
| Placement checksum 3358570449 | No test binds Creek. The add-on's scatter page runs by hand only | Dropped |
| Baseline: iPad Low 30.98 ms, iPad Medium 78.82 ms, S25 33.3 ms | Measured on 1 November, on an older Creek. No frame time exists for today's Creek on any device. The only figure is the first frame, in 2.9 to 4.5 s on the Mac | Today's Creek is timed once before the build, and the garden is held to D-241's ceilings (owner's answer) |
| "Creek Medium takes 166 ms on the S25, now fixed" | The WebGL2 row was the reflection stall that D-286 fixed, and it reads 33.3 ms now. The WebGPU Medium row of 166.6 ms in D-241 is the old scene's own cost, and it is still the Medium ceiling for S24-class phones | Corrected |
| The terrain gains a `wet` option and a new `wet.test.ts` | The weather add-on (`examples/addons/weather`) holds the wet block (`wet.wgsl`), its values (`createWetSurface`) and `wet.test.ts`, which holds the Skyway ground's and the night town street's copies to it. The terrain's material has no free texture slot | The garden's ground copies the block. The terrain does not change |
| The statue is a distance field, meshed by new code | No such helper exists in code. `creek.py` meshes metaballs for the cave | The statue comes from Tripo3D, with metaballs in Blender as the fallback |
| Occluders from coarse copies of the statue and terrace | No call takes a stand-in mesh. A mesh has an occluder switch, which is off on WebGL2 at every preset. WebGPU needs none. The model build writes a blocker box into a file (`blockers` in `build.ts`) | The statue takes the build's blocker |
| Fog and a fog floor hide the world's edge | The engine's fog does not cover the background. The sky's volumetric clouds (D-297) draw as part of the sky, on High and Ultra only, and WebGL2 and compatibility mode stop at Medium | The scene draws its own sea of cloud (section 2) |

**Still not in the code:** a waterfall, a cloud sea, rain rings on water, and any garden model: maple, sculpted pine, azalea, statue, gate or lantern. Tripo3D's command-line tool is installed and signed in on the Mac.

**Findings that carry over:**

- **The owner's main tree complaint** (D-288, the island): trees change character at the mesh-to-card hand-over.
- **Below the horizon, the physical sky draws its own lit ground,** which the clouds must hide.
- **Skyway hides the world's edge** with fog and a far ground plane. The cloud sea does the same job.

## Order of work

All of the work lands in one pull request against main, from one branch (owner's answer; D-379). A fresh agent tries to disprove it before it merges.

1. **Record the brief.** A decision record holds this brief, the rulings above, Tripo3D's terms for paid accounts and the owner's answers below. It cites D-363 and D-378, widens the model rule and retires the ring rule of D-170. The next free number today is D-382; check it again when you claim it.
2. **Measure today's Creek once** on the Mac and the iPad Pro 13 at each preset, as the "before" figure. Do no cost work on it.
3. **Three early tests, each shown to the owner** before anything depends on them. They are review points on the work's branch: build each, show it, and wait for the owner before building on it:
   - the statue, from Tripo3D and finished in Blender;
   - the sculpted pine;
   - bare land, cliff walls, the cloud sea and one waterfall, with no planting.
4. **Build** the design below in this order: land and walls, clouds, water and waterfalls, rocks, models, planting, structures, camera and moods, storm.
5. **Run the full audit** on the garden, redraw its pictures and run the devices.

## Models: Tripo3D and Blender

**Route.** The official Tripo3D command-line tool, `tripo-cli` (0.11.2 on 2026-11-20), signed in from the key in the Mac's keychain (service `tripo3d-api-key`). `tripo make` waits for each job, downloads the model and writes the run's record (`task.json`), and `--dry-run` checks a request and its cost for free. The same tool runs as the `tripo` MCP server. On 2026-11-20 the account held 970 credits. The global skill `tripo3d-blender` holds the setup, the commands, the costs and the Blender finishing steps. Blender 5.3 is installed. Blender's official connection (the Blender Lab add-on, on port 9876) lets an agent look at and adjust a model in the open Blender while it works. It starts only when Blender's "Allow Online Access" preference is on. The committed Blender script stays the one source of each finished model.

**What Tripo3D makes** (owner's answer):

| Model | Tripo3D input | What Blender adds |
| --- | --- | --- |
| Statue | Front, left, back and right views (multiview) | Scale, a patina greener in the folds and streaked by rain, levels, the blocker |
| Roofed gate, stone lanterns | One clean view each | Scale, moss and lichen to match the code-made rocks, levels, a glowing lamp part for each lantern |
| Boulders, a set of 6 to 8 | One view each | Scale, moss on upward faces, levels |
| Trunks and limbs of the sculpted pine and the maples | One view each, without foliage | The bend weight and branch phase that the sway material reads, then the leaf pads and cards from the script |

Foliage, ferns, hostas, azaleas and cushion plants stay as the Blender script's cards, because a generated mesh draws its leaves as a solid shell that cannot sway or show sky through it. Small stones, pebbles, the steps, the land, the water, the grass and the clouds stay in code.

**Steps for each model:**

1. **Reference:** one clean picture on a plain background, cut from the concept or made with the image tool that made the concept. The statue gets four views.
2. **Generate:** `tripo make` with the H3.1 model (`--model tripo-v3.1`), a fixed model seed and texture seed, a face limit, PBR maps (color, roughness, metal, normal) and the removal of baked-in light (`delight=true`). Without `--model`, the tool uses P2, which costs about three times more. Each model's command is kept in the repository beside the Blender script, so anyone can see how it was made. A dry run checks every command before any credits are spent.
3. **Keep the raw result.** The service's links expire in about 5 minutes, and a later model version gives a different mesh from the same seed, so a request cannot be repeated exactly. The raw model and its `task.json` (inputs, model version, seeds, task id, credits) go into the sample-assets repository as sources. The Blender build reads them from the pinned sample content and never calls the network, so a rebuild gives the same files.
4. **Finish in Blender:** the script imports each raw model, sets its size in meters, its front and its foot on the ground, and cleans the mesh. It makes two lower levels, by decimating or with Tripo3D's low-poly remesh, which moves the textures onto the coarse mesh. It resizes the maps and packs occlusion, roughness and metal as `common.py`'s `orm` does, repaints where the look needs it, and exports through the existing `export()`.
5. **Ship:** `build.ts` optimizes the files, as for today's models. They go to the sample-assets repository, and the scene re-pins with `bun run samples:fetch --pin`.

**Starting budgets, to tune against the frame figures:** statue up to 30,000 triangles at its finest level, gate up to 6,000, lantern up to 1,500, boulder up to 1,500. Each has two lower levels. Texture maps up to 1024 texels square for the statue and 512 for the others.

**Credits:** a dry run of an image with detailed PBR textures on H3.1 estimates 40 credits; the same picture on P2 estimates 110. About a dozen models (the statue, the gate, a lantern, 6 to 8 boulders and two trunks) cost about 500 credits on H3.1, so the 970 credits cover one pass and some retries.

**Rights:** Tripo3D's terms, read on 2026-11-20, give a paid account the rights to its outputs, publishing and selling included (section 5.2.2). The outputs are not exclusive, and they may not be used to build a competing 3D-generation service (section 3.2). A free account would not hold these rights (section 5.2.1). The account bought its credits, so the models may go into the public sample-assets repository. They go in under CC BY-NC 4.0 (owner, 2026-11-20): CC0 and CC BY would allow the competing use that Tripo3D's terms bar. Every model finished from a Tripo3D model carries the same licence, while models made only by script or in code stay CC0. The sample-assets branch `creek-garden` adds CC BY-NC to that repository's accepted licences, and each raw model is committed there the moment it is downloaded.

## Design

### 1. Land and cliff (`creek/land.ts`)

- **Shape:** the height function becomes a raised disc with a noisy rim, 44 to 60 m across (about 26 m in radius). A terrace rises 4.5 to 5 m above the water for the statue, about 29 steps, with a channel across the middle. These sizes follow the concept picture's proportions with the statue at 8 m (the lead's scale ruling of 2026-11-20, from the fidelity reviewer's measurements); the cloud tops lie 10 to 13 m below the rim and the creek is 5 to 6.4 m wide. The water stays at height zero, so the placement rules that read height above water keep their meaning, and the camera and route tests that read the water level hold.
- **The ground stays Creek's own mesh** (`terrain()` in `examples/lib/procedural.ts`), with its painted colors and detail maps, not the terrain add-on. There are three reasons:
  - The land shrinks from a 160 m square to a disc, so the same quads give finer detail.
  - The terrain's layers repeat at a fixed spacing, so they cannot curve raked lines around stones.
  - The terrain's material has no free slot for the wet block (section 9).
- **The ground's material** paints moss, raked gravel, rock and the wet bed. The raked lines come from a generated map that follows the stones.
- **Walls:** a height field cannot overhang, and its near-vertical faces stretch. Make the walls a separate mesh in code, in dark volcanic rock with vertical columns and ledges, as the concept shows. They run down into the cloud sea. The terrain add-on's side-mapping on steep faces (`steepFaces`) fixes stretched texture, not stretched geometry, so it does not help here.
- **Check:** close pictures of the bed, of the wall's join to the rim, and of the ground in the stream's reflection.

### 2. Clouds and the world's edge (new `creek/clouds.ts`)

- **Removed:** Creek's mountain ring (`createMountains`, `MOUNTAINS`, `mountainSettings`), the gorges (`GORGE`) and their haze. No other scene uses the shared ring (`examples/lib/mountains.ts`) or the haze (`examples/lib/haze.ts`), so both go too, with the ring rule itself (owner's answer).
- **A sea of cloud below the rim, out to the horizon:** a few stacked layers whose shader draws billowing cloud tops from noise. They are bright where the sun lights them and grey in their hollows, and they drift slowly with the wind. The lowest layer is opaque, so no view sees the ground or the sky's ground below the horizon.
- **Cloud around the cliff:** soft banks that wrap the walls and rise past the rim in places, drawn as large particles from `@null3d/particles` or as sheets, as Creek's mist is today.
- **The sky's own clouds above:** the flat layer on Low and Medium, and the volumetric clouds (D-297) on High and Ultra.
- **Light and color:** every cloud layer takes the air's color and the light from the stage each frame, as the haze does today, so the clouds match every mood.
- **Check:** whether the sky's volumetric layer can sit below the camera. If it can, it may deepen the cloud sea on High and Ultra. It cannot be the sea on every device, since it draws only on High and Ultra.
- **The fog switch:** today Creek starts with fog off, and the switch also hides the mist. The cloud sea and the banks stay at all times, because without them the world's edge shows. The switch turns only the engine's distance fog and the mist on and off. The fog starts on.
- **Manual camera:** it stays above the cloud tops, and its bounds change to suit. The ring rule retires (owner's answer): no showcase scene uses a ring once Creek's goes, since the island's sea and Skyway's fog already hide their edges. D-170 and `.dev/examples.md` record the retirement, and the camera-bounds rule, which today keeps the Manual camera "inside the ring, below its lowest crest", becomes: each scene's bounds keep every view off the world's edge, by the sea, the fog or the clouds. `examples/lib/showcase-routes.test.ts` stops reading Creek's ring as ground.

### 3. Water and waterfalls (`packages/water`, `creek/sketch.ts`)

**Today's water carries over, with how it works with the camera** (the owner's ruling). Keep:

- the river sheets, whose shape gives the bed and the current at each point (`createCreekWater`);
- the opaque surface, whose depth comes from the stream's own bed;
- the foam from the stones (`foamMap`), and the caustics on the bed in each mood;
- the reflection, with its layer mask, Creek's unreflected layer and its cadence (`render.setPassEvery`);
- the view under the water (`createUnderwater`), which turns on as the camera dips below the surface;
- the camera's bounds, which let it dip under the water but never through the bed (a clearance of 0.15 m over the ground);
- the route's dip along the bed, and its test: 5 to 7 seconds under the water, clear of the bed and the stones;
- the close view of the surface that the picture tests draw (`?water-close`).

What changes:

- **The sheets end at the rim's lip** at both ends, instead of running on down the gorges.
- **The stream's line, width and depth functions** take the new channel across the disc.
- **A spring-fed pool near the middle** feeds the creek, and the current runs out from it both ways to the two waterfalls (owner's answer). The shape takes a current function, so this needs no new water code. Check close up that the flow shows no seam where it turns.
- **Livelier water,** as in the white-granite concept (owner's answer): steps in the bed, larger boulders and more foam.

**Waterfalls, new in the water add-on so other scenes can use them.** An animated fall is possible with what the engine has today. There is one at each end, where the creek leaves the rim:

- **The sheet:** it starts at the lip with the river's own width and speed, curves out along the path that falling water takes, then drops almost straight into the clouds.
- **The material** animates on the GPU from the time alone, so it costs the CPU nothing each frame. Two or three layers of white streaks slide down, faster as the water falls. The water is clear and glassy at the lip, and it turns white and broken lower down, with ragged edges. It takes the scene's light and mood.
- **Spray and mist** from `@null3d/particles`: spray at the lip, mist down the fall, and a plume where the fall meets the clouds.
- **Foam** on the river just before the lip, through `foamMap`.
- **Reflection:** the falls lie past the disc's edge, so the reflection leaves them out.
- **Early test 3** judges a fall before the rest is built.

### 4. Rocks

- **Boulders** come from Tripo3D, a set of 6 to 8 that the placement repeats with turns and sizes.
- **Stones and pebbles** stay in code, from the shared rock maker (`rock()` in `examples/lib/procedural.ts`) that `creek/stones.ts` uses today. Add hard faces: cuts by random planes, ridged noise, a squash and a flat underside.
- **Material:** today's moss on upward faces and its lichen tint stay, and the boulders' repaint matches them. Add a wetness value that darkens and glosses, for the storm.
- **Placement:** hand-placed composition boulders go first, then rocks by rule, then plants. Plants avoid rocks, as the stones' footprint test (`stones.clear`) does today. Stones gather around boulders through the placement's clumps.
- **Foam:** `creek/stones.ts` still feeds the foam from the rocks' points.

### 5. Plants

- **`creek.py` grows the garden's plants** in place of the oak, beech, birch, wildflowers and cave: maple, sculpted pine, azalea and clipped shrubs, with today's ferns and hostas, and low cushion plants so the moss reads close up. Each keeps its levels (`MSFT_lod`) and its sway in the second texture coordinates, as today's plants do.
- **Trunks and limbs** of the sculpted pine and the maples come from Tripo3D. The script gives them the sway weights and adds the foliage.
- **Maple color:** the shared sway material multiplies a color for each copy over the leaf texture. Paint the maple's leaves in a pale tone, and tint the copies red, orange and yellow. If the range is too narrow, make two leaf textures.
- **Sculpted pine:** the island's stone pine (`island.py`) builds its crown from flat pads at its limbs' ends, with leaf cards on the pads. A garden pine's cloud layers are pads in tiers. Move the pad crown into `common.py` so both scripts share it. This is early test 2.
- **Wildflowers:** dropped, since the look does not call for them.
- **Size:** today's three files total about 5.45 MB. Report the new files' sizes and the page's memory against D-12.

### 6. Planting (`creek/valley.ts`, `creek/plants.ts`)

- **Garden rules:** Creek's own placement in `valley.ts`, which scores each place from tolerances, grows clumps and keeps room from what stood before. Use tighter spacing than the picture shows. The trees of the composition stand by hand, as today's trees do.
- **Masks:** a rule scores zero on the steps and paths, the terrace, the gravel, the view to the statue and past the rim.
- **Keep:** `clearOfRoute` and its route test, the shared sway material and `@null3d/grass`.
- **Remove:** the fallen logs, which do not suit a tended garden.
- **No hand-over:** on a disc this small, every tree can stay a mesh with dithered levels. That avoids the owner's main tree complaint. Check the cost from the wide orbit. Add far cards through `@null3d/impostors` only if the figures require them, as the island does.

| Starting targets at Medium, to tune | Today (160 m square) | Garden (about 2,100 m², as the concept shows) |
| --- | --- | --- |
| Trees and saplings | 21, placed by hand | 20 to 25, placed by hand, as in the concept |
| Shrubs, ferns, hostas, azaleas | placed by rule | as dense as the concept: almost no bare soil |
| Boulders and stones | Creek's rocks, and 3,000 pebbles | the concept's boulders by hand, stones by rule, and pebbles |
| Grass tufts at High | 52,000 | the banks and patches only, density to match the concept |

**Grass:** the chosen ground is moss and gravel, so grass only needs the banks and some patches. The disc is small, so today's tufts more than cover it with no new triangles, and the garden does not need GPU-built grass; the old zone design goes. Moss close up needs the low cushion plants, or it reads flat. Measure the grass's cost at High.

**Wind reach:** the grass sways within 8 to 32 m by preset, so far grass stands still in the wide view. Trees and plants sway out to 120 m, and leaves fall through the whole view, which may be enough. Show the owner this view. A longer grass reach needs a ruling.

### 7. Statue and garden structures (new `creek/structures.ts`)

- **Statue:** from Tripo3D's multiview mode, finished in Blender with the patina and levels. It is the largest look risk, and early test 1.
- **Fallback:** if the generated statue fails the look test, build it in the Blender script from metaballs, as `creek.py` builds the cave.
- **Gate and lanterns:** from Tripo3D, finished in Blender. Lanterns glow at dusk and night from the stage's lamp share (`lampShare`), as Skyway lights its windows.
- **Steps:** made in code with `@null3d/geometry` (`extrude`, `shape`), because they must fit the ground exactly. They wind up from the creek, then run straight to the statue.
- **Rule:** no overlapping geometry. `findOverlaps` (`examples/lib/overlap.ts`) tests every pair of triangles, so run it on the parts that touch: the steps, the terrace, and the feet of the gate and lanterns. It is too slow for the statue.
- **Occluders:** the statue's model takes the build's blocker box, as the cave does. Measure WebGL2 with the occluder switch on and off.

### 8. Camera and moods (`creek/route.ts`, `creek/sketch.ts`)

- **Route:** a brief wide orbit over the clouds, past a waterfall, along the creek with today's dip under the water, through the gate and up the steps to the statue. It must pass the shared route test (`examples/lib/showcase-routes.test.ts`: smooth speed, smooth turns, and every pose inside the bounds and the shadow range). Creek's clearance test (`creek/route.test.ts`) gains the statue, the gate, the lanterns and the walls, and keeps its dip test.
- **Moods:** no overcast mood exists. The garden opens on Morning with heavier cloud and fog, set through the scene's own stage options. The other moods stay.
- **Air:** the falling and floating leaves take red and orange tints. The fireflies stay.
- **Bounce light:** Creek turns it off, with contact shadows, unless the address has `?effects=on`. Compare it on and off at High before deciding.

### 9. Storm

- **Controls:** a storm button through the shared stage's `setWeather`, as Skyway does, with `wind.setBase` and `wind.gust` raising the air together.
- **Rain:** Skyway draws its falling rain in its own `rain.ts`. Move it to the weather add-on so both scenes share it. The splashes come from the weather add-on's particles.
- **Wet ground:** the garden's ground material copies the wet block from `wet.wgsl`, as Skyway's ground does, and `createWetSurface` gives its values. `wet.test.ts` gains the ground as a fourth copy. The block already gives puddles, rain rings and a mirror. Leave the mirror off to save cost, with the add-on's black texture in its slot.
- **Dry cost:** a dry ground should pay nothing. Check whether a mesh can change its material while the scene runs. If it can, the ground takes the wet material only while it rains. If it cannot, measure the ground with the block in it and no rain, against today's ground.
- **Rocks** use their wetness value.
- **Water gains rain rings,** off by default, from the ring code in the wet block.
- **The waterfalls** run heavier in the storm: more spray and mist.

### 10. Remove and document

- **Remove from Creek:** the mountain ring, the gorges and their haze, the logs, the cave, and the oak, beech, birch and wildflower models.
- **Remove from the shared code:** `examples/lib/mountains.ts`, its test (`examples/lib/mountains.test.ts`) and `examples/lib/haze.ts`, after the clouds take what they need.
- **Update:**
  - `examples/demos.ts`: Creek's title and summary.
  - `.dev/examples.md`: the Creek section; the ring bullet, which goes; the camera-bounds bullet, reworded as in section 2; the island's and Skyway's ring exemptions, which lose their reason to exist; and the model rule, which gains Tripo3D.
  - `.dev/sample-content.md`: Creek's model files, and the Tripo3D raw results with their `task.json` records.
  - D-170 (the ring rule retires), D-378's model rule, and D-241's summary, which still says that Creek drops its Blender plants for the add-on.
  - `docs/api/water.md`: the waterfall and the rain rings.
  - `examples/addons/weather/README.md`: the rain.
  - `tests/lib/plans.ts`: Creek joins the live showcase device plan.
  - The `null3d-develop` skill, in `skills/`, only where the water API changes.

## Considered and not adopted

- **A separate new scene beside Creek.** The owner rebuilds Creek in place (D-363).
- **Rocks and species in the vegetation add-on.** D-378 bars every demo from it.
- **The old `tripo-mcp` server** (`Tripo-Developer/tripo-mcp`). It was installed and removed on 2026-11-19: it crashes on start unless an older MCP library is pinned, and it talks to an old Tripo Blender add-on, not the current Tripo Bridge. The official `tripo-cli` replaces it, as a command and as an MCP server.
- **A homemade tool that calls Tripo3D's web service.** `tripo make` already uploads, waits, retries, checks parameters, downloads before the links expire and records each run.
- **Tripo3D through fal.ai.** The owner chose the direct connection.
- **Three pull requests** (the water add-on, the models, then the scene). The owner chose one.
- **Keeping the cave.** The concept picture shows none.
- **Exempting Creek from the ring rule and keeping the rule.** No scene would then follow it.
- **Generated foliage.** A generated crown is a solid shell that cannot sway or show sky through it.
- **The engine's volumetric clouds as the cloud sea.** They draw only on High and Ultra.
- **The terrain add-on for the top.** See section 1.
- **A wet option in the terrain add-on.** Its material has no free texture slot, and the weather add-on's block is made for a scene's own material.
- **Keeping far cards for trees:** see "No hand-over".
- **Waiting for GPU-built grass:** the look removes the need.

## Branch and pull request

This plan stays on `plan/creek-cliff-garden` (pull request #561). The work itself branches from `origin/main` and lands as one pull request (owner's answer; D-379). It holds the water add-on's waterfalls and rain rings, the garden's models with their `tripo make` commands, `creek.py` and `common.py`, the garden scene, the decision record, the shared rock and rain moves, the ring's removal and the docs. The sample-assets change, with the raw results and their `task.json` records, goes first, so the scene can pin it. Before the pull request opens, and before each push to it, run the touched unit tests, `bun run check` and `bun run limits`.

## Risks

- **Frame time.** Today's Creek has no figure. With the add-on's plants, it ran 7.8 to 11 times over its ceilings on the iPad Pro (D-363). Its Blender models are far cheaper, but the garden has far more plants, two waterfalls and layers of cloud. If density and a ceiling conflict, report the figures for an owner ruling.
- **Statue look,** the largest single risk, tested first. A generated statue can carry soft detail or odd hands. The metaball fallback stands behind it.
- **Generated models:** one request cannot be repeated exactly, which is why the raw results are kept. Their style may differ from the code-made rocks and the scripted plants; the Blender repaint keeps them in one palette.
- **Tripo3D's terms** allow publishing for a paid account, and this account is paid (read on 2026-11-20). If the account ever runs on a free plan, its outputs belong to Tripo, so generate only with bought credits.
- **Credits:** a run on the default P2 model costs about three times an H3.1 run. Name the model in every command, and dry-run first.
- **Cloud cost:** stacked translucent layers draw many times over the same pixels near the rim. Limit the layers by preset.
- **Cloud edge:** a hard line where the cloud sea meets the sky at low sun. Check it at every mood.
- **Load time and memory:** more and larger model files. Hard rule 43 wants the first frame within 10 s.
- **Shared rain:** moving Skyway's rain must leave Skyway's pictures unchanged.

## Verification

- **`bun run test`:**
  - rock tests: the same seed gives the same mesh, faces are hard, and the mesh has no holes;
  - placement tests: composition boulders go first, plants avoid rocks, and stones gather around boulders;
  - route clearance with the statue, the gate, the lanterns and the walls, and the dip test;
  - overlap checks on the parts that touch;
  - the wet block's copy test, with the ground as its fourth copy;
  - the no-ring list and the shared route test.
- **Models:** each generated model has its raw file and its `task.json` in sample-assets. Two builds from them give the same files. Each model meets its triangle and texture budget at each level.
- **Pictures:** Creek's picture references are redrawn on the Mac, and on SwiftShader and Firefox from CI's drawing. Skyway's pictures stay the same after the rain moves.
- **D-288's audit methods on the final scene:** held frames, live manual camera, route sampling, frame-by-frame recording and whole-route speed repeated. Run them on `?gpu=webgpu` with direct draws on and off, `compat` and `webgl2`, at Low to Ultra.
- **Look for:** the cloud edge at every mood, the waterfalls from the route and the orbit, the camera's dip under the water, popping, the first and last frames, and memory on each path.
- **Ground and water:** a page without rain draws the same picture at the same cost, and wet ground draws on all GPU paths.
- **Device runs:** run the cloud iPhone 17, iPad Pro 13, Galaxy S25 and Tab A9 Plus against D-241's showcase ceilings and D-283's wind budgets. Results go in `.dev/tested-devices/`.
- **`bun run limits`, `bun run build:check-size`, `bun run bench:gpu-check`,** with written reasons for any growth.
- **Owner look review** against job 2b3da0a9-dbff-44af-b766-4f0113f73ad2.

## Owner's answers, 2026-11-20

1. **Models from Tripo3D:** the statue, the roofed gate, the stone lanterns, a set of 6 to 8 boulders, and the trunks and limbs of the sculpted pine and the maples. The foliage and ground plants stay as the Blender script's cards, and the small stones, steps, land, water, grass and clouds stay in code.
2. **Water source:** a spring-fed pool near the middle, flowing both ways.
3. **Livelier creek** from concept 4: yes.
4. **Cave:** left out of the garden.
5. **Mountain ring:** Creek drops it, the ring rule retires, and the shared ring and haze helpers are removed.
6. **Frame ceilings:** the garden is held to D-241's ceilings, and today's Creek is timed once on the Mac and the iPad Pro 13 as the "before" figure.
7. **Pull requests:** all of the work in one pull request. The early tests are review points on its branch.

No questions are open.
