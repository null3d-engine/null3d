# D-163: The shadow-catcher material reuses the lit template

Status: decided and built. Task: M2-E5.

Summary: `materials.shadowCatcher` draws only the main directional light's shadows, as three.js's `ShadowMaterial`. It is the lit template with a material row flag, so it adds no shader builds, templates or pipelines, and a page that draws shadows pays nothing new. The image test passes on all three tiers.

## Question

How does the engine draw a surface that shows only the shadows that fall on it, and how much new shader and pipeline machinery does that cost?

## Rule

The material must draw as three.js's `ShadowMaterial` does, with the engine's defaults, on WebGPU, WebGL2 and compatibility mode. The engine's design rules prefer the cheapest way that needs no new shader build for a page that does not use it: "do work once" and "pay only for what you use".

## Data

The lit template already computes the main directional light's shadow for a surface that receives shadows: `null3d::shadows::sun_shadow` in `light_surface`. The `RECEIVE_SHADOWS` builds carry that code, and every lit scene with a shadow-casting light already loads them.

| Measure | Reuse the lit template with a row flag | A new shading and template |
| --- | --- | --- |
| New shader builds | none | the lit fragment path, for each permutation |
| New render pipeline templates | none | one per GPU path, and its WebGPU/WebGL2 entries |
| New generated GPU constants | none | a template id |
| Cost to a page that never draws one | an unused branch on a value | the lit template stays; a new template would be added only if used |

How the data was produced: reading the shader manifest (`crates/null3d-shaders/shaders.toml`), the material table (`crates/null3d-render/src/materials.rs`) and the engine's pipeline tables (`packages/engine/src/gpu/webgpu/pipelines.ts`, `packages/engine/src/gpu/webgl2/programs.ts`) on main at `ecdd66a13`. The row flag sits beside `flag::FLAT_SHADING`, `flag::BLEND` and `flag::NO_FOG`, which the shaders already test at run time "with no cost worth a shader variant".

## Decision

`feature::SHADOW_CATCHER` (material feature 2097152) sets `flag::SHADOW_CATCHER` (row flag 128) in the material's flags word. `materials.shadowCatcher({ color, opacity })` creates a lit material with that flag and the `blend` alpha mode. `lit.wgsl`'s `shade` returns early for it, after every derivative call. `shadow_catcher` writes the material's color with alpha `opacity * (1 - sun_shadow)`, premultiplied. The exposure and the tone mapping apply, and the scene's fog does not. The mesh must set `receiveShadows`, as three.js requires `receiveShadow`; without a shadow-casting directional light the surface draws nothing.

## Consequences

- The branch reads the material's row. It sits after the lit fragment's derivatives (the specular anti-aliasing kernel, the alpha hash's threshold and alpha to coverage's width), because WebGPU rejects a derivative in control flow that depends on a material value: `dpdy` must run in uniform control flow. Everything the branch adds therefore comes after those reads.
- The surface shows the main directional light's shadow only. Point and spot light shadows are computed in the clustered-light path, which a shadow catcher skips. A later feature could add them.
- A surface that faces away from the sun draws nothing, where three.js may show a false shadow on it. A shadow catcher is a plane that faces the sun, so the images match in practice.
- The material takes no texture maps, and `color` and `opacity` are the values it uses. It is documented on `docs/api/materials.md`, the mapping turns `ShadowMaterial` onto it, and the skills mark it as built.
- An image test (`shadow-catcher`) draws on all three tiers, and the parity test compares it with three.js's `ShadowMaterial` twin.
