# D-168: The shadow distance follows the farthest visible receiver

Status: proposed. Date: 2026-10-13. Task: M2-R10. Pending: prototype S2 on the Mac.

Summary: A directional light that names no shadow distance follows the farthest surface that
receives shadows in the camera's view, rounded up on a ladder of 1.25 times per step and held for
one step. A light that names a distance, as a three.js port does, keeps it. The distance is
computed on the CPU from the scene's world spheres and the camera that places the cascades.

## Question

The directional light's shadows reached a fixed 200 m by default. In a small scene, such as a room
15 m across, that spends almost all of each cascade's texels past everything the camera sees: the
near texels are about ten times coarser than they need to be. Can the distance follow what the
camera actually sees, without making the shadows flicker as it moves?

## Rule

- When no distance is named, follow the farthest visible receiver: the farthest surface that
  receives shadows and lies in the camera's view, measured to its bounding sphere's far side.
- Round that up to the next step of a ladder of 1.25 times per step, from 1 m, and hold the
  distance for one step before it falls, so a raw distance that moves across a step does not
  flicker.
- A light that names a distance keeps it, on every preset.
- Compute it on the CPU from the scene's world spheres, so both GPU paths agree and no readback is
  needed. The camera that places the cascades is used, so a debug shadow camera is followed too.
- Adopt it as the default when prototype S2 passes: S4's flight and a 15 m room keep #230's shadow
  stability check, and the distance does not flicker on a still camera.

## Data

Prototype S2 ran on the Mac in a parked Chrome 155 window on 14 October 2026, with the automatic
distance as the default. It drew the visual page's shadow checks (`bun proto-s2.ts`, results under
`logs/r10-shadow-distance/proto/`): the stability check (the share of pixels whose shadow changes
between frames while the camera that places the cascades moves by under a texel per frame, limit
0.05%), the edge offset from a reference of the largest shadow map (limit about 0.13 px), the
contact gap (limit 0.06 px) and the acne on flat surfaces. Each figure is the same on both GPU
paths.

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
steps to 18.19 m (1.25^13), the step above the room's 15 m; at 200 m the first cascade's texel
covered 2.8 cm of the ground, so at 18.19 m it covers 0.26 cm, about 11 times finer. The contact gap
in the room is smaller with the automatic distance than with a fixed 60 m (0.028 against 0.056 px on
WebGPU, 0.006 against 0.017 px on WebGL2), which the finer texels explain. Every figure is within
its limit on both paths.

The check moves the camera that places the cascades by under a texel per frame, as a still camera
does over a moment, so it shows that the distance does not flicker but does not count the steps over
a whole flight. The ladder's hold is one step: a rise happens at once, and a fall happens only once
the raw distance drops a full step below the held one. The 25% step, and the hold, keep the count
low over normal camera motion.

## Decision

- Adopt the automatic distance as the default: a directional light that names no distance follows
  the farthest visible receiver, rounded up on the 1.25 times ladder with one step of hold.
- The distance is computed on the CPU in `fit_shadows` from the scene's world spheres and the
  camera that places the cascades, so both GPU paths agree and no readback is needed. `SunShadow`
  carries the `auto` flag; the resolved distance reaches the cascade fit as any named one does.
- A light that names a distance keeps it, as a three.js port does. S6's null3D sketch now passes
  `S6_SHADOW_DISTANCE`, which its three.js twin already used, so the two engines compare equal work;
  without it the automatic distance sharpened S6's shadows by 0.5% of pixels. The vertex-types test
  scene fixes 200 m, so the integer and float twins' shadows do not depend on the automatic distance.
  S4 and S5 keep the default: their images match their references within the check's tolerance.
- The API is `shadow: { distance: 'auto' }`, the new default. The value 0 in the light table means
  `'auto'`; it is the one value below the setting's range.

## Consequences

- `crates/null3d-core/src/lights.rs` holds the ladder (`ladder_distance`, `AUTO_LADDER`,
  `AUTO_MIN_DISTANCE`, `AUTO_FALLBACK`) and `farthest_receiver_distance`. `SunShadow` gains `auto`.
  The render worker (`crates/null3d-render/src/frame.rs`, `fit_shadows`) resolves the distance and
  keeps the held value.
- The API is `shadow: { distance: 'auto' }`, the new default; a number fixes it.
- [Shadows](../../docs/concepts/shadows.md#settings) and [Lights](../../docs/api/lights.md#shadows)
  describe the setting.
