# D-304: a normal for the sky's light, and occlusion counted once, in custom surfaces

Status: decided and built. The owner approved both hooks for the plant core's light path. A third
hook, a size limit on loaded textures, is not built: phones load separate half-size files instead.
Task: none.

Summary: a custom surface may name `s.ambientNormal`, a normal for the sky's light alone. It may
also name `s.occlusionByMinimum`, which joins its occlusion with ambient occlusion by the smaller
value. Each field adds a shader def only where WGSL names it. All 8,138 engine shader modules and
all 11,468 builds of 21 custom materials keep their exact text.

## Question

A plant's leaf needs two things from the engine. First, sky light should come from a bent normal
toward the open sky, while the sun keeps the leaf's own normal. Second, a crown's occlusion is baked
from its own leaves. Screen-space ambient occlusion sees the same leaves, so their product darkens
the crown twice where a preset draws ambient occlusion. How does the engine offer both to any
material, at no cost to the materials that do not use them?

## Rule

- A material that does not name a hook builds the same text and draws the same pixels as before.
- A hook adds no permutation bit, so a material that names it keeps its count of builds.
- WebGPU, compatibility mode and WebGL2 act alike, from the one WGSL.
- Each hook is public, so another developer's add-on can use it (rule 12 of "Parity with three.js
  and add-on modules").

## Data

| Measure | Before | After |
| --- | --- | --- |
| Engine shader modules that `bun run shaders` writes | 8,138 | 8,138, each byte for byte the same |
| Builds of the 18 custom materials of the repository and 3 samples | 11,468 | 11,468, the same text |
| Builds of a material that names either field | a plain material's builds | the same names and permutation words |

How the data was produced:

- The machine is an Apple M5 Max. The runs are at `ca32544c` and again with the change.
- The engine's figure is the SHA-256 of every file that `bun run shaders` writes into
  `packages/engine/src/generated`.
- Each material's figure is a hash of the debug text of its whole output from the shader
  compiler's `compile_material`. That text holds every WGSL and GLSL build.
- The 18 materials are every WGSL file of the repository that declares a hook function. The 3
  samples are a plain surface, a surface with `diffuseNormal` and light through it, and a surface
  with a coat, alpha and transmission.
- The third row comes from the shader crate's unit tests for the two fields. They compare each
  build's name and permutation word with a plain material's.

The browser test `tests/image/light-hooks.spec.ts` draws each case on all three tiers. It compares
the pictures pixel by pixel, and each picture holds 57,600 pixels. The figures below are from Chrome
on the Mac's GPU. A run on SwiftShader with `CI=1` on the same Mac gives figures within a few
hundred pixels of these, with the same zeros.

| Case | WebGPU | Compatibility | WebGL2 |
| --- | --- | --- | --- |
| Sky normal named at its default, against none (hemisphere, room) | 0, 0 | 0, 0 | 0, 0 |
| Sky normal turned up, hemisphere: pixels lighter, darker | 11,059, 0 | 11,064, 0 | 11,107, 0 |
| Sky normal turned up, room environment: pixels changed | 11,281 | 11,276 | 11,280 |
| Sky normal turned up, sun alone: pixels changed | 0 | 0 | 0 |
| Diffuse normal turned up, sun alone: pixels changed | 11,502 | 11,483 | 11,487 |
| Ambient occlusion on against off: pixels changed | 26,535 | 25,824 | 25,652 |
| Minimum named and false, against none | 0 | 0 | 0 |
| Minimum set: pixels lighter, darker | 18,204, 0 | 19,671, 0 | 19,671, 0 |
| Minimum set, ambient occlusion off: pixels changed | 0 | 0 | 0 |

## Look

The hooks change only the materials that name them. With them, a leaf inside a crown takes its sky
light from the gaps above it. Its baked shade also does not double where ambient occlusion draws.
Without them, the plant must bend `s.diffuseNormal`, which bends the sun's light too. A sunlit leaf
then lights by the crown's shape and loses the light on its own face. The product also leaves a
crown darker on High and Ultra, where ambient occlusion draws, than on Low and Medium. So the hooks
give the better look.

## Decision

Both hooks are fields of the surface that the shader compiler finds by name, as it finds
`s.diffuseNormal`. Naming one adds a shader def to that material's builds: `CUSTOM_AMBIENT_NORMAL`
or `CUSTOM_OCCLUSION_MINIMUM`. Only under that def does the template declare the field, set its
default in `defaultSurface` and act on it. So the text of every other build stays as it was.

- `ambientNormal` starts as the mesh's normal. It lights the ambient and hemisphere lights and the
  environment's diffuse light. It also lights the diffuse light of the reflection probes and the
  probe grid. For that light it takes the place of `diffuseNormal`. The sun keeps `diffuseNormal`.
  The other direct lights, the specular light, the reflection and the light through the surface
  keep `normal`.
- `occlusionByMinimum` starts false. When it is true, the lighting reads `min(s.occlusion, screen)`
  in place of `s.occlusion * screen`. Both values measure how much of the sky reaches the point.
  Where one already holds the other's occluders, the product counts those occluders twice. The
  smaller value is then the better measure. The specular occlusion and the light through a thin
  surface read the same joined value.

Options rejected:

- A material option, `occlusion: 'min'`, in TypeScript. The option would reach the shader as a flag
  in the material row or as a permutation bit. A flag puts a select into every lit build. Every
  build's text then changes, and every pixel pays for the select. A bit doubles the builds of a
  material that sets it, and takes a value of the permutation word (hard rule 27). The field is a
  choice that the material's own builds make when they compile.
- Bending `s.diffuseNormal` for the sky's light. It bends the sun's diffuse light too.
- A blend between the product and the minimum by a share of overlap. The owner approved the
  minimum, and no material needs a share between the two.
- Making `s.diffuseNormal` light the environment's diffuse light as well. In a build that names
  `diffuseNormal` alone, the environment, the probes and the probe grid light by `normal`. A change
  would redraw every picture of the current plant shaders that an environment lights. Instead,
  `ambientNormal` lights that light by a normal of its own. The surface functions page says which
  lights each normal reaches.

## Consequences

- `crates/null3d-shaders/wgsl/lit.wgsl` declares and uses both fields under their defs.
  `crates/null3d-shaders/src/material.rs` keeps one table of the surface's named fields and their
  defs, `diffuseNormal` among them.
- The shader crate's tests check three things. Each field reaches every shading build that names
  it and no other. It adds no build. A swaying, cut-out leaf that names both fields builds its
  caster, motion and pick builds. `tests/image/light-hooks.spec.ts` checks the pixels on every tier.
- `docs/shaders/surface-functions.md` gains both fields and a section for each. It also says which
  lights `diffuseNormal` reaches. `docs/api/materials.md` and the develop skill's quick reference
  and shader reference name the fields.
- The plant core's material sets both: the crown's bent normal in `ambientNormal`, and its baked
  visibility in `occlusion` with `occlusionByMinimum` true.
