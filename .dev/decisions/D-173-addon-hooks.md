# D-173: Add-on hooks, one place per feature, and a path to an add-on marketplace

Status: proposed on 14 October 2026, for the owner's ruling. Nothing is decided. The rulings needed are at the end of "Proposal".

Summary: Each feature lives in one place, the core or one add-on, never both. So a user never chooses between two ways to do one thing. Volumetric clouds become a quality tier of the core sky, and a water add-on owns all water. Every add-on, the engine's own too, reaches the engine only through its public API, and a check enforces it. Each hook comes with its first user, stays experimental until a second add-on uses it, and freezes at 1.0. A marketplace for other developers' add-ons comes after 1.0, with a plugin interface version and a listing check.

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

## Options rejected

- **Private hooks for the engine's own add-ons.** Faster to build. But another developer could never match those add-ons, and a marketplace would start uneven. Particles show the cost: to let others build such an add-on, its drawing must move out of the core later.
- **Open access to internals,** such as the raw GPU device, the render graph's internal passes, or `@null3d/engine/internal`. It is the easiest path for sellers. But it freezes the internals at 1.0, and it breaks the promise that both GPU paths behave the same. An add-on could also break the engine's frame or its threads.
- **Building every hook before its user.** Each hook is a promise for the life of 1.x, and a hook with no user is designed by guesswork.
- **Clouds as an add-on beside the core's flat clouds.** Two places for one feature, with two sets of settings.
- **Keeping the water recipe as the only way to make water.** Every project rebuilds the Creek's work, and an ocean has nowhere to live.

## Consequences

If the owner approves:

- **AGENTS.md:** the rules for add-on modules gain "one place per feature" and "public API only". They point here.
- **D-54:** gains an addendum for section 5 and the public-API check.
- **The check:** `bun run check` refuses imports of `@null3d/engine/internal` or of engine source paths from packages other than the engine.
- **M3's tasks:** each hook joins the task of its first user. Clouds join the sky as a quality tier. `@null3d/water` takes the Creek's water, and the docs' water recipe points to it.
- **The research's technique list:** its core and add-on verdicts change as section 1 says.
- **This record's status:** it changes to decided, with the owner's rulings and their dates.
