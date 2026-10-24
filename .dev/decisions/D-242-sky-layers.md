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

- `scene.setSkyLayer({ wgsl, opacity, sun })` installs a layer and returns it; `SkyLayer.set`
  changes its values and `scene.clearSkyLayer` removes it. The layer draws in the camera's view, in
  scene passes and in reflections, and draws nothing where the background draws nothing, as in a
  debug view.
- `SkyLayerInput` gives the fragment's direction, the core sky's cloud settings, the sketch time
  and the share of the sun that the layer hides. A layer declares no uniforms, textures or
  bindings of its own, so it cannot read a picture or a value that the page changes after it is
  installed. A layer that needs those asks for uniforms in a later hook.
- The sky's environment map and its CPU diffuse light still come from the core sky alone: the map's
  generator draws the sky with its own shader per cube face, and the light is a CPU model of the
  analytic air. A layer therefore adds no light to the scene. Lighting from a layer is owed with the
  volumetric-cloud tier (M3-F11), which draws its clouds in the same map.
- The aurora example add-on in `examples/addons/aurora/` is the first user, with the `aurora` demo
  and its image test on every GPU tier. `docs/api/scene.md` and `docs/api/features.md` record the
  call and drop the hook from the list that waits for a declaration.
- The layout `BACKGROUND_LAYER` takes id 59: the id 53 that the first sketch of the feature used is
  the compute pass's `COMPUTE_RGBA16_FLOAT` layout, and two layouts at one id stop the render worker.
