# D-252: A material's own specular lobe

Status: decided by the helper of M3-E7 on 25 October 2026, for the owner's review. Built: the hook,
the input record and both GPU paths through the WGSL-to-GLSL step. First user: M3-B5's glints.
Date: 2026-10-25. Task: M3-E7.

Summary: A custom material declares `fn lobe(input: LobeInput) -> vec3f`. The engine calls it for the
main directional light and adds the color it returns to that light's specular. The surface function
passes its own four values through `Surface.lobe`. Point, spot and area lights keep the base lobe.

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

- The engine calls the hook once for the main directional light, after it computes that light's base
  specular. The hook's return value adds to that specular.
- The input record gives the normal, the view, the light, the half vector, the filtered roughness,
  the reflectance at normal incidence, the base specular, the light's irradiance and the surface
  function's four values.
- A material that declares no lobe has no call, no input record and no new build. The hook's shader
  def joins the builds of the material that declares it, as a vertex offset's does.
- Both GPU paths draw it. The hook is WGSL in the material's own function; the WGSL-to-GLSL step
  compiles it for WebGL2.

## The main light alone

The engine's clustered point, spot and area lights draw in `null3d::lights::clustered_light`, a
library module. A library module cannot call a function that the entry shader's WGSL declares: the
shader composer resolves each module's imports, and the entry is the outermost module, so the import
would close a cycle.

| Option | Verdict |
| --- | --- |
| A: the main directional light alone | Chosen. It is the glint source of the first user, and it covers the sun of the showroom and of an outdoor scene |
| B: move the clustered loop into the entry shader | Rejected now. `line.wgsl` calls the same function, and the move is a larger change than the hook |
| C: a compiler feature that lets a library module call a function of the entry | Rejected. It changes the shader composer for one hook |
| D: an engine-side glint model | Rejected for M3-B5. The plan makes the glints the add-on's technique, not a core feature |

The limit is documented, so a reader does not assume glints from every light:
`docs/shaders/surface-functions.md` names it, and `docs/api/materials.md` repeats it.

## Cost

- A material that declares no lobe pays nothing: no call, no record and no build.
- A material with a lobe pays one function call for each pixel of the main light, inside the shading
  the engine already does. The call reads values that the shading holds.
- The first user records its cost per preset with its own pictures.

## Consequences

- Code: the hook table and its signature check in `crates/null3d-shaders/src/material.rs`; the
  `LobeInput` record, the `Surface.lobe` field and the call in `crates/null3d-shaders/wgsl/lit.wgsl`;
  the plugin's function names in `packages/vite-plugin/src/wgsl.ts`; the error texts of E1215.
- Tests: `crates/null3d-shaders/tests/material.rs` builds a material with a lobe and refuses a wrong
  signature; `packages/vite-plugin/src/wgsl.test.ts` builds a lobe on its own.
- Docs: `docs/shaders/surface-functions.md` has "A material's own lobe", with the input table and the
  limit. `docs/api/materials.md`, `docs/guides/custom-shaders.md` and the develop skill name the
  function.
- Owed at landing: the `GPU-Checked:` line from `bun run bench:gpu-check`, and the first user's
  pictures, which M3-B5 redraws. The machine ran near a load of 100 on 25 October 2026, where
  neither run measures anything.
- Next: M3-B5 declares the lobe for its flakes. M3-E7's Done when needs that user, so the two tasks
  close together.
