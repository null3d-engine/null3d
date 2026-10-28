# D-252: A material's own specular lobe

Status: decided by the helper of M3-E7, for the owner's review. Built: the hook, the input record
and both GPU paths through the WGSL-to-GLSL step. First user: M3-B5's car paint, whose glints
declare it. Owed: a GPU check of the final code, and the car paint's cost per preset. Task: M3-E7.

Summary: A custom material declares `fn lobe(input: LobeInput) -> vec3f`. The engine calls it for the
main directional light and for each point and spot light that reaches the surface, and adds the color
it returns to that light's specular. The surface function passes its own four values through
`Surface.lobe`. Area lights, and the ambient, hemisphere and environment light, keep the base lobe.

## Question

D-173's hook H4 lets a custom material add a specular lobe beside the base lobe. M3-B5's car-paint
glints are its first user ([D-179](D-179-technique-rulings.md), ruling 17). A glint model
needs the light, the view and the half vector, and it multiplies the base specular. A surface
function has none of those. What does an add-on write, and what does the engine call?

## What a surface function cannot do

- `SurfaceInput` holds no light. `docs/shaders/builtins.md` says "Light values are not built yet".
  The frame's values that a custom material reads hold the time, the camera and the object, not the
  lights.
- The `Surface` record changes the normal, the roughness and the colors. The engine computes each
  light's specular after the surface function returns, so the record cannot scale it.
- A glint factor depends on the half vector. It must run once for each light, where the engine has
  that vector.

## Rule

- The engine calls the hook once for the main directional light, after it computes that light's base
  specular, and once for each point and spot light of the surface's cluster, after it computes that
  light's base specular. The hook's return value adds to that light's specular.
- The input record gives the normal, the view, the light, the half vector, the filtered roughness,
  the reflectance at normal incidence, the base specular, the light's irradiance and the surface
  function's four values.
- A material that declares no lobe has no call, no input record and no new build. The hook's shader
  def joins the builds of the material that declares it, as a vertex offset's does.
- Both GPU paths draw it. The hook is WGSL in the material's own function; the WGSL-to-GLSL step
  compiles it for WebGL2.

The engine owns the hook and the add-on owns the model. The engine declares the hook, the input
record and the call. No flake or sparkle appears in the hook's name or its record, because the
add-on's WGSL writes the whole model.

## Every point and spot light

The engine's clustered point, spot and area lights draw in `null3d::lights::clustered_light`, a
library module. A library module cannot call a function that the entry shader's WGSL declares: the
shader composer resolves each module's imports, and the entry is the outermost module, so the import
would close a cycle.

| Option | Verdict |
| --- | --- |
| A: the entry shader walks the cluster | Chosen. `lit.wgsl` holds the loop for a material that declares a lobe, and shades each light with the library's per-light work, `null3d::lights::cluster_sample`. The library keeps its own loop for the shaders that declare no lobe, so a standard material pays nothing |
| B: a per-material composable module for the lobe | Rejected. The lobe may call any helper, uniform or value of the material's own WGSL, so the module would have to hold all of it. The surface function reads the template's own names, which the module cannot import |
| C: a compiler feature that lets a library module call a function of the entry | Rejected. It changes the shader composer for one hook, and it patches a library module per build |
| D: a second pass over the cluster for the lobe | Rejected. It repeats each light's distance and cone attenuation and its shadow lookup, which are the costly part of the loop |
| E: an engine-side glint model | Rejected for M3-B5. The plan makes the glints the add-on's technique, not a core feature |

The added code is one function in `lit.wgsl` and the per-light split of `null3d::lights`. The loop
body that the two paths share is not copied: both call `cluster_sample`, and the loop skeleton and
the area-light branch stand in each place.

## Cost

- A material that declares no lobe pays nothing: no call, no record and no build.
- A material with a lobe pays one function call for each pixel of each light that reaches it: the
  main light, and each point and spot light of its cluster. The call reads values that the shading
  already holds.
- A lobe material's shading builds hold the cluster loop in the template. The engine's shader build
  writes that loop into the material's own builds alone, so the shipped shader set and the page's
  start do not change.
- The first user's cost per preset is owed, and D-255 names the command that measures it.

## Consequences

- Code: the hook table and its signature check in `crates/null3d-shaders/src/material.rs`;
  `null3d::lights::cluster_sample`, which returns one light's direction and its color after the
  attenuation, the shadow, the spot map and the layers; the `LobeInput` record, the `Surface.lobe`
  field, the sun's call and the cluster's loop in `crates/null3d-shaders/wgsl/lit.wgsl`; the plugin's
  function names in `packages/vite-plugin/src/wgsl.ts`; the error texts of E1215.
- Tests: `crates/null3d-shaders/tests/material.rs` builds a material with a lobe into every variant,
  refuses a wrong signature, counts the lobe's two call sites on both paths, and builds the car
  paint's shipped WGSL on WebGPU and WebGL2. `packages/vite-plugin/src/wgsl.test.ts` builds a lobe
  on its own.
- Docs: `docs/shaders/surface-functions.md` has "A material's own lobe", with the input table and the
  lights that call it. `docs/api/materials.md`, `docs/guides/custom-shaders.md` and the develop skill
  name the function.
- Pictures: `tests/image/car-paint.spec.ts` measures pixels that grow brighter with the flakes than
  without them, so the glints draw, and measures the same difference with the sun left out, so the
  point light answers the lobe. D-255 records its runs in both reference sets.
- M3-B5 declares the lobe for its flakes, as D-255 records. M3-B5's own cost per preset is owed.

## Runs

The GPU check's line for the hook is the one that commit dd2bcab87 records:

`GPU-Checked: 9369b1380..c307ddad6 not judged: s4 medium 4.24 to 4.20 ms (+3.0%); s6 medium 4.69 to 4.61 ms (-4.3%); s4 high 4.54 to 2.24 ms (-38.1%); s6 high 6.51 to 6.70 ms (+10.3%); the benchmark pages changed between the commits`

The measured tip, c307ddad6, contains this task's commit 766387e0e. The check says not judged because
the benchmark pages changed between the two builds. The guide says such a line still gives the
figures, and a reviewer judges them.

The build tests are `cargo test -p null3d-shaders --test material`: a lobe in every variant, a wrong
signature refused, the two call sites of every path, and the car paint on both paths. The suite
passed 34 of 34 on the Mac for this branch, in 117.7 s, and its log is not kept. The full shader
build, `bun tools/shaders.ts`, compiled all 80 entries of the manifest with the changed library.
