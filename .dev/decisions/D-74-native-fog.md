# D-74: Native fog

Status: decided, 2026-10-05. Date: 2026-10-05. Task: M2-E8.

## Question

null3D's fog copied three.js's: linear fog or exponential squared fog, by depth along the camera's view. [D-52](D-52-intent-parity.md) asks for the best technique by default, with three.js's look reached through the port. Decision 13 of [D-53](D-53-technique-defaults.md) names the target: one fog with radial distance, height and sun light, and a curve setting. How is it measured, how does height enter, where does the sun's light come from, and what does it cost?

## Rule

- A point keeps its fog as the camera turns. Fog at the screen's edges must not shift.
- A port of three.js's `Fog` and `FogExp2` keeps their curves and numbers.
- The fog mixes in linear color before the tone curve, as three.js's `WebGPURenderer` does.
- A scene without fog pays nothing, and the fog adds no shader build ([D-56](D-56-first-use-shader-files.md)).
- The frame's values keep their size, and every block stays laid out alike on every GPU path ([implementation notes](../implementation-notes.md#safaris-webgl2-path)).

## How other engines do it

| Engine | Distance | Height fog | Sun light |
| --- | --- | --- | --- |
| three.js | Depth along the view, per vertex | None | None |
| Unity URP, PlayCanvas | Depth along the view | None | None |
| Bevy | Straight-line distance | None in its distance fog | Each directional light, shadowed |
| Godot | Straight-line distance | Density at the surface point, joined with `max` | Fixed power of 8, unshadowed |
| Filament | Straight-line distance | Exact integral along the ray | Power that a setting gives, unshadowed |
| HDRP, Wicked | Straight-line distance | Exact integral along the ray | Not compared |

Depth along the view gives the same fog to every point on a plane that faces the camera. A point at the screen's edge lies farther away than its depth, so it takes too little fog. When the camera turns, the point's depth changes and its fog changes with it. Bevy's source says the same: the straight-line distance "remains consistent with camera rotation".

## Decision

### Distance

Fog measures each point's straight-line distance from the camera. The shaders already work in positions relative to the camera, so the distance is the length of that position: one square root per pixel. The fog no longer needs the camera's view direction, which left the frame's values.

### Curves

`curve` takes `'exponential'`, the default, `'exp2'` or `'linear'`:

- Exponential: 1 - exp(-density × d). Light through an even haze dims so, and Godot uses it by default.
- Exponential squared: 1 - exp(-(density × d)²), three.js's `FogExp2`.
- Linear: three.js's `Fog`, with its smooth step from `near` to `far`, not a straight ramp.

The port maps `Fog(color, near, far)` to the linear curve and `FogExp2(color, density)` to the exp2 curve, with the same numbers. The density's default is 0.01, Godot's: exponential fog then hides about two thirds of an object 100 units away. three.js's `FogExp2` default of 0.00025 is too thin to see in most scenes, and a port passes its own density.

### Height

The fog's density falls with height: density × exp(-falloff × (y - height)). The shaders integrate it exactly along each view ray, as Filament, HDRP and Wicked do. Take a ray from the camera at height y₀ that rises by r over a distance d. The fog it crosses equals that of a path through fog at the base density, of length

d × exp(-falloff × (y₀ - height)) × (1 - exp(-falloff × r)) / (falloff × r).

The first factor depends only on the camera, so the core computes it once a frame, for each view's camera. The shaders compute the second. The curve then takes this path in place of the distance, so height works with every curve. Without a falloff the path is the distance, and a branch on the frame's values skips the height terms.

Godot evaluates the density at the surface point and joins it to the distance fog with `max`. That gives a mountain top seen across a foggy valley no fog at all. The integral gives it the fog of the valley that the ray crosses.

Near r = 0 the formula divides 0 by 0, and in 32-bit floats it loses digits to cancellation below a product of about 0.01. There the shaders take the first three terms of its series, 1 - x/2 + x²/6, whose first missing term is under 1e-9. Each exponent is limited to 40, so each term stays finite and so does their product, which an exponent of 80 or more would not.

### Sun light

`sunGlow` scatters the main directional light toward the camera: the fog's color toward a point becomes

fog color + sun color × sunGlow × max(dot(view direction, direction toward the sun), 0)^sunGlowExponent.

The frame's values already hold the main directional light's direction and exposed color, which the lit shaders read. So the glow needs no new data: it follows the light, its intensity and the exposure. The glow mixes by the fog's factor, so it grows with the fog in front of a point, as Filament's in-scattering does. It is off by default, as in Godot, Bevy and Filament, because it is a look that a scene chooses. The exponent's default is 8, Godot's fixed value. Bevy darkens the glow with the sun's shadow map. That would need the shadow lookup in unlit shaders, sprites and lines, so null3D's glow, like Godot's and Filament's, is not shadowed.

### Where the fog mixes

The fog mixes into each fragment's exposed linear color, before the tone curve. three.js's `WebGPURenderer` does the same, and so does its `WebGLRenderer` when it draws into a half-float target. Only `WebGLRenderer`'s default 8-bit canvas mixes after the sRGB encoding. The mapping note said that three.js mixes after encoding everywhere, and now says where it does.

### The frame's values

The fog keeps 48 bytes. The first vector holds the color and the density. The second holds near, far, the falloff and the camera's density share. Then come the glow, its exponent, a spare and the curve. Two `vec4f` and four scalars lay out alike in WGSL, in GLSL's std140 and by ANGLE's Metal rules, so no block moves.

### Cost

The fog is a branch on the frame's values in the mesh templates, as ambient occlusion's reading and color grading are ([D-56](D-56-first-use-shader-files.md)). A permutation bit would double each mesh template's builds for a few lines of code.

`bun run build:check-size` measured the growth against main at df913098, after Brotli:

| Files | Before | After | Growth |
| --- | --- | --- | --- |
| The 4 WGSL start files | 22,202 to 23,008 bytes | 22,496 to 23,207 bytes | +0.6% to +1.6%, +128 to +349 bytes |
| The 8 GLSL start files | 20,013 to 21,018 bytes | 20,163 to 21,257 bytes | +0.7% to +1.3%, +150 to +260 bytes |
| The 8 GLSL morph files, which load on first use | 17,014 to 18,834 bytes | 17,244 to 19,230 bytes | +0.9% to +2.5%, +153 to +437 bytes |
| The 12 skin files, which load on first use | 17,592 to 20,898 bytes | 17,303 to 21,162 bytes | -1.6% to +1.6%, -289 to +289 bytes |
| The 6 line files, which load on first use | 6,042 to 8,064 bytes | 6,227 to 8,243 bytes | +2.2% to +3.1%, +173 to +200 bytes |
| The 6 sprite files, which load on first use | 3,265 to 5,018 bytes | 3,468 to 5,232 bytes | +4.3% to +6.2%, +197 to +247 bytes |
| The 2 WGSL files of the engine's own test template, which only test pages load | 1,672 and 2,555 bytes | 1,699 and 2,571 bytes | +1.6% and +0.6%, +27 and +16 bytes |
| The core, `null3d_bg.wasm` | 281,829 and 282,519 bytes | 282,033 and 282,927 bytes | +0.1% |

The fog's code is in every fragment shader of the mesh, line and sprite templates, so each build carries it. The fog adds about 150 to 450 bytes to each file after Brotli. So the small line and sprite files grow the most in percent. Joining the two exponential curves into one `exp` and folding the path into `fog_factor` kept the start files under 2%. The first version of the fog, with separate functions, grew GLSL files by up to 5.6% against main at 62ab95e1. The fog adds no build, so the count of pipelines stays the same.

Uncompressed, the fog adds about 810 bytes to each of the 32 fragment programs in a skin file. The two largest GLSL skin files, with tone mapping and half floats, were at 98.3% of their 1536 KB limit on main. The fog's first form took them over it by up to 5.6 KB. Two changes brought them back under, to 1,572,140 bytes, 724 bytes below the limit. The material's `fog: false` check and the zero-factor check are two early returns, because naga writes an `||` in GLSL as a local variable and an if-else. The height terms' limits are constants inside `fog_height_ratio`, which naga writes as numbers. The next growth of the skin templates will meet the limit regardless of the fog.

naga also renames a name that two functions of one module share, so `fog_height_ratio` calls its input `climb`. With `x`, a custom material's surface function with an argument named `x` lost that name, and the shader crate's material test caught it.

Per pixel, the fog costs one square root and one `exp` for the curve, and a normalize and a `pow` for the glow. Height adds one more `exp` and a division. Exponential and exponential squared fog share one `exp`, and the curve picks its result with `select`, so the shader holds one short function for every curve. A scene without fog, or a material with `fog: false`, returns before any of it. That matches the estimate of about 15 operations and one `exp`.

## Data

Results on 5 October 2026, in Chrome on the Mac's GPU and on SwiftShader, as CI draws. These runs came before the last change to the shader, which joined the exponential curves into one `exp` and folded the path into `fog_factor`. The change gives the same values within 32-bit rounding, and CI runs every one of these checks again on the pull request.

| Check | Result |
| --- | --- |
| `fog-turn.spec.ts`: a white box 29.75 units away in black exponential fog of density 0.03, with the camera turned by 0, 20 and 40 degrees | The box's brightest channel is 171 on WebGPU and 172 in compatibility mode and on WebGL2, at every turn. Fog by depth along the view would give about 189 at 40 degrees, where the depth is 22.8 |
| The shader library test, which checks the fog's functions against references in 64-bit floats | Passes on all three tiers |
| Image tests `fog-linear`, `fog-exp2`, `fog-exponential`, `fog-height`, `fog-sun` and `lines-lit`, all three tiers | 18 of 18 pass on each reference set, with new references |
| `fog-linear` and `fog-exp2` against three.js's `Fog` and `FogExp2`, by three.js's own rule | 6 of 6 pass on the Mac's GPU, with at most 0.003% of the pixels different, and 6 of 6 on SwiftShader, with at most 0.016% |
| S4 against three.js, whose town fades into linear fog at a wide angle | 2.9% to 3.3% of the pixels differ, at the far corners. S4 was already left out of the parity checks for WebGL2, and now lists the fog as a reason on every tier |
| S4's image test | 2.2% of the pixels changed, at the corners, on every tier: new references |

The fog scenes' narrow view keeps the straight-line distance within a few percent of the depth. So the two engines' fog differs by less than three.js's threshold at each pixel. A wide view, such as S4's, shows the difference at its corners. That difference is the reason for the change: three.js's fog there moves as the camera turns.

## Options

| Option | Turns with the camera | Height | Cost |
| --- | --- | --- | --- |
| A: three.js's fog by depth along the view (before) | Shifts at the edges | None | One dot product |
| B: straight-line distance, height from the density at the point (Godot) | Still | Wrong across valleys | As C, without the ray term |
| C: straight-line distance, exact height integral, sun glow (Filament) | Still | Exact | One more `exp` with height |
| D: a full-screen fog pass after the opaque pass (Filament's option) | Still | Exact | A pass over every pixel, and transparent objects need their own fog anyway |

Option C.

## Consequences

- `scene.setFog` takes `{ color, curve, density, near, far, height, heightFalloff, sunGlow, sunGlowExponent }`. The `type` option is gone, and a call that passes it throws E1108 with the new name.
- `null3d::fog` in the shader library loses `fog_depth`, and adds `EXPONENTIAL`, `fog_exponential`, `fog_height_ratio` and `fog_color`. The `Fog` struct's fields changed.
- The image tests `fog-linear` and `fog-exp2` take new references, and so do `lines-lit` and S4, which have linear fog. Their parity with three.js becomes a sanity comparison.
- New image tests: `fog-exponential`, `fog-height` and `fog-sun`. The browser test `fog-turn.spec.ts` checks that a box keeps its fogged color as the camera turns.
- Docs: `api/scene` (fog), `concepts/lighting` (fog), the shader library. Mapping entries `Fog` and `FogExp2`.
