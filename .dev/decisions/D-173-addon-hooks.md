# D-173: Add-on hooks, one place per feature, and a path to an add-on marketplace

Status: decided by the owner on 15 October 2026, at about 10:40 (UTC+8). The owner answered four of the proposal's five questions on 14 October 2026, at 13:35. A check of the proposal that afternoon found errors in it and in the draft rulings. On 15 October the owner ruled on a corrected list of eleven items ("Decision"). Date: 2026-10-15. Task: M3-plan.

Summary: Each feature lives in one place, the core or one add-on, never both. An add-on extends or replaces a core feature only through that feature's own settings. Flat clouds stay in the core sky, and a water add-on owns all water. Every add-on and every example reaches the engine only through its public entry points, and `bun run check` enforces it. The engine's team builds ten foundation add-ons, each its own npm package. M3's six content add-ons become example add-ons in `examples/`. Hooks H1 to H9 each come with a first user, all before 1.0. The plugin interface version and a listing check come in M4. The marketplace itself is a business, not engine code.

## Question

A research session on 12 to 14 October 2026 proposed new techniques. Several were add-ons: volumetric clouds, water and an ocean, grass made on the GPU, hair, special materials, and a bake. The owner asked three questions:

1. Does the engine already do clouds or water? Users must never have to choose between a built-in feature and an add-on that does the same thing.
2. The owner may later open a marketplace, where other developers build and sell powerful add-ons. How do the planned add-ons affect that?
3. Should the engine have more hook and plugin points for that marketplace?

## Rule

- The best technique is the default, and one clear way does each task ([D-52](D-52-intent-parity.md), design principle 10).
- Core or add-on ([D-54](D-54-addon-modules.md)): a feature that a glTF file or a standard scene needs stays in the core and loads on first use. An optional feature with heavy machinery of its own is an add-on. A page pays nothing for a feature it does not use.
- Both GPU paths are first-class (design principle 9). A hook works on WebGPU and WebGL2, or it states its fallback.
- The public API freezes at 1.0, in M4. Each public hook is a promise that limits how the engine's internals can change after that.

## Data

The facts below come from `origin/main` at 114a1246d, 14 October 2026.

### Clouds and water in the engine today

- **Clouds.** The core draws a flat cloud layer in the sky: four octaves of drifting noise on a plane, with three.js's formulas (`crates/null3d-shaders/wgsl/lib/atmosphere.wgsl`). The analytic sky ([D-118](D-118-sky-environment.md)) and the physical sky ([D-143](D-143-physical-sky.md)) both draw it, and the sky's environment map holds it. The engine has no volumetric clouds.
- **Water.** The engine has no water object. Water is a recipe on core features:
  - a reflection pass ([D-120](D-120-planar-reflections.md));
  - transmission ([D-122](D-122-transmission.md));
  - a custom material's surface function, with vertex offsets for waves.

  The guide [Custom passes](../../docs/guides/custom-passes.md) has a water recipe. The Creek showcase builds its water this way (`examples/showcase/creek/water.ts`): waves, ripples, caustics and foam. The three.js mapping sends `Water` and `Water2` to the reflection-pass recipe.

So a clouds add-on would put clouds in two places, each with its own settings: flat clouds in the core, volumetric clouds in the add-on. A water add-on next to the recipe would give two ways to make water.

### How the two add-ons reach the engine

| Add-on | What the engine holds for it | Could another developer build it today? |
| --- | --- | --- |
| `@null3d/terrain` ([D-152](D-152-terrain.md)) | Nothing. It uses only `ctx.materials.shader`, `ctx.textures.fromData` and public types | Yes. But D-152 rejected its preferred design, one instanced grid with heights read in the vertex shader, mainly because the public API then gave a custom vertex stage no per-instance data. The design that shipped bakes the heights on the CPU |
| `@null3d/particles` ([D-131](D-131-particles.md)) | Most of it. The engine holds the particle buffer (`scene.createParticleBuffer`), the shaders (`particle.wgsl`, `particle_depth.wgsl`) and the renderer's particle path (`crates/null3d-render/src/particles.rs`), loaded on first use. The add-on holds the emitters, sub-emitters and the API | No. The public API has no way to add a shader template or a new kind of draw |

The engine package exports an `./internal` entry point. Neither add-on imports it today, but no check stops an add-on from doing so. The on-demand loader that compiles an add-on's WebAssembly and runs its tasks on the job workers ([D-54](D-54-addon-modules.md#built)) is not in the public entry point.

### Public extension points today

- **Custom materials:**
  - surface functions with vertex offsets, and full shaders;
  - typed uniforms and up to 6 textures ([D-47](D-47-custom-material-textures.md));
  - custom shader inputs ([D-138](D-138-custom-shader-inputs.md)) and per-row values in instance batches ([D-127](D-127-row-values.md)).
- **Custom effects and custom tone curves** in the effect chain ([D-71](D-71-custom-effects.md)).
- **Render passes:** `scene`, `reflection` and `fullscreen`, with textures that materials and effects read.
- **Textures** made from data, image bitmaps and passes.
- **The WGSL library:** `null3d::` imports.

M3's first tasks already add four hooks, each for an add-on of the same milestone:

- canvas uploads of changed rectangles (M3-A2, for screens);
- texture-array layers in custom WGSL (M3-A3, for facades);
- bloom levels for custom effects (M3-A4, for the lens kit);
- draws from a vertex count alone (M3-A5, for weather).

### Hooks that the planned add-ons lack

| Hook | First users | WebGL2 |
| --- | --- | --- |
| H1. A compute pass whose storage output materials, effects and passes read in the same frame | Water's ocean (FFT), the bake, hair | No compute: a fragment-pass form where it can work, else WebGPU only, as stated |
| H2. Draws whose count and instances the GPU writes, in the main pass and the shadow passes | Vegetation, hair | Falls back to instance batches that the CPU fills |
| H3. A new kind of draw: an add-on registers a shader template, what it reads, and where it sorts | Splats; particles, to move their drawing out of the core | Both paths, through the engine's WGSL-to-GLSL step |
| H4. Material lobes: a custom material adds a specular lobe beside the base lobe | Car paint (M3-B5), a materials pack, hair | Both |
| H5. Add-on tasks: the public form of D-54's loader, for WebAssembly and work on the job workers | Splat sorting, physics (`@null3d/rapier`) | Both |
| H6. A baked-data format for probes and light maps, which the core reads | The bake; tools of other developers | Both |
| H7. Depth, normals and motion vectors as inputs to effects, passes and compute | Particle and splat depth mixing, screen-space add-ons | Both, where the frame makes them |
| H8. Sky layers: an add-on draws into the background and the environment map, and shades the sun | Auroras, space backgrounds; no planned user | Both. Not needed for clouds under this proposal |

### What a marketplace needs beyond hooks

- **Versions.** D-54 keeps each add-on's version in step with the engine's. That works for the engine's own add-ons, which release with it. An outside seller cannot release with every engine version.
- **Shared budgets.** On WebGL2 the lit shader's fragment stage reads at most 16 textures, and the core already uses most of them ([Technique review](../technique-review-2026-10.md#webgl2-texture-units)). Add-ons that add per-pixel inputs compete for the rest. GPU time is shared the same way, and an add-on in the light loop slows every pixel.
- **Namespaces.** Shader library names (`null3d::`), error codes (`E1xxx`) and quality keys are one flat space today. Two add-ons from two sellers could clash.
- **Trust.** An add-on's code runs in the engine's threads, with shared memory. Bad WGSL can lose the GPU device.
- **Code is readable.** JavaScript and WGSL cannot be hidden, so a paid add-on rests on licence terms, not on locked code.
- **Already in place:**
  - one install and one import;
  - CDN delivery under a strict policy (D-54);
  - first-use shader files (D-56);
  - one notices file per build that each add-on extends.

## Proposal

This is the proposal of 14 October 2026, kept as it was put to the owner. "Decision" below changes several parts of it: clouds, particles, the hook schedule, the foundations and the plugin interface version.

### 1. One place per feature

A feature lives in the core or in one add-on, never in both. An add-on may make a core feature better only through that feature's own settings, never through a second API. When the core has a basic version and the better one is heavy, one of two things happens:

- the better one joins the core as a quality tier that loads on first use; or
- the basic one moves out into the add-on.

Applied to the research's list:

- **Clouds:** a quality tier of the core sky, not an add-on. The same cloud settings draw the flat layer on Low and Medium, and volumetric clouds from High up. The volumetric tier needs only shaders and noise made in the browser, which load on first use, so a scene without clouds pays nothing. This reverses the research session's add-on proposal.
- **Water:** `@null3d/water` owns all water. It holds the river and lake water lifted from the Creek showcase, and later the FFT ocean. Reflection passes and transmission stay in the core as general features. The docs recipe becomes a page on how the add-on is built.
- **Particles:** users see one way today, so the rule holds. The drawing moves out of the core once hook H3 exists. Until then this is a recorded exception to section 2.

### 2. Public API only

Add-ons reach the engine only through `@null3d/engine`'s public entry points. The engine's own add-ons count as add-ons here. A check in `bun run check` fails when a package other than the engine imports `@null3d/engine/internal` or the engine's source paths. When one of the engine's add-ons needs something the API lacks, the hook becomes public, so another developer could build the same add-on.

### 3. Hooks grow with their users

- A hook is built with its first user, never before. M3's tasks M3-A2 to M3-A5 already follow this.
- A new hook is marked experimental in its docs and types. It becomes stable once a second add-on uses it, the engine's or another developer's.
- Stable hooks freeze with the API at 1.0. Experimental hooks stay marked, and may change in a 1.x release with a note.
- Each hook works on both GPU paths, or its docs state the fallback, as the table above does.
- The order follows the add-ons that the owner places in M3. H4 comes with car paint, H3 and H5 with splats, H1 and H6 with the bake, and H2 with vegetation.

### 4. Shared budgets and names for add-ons

- **Quality presets:** an add-on declares its settings per preset, and the governor's steps reach them.
- **Stats overlay:** it shows each add-on's GPU time and memory, so a user sees what an add-on costs.
- **WebGL2 textures:** the engine hands out the lit shader's free texture units. When none are left, it refuses an add-on's material with an error code, not a broken shader.
- **Names:** each add-on gets its own shader library name (`<add-on>::`), its own error-code range and its own quality keys.

### 5. A plugin interface version

The engine's own add-ons keep D-54's rule, with their versions in step with the engine's. An outside add-on instead declares the range of the plugin interface it was built for. The engine refuses it, with an error code that names both versions, when the range does not match. The interface version changes only when a stable hook changes. This comes after 1.0, with the marketplace.

### 6. The marketplace after 1.0

A listing check runs the engine's own gates on the add-on:

- the public-API check;
- WGSL validation on both GPU paths;
- the CDN and strict-policy test (D-54);
- `bench:allocation`;
- the size budgets for first-use files ([D-14](D-14-js-budget.md));
- a published cost per preset.

The licence terms, not locked code, protect a paid add-on.

### Rulings needed

1. The rule of one place per feature, with clouds as a tier of the core sky and a water add-on that owns all water.
2. Public API only for every add-on, with the check, and particles as the recorded exception until H3.
3. Hooks built with their first users and stable after a second, with H1 to H8 as the list to draw from.
4. Which add-ons the engine builds itself. One option keeps the engine's own add-ons to foundations, and leaves content packs to other developers once a marketplace exists:
   - foundations: physics, splats, text, particles, terrain and water;
   - content packs: special materials, vegetation styles, hair, effects packs.
5. Whether section 5 (the plugin interface version) and section 6 (the marketplace) are planned now for after 1.0, or wait.

## The check of 14 October 2026

The same afternoon, a check of the proposal against `origin/main` found these facts. They changed the recommendations that the owner ruled on.

| # | Finding | Effect |
| --- | --- | --- |
| F1 | Flat clouds run through the core's lighting. The CPU sky light copies the cloud noise for the diffuse light (`crates/null3d-render/src/sky_light.rs`), and both skies draw the clouds with the same settings | Moving them out needs a hook into the background, the environment map and the CPU light. It saves no download, since the sky's shaders load on first use |
| F2 | The proposal's rule 11 forbids what the engine does today. `three-compat` adds tone curves through the core's tone-curve setting ([D-52](D-52-intent-parity.md)), and lit fog is a tier of core fog ([D-133](D-133-volumetric-fog.md)) | Rule 11 is reworded: an add-on extends or replaces a core feature only through that feature's own settings |
| F3 | Particles are not an exception. `scene.createParticleBuffer` is a public method, and the add-on imports only `@null3d/engine` | The exception goes. The method needs a written docs page |
| F4 | Physics needs no hook today. The physics guide runs Rapier or cannon-es in the sketch worker | H5's first user is splat sorting, not physics |
| F5 | A custom material sees only its own pixel's depth, not the depth behind it. The Creek fakes shallow edges from its known stream bed | Water needs H7, the scene's depth behind a custom material. The frame already copies the opaque depth for soft particles ([D-131](D-131-particles.md)) |
| F6 | Car paint's flakes may need no new lobe. A hashed normal per cell works if the surface sets a base normal apart from the clear coat's | H4 waits for the clear coat check ([D-147](D-147-clearcoat-and-sheen.md)) |
| F7 | The glTF loader refuses a required extension outside its list with E1417. A `KHR_gaussian_splatting` file fails with no hint to import the splats add-on | New hook H9: an add-on registers a glTF extension handler, as three.js's `GLTFLoader.register` does. Until then, E1417 names the add-on for known extensions |
| F8 | Published add-ons with WGSL have gaps that no test covers. Terrain ships raw WGSL for the user's Vite plugin to compile, and the plugin skips WGSL under `node_modules`. A browser cannot import a `.wgsl` file from a CDN, which D-54 promises. The fresh-project test installs only controls and geometry | Each add-on compiles its WGSL when its package is packed. The fresh-project test installs terrain and particles, and the CDN test loads one add-on |
| F9 | Add-ons already pin the engine exactly: `workspace:*` packs to the exact version | A partial upgrade then fails with a peer conflict. So the command-line tool gains `bunx @null3d/cli upgrade`, which moves every `@null3d` package together |
| F11 | M3's plan holds one-place duplicates. The lens kit repeats the core's sharpening (M3-A10), grading (M3-A8) and vignette. Weather's rain sits beside the particles add-on | The lens kit uses the core's features. Weather says which feature makes rain |
| F12 | No example imports private engine code today | The import check covers all of `examples/`, and it passes on main |
| F13 | The plan's package table lacks particles, terrain, impostors, physics, splats, text and water | The plan's table gains them |

## Decision

### The owner's words

| Time (UTC+8) | The owner said |
| --- | --- |
| 14 Oct, 13:19 | "i don't want it to be the case where peopl have to choose between engine built-in stuff and/or add-ons." The owner added that a marketplace may come later, where others build and sell powerful add-ons |
| 14 Oct, 13:35 | "1. feels like clouds should also be an add-on 2. yes 3. what eight? 4. yes foundations ourselves, rest to others 5. after 1.0" |
| 14 Oct, 13:40 | "will we publish our add-ons as part of the npm package or separately? need to decide." |
| 15 Oct, morning | "let's not leave anything till after 1.0 let's decide now" |
| 15 Oct, about 10:40 | After the coordinator's adjusted list: "i approve all other stuff" |

The 13:35 answers matched the proposal's five questions. A draft of rulings from them was never landed. It recorded clouds as an add-on, kept rule 11's first wording, and kept particles as an exception. The owner's rulings of 15 October replace it.

### The rulings of 15 October 2026

1. **Flat clouds stay in the core.** This reverses the owner's 14 October "feels like clouds should also be an add-on". They are three.js `Sky`'s clouds, so ports keep their look ([D-52](D-52-intent-parity.md)). Moving them saves no bytes (F1).
2. **Volumetric clouds are left to other developers,** as an add-on behind the core's cloud settings. They are not on the engine team's plan. This is a choice of scope, not a deferral.
3. **Particles are not an exception.** The add-on uses a public engine method (F3). The method gets a written docs page.
4. **The foundation add-ons** are physics, Gaussian splats, MSDF text, particles, terrain, water, controls, geometry, impostors and `three-compat`. The engine's team builds them. A later add-on is a foundation when other add-ons or many kinds of project build on it. So is one that implements a standard or wraps a large third-party library.
5. **M3's six content add-ons are example add-ons,** not npm packages: the lens kit, facades, screens, weather, car paint and traffic lanes. Each lives in `examples/addons/<name>/`, shaped like a package, under the engine's licences. It uses only the public API and has image tests through the examples. This changes [D-172](D-172-rive-city-follow-ups.md). The lens kit uses the core's sharpening, grading and vignette, and weather says which feature makes rain (F11).
6. **Publishing.** Each foundation add-on is its own npm package. It pins the exact engine version and checks the engine's version at run time. Its WGSL is compiled when the package is packed (F8). The engine package holds no bundle of add-ons in the style of `three/addons`.
7. **Rule 11 reads:** "an add-on extends or replaces a core feature only through that feature's own settings" (F2).
8. **Each hook is built with its first user, all before 1.0.** That covers H1 to H9, the preset and stats links, the texture-unit allocator and the namespaces. The coordinator moved H1, H2 and H8 from 1.x to before 1.0 at the owner's word, about 5 helper-weeks. H4 waits for the clear coat check, still before 1.0. The table below gives each hook's first user.
9. **The plugin interface version comes in M4,** because it freezes with the API at 1.0.
10. **The marketplace's store is a business, not engine code.** The engine's part comes in M4: the plugin interface version (ruling 9) and a listing check. The coordinator moved the listing check from after 1.0 at the owner's word.
11. **This record stays on main** and records these rulings. The draft rulings were never landed, because they had three errors: clouds as an add-on, rule 11's first wording and the particles exception.

### Hooks, each with its first user

This table replaces the hook list under "Data". Every hook is public, works on both GPU paths or states its fallback, and stays experimental until a second add-on uses it. A hook loads on first use or sits in the add-on, so a page's start does not grow. H3 and H9 touch start code, the glTF worker and the draw lists, so their tasks budget about 1 to 2 KB and check it.

| Hook | What it does | First user | WebGL2 | When |
| --- | --- | --- | --- | --- |
| H1 | A compute pass whose storage output materials, effects and passes read in the same frame | The water add-on's FFT ocean | A fragment-pass form, else WebGPU only, as its docs state | Before 1.0, with the ocean |
| H2 | Draws whose count and instances the GPU writes, in the main and shadow passes | Splats' GPU culling, to confirm in its task | The CPU fills instance batches | Before 1.0 |
| H3 | A new kind of draw: an add-on registers a shader template, what it reads and where it sorts | Splats; then impostors or particles | Both, through the WGSL-to-GLSL step | M3, with splats |
| H4 | Material lobes: a custom material adds a specular lobe beside the base lobe | Car paint's glints, if the clear coat check shows they need one (F6) | Both | Before 1.0, after the clear coat check |
| H5 | Add-on tasks: the public form of D-54's loader, for WebAssembly and work on the job workers | Splat sorting (F4) | Both | M3, with splats |
| H6 | One documented format for baked probes and light maps, which the core reads | The probe grid's own grids ([D-146](D-146-light-probe-grid.md)) and light maps | Both | M3, stable at once |
| H7 | Scene inputs: depth, normals and motion vectors for effects, passes and compute; the depth behind a custom material | Water's soft shores (F5); splats' depth mixing | Both, where the frame makes them | M3, with water and splats |
| H8 | Sky layers: an add-on draws into the background, the environment map and the CPU sky light, and dims the sun | An example add-on that draws a sky layer, so other developers can build volumetric clouds | Both | Before 1.0 |
| H9 | glTF extension handlers, as `GLTFLoader.register` does | Splats (`KHR_gaussian_splatting`) | Both | M3, with splats; E1417 names the add-on until then |
| Preset and stats links | An add-on declares settings per quality preset, the governor reaches them, and the stats overlay shows each add-on's GPU time and memory | Splats' budget; water's reflection cadence | Both | M3 |
| Texture-unit allocator | The engine hands out the lit shader's free WebGL2 texture units and refuses an add-on's material with an error code when none are left | Any add-on with per-pixel inputs | WebGL2 only | M4 |
| Namespaces | A shader library name, an error-code range and quality keys per add-on | Every outside add-on | Both | M4 |
| Plugin interface version | An outside add-on declares the interface range it was built for, and the engine refuses a mismatch with an error that names both | Outside add-ons | Both | M4 |

## Options rejected

- **Private hooks for the engine's own add-ons.** Faster to build. But another developer could never match those add-ons, and a marketplace would start uneven.
- **Open access to internals,** such as the raw GPU device, the render graph's internal passes, or `@null3d/engine/internal`. It is the easiest path for sellers. But it freezes the internals at 1.0, and it breaks the promise that both GPU paths behave the same. An add-on could also break the engine's frame or its threads.
- **Building every hook before its user.** Each hook is a promise for the life of 1.x, and a hook with no user is designed by guesswork.
- **Clouds as an add-on beside the core's flat clouds.** Two places for one feature, with two sets of settings.
- **Flat clouds moved into a clouds add-on,** the owner's first answer. Every `Sky` port would need an install, H8 would have to reach three places in M3, and no download would shrink (F1).
- **Volumetric clouds as a quality tier of the core sky,** the proposal. A heavy feature that no planned demo needs would join the core.
- **Keeping the water recipe as the only way to make water.** Every project rebuilds the Creek's work, and an ocean has nowhere to live.
- **Add-ons as sub-paths of `@null3d/engine`,** three.js's `three/addons` model. The install grows, code inside the package can reach the internals, and the engine's own add-ons ship ahead of other developers'.
- **M3's content add-ons as npm packages,** as D-172 first said. Six first publishes, and a version promise for content that other developers should be free to sell.

## Consequences

Done in this change:

- **AGENTS.md:** the rules for add-on modules gain rules 11 to 13. They are one place per feature, public API only with its check, and the foundations with their publishing. The two pairs of rules that repeated numbers 8 and 9 became one rule each.
- **The check:** `tools/check-addon-imports.ts`, run by `bun run check`. It reads the shipped code of every package beside the engine, less the build tools `cli` and `vite-plugin`, and every file of `examples/`. It refuses an import of any engine entry point other than `@null3d/engine` and `@null3d/engine/stats`, and an import of the engine's source. Tests are not checked. `tools/lib/addon-imports.test.ts` tests it.
- **Records:** [D-54](D-54-addon-modules.md) and [D-172](D-172-rive-city-follow-ups.md) gain addenda that point here. [D-179](D-179-technique-rulings-2026-10-15.md) holds the same day's rulings on techniques and on every item that was set for after 1.0.

Tasks, each with its first user:

- The hooks of the table above, each in its first user's task.
- WGSL compiled when an add-on is packed, with the fresh-project test installing terrain and particles and the CDN test loading one add-on (F8). This must land before 0.1.0, which ships add-ons.
- A run-time check of the engine's version in each add-on, and `bunx @null3d/cli upgrade` (F9).
- E1417 names the add-on for known glTF extensions until H9 exists (F7).
- A written docs page for `scene.createParticleBuffer` (ruling 3).
- The water add-on: river and lake in M3, after splats, then the FFT ocean before 1.0 ([D-179](D-179-technique-rulings-2026-10-15.md)). The docs' water recipe and the Creek then use it.
- The `three-compat` add-on in M3, with Reinhard, Cineon and `OutlinePass`'s glow ([D-179](D-179-technique-rulings-2026-10-15.md)).
- M3-B1 to M3-B6 move to `examples/addons/`.

## Addendum, 21 October 2026: M4's hook and platform tasks move into M3

The owner moved all of M4's feature work into M3 ([D-199](D-199-m4-features-and-study-tasks-in-m3.md)). The hooks table's M4 rows now come in M3: H1 (M3-E8), H2 (M3-E9), H8 (M3-E10), the texture-unit allocator (M3-D7), namespaces (M3-D8), the plugin interface version (M3-D6) and the listing check (M3-D9). The plugin interface version still freezes with the API, in M4. Before H3, M3-R1 defines one public feature description that every hook is an instance of. Built-in renderer features stay internal and do not use these hooks; a feature that leaves the core uses them.

## Addendum, 21 October 2026: the volumetric cloud tier is built in M3

The owner asked for volumetric clouds on 21 October 2026, after the ruling that leaves them to other
developers was read back. Ruling 1's core tier therefore gets a task: M3-F11 builds the sky's High
tier and above as volumetric clouds, behind the same cloud settings that draw the flat layer on Low
and Medium. The H8 sky-layers hook (M3-E10) keeps its place: it is how another developer adds their
own clouds behind these settings, not a second way for the engine to draw them.

The rule of one place per feature holds. Clouds stay in the core, and no cloud add-on is planned.

## Addendum, 21 October 2026: the add-ons come last in M3

The owner ruled on 21 October 2026 that the add-ons wait until the architecture and the core engine
work are done. The order inside M3 is therefore:

1. The core's work: level of detail, the Rive City follow-ups, the glTF and API features, the script
   tag and the study's tasks. M3-R1, one feature description for every hook, is architecture and
   belongs here.
2. The add-on platform: the pack, version, namespace, texture-unit, listing and interface-version
   tasks (M3-D1 to M3-D9), the hooks each with its first user (M3-E1 to M3-E10), and the example
   add-on layout (M3-D5).
3. The add-on products: `@null3d/particles`-style Gaussian splats (M3-F2), `@null3d/water` with the
   FFT ocean (M3-F5, M3-F9) and `@null3d/three-compat` (M3-F7).

This changes no ruling about what is built, only when. Hooks still ship with a first user, so each
hook's task waits for the add-on that uses it.
## Addendum, 21 October 2026: the shape of H9, glTF extension handlers

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

## Addendum, 21 October 2026: H5's shape, an add-on's tasks on the job workers

**Problem.** H5's first user, the Gaussian splats add-on (M3-F2), sorts its instances in every frame on WebGL2. The engine's on-demand loader already runs such work in the job workers for its own decoders. No public entry point exposes it. An add-on that copied the loader would start workers of its own, which D-54 rejects. A page with two add-ons would then run three sets of threads, and each would solve CDN delivery and the page's policy again.

**Decision.** `runTask(task, input, transfer?)` is the hook, exported from `@null3d/engine`.

- A task is one object: a name, the address of the module that exports `run`, and the WebAssembly files that the module uses. The engine compiles each file once per page. It imports the module once in each worker that runs it, so a module keeps its state between tasks.
- `run` gets the task's input and a function that returns each compiled module by the name the task gives it. It returns `{ output, transfer? }` or a promise of one.
- The promise resolves on the thread that queued the task. A rejection is a `TaskFailure` with the stage `'load'`, `'run'` or `'stopped'`, or an engine error when a WebAssembly file does not download or compile.
- The public function loads the loader on first use. `TaskFailure` and `TaskLoadError` live in files of their own. An export that pulled the loader into the page's start also pulled its worker in. The size report refused that chunk as engine code that no part named. A page that runs no task now pays nothing.

The contract, which the docs page and the TSDoc give:

- The task runs in a job worker, never in the thread that runs the sketch.
- A job worker leaves the job loop only between frame chunks, and with two or more job workers one never takes tasks ([D-07](D-07-job-workers.md), [D-54](D-54-addon-modules.md)). So no frame waits for a task.
- An answer reaches the thread that queued the task between two frames. A `then` callback runs before the next frame's `onUpdate`, and that frame draws what the task wrote.
- Tasks run at the same time in different job workers, and their answers come back in no fixed order.
- A `SharedArrayBuffer` in the input is posted to the worker shared, not copied, and the engine neither copies nor transfers it. Once the promise resolves, the worker has stopped writing.
- Where no job worker takes the tasks, the loader starts a task worker, as it does on a page without worker threads. A task worker that does not start fails the task with E1406.
- When the engine stops, the tasks that wait reject with the stage `'stopped'`.

**Options rejected.**

- A worker handle that an add-on starts and keeps. It is D-54's rejected option, with the same costs.
- A callback without a promise, delivered at a frame point. An add-on could not tell when the worker had finished writing, and the engine would need a frame point for work that has none.
- A copy of every input and output. A per-frame sort of a large splat scene copies megabytes in each frame, on the thread that must keep the frame.
- A plugin object with one interface per hook. M3-R1 gives every hook one feature description; H5 has no frame point and no scene resource, so it stays a function and a task descriptor.

**Changes the public hook needed.** Three faults would show with a second add-on, or with a sketch on the page:

- A file's name was global to the page, so two add-ons that both named a file `sort` received each other's module. The engine now keys each file by its task's module address, both in the thread's cache of compiled modules and in each worker's table.
- The cache of compiled modules was keyed by a file's name. It is keyed by the file's address, so two files with one name each compile once.
- When the sketch runs on the page (`sketchThread: 'main'`), the page never heard which job workers started. The engine sent that news to the sketch worker alone. The first task then waited its full limit of 10 seconds before it ran. The page's own loader now takes the same news. The browser test's case for that mode took 10.7 seconds before the fix, and 0.66 seconds after it.

**Tests.** `packages/engine/src/shared/tasks.test.ts` checks the shared buffer, the failure stages and the per-task module key. The browser test `tests/image/addon-tasks.spec.ts` runs the hook in every thread mode, through the minimal add-on in `tests/pages/addons/task-probe/`. It checks four things. The task ran in a job worker or the task worker. Each answer landed in a frame after the frame that queued it. The rounds reached the frames in order. The last answer is the one that the drawn frame shows.

**What shows it.** The hook's visible user is the splats add-on, which brings its demo. No demo shows a job-worker task on its own, so this change adds no demo (M3-F2 owns that one).