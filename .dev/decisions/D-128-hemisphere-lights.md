# D-128: Hemisphere lights light surfaces, summed into the frame's values

Status: decided. Date: 2026-10-10. Task: M2-EX12.

Summary: Hemisphere lights now light standard materials and lit lines on every GPU path, with three.js's `HemisphereLight` blend. The core sums any number of them, each frame, into the ambient light and one color per world axis. The frame's values grow by 48 bytes, to 560, and each pixel pays three multiply-adds, with or without hemisphere lights. Their light adds to an environment's light, as in three.js, and neither the environment's intensity nor a material's `envIntensity` scales it.

## Question

`scene.createHemisphereLight` was documented, and it returned a light, but no GPU path drew its light. A demo that relied on it for fill got none. How does the engine draw any number of hemisphere lights, whose colors and intensities change in every frame? And how does it keep the cost near zero when a scene has none? And how does their light combine with an environment's?

## Rule

- Intent parity with three.js ([D-52](D-52-intent-parity.md)): the same blend from the ground color to the sky color, diffuse only. The parity scenes pass three.js's image rule.
- Any number of lights, and changes in every frame, with no allocation and no new shader build.
- No measurable GPU time in a scene without hemisphere lights.
- The rule for environments matches three.js's, and the docs state it.

## Options

three.js's `getHemisphereLightIrradiance` blends `mix(ground, sky, 0.5 * dot(n, up) + 0.5)`. That is `(sky + ground) / 2 + dot(n, up) * (sky - ground) / 2`: a constant, plus a term that is linear in the normal. A sum of such lights is again a constant and a linear term. The linear term is one color for each world axis, so three colors in all.

| Option | Per pixel | Frame values | Verdict |
| --- | --- | --- | --- |
| A: a list of lights in a buffer, looped in the shader, as three.js loops its uniform array | A loop over the lights: a load, a dot product and a mix each | A count and a list | Rejected. The cost grows with the lights, and the loop needs a buffer or a fixed array size per shader build |
| B: sum on the CPU into the ambient color and three axis colors | Three multiply-adds | 48 bytes more | Chosen |
| C: B's three colors in the spare fourth floats of other frame values, such as the environment's coefficients | Three multiply-adds | No growth | Rejected. Nine floats spread over unrelated fields are hard to read and to keep right, to save 48 bytes per view |
| D: as A or B, behind a shader define, so scenes without hemisphere lights build without the code | None without lights | As B | Rejected. A new build bit doubles the pipelines that can exist, and a light added during play would build new pipelines. Three multiply-adds cost less than the branch that would skip them |

The constant part of each light joins the ambient sum, which the shaders already add. So the shaders add `ambient + n.x * X + n.y * Y + n.z * Z`. Without hemisphere lights, the three colors are zero, and the sum is the ambient light, bit for bit.

The frame's values were full at 512 bytes. The three colors go at their end, so the offsets of every older field stay. On WebGL2, a frame's slot in the ring of frame values aligns its next part to 256 bytes. So the slot's part before the cell offsets grows from 512 to 768 bytes. That is 256 bytes of GPU memory per slot.

## Environments

three.js adds the hemisphere lights' irradiance to the ambient light and the light probes, in `irradiance`. It adds an environment map's diffuse light separately, as `iblIrradiance`. Both reach the surface's diffuse light, so the two add up. `scene.environmentIntensity` and a material's `envMapIntensity` scale only the map's part. Ambient occlusion, from the occlusion map, darkens both.

The engine does the same. The hemisphere lights join the ambient light. The environment's light, from a file, the built-in room or the sky's environment, adds after it, times the environment's intensity and the material's `envIntensity`. The occlusion map and the frame's ambient occlusion darken all of it. The shader does not know where an environment came from, so the rule is the same for each. A scene lit by the sky's environment already has the sky's light, so it needs no hemisphere light.

Some views have no copy of the opaque colors. There, without an environment, surfaces that let light through take the light behind them from the ambient light. They now take the ambient and hemisphere light along the refracted ray.

## Data

Parity with three.js r186, by three.js's image rule (under 0.1% of pixels), on 10 October 2026. The figures give the share of pixels that differ from three.js's page on the same GPU path.

| Scene | WebGPU | Compatibility mode | WebGL2 | three.js's two renderers | Device |
| --- | --- | --- | --- | --- | --- |
| `lights-hemisphere`: one hemisphere light and a dim ambient light | 0.000% | 0.000% | 0.000% | 0.020% | MacBook Pro (Apple M5 Max), Chrome |
| The same | 0.000% | 0.000% | 0.000% | 0.014% | SwiftShader, Playwright's Chromium |
| `environment-room-hemisphere`: the room and a hemisphere light | 0.008% | 0.284% | 0.008% | 0.334% | MacBook Pro, Chrome |
| The same | 0.009% | 0.271% | 0.008% | 0.356% | SwiftShader |
| `environment-room`, without the hemisphere light, for comparison | 0.008% | 0.269% | 0.008% | 0.316% | MacBook Pro, Chrome |

Compatibility mode's figures with the room pass because three.js's two renderers differ more. They come from the room, not from the hemisphere light: the room alone gives the same figures.

The `lights-hemisphere-split` test draws the light as two halves, one upside down with its colors swapped, set in every frame. It matched the single light's references on all three paths, on the Mac's GPU and on SwiftShader.

How the data was produced: `bun run parity -- --scene lights-hemisphere,environment-room-hemisphere,lights-16,environment-room` on the Mac, and the same with `CI=1` for SwiftShader. `bun run test:images` on both sets: 9 of 9 hemisphere tests pass on the Mac, and 106 of 106 tests of lights, materials, environments, lines, transmission, reflections and time of day pass on SwiftShader. The shader library test passes on both, with `ambient_irradiance` among its cases.

## Decision

Option B. The core sums the hemisphere lights in the frame's light pass (`LightTable::gather`), with the ambient lights. Each light's sky lies along its object's +Y axis, of length 1 whatever the object's scale. The renderer carries the three colors to every view's frame values: the camera's, scene passes' and reflection passes'. The lit material, lit lines and the refraction fallback add them through `ambient_light` in `null3d::mesh`, which calls `ambient_irradiance` in the shader library.

## Consequences

- `docs/api/lights.md` and `docs/concepts/lighting.md` describe hemisphere lights and the rule for environments, and drop the note that they do not light yet. The three.js mapping and both skills follow.
- The image tests add `lights-hemisphere`, `lights-hemisphere-split` and `environment-room-hemisphere`. The parity list compares the first and the last with three.js.
- Every shader that declares the frame's values carries the three new fields. After Brotli, the WebGPU builds of the lines grew by 150 bytes (2.3%), and the small texture coordinate builds by 67 to 72 bytes (2.8% and 3.9%). Every other file grew by less than 2%.
- `bun run bench:allocation --hemisphere` samples S1 with two hemisphere lights whose intensities change in every frame.
- three.js points a hemisphere light's sky from its position toward the origin. null3D points it along the light's +Y axis, as before this record. A port turns the light where three.js moves it.
