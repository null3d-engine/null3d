# D-242: Sky layers through a template that an add-on completes

Status: decided by the helper of M3-E10 on 24 October 2026, for the owner's review. Built: the
template, the compiler, both GPU paths, `scene.setSkyLayer` and the aurora example add-on. Date:
2026-10-24. Task: M3-E10.

Summary: A sky layer is one WGSL function, `fn skyLayer(input: SkyLayerInput) -> SkyLayer`, which
the shader compiler joins to the engine's sky-layer template. The engine draws it as a box at the
far plane right after the background, in the background's place and depth state, with the frame's
group and one block of the core sky's values. `scene.setSkyLayer` installs it, and the layer's
pipeline takes a template of the page's own, as a custom effect's does.

## Question

D-173's hook H8 asks that an add-on draw over the sky: the top of the sky, a second layer of
clouds, an aurora or a space backdrop. What does an add-on write, how does the engine stitch and
draw it, and which of the sky's three places does it reach?

## Rule

- An add-on writes one WGSL function and no pipeline, no binding and no vertex. The engine owns
  the box, the bindings, the depth state and the blend, as the custom-effect template owns its
  triangle.
- The layer obeys the core sky's settings: it reads the cloud coverage, density, elevation and
  scale that the core sky's flat clouds obey, and the share of the sun that it hides dims the disc
  that the core sky draws.
- Both GPU paths draw it (D-173), and a layer whose shader has not arrived yet draws nothing and
  costs no frame.
- A layer may be replaced or removed while the page runs, so its pipeline cannot take an engine
  template id that a second shader would then have to replace: it takes a template of the page's
  own, from the custom range.

## Data

| Measure | The template registered as an engine template | A template per compiled layer |
| --- | --- | --- |
| A second shader installed on one page | The production backend keeps the first: a template that exists is never defined again | Works: the second layer takes another template |
| Hot update in development | Swaps the shader under the same id | Swaps as a custom effect's does |
| Mock backend's group check | Judges the layer's two groups | Judges none, as for every template from the custom range |

How the data was produced: the backends' `defineCustom` and `replaceCustom` in
`packages/engine/src/gpu/webgpu/pipelines.ts` and `packages/engine/src/gpu/webgl2/backend.ts` read
against `template::NAMES` and `groups::TABLE` in `crates/null3d-gpu/src/drawlist.rs`. The engine's
own templates hold fixed layouts because the engine decides them; a template whose shader comes
from the page is defined at its first use and never re-defined in a release build.

## Decision

A template per compiled layer. The engine's `background_layer.wgsl` stays a template that the
build checks with a stub and writes no module of, as the custom-effect template does, and the shader
compiler builds each layer's function into every variant of it. The draw list's template id follows
the page's shader, so installing a second layer, or replacing a layer, needs no rule beyond the one
custom effects already follow.

## Consequences

- `scene.setSkyLayer(description, { wgsl, opacity, sun })` installs a layer and returns it;
  `SkyLayer.set` changes its values and `scene.clearSkyLayer` removes it. The description is an
  instance of M3-R1's feature description: the `'background'` point, the `'draw'` kind, the `'sky'`
  slot and the three views. The layer draws in the camera's view, in scene passes and in
  reflections, and draws nothing where the background draws nothing, as in a debug view.
- `SkyLayerInput` gives the fragment's direction, the core sky's cloud settings, the sketch time
  and the share of the sun that the layer hides. A layer declares no uniforms, textures or
  bindings of its own, so it cannot read a picture or a value that the page changes after it is
  installed. A layer that needs those asks for uniforms in a later hook.
- The sky's environment map and its CPU diffuse light stay the core sky's alone: the map's
  generator draws the sky with its own shader per cube face, and the light is a CPU model of the
  analytic air. A layer therefore adds no light to the scene, and its task line says so. M3-F11
  lights the scene from clouds, and it draws them in the same map (see the addendum of 25 October).
- The aurora example add-on in `examples/addons/aurora/` is the first user, with the `aurora` demo
  and its image test on every GPU tier. `docs/api/scene.md` and `docs/api/features.md` record the
  call and drop the hook from the list that waits for a declaration.
- The layout `BACKGROUND_LAYER` takes id 59: the id 53 that the first sketch of the feature used is
  the compute pass's `COMPUTE_RGBA16_FLOAT` layout, and two layouts at one id stop the render worker.

## Addendum, 25 October 2026: the environment map and the CPU sky light

Status: narrowed by the coordinator on 25 October 2026, with the owner reviewing it on the morning of
26 October. The owner may reverse the narrowing in one line. This addendum records a narrowing, not
the design that the record first carried. The cost of the wider line is in "The options" below.

The task first asked the hook to draw into the background, the environment map and the CPU sky
light. The build reaches the first place alone. The narrowed task asks for the background and the
sun's dimming, and says that a layer lights nothing. M3-F11 is the place that lights the scene from
clouds, because it is the engine's own tier and sets the map's refresh step and the CPU light itself.

### The CPU sky light

The engine cannot draw an add-on's WGSL into it. The light is a Rust port of the analytic sky's
shader math, `crates/null3d-render/src/sky_light.rs`. It samples that model over a cube and projects
it onto nine spherical-harmonic coefficients. A layer is GPU WGSL that the page's build makes. The
CPU has no way to run it.

| Option | Verdict |
| --- | --- |
| A: the add-on also ships a CPU copy of its layer, which the render worker calls | Rejected. It needs a WASM ABI in the hook, and it is far more than the task's two helper-weeks |
| B: the engine reads the map's faces back and projects them on the CPU | Rejected. A readback stalls the render thread at each fill |
| C: the add-on supplies its own spherical harmonics as data | Rejected here. It is a different, smaller hook. It does not run the layer's WGSL |
| D: drop the clause. The CPU diffuse sky light stays the core sky's | Chosen on 25 October 2026 |

### The environment map

The map can hold a layer, but the result lights reflections alone. Its diffuse ambient light comes
from the CPU model, so option D above also blocks the diffuse part. Two more faults make the map
expensive now:

- The engine's environment sky shader is one fixed pipeline, `crates/null3d-shaders/wgsl/
  environment.wgsl`, whose `fs_sky` draws three.js's sky per cube face. A layer is page WGSL. To
  join it, the map's sky draw must become a template per page, take the layer's block, and bind it,
  as the background layer does. That is a second build of every layer's shader.
- A map fills again only past a visible step: the sun turns half a degree, a color drifts by a
  fiftieth, or the clouds drift a tenth of a cell (`crates/null3d-render/src/sky_maps.rs`). The
  engine knows those steps because it owns the settings. A layer's animation lives inside its WGSL,
  and its only values are opacity and the hidden sun. The engine cannot tell how fast the layer
  moves, so it would either capture the whole cube in every frame or light the scene with a stale
  layer. A sound build needs a refresh step or a `static` promise from the add-on, which is a new
  field in the hook.

Estimate for a sound build: one to one and a half helper-days, with the new field and its docs, on
both GPU paths. The first user, the aurora, changes little across the sky. Its light in reflections
alone would hardly show.

### The options and the cost of the wider line

| Option | Verdict |
| --- | --- |
| A: build the environment map now, and drop the CPU light | Rejected. It costs one to one and a half helper-days, and it lights reflections alone. Its first user would hardly show |
| B: build both places | Rejected. The CPU light has no sound way to run a layer's WGSL at all |
| C: narrow the task to the background and the sun | Chosen on 25 October 2026, with the owner reviewing it on 26 October |

If the owner reverses the narrowing, the cost is one to one and a half helper-days for the
environment map, plus the refresh-step field, and it still lights reflections alone. The CPU light
would need a new hook shape, which this record describes under "The CPU sky light".

### The task line

"H8, sky layers: an add-on draws over the background and dims the sun, so other developers can
build volumetric clouds behind the core's cloud settings. A layer lights nothing: the sky's
environment map and its CPU light stay the core sky's (D-242, narrowed on 25 October 2026)."

M3-F11 stays the place that lights the scene from clouds. It is the engine's own tier, so it sets
the map's refresh step and the CPU light itself.
