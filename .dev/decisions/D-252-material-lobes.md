# D-252: A material's own specular lobe

Status: decided by the helper of M3-E7 on 25 October 2026, for the owner's review. Widened on
26 October 2026 after the audit of that task. Built: the hook, the input record, and both GPU paths
through the WGSL-to-GLSL step. The hook answers the main directional light and each point and spot
light. First user: M3-B5's car paint, whose glints declare it. Date: 2026-10-25, addendum
2026-10-26.

Summary: A custom material declares `fn lobe(input: LobeInput) -> vec3f`. The engine calls it for the
main directional light and for each point and spot light that reaches the surface. It adds the color
it returns to that light's specular. Area lights keep the base lobe, because their light is an
integral over the light's area.

## Question

D-173's hook H4 lets a custom material add a specular lobe beside the base lobe. M3-B5's car-paint
glints are its first user ([D-179](D-179-technique-rulings-2026-10-15.md), ruling 17). A glint model
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

- The engine calls the hook once for the main directional light, and once for each point and spot
  light of the surface's cluster. It calls the hook after it computes that light's base specular, and
  the return value adds to that light's specular.
- The input record gives the normal, the view, the light, the half vector, the filtered roughness
  and the reflectance at normal incidence. It also gives the base specular, the light's irradiance
  and the surface function's four values.
- A material that declares no lobe has no call, no input record and no new build. The hook's shader
  def joins the builds of the material that declares it, as a vertex offset's does.
- Both GPU paths draw it. The hook is WGSL in the material's own function; the WGSL-to-GLSL step
  compiles it for WebGL2.
- Area lights keep the base lobe. Their light is an LTC integral, and the glint model needs the
  area light's form of the paper ([D-179](D-179-technique-rulings-2026-10-15.md)).

The engine owns the hook and the add-on owns the model. The engine declares the hook, the input
record and the call. No flake or sparkle appears in the hook's name or its record, because the
add-on's WGSL writes the whole model.

## Look

The first user's own scenes light the car with a point light as well as the sun. The Showroom has a
blue lamp that follows the pointer, and the test page has a blue-white lamp. The paint's lobe removes
the smooth highlight wherever its flakes miss. The sun alone would therefore leave the paint
sparkled under it, and smooth under the lamp of the same scene. The wider hook looks better, and hard
rule 40 requires it. It costs one lobe call for each light of a surface's cluster, inside the shading
that the engine already does. Area lights stay smooth, which the first user's scenes do not use.

## Every direct light

The engine's clustered point, spot and area lights draw in `null3d::lights::clustered_light`, a
library module. A library module cannot call a function that the entry shader's WGSL declares. The
composer resolves each module's imports, and the entry is the outermost module, so the import would
close a cycle.

| Option | Verdict |
| --- | --- |
| A: the main directional light alone | Rejected on 26 October 2026. It drops a visual effect to save work, which hard rule 40 forbids, and the paint then glints under one light of its own scene |
| B: move the clustered loop into the entry shader | Rejected. `line.wgsl` calls the same function, and the move would hold two copies of the loop |
| C: a virtual function in the library that the entry shader overrides | Chosen. The composer already resolves it, so no module calls another module's function |
| D: an engine-side glint model | Rejected for M3-B5. The plan makes the glints the add-on's technique, not a core feature |

Option C, as built:

- `lib/lights.wgsl` declares `virtual fn custom_lobe(normal, view, light, roughness, f0, specular,
  irradiance, values) -> vec3f`, which returns zero.
- Its loop calls the function after each light's base specular, under the shader def CUSTOM_LOBE.
- The lit template declares `override fn null3d::lights::custom_lobe` in the same def. Its body calls
  the material's `lobe` with a `LobeInput`, so the lobe sees that light's direction, irradiance and
  base specular.
- A build without CUSTOM_LOBE makes no call, and the build's compaction drops the unused function. A
  material without a lobe pays nothing.

The composer leaves its own marker in the name of an overriding function, such as
`custom_lobeX_naga_oil_vrt_X...`. The shader build takes that marker off with the module markers
(`crates/null3d-shaders/src/names.rs`), so the emitted WGSL and GLSL name the function
`custom_lobe`.

## Cost

- A material that declares no lobe pays nothing: no call, no record and no build.
- A material with a lobe pays one function call for each light of each pixel's cluster, inside the
  shading the engine already does. The call reads values that the shading holds.
- The first user's cost per preset is owed, and D-255 names the command that measures it.

## Consequences

- Code: the hook table and its signature check in `crates/null3d-shaders/src/material.rs`; the
  `LobeInput` record, the override and the call in `crates/null3d-shaders/wgsl/lit.wgsl`; the
  virtual function and the per-light call in `crates/null3d-shaders/wgsl/lib/lights.wgsl`. The
  extra argument of `clustered_light` follows in `line.wgsl`, and the override marker in
  `crates/null3d-shaders/src/names.rs` and `library.rs`. The plugin's function names are in
  `packages/vite-plugin/src/wgsl.ts`, and the error texts of E1215 changed with them.
- Tests: `crates/null3d-shaders/tests/material.rs` builds a material with a lobe into every
  variant. It counts the two calls that reach the lobe in the WGSL and in the GLSL of each build.
  It refuses a wrong signature, and builds the car paint's shipped WGSL on WebGPU and WebGL2.
  `packages/vite-plugin/src/wgsl.test.ts` builds a lobe on its own. `tests/image/car-paint.spec.ts`
  measures glints under a point light and under a spot light with the main light out, on every GPU
  tier.
- Docs: `docs/shaders/surface-functions.md` holds the lobe's section, with the input table and the
  limit. `docs/api/materials.md`, `docs/guides/custom-shaders.md` and the develop skill name the
  function. `docs/guides/car-paint.md` and the add-on's README describe the glints under each light.
- Pictures: `tests/image/car-paint.spec.ts` measures pixels that grow brighter with the flakes than
  without them, so the glints draw. Its second test turns the main light out, and counts 182
  brighter pixels under the point light and 171 under the spot light, on WebGPU, compatibility mode
  and WebGL2. The paint's references moved, and [image tests](../image-tests.md#references) records
  the shares and the commands.
- Next: M3-B5 declares the lobe for its flakes, as D-255 records. M3-B5's own cost per preset is
  still owed.

## Runs

The build tests are `cargo test -p null3d-shaders --test material`: a lobe in every variant with both
calls present, a wrong signature refused, and the car paint on both paths. CI run 40222451866 passed
those tests in its rust-tests jobs, and its browser shards drew the paint's glints on WebGPU,
compatibility mode and WebGL2.

The GPU check's line for the hook is the one recorded by commit dd2bcab87, taken on 25 October 2026:

`GPU-Checked: 9369b1380..c307ddad6 not judged: s4 medium 4.24 to 4.20 ms (+3.0%); s6 medium 4.69 to 4.61 ms (-4.3%); s4 high 4.54 to 2.24 ms (-38.1%); s6 high 6.51 to 6.70 ms (+10.3%); the benchmark pages changed between the commits`

The measured tip, c307ddad6, contains this task's commit 766387e0e. The check says not judged because
the benchmark pages changed between the two builds. The guide says such a line still gives the
figures, and a reviewer judges them.

The line does not measure the branch's final code, because GPU-path commits landed after c307ddad6.
A further `bun run bench:gpu-check` is therefore owed before the landing. No record holds a timing
run of the hook alone. Its code enters only the builds of materials that declare a lobe, and the
benchmark scenes declare none.
