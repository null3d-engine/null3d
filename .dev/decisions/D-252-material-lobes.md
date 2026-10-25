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

## The half vector of a light behind the surface

The lobe reads a half vector, which the engine works out from the light and view directions. Those
two directions cancel when a light lies on the far side of the surface, on the eye's own line. Then
the sum has no direction, and `normalize` of it gives a NaN. `lobe_half` in `lit.wgsl` uses the
surface's normal in that case, so the lobe draws a finite color.

No picture on this branch proves that guard. The cancellation holds exactly along one line, and that
line meets a convex body at one point, so no pixel is sure to land on it. The test page's body shows
the margin: on the line the sum is zero, and five millimetres off it the sum is 2.7e-3, where the
guard waits for 1e-4. A lamp at the camera is the other direction and not this case, because its
light and the view then point one way.

An orthographic camera and a flat panel would make the whole panel cancel, with a light along the
view. That picture cannot separate the guard either. The engine's own specular works out the same
half vector without a guard, so the panel would draw a NaN with the guard and without it.

The engine's own specular paths therefore keep their raw `normalize`: `brdf_ggx` and
`brdf_ggx_physical` in `lib/lighting.wgsl`, and the coat and sheen of `lib/coat_sheen.wgsl`. The
anisotropic branch of `brdf_ggx_physical` also passes its tangent and bitangent cosines without
`saturate`, where the cosine of the normal takes it. Repairing those reaches every lit picture in
the repository, so it is not a change for this task. The engine's owner list holds the fault, with
the lobe guarded and these paths not, and this section gives the arithmetic behind that entry.

## Cost

- A material that declares no lobe pays nothing: no call, no record and no build.
- A material with a lobe pays one function call for each light of each pixel's cluster, inside the
  shading the engine already does. The call reads values that the shading holds.
- The first user's cost per preset is owed, and D-255 names the command that measures it.

## Consequences

- Code: the hook table and its signature check in `crates/null3d-shaders/src/material.rs`; the
  `LobeInput` record, the `lobe_half` guard, the override and the call in
  `crates/null3d-shaders/wgsl/lit.wgsl`; the virtual function and the per-light call in
  `crates/null3d-shaders/wgsl/lib/lights.wgsl`. `clustered_light` takes the surface's four values
  only in the CUSTOM_LOBE builds, so `line.wgsl` and every other caller is unchanged. The override
  marker is taken off in `crates/null3d-shaders/src/names.rs` and `library.rs`. The plugin's
  function names are in `packages/vite-plugin/src/wgsl.ts`, and the error texts of E1215 changed
  with them.
- Tests: `crates/null3d-shaders/tests/material.rs` builds a material with a lobe into every
  variant. It counts the two calls that reach the lobe in the WGSL and in the GLSL of each build.
  It refuses a wrong signature, and builds the car paint's shipped WGSL on WebGPU and WebGL2.
  `packages/vite-plugin/src/wgsl.test.ts` builds a lobe on its own.
  `tests/image/car-paint.spec.ts` measures glints with the main light out, under a point light,
  under a spot light and under a lamp at the camera, which the sketch calls `lamp=eye`. That lamp
  sends its light back along the view, so the lobe reads a half vector equal to the view. It is the
  grazing end of the range, not the guard's case, which the next section records as unproven.
- Docs: `docs/shaders/surface-functions.md` holds the lobe's section, with the input table and the
  limit. `docs/api/materials.md`, `docs/guides/custom-shaders.md` and the develop skill name the
  function. `docs/guides/car-paint.md` and the add-on's README describe the glints under each light.
- Pictures: `tests/image/car-paint.spec.ts` measures pixels that grow brighter with the flakes than
  without them, so the glints draw. Its second test turns the main light out, and counts 182
  brighter pixels under the point light, 171 under the spot light and 166 to 168 under the lamp at
  the eye, the same on WebGPU, compatibility mode and WebGL2. The paint's references moved, and
  [image tests](../image-tests.md#references) records the shares and the commands.
- Next: M3-B5 declares the lobe for its flakes, as D-255 records. M3-B5's own cost per preset is
  still owed.

## Runs

On 26 October 2026, on the Mac, the branch's own code gave these results:

- `cargo test -p null3d-shaders --test material`: 33 passed, 0 failed. A lobe in every variant with
  both calls present, a wrong signature refused, and the car paint on both paths.
- `cargo test -p null3d-shaders --lib`: 91 passed, 0 failed.
- `tests/image/car-paint.spec.ts`: both tests passed. The part test drew 260 to 263 glints with the
  main light on, and the per-light test drew 182 under the point light, 171 under the spot light and
  166 to 168 under the lamp at the eye, on WebGPU, compatibility mode and WebGL2.
- The same per-light test passed on this Mac's SwiftShader: 184 under the point light, 173 under the
  spot light and 166 to 168 under the lamp at the eye. The part test drew 264 to 267 glints there.
- The paint's pictures moved by 0.418% to 0.677% of the pixels on the Mac's GPU, and by 0.425% to
  0.641% under SwiftShader, against a 0.1% limit. They still match after the `lobe_half` guard, which
  none of those scenes reaches. [Image tests](../image-tests.md#references) holds the figures per
  test and the commands that draw them again.

The plugin's `builds a lobe alone as a custom material` passed through the rebuilt shader compiler.
The rest of that suite met its own 30-second limit under a load near 90, including tests that this
task does not touch.

No CI run holds this code yet. The first run of the branch checks the SwiftShader picture set,
which this Mac drew.

The branch needs a `GPU-Checked:` line of its own, and the landing gate has not taken one on the tip
`c07dc10ea`. The line below is the hook's from before the task's own commits, so it cannot stand for
them. This record gives no line it did not measure.

The earlier line is the one recorded by commit dd2bcab87, taken on 25 October 2026:

`GPU-Checked: 9369b1380..c307ddad6 not judged: s4 medium 4.24 to 4.20 ms (+3.0%); s6 medium 4.69 to 4.61 ms (-4.3%); s4 high 4.54 to 2.24 ms (-38.1%); s6 high 6.51 to 6.70 ms (+10.3%); the benchmark pages changed between the commits`

The measured tip, c307ddad6, contains this task's commit 766387e0e. The check says not judged because
the benchmark pages changed between the two builds. The guide says such a line still gives the
figures, and a reviewer judges them.

The line does not measure the branch's final code, because GPU-path commits landed after c307ddad6.
A further `bun run bench:gpu-check` is therefore owed before the landing. No record holds a timing
run of the hook alone. Its code enters only the builds of materials that declare a lobe, and the
benchmark scenes declare none.
