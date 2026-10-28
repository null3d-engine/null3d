# D-173: Add-on hooks, one place per feature, and a path to an add-on marketplace

Status: decided by the owner. Built: the import and layout checks, and the packages of ten foundations: controls, geometry, impostors, particles, splats, terrain, `three-compat`, vegetation, water and wind. Pending: the physics and MSDF text packages, and the open hooks and tasks: H1 (M3-E8), H2 (M3-E9), H4, material lobes (M3-E7), H5, add-on tasks (M3-E2), H7, scene inputs (M3-E4 and M3-E4a), H8, sky layers (M3-E10), the preset and stats links (M3-E6), the texture-unit allocator (M3-D7), the listing check (M3-D9), the splats add-on (M3-F2), water (M3-F5), the FFT ocean (M3-F9) and the volumetric tier (M3-F11). Each hook and platform task is built in its own M3 task, with its first user. Task: M3-plan.

Summary: Each feature lives in one place, the core or one add-on, never both. An add-on extends a core feature only through that feature's own settings. Flat and volumetric clouds are tiers of the core sky, and a water add-on owns all water. Every add-on and example reaches the engine only through its public entry points, which `bun run check` enforces. The engine's team builds twelve foundation add-ons as npm packages, and M3's six content add-ons are example add-ons. Hooks H1 to H9, the plugin interface version and a listing check all come in M3, each hook with its first user.

## Question

A research session proposed new techniques. Several were add-ons: volumetric clouds, water and an ocean, grass made on the GPU, hair, special materials, and a bake. The owner asked three questions:

1. Does the engine already do clouds or water? Users must never have to choose between a built-in feature and an add-on that does the same thing.
2. The owner may later open a marketplace, where other developers build and sell powerful add-ons. How do the planned add-ons affect that?
3. Should the engine have more hook and plugin points for that marketplace?

## Rule

- The best technique is the default, and one clear way does each task ([D-52](D-52-intent-parity.md), design principle 10).
- Core or add-on ([D-54](D-54-addon-modules.md)): a feature that a glTF file or a standard scene needs stays in the core and loads on first use. An optional feature with heavy machinery of its own is an add-on. A page pays nothing for a feature it does not use.
- Both GPU paths are first-class (design principle 9). A hook works on WebGPU and WebGL2, or it states its fallback.
- The public API freezes at 1.0, in M4. Each public hook is a promise that limits how the engine's internals can change after that.

## Data

The facts below hold at `origin/main` 114a1246d, the commit that the proposal was checked against.

### Clouds and water

- **Clouds.** The core draws a flat cloud layer in the sky: four octaves of drifting noise on a plane, with three.js's formulas (`crates/null3d-shaders/wgsl/lib/atmosphere.wgsl`). The analytic sky ([D-118](D-118-sky-environment.md)) and the physical sky ([D-143](D-143-physical-sky.md)) both draw it, and the sky's environment map holds it. The engine has no volumetric clouds.
- **Water.** The engine has no water object. Water is a recipe on core features:
  - a reflection pass ([D-120](D-120-planar-reflections.md));
  - transmission ([D-122](D-122-transmission.md));
  - a custom material's surface function, with vertex offsets for waves.

  The guide [Custom passes](../../docs/guides/custom-passes.md) has a water recipe. The Creek showcase builds its water this way (`examples/showcase/creek/water.ts`): waves, ripples, caustics and foam. The three.js mapping sends `Water` and `Water2` to the reflection-pass recipe.

So a clouds add-on would put clouds in two places, each with its own settings: flat clouds in the core, volumetric clouds in the add-on. A water add-on next to the recipe would give two ways to make water.

### How the two add-ons reach the engine

| Add-on | What the engine holds for it | Could another developer build it? |
| --- | --- | --- |
| `@null3d/terrain` ([D-152](D-152-terrain.md)) | Nothing. It uses only `ctx.materials.shader`, `ctx.textures.fromData` and public types | Yes. But D-152 rejected its preferred design, one instanced grid with heights read in the vertex shader, mainly because the public API gave a custom vertex stage no per-instance data. The design that shipped bakes the heights on the CPU |
| `@null3d/particles` ([D-131](D-131-particles.md)) | Most of it. The engine holds the particle buffer (`scene.createParticleBuffer`), the shaders (`particle.wgsl`, `particle_depth.wgsl`) and the renderer's particle path (`crates/null3d-render/src/particles.rs`), loaded on first use. The add-on holds the emitters, sub-emitters and the API | No. The public API has no way to add a shader template or a new kind of draw |

The engine package exports an `./internal` entry point. Neither add-on imports it, but at that commit no check stops an add-on from doing so; section 2's check does. The on-demand loader that compiles an add-on's WebAssembly and runs its tasks on the job workers ([D-54](D-54-addon-modules.md#built)) is not in the public entry point.

### Public extension points

- **Custom materials:**
  - surface functions with vertex offsets, and full shaders;
  - typed uniforms and up to 6 textures ([D-47](D-47-custom-material-textures.md));
  - custom shader inputs ([D-138](D-138-custom-shader-inputs.md)) and per-row values in instance batches ([D-127](D-127-row-values.md)).
- **Custom effects and custom tone curves** in the effect chain ([D-71](D-71-custom-effects.md)).
- **Render passes:** `scene`, `reflection` and `fullscreen`, with textures that materials and effects read.
- **Textures** made from data, image bitmaps and passes.
- **The WGSL library:** `null3d::` imports.

M3's first tasks add four hooks, each for an add-on of the same milestone:

- canvas uploads of changed rectangles (M3-A2, for screens);
- texture-array layers in custom WGSL (M3-A3, for facades);
- bloom levels for custom effects (M3-A4, for the lens kit);
- draws from a vertex count alone (M3-A5, for weather).

### What a marketplace needs beyond hooks

- **Versions.** D-54 keeps each add-on's version in step with the engine's. That works for the engine's own add-ons, which release with it. An outside seller cannot release with every engine version.
- **Shared budgets.** On WebGL2 the lit shader's fragment stage reads at most 16 textures, and the core uses most of them ([Technique review](../technique-review.md#webgl2-texture-units)). Add-ons that add per-pixel inputs compete for the rest. GPU time is shared the same way, and an add-on in the light loop slows every pixel.
- **Namespaces.** Shader library names (`null3d::`), error codes (`E1xxx`) and quality keys share one flat space unless each add-on has its own (section 4). Two add-ons from two sellers could clash.
- **Trust.** An add-on's code runs in the engine's threads, with shared memory. Bad WGSL can lose the GPU device.
- **Code is readable.** JavaScript and WGSL cannot be hidden, so a paid add-on rests on license terms, not on locked code.
- **Already in place:**
  - one install and one import;
  - CDN delivery under a strict policy (D-54);
  - first-use shader files (D-56);
  - one notices file per build that each add-on extends.

## Design

The six parts below hold as [the rulings](#the-rulings) set them.

### 1. One place per feature

A feature lives in the core or in one add-on, never in both. An add-on extends or replaces a core feature only through that feature's own settings, never through a second API (ruling 7). When the core has a basic version and the better one is heavy, one of two things happens:

- the better one joins the core as a quality tier that loads on first use; or
- the basic one moves out into the add-on.

Applied to the research's list:

- **Clouds:** both kinds are tiers of the core sky (rulings 1 and 2). The same cloud settings draw the flat layer on Low and Medium, and volumetric clouds from High up. The volumetric tier needs only shaders and noise made in the browser, which load on first use, so a scene without clouds pays nothing. No cloud add-on is planned.
- **Water:** `@null3d/water` owns all water. It holds the river and lake water lifted from the Creek showcase, and the FFT ocean. Reflection passes and transmission stay in the core as general features. The docs recipe becomes a page on how the add-on is built.
- **Particles:** users see one way, and the add-on uses a public engine method, so the rule holds with no exception (ruling 3).

### 2. Public API only

Add-ons reach the engine only through `@null3d/engine`'s public entry points. The engine's own add-ons count as add-ons here. `tools/check-addon-imports.ts`, run by `bun run check`, fails when a package other than the engine imports `@null3d/engine/internal` or the engine's source paths. When one of the engine's add-ons needs something the API lacks, the hook becomes public, so another developer could build the same add-on.

### 3. Hooks grow with their users

- A hook is built with its first user, never before. M3-A2 to M3-A5 follow this.
- A new hook is marked experimental in its docs and types. It becomes stable once a second add-on uses it, the engine's or another developer's.
- Stable hooks freeze with the API at 1.0. Experimental hooks stay marked, and may change in a 1.x release with a note.
- Each hook works on both GPU paths, or its docs state the fallback, as [the hooks table](#hooks-each-with-its-first-user) does.
- Each hook comes with the first user that the hooks table names.
- M3-R1 defines one public feature description that every hook is an instance of, before H3. Built-in renderer features stay internal and do not use these hooks; a feature that leaves the core uses them.

### 4. Shared budgets and names for add-ons

- **Quality presets:** an add-on declares its settings per preset, and the governor's steps reach them.
- **Stats overlay:** it shows each add-on's GPU time and memory, so a user sees what an add-on costs.
- **WebGL2 textures:** the engine hands out the lit shader's free texture units. When none are left, it refuses an add-on's material with an error code, not a broken shader ([the allocator](#the-texture-unit-allocator)).
- **Names:** each add-on gets its own shader library name (`<add-on>::`), its own error-code range and its own quality keys ([D-224](D-224-addon-namespaces.md)).

### 5. A plugin interface version

The engine's own add-ons keep D-54's rule, with their versions in step with the engine's. An outside add-on instead declares the range of the plugin interface it was built for. The engine refuses it, with an error code that names both versions, when the range does not match. The interface version changes only when a stable hook changes. M3-D6 builds it ([D-223](D-223-plugin-interface-version.md)), and it freezes with the API at 1.0, in M4.

### 6. The marketplace

The marketplace's store is a business, not engine code (ruling 10). The engine's part is the plugin interface version and a listing check (M3-D9, [D-225](D-225-addon-listing-check.md)). The listing check runs the engine's own gates on the add-on:

- the public-API check;
- WGSL validation on both GPU paths;
- the CDN and strict-policy test (D-54);
- `bench:allocation`;
- the size budgets for first-use files ([D-14](D-14-js-budget.md));
- a published cost per preset.

The license terms, not locked code, protect a paid add-on.

## The check of the proposal

A check of the proposal against `origin/main` found these facts. The rulings rest on them.

| # | Finding | Effect |
| --- | --- | --- |
| F1 | Flat clouds run through the core's lighting. The CPU sky light copies the cloud noise for the diffuse light (`crates/null3d-render/src/sky_light.rs`), and both skies draw the clouds with the same settings | Moving them out needs a hook into the background, the environment map and the CPU light. It saves no download, since the sky's shaders load on first use |
| F2 | A rule 11 that forbids any extension of a core feature forbids what the engine does. `three-compat` adds tone curves through the core's tone-curve setting ([D-52](D-52-intent-parity.md)), and lit fog is a tier of core fog ([D-133](D-133-volumetric-fog.md)) | Rule 11 reads: an add-on extends or replaces a core feature only through that feature's own settings |
| F3 | Particles are not an exception. `scene.createParticleBuffer` is a public method, and the add-on imports only `@null3d/engine` | No exception. The method needs a written docs page |
| F4 | Physics needs no hook. The physics guide runs Rapier or cannon-es in the sketch worker | H5's first user is the splats add-on, not physics |
| F5 | A custom material sees only its own pixel's depth, not the depth behind it. The Creek fakes shallow edges from its known stream bed | Water needs H7, the scene's depth behind a custom material. The frame already copies the opaque depth for soft particles ([D-131](D-131-particles.md)) |
| F6 | Car paint's flakes may need no new lobe. A hashed normal per cell works if the surface sets a base normal apart from the clear coat's | H4 waits for the clear coat check ([D-147](D-147-clearcoat-and-sheen.md)) |
| F7 | The glTF loader refuses a required extension outside its list with E1417. A `KHR_gaussian_splatting` file fails with no hint to import the splats add-on | Hook H9: an add-on registers a glTF extension handler, as three.js's `GLTFLoader.register` does. Without a handler, E1417 names the add-on for known extensions |
| F8 | Published add-ons with WGSL have gaps that no test covers. Terrain ships raw WGSL for the user's Vite plugin to compile, and the plugin skips WGSL under `node_modules`. A browser cannot import a `.wgsl` file from a CDN, which D-54 promises. The fresh-project test installs only controls and geometry | Each add-on compiles its WGSL when its package is packed. The fresh-project test installs terrain and particles, and the CDN test loads one add-on |
| F9 | Add-ons pin the engine exactly: `workspace:*` packs to the exact version | A partial upgrade then fails with a peer conflict. So `bunx @null3d/cli upgrade` moves every `@null3d` package together |
| F11 | M3's plan holds one-place duplicates. The lens kit repeats the core's sharpening (M3-A10), grading (M3-A8) and vignette. Weather's rain sits beside the particles add-on | The lens kit uses the core's features. Weather says which feature makes rain |
| F12 | No example imports private engine code | The import check covers all of `examples/`, and it passes on main |
| F13 | The plan's package table lacks particles, terrain, impostors, physics, splats, text and water | The plan's table gains them |

## Decision

### The rulings

1. **Flat clouds stay in the core.** They are three.js `Sky`'s clouds, so ports keep their look ([D-52](D-52-intent-parity.md)). Moving them saves no bytes (F1).
2. **Volumetric clouds are the core sky's High tier and above.** M3-F11 builds them behind the same cloud settings that draw the flat layer on Low and Medium. Through the H8 sky-layers hook (M3-E10), another developer adds their own clouds behind these settings. It is not a second way for the engine to draw them. No cloud add-on is planned.
3. **Particles are not an exception.** The add-on uses a public engine method (F3). The method gets a written docs page.
4. **The foundation add-ons** are physics, Gaussian splats, MSDF text, particles, terrain, water, controls, geometry, impostors, `three-compat`, vegetation and wind. The engine's team builds them. A later add-on is a foundation when other add-ons or many kinds of project build on it. So is one that implements a standard or wraps a large third-party library. [Vegetation and wind](#vegetation-and-wind) gives those two's reasons.
5. **M3's six content add-ons are example add-ons,** not npm packages: the lens kit, facades, screens, weather, car paint and traffic lanes. Each lives in `examples/addons/<name>/`, shaped like a package, under the engine's licenses. It uses only the public API and has image tests through the examples. The lens kit uses the core's sharpening, grading and vignette, and weather says which feature makes rain (F11). [D-172](D-172-neon-harbour-follow-ups.md) lists them.
6. **Publishing.** Each foundation add-on is its own npm package. It pins the exact engine version and checks the engine's version at run time. Its WGSL is compiled when the package is packed (F8). The engine package holds no bundle of add-ons in the style of `three/addons`.
7. **Rule 11 reads:** "an add-on extends or replaces a core feature only through that feature's own settings" (F2).
8. **Each hook is built with its first user, all before 1.0.** That covers H1 to H9, the preset and stats links, the texture-unit allocator and the namespaces. H1, H2 and H8 together cost about 5 helper-weeks. H4 waits for the clear coat check, still before 1.0. The table below gives each hook's first user and its task.
9. **The plugin interface version is built in M3 (M3-D6),** and it freezes with the API at 1.0, in M4. [D-223](D-223-plugin-interface-version.md) gives the version, the declared range and the refusal.
10. **The marketplace's store is a business, not engine code.** The engine's part is the plugin interface version (ruling 9) and a listing check (M3-D9).
11. **This record holds the rulings.** [Options rejected](#options-rejected) gives the reasons against clouds as an add-on, rule 11's first wording and the particles exception.

### Hooks, each with its first user

Every hook is public, works on both GPU paths or states its fallback, and stays experimental until a second add-on uses it. A hook loads on first use or sits in the add-on, so a page's start does not grow. H3 and H9 touch start code, the glTF worker and the draw lists, so their tasks budget about 1 to 2 KB and check it. All of the engine's feature work that was set for M4 comes in M3 ([D-199](D-199-m4-features-and-study-tasks-in-m3.md)).

| Hook | What it does | First user | WebGL2 | When |
| --- | --- | --- | --- | --- |
| H1 | A compute pass whose storage output materials, effects and passes read in the same frame | The water add-on's FFT ocean | A fragment-pass form, else WebGPU only, as its docs state | M3 (M3-E8), with the ocean |
| H2 | Draws whose count and instances the GPU writes, in the main and shadow passes | Splats' GPU culling, to confirm in its task; vegetation's near grass, which casts shadows and so needs the shadow views | The CPU fills instance batches | M3 (M3-E9) |
| H3 | A new kind of draw: an add-on registers a shader template, what it reads and where it sorts | Splats; then impostors or particles | Both, through the WGSL-to-GLSL step | M3, with splats |
| H4 | Material lobes: a custom material adds a specular lobe beside the base lobe | Car paint's glints, if the clear coat check shows they need one (F6) | Both | Before 1.0, after the clear coat check |
| H5 | Add-on tasks: the public form of D-54's loader, for WebAssembly and work on the job workers | The splats add-on's selection ([H5](#h5-an-add-ons-tasks-on-the-job-workers), F4) | Both | M3, with splats |
| H6 | One documented format for baked probes and light maps, which the core reads | The probe grid's own grids ([D-146](D-146-light-probe-grid.md)) and light maps | Both | M3, stable at once |
| H7 | Scene inputs: depth, normals and motion vectors for effects, passes and compute; the depth behind a custom material | Water's soft shores (F5); splats' depth mixing | Both, where the frame makes them | M3, with water and splats |
| H8 | Sky layers: an add-on draws into the background, the environment map and the CPU sky light, and dims the sun | An example add-on that draws a sky layer, so other developers can add their own clouds behind the core's cloud settings | Both | M3 (M3-E10) |
| H9 | glTF extension handlers, as `GLTFLoader.register` does | Splats (`KHR_gaussian_splatting`) | Both | M3 (M3-E3), with splats |
| Preset and stats links | An add-on declares settings per quality preset, the governor reaches them, and the stats overlay shows each add-on's GPU time and memory | Splats' budget; water's reflection cadence | Both | M3 |
| Texture-unit allocator | The engine hands out the lit shader's free WebGL2 texture units and refuses an add-on's material with an error code when none are left | Any add-on with per-pixel inputs | WebGL2 only | M3 (M3-D7) |
| Namespaces | A shader library name, an error-code range and quality keys per add-on | Every outside add-on | Both | M3 (M3-D8) |
| Plugin interface version | An outside add-on declares the interface range it was built for, and the engine refuses a mismatch with an error that names both | Outside add-ons | Both | M3 (M3-D6); it freezes with the API at 1.0 |

The two hooks' start code measures as follows, at commit `78626b299`, whose run log is not kept. H3 adds 4,199 bytes of TypeScript to the start module. Without comment lines it adds 2,182 bytes, which Brotli compresses alone to 536 bytes. With the comments it compresses to 1,157 bytes. The adapter's own code loads on first use, in `page-feature-draws.js` at 1,114 bytes after Brotli and `sketch-worker-feature-draws.js` at 1,117. H9 adds 3,309 bytes to the glTF extension handler. Without comment lines it adds 1,562 bytes, which Brotli compresses alone to 589 bytes. With the comments it compresses to 1,087 bytes. Compressing a part alone reads high, because it shares no dictionary with the rest of the bundle. Each figure therefore bounds the part's share of the start. Both hooks stay under the budget of about 1 to 2 KB, and `bun run build` names each module and its bytes.

### Order in M3

The add-ons wait until the architecture and the core engine work are done, by the owner's ruling. The order inside M3 is:

1. The core's work: level of detail, the Neon Harbour follow-ups, the glTF and API features, the script tag and the study's tasks. M3-R1, one feature description for every hook, is architecture and belongs here.
2. The add-on platform: the pack, version, namespace, texture-unit, listing and interface-version tasks (M3-D1 to M3-D9). Then the hooks each with its first user (M3-E1 to M3-E10), and the example add-on layout (M3-D5).
3. The add-on products: `@null3d/particles`-style Gaussian splats (M3-F2), `@null3d/water` with the FFT ocean (M3-F5, M3-F9) and `@null3d/three-compat` (M3-F7).

The order sets when, not what is built. Hooks ship with a first user, so each hook's task waits for the add-on that uses it.

### Vegetation and wind

The owner made vegetation a foundation ([D-241](D-241-vegetation-foundation.md)). It passes ruling 4's test, because many kinds of project use plants and other developers' style packs build on it. It holds the species generator, the scatter, the grass, the leaf material, the wind and the hand-off to impostors. Themed species packs stay content for other developers.

The owner made the fluid wind an add-on of its own, working name `@null3d/wind` ([D-241](D-241-vegetation-foundation.md#fluid-wind-is-an-add-on-of-its-own)). It passes ruling 4's test: vegetation, particles and water read the field, and so would later add-ons for hair or weather. Rule 13 in AGENTS.md lists both.

Vegetation is the first foundation that depends on another add-on. The rule for that:

- An add-on imports another add-on only by its package name, or by a sub-path that the package exports. It never imports a relative path into the other add-on's folder.
- It lists the other add-on as a dependency at the exact version. Every foundation pins the exact engine version and releases with the engine, so the two always release in step.
- It never copies the other add-on's code. Each feature lives in one place, as rule 11 says.

`tools/check-addon-imports.ts` covers the wind add-on (M3-V15). It refuses a relative import from one package into another package's folder. It also refuses an import of a sub-path that the other package does not export. `tools/lib/addon-imports.test.ts` covers both refusals, and a fixture that holds one import of each.

## Hook shapes

### H1: one storage texture at a fixed binding

Decided by the coordinator. Task: M3-E8.

An add-on's compute pass writes one storage texture at a fixed binding of the pass's group. The add-on's uniforms and sampled textures follow it in the same layout that a full-screen effect uses. The shader download and the bind group layout stay the same whatever a scene uses, so an add-on does not pay for a surface that it ignores.

A ping-pong pair is two passes: a pass that needs two textures uses two passes and swaps its target. A storage buffer waits for the first user that needs one, and M3-E9's GPU-written count buffer reuses this surface rather than bringing a second one. The target's default format is `rgba16float`. The call refuses on WebGL2, which has no compute, and the docs give the full-screen fallback.

### H5: an add-on's tasks on the job workers

H5's first user, the Gaussian splats add-on (M3-F2), runs its selection in every frame on WebGL2. The engine's on-demand loader runs such work in the job workers for its own decoders. An add-on that copied the loader would start workers of its own, which D-54 rejects. A page with two add-ons would then run three sets of threads, and each would solve CDN delivery and the page's policy again.

`runTask(task, input, transfer?)` is the hook, exported from `@null3d/engine`.

- A task is one object: a name, the address of the module that exports `run`, and the WebAssembly files that the module uses. The engine compiles each file once per page. It imports the module once in each worker that runs it, so a module keeps its state between tasks.
- `run` gets the task's input and a function that returns each compiled module by the name the task gives it. It returns `{ output, transfer? }` or a promise of one.
- The promise resolves on the thread that queued the task. A rejection is a `TaskFailure` with the stage `'load'`, `'run'` or `'stopped'`, or an engine error when a WebAssembly file does not download or compile.
- The public function loads the loader on first use. `TaskFailure` and `TaskLoadError` live in files of their own. An export that pulls the loader into the page's start also pulls its worker in, and the size report refuses that chunk as engine code that no part names. A page that runs no task pays nothing.
- The engine keys each file by its task's module address, in the thread's cache of compiled modules and in each worker's table. Two add-ons that both name a file `sort` therefore never receive each other's module, and two files with one name each compile once.
- When the sketch runs on the page (`sketchThread: 'main'`), the page's own loader takes the news of which job workers started. Without it, the first task waits its full limit of 10 seconds before it runs. The browser test's case for that mode takes 0.66 seconds, against 10.7 seconds without the news.

The contract, which the docs page and the TSDoc give:

- The task runs in a job worker, never in the thread that runs the sketch.
- A job worker leaves the job loop only between frame chunks, and with two or more job workers one never takes tasks ([D-07](D-07-job-workers.md), [D-54](D-54-addon-modules.md)). So no frame waits for a task.
- An answer reaches the thread that queued the task between two frames. A `then` callback runs before the next frame's `onUpdate`, and that frame draws what the task wrote.
- Tasks run at the same time in different job workers, and their answers come back in no fixed order.
- A `SharedArrayBuffer` in the input is posted to the worker shared, not copied, and the engine neither copies nor transfers it. Once the promise resolves, the worker has stopped writing.
- Where no job worker takes the tasks, the loader starts a task worker, as it does on a page without worker threads. A task worker that does not start fails the task with E1406.
- When the engine stops, the tasks that wait reject with the stage `'stopped'`.

Tests: `packages/engine/src/shared/tasks.test.ts` checks the shared buffer, the failure stages and the per-task module key. The browser test `tests/image/addon-tasks.spec.ts` runs the hook in every thread mode, through the minimal add-on in `tests/pages/addons/task-probe/`. It checks four things. The task ran in a job worker or the task worker. Each answer landed in a frame after the frame that queued it. The rounds reached the frames in order. The last answer is the one that the drawn frame shows.

The hook's visible user is the splats add-on, which brings its demo (M3-F2). No demo shows a job-worker task on its own.

#### What H5 carries for splats

"Splat sorting" in H5's table row means the add-on's selection, never the per-splat depth sort. The hook cannot honestly carry that sort:

- An answer reaches the thread that queued the task between two frames, as the contract above says. The transparent pass needs the rows' order inside the frame that draws them, so an order that a task returns can only reach a later frame.
- The engine's transparent pass culls and sorts every blended batch's rows back to front on the job workers, inside the frame's own job chunks (`crates/null3d-core/src/depth_sort.rs`). The batch takes rows, a count and dirty marks, and no order that a caller gives: the pass's sort replaces any order in which the rows arrived ([D-54](D-54-addon-modules.md)).
- So a second sort in the add-on would be discarded by the engine's sort. To keep it, the add-on would also re-upload every row in the new order in every frame, and the engine would still sort them again. That duplicates the one place that orders blended draws, which D-54 rejects.

What runs through the hook is the add-on's selection. The task sorts the cloud's chunks by their distance to the camera, lowers their detail levels where the budget runs out, and answers each chunk's prefix; the sketch packs those rows between two frames. The engine's transparent pass then sorts the chosen rows back to front on its job workers, on both GPU paths, as it does for every blended draw. The allocation check covers the whole path ([Benchmarks](../benchmarks.md#allocation-and-profiling)).

M3-E2 is met when the splats add-on's selection, which splats draw and each chunk's prefix, nearest first, runs on the job workers on WebGL2 through the hook, the engine's transparent pass sorts the chosen rows there, and the allocation check covers the path. [Tasks on the job workers](../../docs/api/tasks.md) says the same.

### H9: glTF extension handlers

M3-E3 builds H9, with M3-D3's hint for files that load without it. The shape:

- `assets.registerGltfExtension(handler)` registers a handler for one or more extension names, for the engine that the `assets` object belongs to. It returns a function that unregisters the handler. A second handler for one extension fails with E1213.
- A handler is `{ extensions, load(data, context) }`, close to three.js's `GLTFLoader.register()`. The loader calls `load` once for each primitive that carries one of the handler's extensions.
- `data` holds the extension's `name` and its `json` as the file gives them. It holds the `node`'s name and place, and the `primitive`'s attributes as floats by their glTF names. It also holds the `count`, `indices`, `mode` and file material. The loader reads attribute names that the engine does not know, so the splat rotation, scale, opacity and spherical-harmonic names arrive.
- `context` holds the engine's public `geometry` and `materials` makers, so a handler makes its parts through the public API alone.
- `load` returns one `{ mesh, material }` part, a list of them, or nothing, which draws nothing. The loader places the parts at the node. They join the prefab's template and instance parts, so `scene.instantiate`, `scene.createInstances` and `prefab.destroy()` treat them as the model's own. A handler may return a promise.
- A primitive that a handler claims draws only what the handler returns. The mesh's other primitives draw as usual. The parser reads claimed primitives in the worker, and their arrays move to the sketch thread with the model's own arrays.
- The loader sends the registered extension names with each file. A file's `extensionsRequired` passes for a name that a handler reads, so a registered add-on loads a file that requires its extension.
- Without a handler, a required extension that a foundation add-on reads fails with E1417, whose message names the package: `KHR_gaussian_splatting` names `@null3d/splats`. The table in `gltf-parse.ts` holds that list, so a new add-on's extensions join it with the add-on's handler.

Not in this shape: extensions on materials, nodes or the file itself, and a handler that runs before the file's other objects exist. The first user, splats, carries its data on a mesh primitive, and its own draw uses H3 and H5. The handler also gives no bounds; the model's bounds hold a part's mesh by its radius around the node.

### The texture-unit allocator

WebGL2 gives each shader stage at least 16 texture units. The lit shader reads most of them, so an add-on's material that adds textures of its own could pass a stage's share. The device would then fail to link the program: the draw would show nothing and report no reason. M3-D7 refuses it first.

`prepareProgram` in `packages/engine/src/gpu/webgl2/programs.ts` counts the distinct texture slots that each stage declares, before it numbers them and before it reads the link result, and calls `checkStageUnits`. It compares the count against the units that the device reports for each stage (`MAX_VERTEX_TEXTURE_IMAGE_UNITS` and `MAX_TEXTURE_IMAGE_UNITS`), rather than the 16 that every device gives. A stage past them throws E1209 with the count and the limit. A device that reports more units lets a larger stage link. A count after the link would never fire on a device with 16 units, because the driver's plain link error comes first. The count reads the composed GLSL's declared textures rather than the linked program's, since a driver removes a texture that the shader never reads. The declared list is the bound that a device without the removal rule would see.

The refusal comes at the first draw of a material, when its program is prepared, and not at `materials.shader()`. An add-on's shader can arrive as a first-use loader, so the material's variants may be empty when it is created, while the program always has its composed source. WebGPU needs no such check: the engine's own layouts stay within its 16 sampled textures, and a device refusal there names E1305.

Tests: `programs.test.ts` holds a stage of 17 declared textures and the boundary tests with an explicit limit, beside the test that every build of the engine's own shaders stays within the units. The browser test `tests/image/program-units.spec.ts` builds a program by hand, with one texture more than the device's fragment stage holds. It reads the link result before the engine does. It then checks that the engine throws E1209 with the device's real count.

## Options rejected

- **Private hooks for the engine's own add-ons.** Faster to build. But another developer could never match those add-ons, and a marketplace would start uneven.
- **Open access to internals,** such as the raw GPU device, the render graph's internal passes, or `@null3d/engine/internal`. It is the easiest path for sellers. But it freezes the internals at 1.0, and it breaks the promise that both GPU paths behave the same. An add-on could also break the engine's frame or its threads.
- **Building every hook before its user.** Each hook is a promise for the life of 1.x, and a hook with no user is designed by guesswork.
- **Clouds as an add-on beside the core's flat clouds.** Two places for one feature, with two sets of settings.
- **Flat clouds moved into a clouds add-on.** Every `Sky` port would need an install, H8 would have to reach three places in M3, and no download would shrink (F1).
- **Volumetric clouds left to other developers alone.** The owner wants them in the engine. H8 still lets another developer add their own clouds behind the core's settings.
- **A rule 11 that forbids any extension of a core feature.** It forbids `three-compat`'s tone curves and lit fog, which extend core features through their own settings (F2).
- **Particles as a recorded exception to section 2.** The add-on uses only a public method (F3).
- **Keeping the water recipe as the only way to make water.** Every project rebuilds the Creek's work, and an ocean has nowhere to live.
- **Add-ons as sub-paths of `@null3d/engine`,** three.js's `three/addons` model. The install grows, code inside the package can reach the internals, and the engine's own add-ons ship ahead of other developers'.
- **M3's content add-ons as npm packages.** Six first publishes, and a version promise for content that other developers should be free to sell.
- **H1 with declared storage bindings.** The pass would declare each binding by name, kind, format and access, and the engine would build the layout. That covers a ping-pong pair or a storage buffer in one pass. It also makes the shader download and the layout depend on the add-on, gives every page the code for a surface that it may not use, and turns one fixed thing to test into a set.
- **H5 as a worker handle that an add-on starts and keeps.** It is D-54's rejected option, with the same costs.
- **H5 as a callback without a promise, delivered at a frame point.** An add-on could not tell when the worker had finished writing, and the engine would need a frame point for work that has none.
- **H5 with a copy of every input and output.** A per-frame sort of a large splat scene copies megabytes in each frame, on the thread that must keep the frame.
- **H5 as a plugin object with one interface per hook.** M3-R1 gives every hook one feature description; H5 has no frame point and no scene resource, so it stays a function and a task descriptor.

## Consequences

Built:

- **AGENTS.md:** rules 11 to 13 of the add-on module rules hold one place per feature, public API only with its check, and the foundations with their publishing.
- **The check:** `tools/check-addon-imports.ts`, run by `bun run check`. It reads the shipped code of every package beside the engine, less the build tools `cli` and `vite-plugin`, and every file of `examples/`. It refuses an import of any engine entry point other than `@null3d/engine` and `@null3d/engine/stats`, and an import of the engine's source. It also refuses an import from any package into `examples/`, because an example add-on is never published (ruling 5). Tests are not checked. `tools/lib/addon-imports.test.ts` tests it, over fixtures and over the repository's own files.
- **The layout check:** `tools/check-addon-layout.ts`, also run by `bun run check`. It holds each folder under `examples/addons/` to the shape in the shared README. The shape is an `index.ts` entry, a `.wgsl` file that the entry imports, and the `.wgsl.d.ts` beside it. The README gives a `## Licence` section that names the engine's licenses. `tools/lib/addon-layout.test.ts` tests it, over fixtures and over the real folders. M3's content add-ons follow it and the demos import them.
- **Records:** [D-54](D-54-addon-modules.md) and [D-172](D-172-neon-harbour-follow-ups.md) point here. [D-179](D-179-technique-rulings.md) holds the rulings on techniques and on every item that was set for after 1.0.

Tasks, each with its first user:

- The hooks of the table above, each in its first user's task.
- WGSL compiled when an add-on is packed, with the fresh-project test installing terrain and particles and the CDN test loading one add-on (F8). This must land before 0.1.0, which ships add-ons.
- A run-time check of the engine's version in each add-on, and `bunx @null3d/cli upgrade` (F9).
- Without a handler, E1417 names the add-on for known glTF extensions (F7).
- A written docs page for `scene.createParticleBuffer` (ruling 3).
- The water add-on: river and lake in M3, after splats, then the FFT ocean before 1.0 ([D-179](D-179-technique-rulings.md)). The docs' water recipe uses it. The Creek keeps its own water until the add-on reproduces the look the owner approved ([D-257](D-257-water-addon.md)).
- The `three-compat` add-on in M3, with Reinhard, Cineon and `OutlinePass`'s glow ([D-179](D-179-technique-rulings.md)).
- M3-B1 to M3-B6 live in `examples/addons/`.
**What shows it.** The hook's visible user is the splats add-on, which brings its demo. No demo shows a job-worker task on its own, so this change adds no demo (M3-F2 owns that one).
## the texture-unit allocator of M3-D7

WebGL2 gives each shader stage 16 texture units. The lit shader reads most of them, so an add-on's material that adds textures of its own could pass a stage's share, and the device would then fail to link the program: the draw would show nothing and report no reason. M3-D7 refuses it first.

`prepareProgram` in `packages/engine/src/gpu/webgl2/programs.ts` counts the distinct texture slots that each stage declares, before it numbers them, and calls `checkStageUnits`. A stage past the units that the device reports for it throws E1209 with the count and the limit. The count reads the composed GLSL's declared textures rather than the linked program's, since a driver removes a texture that the shader never reads and the declared list is the bound that a device without the removal rule would see.

The refusal comes at the first draw of a material, when its program is prepared, and not at `materials.shader()`. An add-on's shader can arrive as a first-use loader, so the material's variants may be empty when it is created, while the program always has its composed source. WebGPU needs no such check: the engine's own layouts already stay within its 16 sampled textures, and a device refusal there names E1305.

The boundary tests in `programs.test.ts` hold a stage of 17 declared textures against an explicit limit. The same file checks that every build of the engine's own shaders stays within the units.

### the count runs before the link, against the device's units

The count above ran after `prepareProgram` read the program's link result. On a device with 16 units, a stage of 17 textures therefore threw the driver's plain link error, and E1209 never came. The count now runs first, on the declared sources of both stages. It compares against the units that the device reports for each stage (`MAX_VERTEX_TEXTURE_IMAGE_UNITS` and `MAX_TEXTURE_IMAGE_UNITS`), rather than the 16 that every device gives. A device that reports more units lets a larger stage link.

The browser test `tests/image/program-units.spec.ts` builds a lit custom material through the public API, as a page builds one, and draws it. The material declares six textures of its own. Its fragment stage reads 12 units: six of the engine's lighting and six of its own. A WebGL2 device promises at least 16, so no compliant device refuses that material. The page therefore makes its own context report 10 fragment units, as a reduced driver would, and keeps the device's own count in its result. The engine throws E1209 with both numbers, which shows the refusal is the allocator's and not the driver's. A unit test in `programs.test.ts` holds the order: its device links the program, and the engine throws E1209 without asking for the link result.

## H1's storage surface is one texture at a fixed binding

Status: decided by the coordinator. Task: M3-E8.

An add-on's compute pass writes one storage texture at a fixed binding of the pass's group. The add-on's uniforms and sampled textures follow it in the same layout that a full-screen effect uses. The shader download and the bind group layout stay the same whatever a scene uses, so an add-on does not pay for a surface that it ignores.

**Rejected: declared storage bindings.** The pass would declare each binding by name, kind, format and access, and the engine would build the layout. That covers a ping-pong pair or a storage buffer in one pass. It also makes the shader download and the layout depend on the add-on, gives every page the code for a surface that it may not use, and turns one fixed thing to test into a set. A pass that needs two textures uses two passes and swaps its target.

**Consequences.** A ping-pong pair is two passes. A storage buffer waits for the first user that needs one, and M3-E9's GPU-written count buffer reuses this surface rather than bringing a second one. The target's default format is `rgba16float`. The call refuses on WebGL2, which has no compute, and the docs give the full-screen fallback.

## vegetation is the eleventh foundation

The owner made vegetation a foundation add-on ([D-241](D-241-vegetation-foundation.md)). It passes ruling 4's test, because many kinds of project use plants and other developers' style packs build on it. It holds the species generator, the scatter, the grass, the leaf material, the wind and the hand-off to impostors. Themed species packs stay content for other developers, as the "vegetation styles" of the owner's answer of 14 October. Rule 13 in AGENTS.md lists it. H2's GPU-written draws gain a second user that needs the shadow views: the near grass, which casts shadows (M3-E9).

## what M3-E2's line covers

Status: the owner's ruling of 26 October settles the line. The hook carries the add-on's selection,
and the engine's transparent pass sorts the chosen rows.

M3-E2's plan line read "splat sorting runs on the job workers on WebGL2 through it". An audit read
"splat sorting" as the per-splat depth sort, which left the task unmet. That sort is not the hook's,
and the hook cannot honestly carry it.

- An answer reaches the thread that queued the task between two frames, as the contract above says.
  The transparent pass needs the rows' order inside the frame that draws them, so an order that a
  task returns can only reach a later frame.
- The engine's transparent pass culls and sorts every blended batch's rows back to front on the job
  workers, inside the frame's own job chunks (`crates/null3d-core/src/depth_sort.rs`). The batch
  takes rows, a count and dirty marks, and no order that a caller gives: the pass's sort replaces
  any order in which the rows arrived ([D-54](D-54-addon-modules.md)).
- So a second sort in the add-on would be discarded by the engine's sort. To keep it, the add-on
  would also re-upload every row in the new order in every frame, and the engine would still sort
  them again. That duplicates the one place that orders blended draws, which D-54 rejects.

What runs through the hook is the add-on's selection. The task sorts the cloud's chunks by their
distance to the camera, lowers their detail levels where the budget runs out, and answers each
chunk's prefix; the sketch packs those rows between two frames. The engine's transparent pass then
sorts the chosen rows back to front on its job workers, on both GPU paths, as it does for every
blended draw. The allocation check covers the whole path
([Benchmarks](../benchmarks.md#allocation-and-profiling)).

The line, as M3-E2 reads: "the splats add-on's selection, which splats draw and each chunk's
prefix, nearest first, runs on the job workers on WebGL2 through the hook, the engine's transparent
pass sorts the chosen rows there, and the allocation check covers the path."

H5's table row above says "Splat sorting" as the first user, and the owner's ruling reads that as the
add-on's selection. [Tasks on the job workers](../../docs/api/tasks.md) now says the same.

## wind is the twelfth foundation, and one add-on may build on another

The owner made the fluid wind an add-on of its own, working name `@null3d/wind`
([D-241](D-241-vegetation-foundation.md), the addendum on fluid wind). It passes ruling 4's test:
vegetation, particles and water read the field, and so would later add-ons for hair or weather.
Rule 13 in AGENTS.md lists it.

Vegetation is the first foundation that depends on another add-on. The rule for that:

- An add-on imports another add-on only by its package name, or by a sub-path that the package
  exports. It never imports a relative path into the other add-on's folder.
- It lists the other add-on as a dependency at the exact version. Every foundation pins the exact
  engine version and releases with the engine, so the two always release in step.
- It never copies the other add-on's code. Each feature lives in one place, as rule 11 says.

M3-V15 extended `tools/check-addon-imports.ts` with the wind add-on. It refuses a relative import
from one package into another package's folder, and an import of a sub-path that the other package
does not export. `tools/lib/addon-imports.test.ts` covers both refusals, and a fixture that holds one
import of each.
