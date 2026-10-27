# D-252: A material's own specular lobe

Status: decided by the helper of M3-E7, for the owner's review. Built: the hook, the input record
and both GPU paths through the WGSL-to-GLSL step. First user: M3-B5's car paint, whose glints
declare it. Owed: a GPU check of the final code, and the car paint's cost per preset. Task: M3-E7.

Summary: A custom material declares `fn lobe(input: LobeInput) -> vec3f`. The engine calls it for the
main directional light and adds the color it returns to that light's specular. The surface function
passes its own four values through `Surface.lobe`. Point, spot and area lights keep the base lobe.

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
  specular. The hook's return value adds to that specular.
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

## The main light alone

The engine's clustered point, spot and area lights draw in `null3d::lights::clustered_light`, a
library module. A library module cannot call a function that the entry shader's WGSL declares: the
shader composer resolves each module's imports, and the entry is the outermost module, so the import
would close a cycle.

| Option | Verdict |
| --- | --- |
| A: the main directional light alone | Chosen. It is the glint source of the first user, and it covers the sun of the showroom and of an outdoor scene |
| B: move the clustered loop into the entry shader | Rejected. `line.wgsl` calls the same function, and the move is a larger change than the hook |
| C: a compiler feature that lets a library module call a function of the entry | Rejected. It changes the shader composer for one hook |
| D: an engine-side glint model | Rejected for M3-B5. The plan makes the glints the add-on's technique, not a core feature |

The limit is documented, so a reader does not assume glints from every light:
`docs/shaders/surface-functions.md` names it, and `docs/api/materials.md` repeats it.

## Cost

- A material that declares no lobe pays nothing: no call, no record and no build.
- A material with a lobe pays one function call for each pixel of the main light, inside the shading
  the engine already does. The call reads values that the shading holds.
- The first user's cost per preset is owed, and D-255 names the command that measures it.

## Consequences

- Code: the hook table and its signature check in `crates/null3d-shaders/src/material.rs`; the
  `LobeInput` record, the `Surface.lobe` field and the call in `crates/null3d-shaders/wgsl/lit.wgsl`;
  the plugin's function names in `packages/vite-plugin/src/wgsl.ts`; the error texts of E1215.
- Tests: `crates/null3d-shaders/tests/material.rs` builds a material with a lobe into every variant
  and refuses a wrong signature. It also builds the car paint's shipped WGSL on WebGPU and WebGL2.
  `packages/vite-plugin/src/wgsl.test.ts` builds a lobe on its own.
- Docs: `docs/shaders/surface-functions.md` has "A material's own lobe", with the input table and the
  limit. `docs/api/materials.md`, `docs/guides/custom-shaders.md` and the develop skill name the
  function.
- Pictures: `tests/image/car-paint.spec.ts` measures pixels that grow brighter with the flakes than
  without them, so the glints draw. D-255 records its runs in both reference sets.
- M3-B5 declares the lobe for its flakes, as D-255 records. M3-B5's own cost per preset is owed.

## Runs

The GPU check's line for the hook is the one that commit dd2bcab87 records:

`GPU-Checked: 9369b1380..c307ddad6 not judged: s4 medium 4.24 to 4.20 ms (+3.0%); s6 medium 4.69 to 4.61 ms (-4.3%); s4 high 4.54 to 2.24 ms (-38.1%); s6 high 6.51 to 6.70 ms (+10.3%); the benchmark pages changed between the commits`

The measured tip, c307ddad6, contains this task's commit 766387e0e. The check says not judged because
the benchmark pages changed between the two builds. The guide says such a line still gives the
figures, and a reviewer judges them.

The line does not measure the branch's final code, because GPU-path commits follow c307ddad6. A
further `bun run bench:gpu-check` of the final code is therefore owed. No record holds a timing
run of the hook alone. Its code enters only the builds of materials that declare a lobe, and the
benchmark scenes declare none.

The build tests are `cargo test -p null3d-shaders --test material`: a lobe in every variant, a wrong
signature refused, and the car paint on both paths. That test passed 33 of 33 on the Mac for commit
`7a5cd7a86`, and its log is not kept.
