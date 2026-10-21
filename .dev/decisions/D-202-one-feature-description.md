# D-202: One feature description for add-on hooks

Status: decided. Date: 2026-10-21. Task: M3-R1. The owner's ruling of 21 October 2026 put the hooks into M3 and asked for one public feature description before H3 ([D-199](D-199-m4-features-and-study-tasks-in-m3.md)). This record gives the shape and the rules that make each hook an instance of it.

Summary: Every add-on render hook declares one `FeatureDescription` and registers it in a `FeatureRegistry`. A description names a frame point, a kind, an order band and a view mask. It declares its reads and writes of scene resources, and publishes outputs with a neutral default. It provides lighting slots with one owner each. It carries the ready, quality, resize, reset and destroy callbacks. `defineFeature` fills the defaults and checks the description, and E1223 reports each mistake. A test writes the real depth of field against the shape and passes, with no built-in moved. H4, H5, H6 and H9 are not frame features, so each still needs its own hook payload.

## Question

The D-173 hooks H1 to H9 were designed one at a time, each with its first user. Before H3 builds a new kind of draw, the engine needs one public shape for all of them. What does a feature declare, how does the engine check it, and which hooks does one shape fail to hold?

## Rule

- The shape is public, experimental and loads on first use. The engine's built-in renderer features stay internal and do not use it (AGENTS.md, parity rule 14; [D-199](D-199-m4-features-and-study-tasks-in-m3.md)).
- A feature declares enough for the render graph to place it. It gives the point where it records, its reads and writes, its order inside the point, and its view mask.
- One provider per lighting slot. Two answers for one kind of light would be a silent bug.
- A missing, switched-off or not-ready feature breaks nothing downstream. Each output carries a neutral default.
- Only the public entry point `@null3d/engine` exposes the shape. The check `tools/check-addon-imports.ts` holds that rule ([D-173](D-173-addon-hooks.md), ruling 2).
- The shape must express the engine's own features, even though they do not move onto it. If a real built-in does not fit, the shape is incomplete.

## Data

### The study's descriptor

The engine study of 20 October 2026 read the competitor's `RendererFeatureDesc` in its chapter 04. Its fields are a name, a user pointer, and one record function for each of 12 phases. It holds a `has_draws` predicate per phase, and read and write bits of scene resources. It also holds prepare, resize, reset, destroy, quality and ready functions, and a static-shadow flag. It declares 16 published outputs, a lighting-slot mask, an order and a view mask. The study found 35 registrations, and the engine's own lights, shadows, sky, TAA, bloom and DOF use the same descriptor as game code.

Two parts of that design do not carry over:

- The 12 phases have fixed values and a fixed pass order. null3D's render graph orders passes from their declared reads and writes, which the study called better.
- Its record functions run on the recording thread with the pass open. null3D's render worker never runs sketch code, so a feature must be data at that point.

### null3D's extension points today

- `render.addPass` declares scene, reflection and full-screen passes, with `writes`, `reads`, `size` or `scale`, `layers`, `every`, `clearColor` and the pass's own WGSL ([D-104](D-104-scene-passes.md)).
- `post.addEffect` declares full-screen effect WGSL with textures, uniforms and an `order`.
- Custom materials declare surface functions, full shaders, textures, uniforms and per-row values.
- `quality` gives the preset and the settings, and a budget that the governor scales.
- The render graph already compiles reads and writes, culls passes that nothing shows, and reports E1502 to E1505.

So the engine has declarations for passes and effects. It has no one shape that ties a feature's frame point, resources, outputs, slots, order, views and lifecycle together.

### The real built-in that the test writes

The test `packages/engine/src/scene/features.test.ts` writes depth of field against the shape. The description matches the built-in's real behavior:

- It records at `'resolve'`, as a `'fullscreen'` feature, on the HDR color before the tone curve.
- It reads `'sceneColor'` and `'sceneDepth'`, and writes `'sceneColor'`.
- Its `quality` callback takes `settings.dofSamples`, which the preset table gives as 0, 22, 43 and 71.
- Its `ready` callback is false on Low, where the real setting is 0, and true on the other presets.
- Its `resize`, `reset` and `destroy` callbacks run, and the registry refuses a second owner of its name.

The test file's 12 tests pass. It changes no built-in and does not ship.

## Decision

### The public type

`FeatureDescription` holds one add-on feature:

| Field | Meaning | Default |
| --- | --- | --- |
| `name` | From 1 to 64 characters, without a line break. It names the feature in errors, the graph dump and the stats GPU scope. | Required |
| `frame` | The point in the frame where the feature records. Without it, the feature publishes data and records no frame work. | None |
| `kind` | `'draw'`, `'compute'` or `'fullscreen'`. It is required with a frame, and the frame point decides which kinds it takes. | Required with a frame |
| `band` | `'before'`, `'normal'` or `'after'`, against the engine's own work at the point. | `'normal'` |
| `order` | A whole number inside the band's range. A lower number runs first. | The band's first place |
| `reads` | Scene resources: `'sceneColor'`, `'sceneDepth'`, `'normals'`, `'motionVectors'`, `'history'` or `'shadowAtlas'`. | None |
| `writes` | The scene resources that the feature writes. A compute feature writes none. | None |
| `outputs` | Textures published by name, each with a neutral default: `'black'`, `'white'` or `'transparent'`. | None |
| `provides` | Lighting slots: `'shadow'`, `'ambient'`, `'sky'`, `'ao'`, `'reflection'` or `'fog'`. | None |
| `views` | The view mask: `'main'`, `'scenePass'` or `'reflection'`. | `['main']` |
| `ready` | Returns whether the feature draws. False means no cost at all. | Ready |
| `quality` | Gets the preset and the settings, and maps them onto the feature's own settings. | None |
| `resize` | Gets the render size in device pixels. | None |
| `reset` | Gets `'resize'`, `'camera'` or `'exposure'`, and drops the history that the reason makes stale. | None |
| `destroy` | Frees the feature's own objects. | None |

### The frame points and kinds

| Frame point | What runs there | Kinds |
| --- | --- | --- |
| `'shadow'` | The shadow passes, from a light's view. | `'draw'` |
| `'background'` | The background, before the opaque objects. | `'draw'`, `'compute'`, `'fullscreen'` |
| `'opaque'` | The pass that shades the opaque objects. | `'draw'`, `'compute'`, `'fullscreen'` |
| `'transparent'` | The pass that draws the blended objects. | `'draw'`, `'compute'`, `'fullscreen'` |
| `'resolve'` | The scene color as the camera's passes leave it, before the tone curve. | `'compute'`, `'fullscreen'` |
| `'post'` | The display image, after the tone curve. | `'compute'`, `'fullscreen'` |

The frame point is a position in null3D's frame, not a copy of the study's 12 phases. The kinds follow the pass state at each point. A shadow map holds no full-screen result, and a post point has no camera to draw the scene from.

### The order bands

| Band | Range | Meaning |
| --- | --- | --- |
| `'before'` | -1,048,576 to -1 | Before the engine's own work at the point. |
| `'normal'` | 0 to 1,048,575 | With the engine's own work. |
| `'after'` | 1,048,576 to 2,097,151 | After the engine's own work at the point. |

A million numbers separate the bands, as the study's `BUILTIN` and `BUILTIN_POST` constants did. A band is easier to reason about than a bare number, and validation refuses an order outside its band.

### The lifecycle

- `ready` is checked before the frame records the feature. A false answer removes its pass, its targets and its download, so a feature that a sketch does not use costs nothing.
- `quality` runs when the preset or its settings change. It is the engine's existing quality event, narrowed to one feature.
- `resize` runs after the engine takes a new render size.
- `reset` runs when the render size changes, when the camera cuts to another place, or when the exposure moves enough to make stored values stale.
- `destroy` runs once. The registry does not call it, because the owner stops the feature before it removes it, as `render.removePass` does with its textures.

### The checks

`defineFeature` validates one description and returns it frozen, with every default filled. `FeatureRegistry.add` validates the rules across features. E1223 reports each mistake:

- an unknown option, so a typo is not ignored;
- a frame point, kind, resource, slot or view that does not exist;
- a kind that the frame point does not take;
- a resource or a view without a frame point;
- a compute feature that writes a scene resource;
- an order outside its band;
- a name that is empty, longer than 64 characters or has a line break;
- an output with no neutral default, or with an option other than `default`;
- a feature name or output name that another feature has;
- a lighting slot that another feature provides.

### Options rejected

- **One interface per hook.** That was the plan's starting point. Eight shapes would need eight version promises, eight docs pages and eight chances to disagree. One shape, built before H3, costs less (study chapter 15, A1).
- **A copy of the study's 12 fixed phases.** null3D's graph orders by reads and writes. A fixed order would hide the graph's advantage and would force a slot for every pass that the engine might add.
- **A record callback per phase.** The render worker never runs sketch code. The declarations cross to it as data, and the callbacks run on the sketch's thread.
- **A numeric order alone.** A number does not say whether a feature runs with the engine's work or after it. The band says that, and the order breaks ties inside it.
- **A lighting slot without one owner.** A second provider would light the scene twice, or give two answers for one term, with no error. The registry refuses it.
- **A description that names an output with no default.** A material that reads a missing texture would show white or black by accident. The default is part of the declaration.
- **A public API for the engine's own renderer features now.** The built-ins work and stay internal. Moving them onto the shape is D-180's question after 1.0, and a built-in moves only when it needs major work.

## How each hook fits

| Hook | Fits as | What the shape does not yet give it |
| --- | --- | --- |
| H1, a compute pass whose storage output materials and effects read in the same frame | `kind: 'compute'`, a frame point such as `'background'`, and an output with a neutral default | The same-frame storage read is a binding and ordering job for M3-E8's adapter. A feature has one `kind`, so the WebGL2 fragment-pass fallback is not expressible. That hook needs a fallback kind or a second description. |
| H2, draws whose count and instances the GPU writes | `kind: 'draw'`, with its frame point and order band | The GPU-written count, the indirect buffer and the CPU-filled fallback are the hook's own payload. The shape says where the draw sorts, not how its count is made. |
| H3, a new kind of draw | `kind: 'draw'`, with its frame point, order band, reads and writes | The shader template, the vertex format and the draw payload are H3's registration. The shape carries the sorting and the resources, not the draw's own declaration. |
| H4, material lobes | Not a frame feature | A lobe extends the material shader. The shape has no shader-piece field. H4 needs its own material hook. |
| H5, add-on tasks | Partly: a feature with no frame, an output and the ready and destroy callbacks | The task registration, the WebAssembly module and the job-worker queue are the hook's payload. The shape has no field for them. |
| H6, a baked-data format | Partly: a data feature that publishes an output with a neutral default | The file format and the core's reader are not a frame feature. H6 needs its own format hook. |
| H7, scene inputs | `reads` covers depth, normals, motion and history | The depth behind a custom material is a material input, not a frame read. That part needs a custom-material field. |
| H8, sky layers | `frame: 'background'`, `provides: ['sky', 'ambient']`, and outputs with neutral defaults | The CPU sky light is not a declared resource, so the adapter at the background point must include it. The shape does not name it. |
| H9, glTF extension handlers | Not a frame feature | A loader handler registers an extension name and a parse function. The shape has no field for it. |
| Preset and stats links | The `quality` callback and the feature `name`, which names its GPU scope | One GPU timing scope per feature is the adapter's job, in M3-E6. |
| Texture units, namespaces, interface version | Not frame features | The registry's unique names help, but unit allocation, name ranges and the version range are separate platform work (M3-D6 to M3-D8). |

The shape therefore holds the render hooks H1, H2, H3, H7 and H8, and the preset and stats link. It holds the data parts of H5 and H6. H4, H9 and the platform items need their own hooks, and the record says so rather than bending the shape around them.

## Consequences

- **Code:** `packages/engine/src/scene/features.ts` holds the types, `defineFeature`, `FeatureRegistry` and the checks. `packages/engine/src/index.ts` exports them. E1223 joins `codes.ts`, `fixes.ts` and the code list.
- **Test:** `packages/engine/src/scene/features.test.ts`. It writes depth of field against the shape, checks the defaults and each refusal, and proves the registry's one-owner rules. It does not ship and moves no built-in.
- **Docs:** `docs/api/features.md` and its generated reference. The page says that the graph adapter is not built yet.
- **Skills:** no skill shows the API yet. `bun run skills:check` and the develop skill were re-read.
- **Size:** no start path calls the registry. A page that does not use a feature description downloads none of its code. The adapter that M3-E1 adds loads on first use, as the plan asks.
- **Next:** M3-E1 (H3) builds the adapter that turns a registered feature into a render graph node, with its declared reads and writes. M3-E6 adds the GPU timing scope. The hooks that the table marks as needing their own payload keep their own tasks.

## Addendum, 21 October 2026: the view mask in null3D

The study's view mask chose between the main view, a thumbnail view and a stage view. null3D has the camera's view, scene pass views, reflection pass views and reflection probe captures. The shape names the first three. A feature that must also record in a probe capture needs a fourth view name when its first hook asks for one. No planned hook does.

## Addendum, 21 October 2026: the draw adapter, M3-E1

M3-E1 builds H3's adapter, `scene.addFeatureDraw(description, options)`. It takes a checked description with `kind: 'draw'` and the draw's own declaration: its compiled WGSL, the vertex arrays of one shape, and its uniforms. Choices that were not obvious:

- **A draw is a scene object, not a new draw-list command.** The adapter makes a mesh from the add-on's arrays, a custom material from its WGSL, and an ordinary scene object that draws them. The engine already culls objects, uploads changed vertices, sorts blended ones and records them for both GPU paths and every thread mode. A new draw-list command would repeat the pass recording of both frame builders and the pipeline setup of both backends for the same picture, and would break the 1 to 2 KB start-code budget that D-173 gives H3. Rejected for the same reason: a new `Shading` kind.
- **The shader compiles through the custom-material path.** A surface function or a full shader is what the plugin already compiles to WGSL and to GLSL ES 3.00, and what the custom-material template sends to the thread that draws. H3 adds no second shader route.
- **The vertex format is the arrays that the add-on gives.** `geometry.fromArrays` fixes the attributes and their types, as it does for any mesh. The adapter turns vertex colors on when the arrays have colors, so a surface function reads the per-vertex color as `input.vertexColor`.
- **The payload is the material's uniforms.** They fit the same 32-number row that `materials.shader` already writes, and `draw.setUniform` changes them with no allocation. A compact per-copy payload that a shader reads from its own buffer is not this declaration: it belongs to the draws whose count the GPU writes (H2, M3-E9).
- **The frame point and the alpha mode must agree.** `'opaque'` takes an opaque or masked material, and `'transparent'` a blended one. A mismatch throws E1223 instead of drawing in a pass that the description never named, because the pass follows the blending, not the frame field.
- **The band and order become the object's render order.** Blended objects sort lower first, so a band shifts the order by two million places. Opaque draws keep the engine's own order, and the docs say so, because the depth test decides what shows.
- **The adapter places the main view alone.** A scene or reflection pass would need per-view object lists that the adapter does not have. A description with another view throws E1223 rather than drawing in the main view alone with no warning. The shape already allows the mask to grow when an adapter can honour it.
- **Splats' core draw is still ahead.** The first test user is a point cloud, which the adapter draws from its vertices. A splat scene's compact buffer, its per-frame order and its dynamic count need M3-E2's sort and M3-E9's GPU-written count. The H3 hook is the shape those tasks extend, not a replacement for them.
