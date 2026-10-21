# D-168: The shadow distance follows the farthest visible receiver

Status: decided. Date: 2026-10-13. Task: M2-R10.

Summary: A directional light that names no shadow distance now follows the farthest surface that
receives shadows in the camera's view. It rounds that distance up on a ladder of 1.25 times per
step, and holds it for one step. A light that names a distance keeps it, as a three.js port does.
The CPU computes the distance from the scene's world spheres and the camera that places the
cascades. Both GPU paths then draw the same shadows.

## Question

The directional light's shadows reached a fixed 200 m by default. A small scene, such as a room
15 m across, then spends almost all of each cascade's texels past what the camera sees. Its near
texels are about ten times coarser than they need to be. Can the distance follow what the camera
sees, without the shadows flickering as it moves?

## Rule

- When no distance is named, follow the farthest visible receiver. That is the farthest surface
  that receives shadows, lies in the camera's view, and is measured to its sphere's far side.
- Round that distance up to the next step of a ladder of 1.25 times per step, from 1 m.
- Hold the held distance for one step, so a raw distance that moves across a step does not flicker.
- A light that names a distance keeps it, on every preset.
- Compute the distance on the CPU from the scene's world spheres. Both GPU paths then agree, and
  no readback is needed. Use the camera that places the cascades, which follows a debug shadow
  camera too.
- Adopt it as the default when prototype S2 passes. S2 checks S4's flight and a 15 m room with
  #230's shadow stability check. It also checks that the distance does not flicker on a still
  camera.

## Data

Prototype S2 ran on the Mac in a parked Chrome 155 window on 14 October 2026. It drew the visual
page's shadow checks (`bench/lib/visual.ts`) for the benchmark scenes and a 15 m room, with the
automatic distance and with a fixed one. A one-off script of the task's branch drove them. Its results are in
[`bench/probes/shadow-distance/`](../../bench/probes/shadow-distance/), one file per page and GPU
path. The
stability check measures the share of pixels whose shadow changes between frames. The camera that
places the cascades moves by under a texel per frame, and the limit is 0.05%. The edge offset
compares with a reference of the largest shadow map, limit about 0.13 px. The contact gap is
limited to 0.06 px. Every figure is the same on both GPU paths.

| Scene | Path | Distance | Stability | Edge offset | Contact gap |
| --- | --- | --- | --- | --- | --- |
| S4, the town flight | WebGPU | auto | 0.000% | 0.069 px | 0.021 px |
| S4, the town flight | WebGL2 | auto | 0.000% | 0.066 px | 0.016 px |
| The shadows scene | WebGPU | 60 m | 0.000% | 0.128 px | none |
| The shadows scene | WebGL2 | 60 m | 0.000% | 0.100 px | none |
| A 15 m room | WebGPU | auto | 0.000% | 0.014 px | 0.028 px |
| A 15 m room | WebGPU | 60 m | 0.000% | 0.014 px | 0.056 px |
| A 15 m room | WebGL2 | auto | 0.000% | 0.013 px | 0.006 px |
| A 15 m room | WebGL2 | 60 m | 0.000% | 0.009 px | 0.017 px |

The distance did not flicker: every stability figure is 0.000%. In the room the automatic distance
steps to 18.19 m (1.25^13). That is the ladder step above the room's 15 m. At 200 m the first
cascade's texel covered 2.8 cm of the ground, and at 18.19 m it covers 0.26 cm. That is about 11
times finer. In the room the contact gap is smaller with the automatic distance than with a fixed
60 m: 0.028 against 0.056 px on WebGPU, and 0.006 against 0.017 px on WebGL2. The finer texels
explain it. Every figure is within its limit on both paths.

The check moves the camera that places the cascades by under a texel per frame. A still camera does
that over a moment. So the check shows that the distance does not flicker. It does not count the
steps over a whole flight. The ladder's hold is one step. A rise happens at once. A fall happens
only once the raw distance drops a full step below the held one. The 25% step and the hold keep the
count low over normal camera motion.

## Decision

- Adopt the automatic distance as the default. A directional light that names no distance follows
  the farthest visible receiver, up the 1.25 times ladder with one step of hold.
- The CPU computes the distance in `fit_shadows`. It reads the scene's world spheres and the camera
  that places the cascades. `SunShadow` carries the `auto` flag. The resolved distance reaches the
  cascade fit as a named one does.
- A light that names a distance keeps it, as a three.js port does. S6's sketch now passes
  `S6_SHADOW_DISTANCE`, which its three.js twin already used. The two engines then compare equal
  work. Without it the automatic distance sharpened S6's shadows by 0.5% of pixels. The
  vertex-types test scene names 200 m, so the integer and float twins' shadows do not depend on
  the automatic distance. S4 and S5 keep the default, and their images match their references.
- The API is `shadow: { distance: 'auto' }`, the new default. The value 0 in the light table means
  `'auto'`. It is the one value below the setting's range.

## Consequences

- `crates/null3d-core/src/lights.rs` holds the ladder (`ladder_distance`, `AUTO_LADDER`,
  `AUTO_MIN_DISTANCE`, `AUTO_FALLBACK`) and `farthest_receiver_distance`. `SunShadow` gains `auto`.
  `crates/null3d-render/src/frame.rs` resolves the distance and keeps the held value.
- The API is `shadow: { distance: 'auto' }`, the new default. A number fixes it.
- [Shadows](../../docs/concepts/shadows.md#settings) and [Lights](../../docs/api/lights.md#shadows)
  describe the setting.

## Addendum, 20 October 2026: the hold now holds a whole step

The hold did nothing. `ladder_distance` kept the held step only while the step at the raw distance was the held one. Inside the held step, that is always so. So the distance fell as soon as the raw distance crossed below the step under the held one. It rose again as soon as the raw distance crossed back. A receiver at the edge of the view that swayed across a step's boundary flipped the distance between two steps every frame. The shadow texels changed size with it.

Now the held step stays while the raw distance lies within it or within the step under it: a whole step of hysteresis. Once the raw distance drops below that lower step, the distance falls to the step at the raw distance. A rise stays immediate. The manual ladder in the Shadows concept page already worked this way.

A unit test swings the raw distance just above and just below a step's boundary for 600 frames. The distance must never change after the first rise. The ladder's other test checks an immediate rise, a hold one step down, and a fall once the raw distance is a whole step lower.

