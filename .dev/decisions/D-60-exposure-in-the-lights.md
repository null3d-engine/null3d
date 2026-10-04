# D-60: Exposure in the lights, and light units

Status: decided. Date: 2026-10-04. Task: M2-E6.

## Question

Where does the exposure scale the scene's color, so that scenes in real units stay inside the range of a 16-bit float? And how do the new inputs, `post.set({ ev100 })` and the lights' `intensityUnit`, combine with three.js's units? Ports keep those units ([D-52](D-52-intent-parity.md)).

## Rule

- The picture of every scene stays the same: the image tests keep their references, and the strict parity tests against three.js stay strict.
- A scene in real units, a sun of 100,000 lux at EV100 15, stores values near 1. It draws no black pixels, and bloom glows, on CI's software GPU.
- Nothing allocates per frame. A sketch may change the exposure every frame, so a change must not make the core rewrite per-material data.

## Data

Before this record, the final pass multiplied the scene color by the exposure. The scene color held the light before the exposure, in an `rgba16float` target, whose largest value is 65,504.

| Case | Value before the exposure | Exposure | Stored before | Stored now |
| --- | --- | --- | --- | --- |
| White rough surface facing a sun of 100,000 lux | 100,000 / π = 31,831 | 2.54e-5 (EV100 15) | 31,831 | 0.81 |
| The sun's highlight on smooth metal at the roughness floor, about 42,000 times the irradiance | 4.2e9 | 2.54e-5 | 65,472 after the color limit of M2-R12, so the canvas shows 1.66 before the tone curve: gray, not white | 107,000, limited to 65,472: white |
| An emissive sphere of 1,000,000 nits | 1,000,000 | 2.54e-5 | 65,472, so 1.66 | 25.4 |

Everything before the tone curve is linear. So multiplying the exposure into each light gives the same picture as multiplying the sum at the end. Only the rounding of 32-bit floats differs.

How the data was produced: the formulas of the standard material, and Filament's exposure, `1 / (1.2 × 2^EV100)`. The image tests `real-units` and `real-units-exposure` and their pixel spec (`tests/image/real-units.spec.ts`) check it on every tier.

Results on 5 October 2026, on the Mac's GPU and on SwiftShader:

| Check | Before (the shading branch, M2-R12) | After |
| --- | --- | --- |
| `real-units-exposure` on SwiftShader, each of the 3 tiers | The highlight and the glowing sphere draw 238 of 255, not white. The glow near the highlight is 54, under its floor of 60. 7.2% to 7.5% of the pixels differ from the reference | Passes. The image matches `real-units`, drawn with `ev100` and light units, to the pixel |
| Image tests on the Mac's GPU | | 516 of 516 pass |
| Image tests of the changed areas on SwiftShader | | 202 of 202 pass |
| Parity with three.js | | 129 of 129 comparisons pass, as strict as before |
| Allocation check, WebGPU and WebGL2 | | Both pass |

## Decision

### Where the exposure applies

The core multiplies the exposure into every light on the CPU, as the light gather reads them each frame. That covers the main directional light, the ambient lights, and each point and spot light. The background color and the fog color take it in the same way. Filament and Godot do the same.

Colors that come from materials and textures take the exposure in the shader, from the frame's values. These are emissive light, light maps, unlit colors, sprites, lines, debug lines and the background texture. Filament exposes emissive light in its shader in the same way. A change of exposure then rewrites one frame value, not every material row.

The tone curve and the final pass apply no exposure: the final pass's exposure is 1. A full custom shader's `finish` keeps its meaning. It takes color in the scene's units and applies the exposure. The engine's own templates call `finish_exposed`.

### EV100 and the exposure multiply

`post.set({ ev100 })` sets the camera's exposure, `1 / (1.2 × 2^EV100)`. Filament, Bevy, Godot and HDRP compute it so. The `exposure` setting keeps three.js's meaning and multiplies it, as exposure compensation does; Godot multiplies the same way. The default, `ev100: false`, leaves three.js's units. A port that sets only `exposure` sees no change.

### Light units

Intensities stay in three.js's units by default: candela for point and spot lights, and lux for the others. `intensityUnit: 'lumen'` on a point light divides by 4π. On a spot light it divides by π at any cone angle, as three.js's `power` and Filament's `SPOT` do. The unit `'lux'` on directional, hemisphere and ambient lights names three.js's own unit, so it changes nothing. A unit that the kind of light does not take throws E1213. glTF lights stay in candela and lux, as `KHR_lights_punctual` specifies.

### Bloom's threshold is multiplied by the exposure

The threshold keeps three.js's meaning: luminance before the exposure. `UnrealBloomPass` compares it before `OutputPass` exposes the picture. The scene color now holds exposed color. So the bright pass compares against the threshold times the exposure, and its soft edge, three.js's `smoothWidth` of 0.01, scales the same way.

An example: a pixel of luminance 2, a threshold of 1 and an exposure of 0.5.

| | Pixel | Threshold | Glows |
| --- | --- | --- | --- |
| three.js | 2 | 1 | Yes, by a margin of 1, which `OutputPass` then exposes to 0.5 |
| null3D, threshold multiplied | 2 × 0.5 = 1 | 1 × 0.5 = 0.5 | Yes, by a margin of 0.5: three.js's exposed glow |
| null3D, threshold divided | 1 | 1 / 0.5 = 2 | No |

The plan's wording for this task said "divided by the exposure", which was wrong for that reason. M2-R12's limit on bloom's input now applies to exposed color.

## Consequences

- `LightTable::gather` takes the frame's exposure, and `Fog::uniform` takes it too. `SceneColor::clear_color` exposes the background. `Output::tone_map` became `Output::expose`, and `FinalPass::prepare` takes only the tone mapping. Bloom's bright pass takes the exposure through `Bloom::bright_pass`.
- `null3d::tonemap::tone_map` takes exposed color, and the final pass's FXAA weights no longer read the exposure. `null3d::mesh` adds `exposed` and `finish_exposed`. The standard material's template imports `finish_exposed` in place of `finish`. A surface function may now declare `finish`, and may not declare `finish_exposed`.
- A scene in real units shows its background color and unlit colors black. three.js does the same at that exposure, since those colors are in the scene's units too.
- Docs: `concepts/lighting` (units and exposure), `api/lights`, `api/post`, `concepts/post-processing`, `concepts/color-management`, `shaders/surface-functions` and `guides/custom-shaders`. The mapping entries of `toneMappingExposure` and of the lights' `power` changed too. Skills: the porting skill's notes on lights and exposure, and the develop skill's reserved shader names.
