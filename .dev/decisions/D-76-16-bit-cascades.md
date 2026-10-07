# D-76: 16-bit depth for the shadow cascades

Status: decided. Date: 2026-10-06. Task: M2-R8. Pending: the iPad runs. The S25's shadow image tests passed on 2026-10-07.

Summary: The cascades store 16-bit depth and the tiles keep 32-bit floats. Each cascade floors the bias toward the light and the plane margin at 1.5 depth steps, 21.6 mm in S4's last cascade. Each also snaps along the light to whole steps. Without the snap S4's shadows flickered (0.095% of pixels); with it the S25 and Pixel 9 pass. Cascade memory halves: Ultra 256 to 128 MiB, Medium and High 48 to 24 MiB, with the same GPU time.

## Question

The directional light's shadow map stored 32-bit float depth, and so did the atlas of spot and point light tiles. Can the cascades store 16-bit depth? It halves their memory, the bytes that each cascade pass writes and the bytes that each receiver reads. What must change so that no shadow test gets worse?

## Rule

- Adopt 16-bit cascades when no shadow image test changes on any tier, on the Mac's GPU and on SwiftShader. The contact checks must stay within their limits. Memory alone justifies the change when the time is equal: Ultra saves 128 MiB.
- Keep all bias in the shader. PlayCanvas finds hardware depth bias inconsistent across depth formats on WebGPU, and null3D's casters already draw with none.
- The tiles change only if their precision holds at the far end of a perspective view.

## Data

One 16-bit step is a cascade's depth range over 65,535. The range is the box's depth: the sphere's diameter plus the margin toward the light, 2r + max(2r, distance) (`shadows.rs`, `fit_cascades`). For S4's 3 cascades over 200 m (technique deep dive, section 4.3):

| Cascade | Radius | Depth range | One 16-bit step | Under the 10 mm bias and plane margin? |
| --- | --- | --- | --- | --- |
| 1 (0.1 to 24 m) | 28.3 m | 256.5 m | 3.9 mm | yes |
| 2 (24 to 57 m) | 67.1 m | 334 m | 5.1 mm | yes |
| 3 (57 to 200 m) | 235.5 m | 942 m | 14.4 mm | no |

The step depends on the box, not on the map's size, so Ultra's 4,096 texels give the same steps. A plain format change would leave the last cascade's rounding above both defaults that cover it.

A tile is a perspective view whose near plane sits at 1/1,000 of its range. In 16 bits, one step near its far end is about 1.5% of the distance from the light. That is 15 cm at 10 m. Godot stores 16-bit tiles only because it stores linear distance for point lights.

Memory of the cascades (layers x texels squared x bytes per texel):

| Preset | 32-bit | 16-bit |
| --- | --- | --- |
| Low (2 x 1,024) | 8 MiB | 4 MiB |
| Medium and High (3 x 2,048) | 48 MiB | 24 MiB |
| Ultra (4 x 4,096) | 256 MiB | 128 MiB |

Image tests with 16-bit cascades against the references of 32-bit cascades, for every test whose scene casts shadows. Chrome 154 drew them on the MacBook Pro M5 Max on 5 October 2026:

| GPU set | Tests | Passed |
| --- | --- | --- |
| Mac's GPU | 156 | 156 |
| SwiftShader | 156 | 156 |

The same tests ran again on 7 October 2026, with the depth snap and with the blend between cascades of D-73. The filter now matches 159 tests, and all 159 passed on each GPU set against the same references.

The contact checks of S4's sun, 16-bit against 32-bit cascades on the Mac's GPU (Chrome 154, 5 October 2026). All 24 shadow checks passed with 16-bit cascades, and all 16 contact checks with 32-bit ones. The gap is the mean light between a box's foot and its shadow, in pixels. The acne is the mean shadow on the lit tops of slabs that cast shadows, in percent. D-16 gives 0.020 and 0.077 pixels for the near and far gaps:

| View | Measure | WebGPU 16-bit | WebGPU 32-bit | WebGL2 16-bit | WebGL2 32-bit |
| --- | --- | --- | --- | --- | --- |
| Near | gap | 0.0202 px | 0.0199 px | 0.0178 px | 0.0163 px |
| Last cascade | gap | 0.0766 px | 0.0771 px | 0.0838 px | 0.0813 px |
| Turning camera | gap | 0.0447 px | 0.0453 px | 0.0431 px | 0.0391 px |
| Slabs, S4's sun | acne | 0.249% | 0.249% | 0.216% | 0.216% |
| Slabs, sun at 35 degrees | acne | 0.378% | 0.378% | 0.345% | 0.345% |
| Slabs, sun at 20 degrees | acne | 0.445% | 0.445% | 0.413% | 0.414% |

The gaps move by at most 0.0025 px, and the acne by at most 0.0005 percentage points. A run of 16-bit cascades with no floor gave the same figures as the floor, to four decimals. The likely reason: no caster in the contact scene lies within 2 cm under a receiver. A floor of 1,000 steps failed the last cascade's check on both paths, with a gap of 0.86 px. So the shader does apply the floor. The floor guards against the rounding that the table of steps above computes. A scene whose casters lie a step or less under their receivers would show it.

The Automate S25 (Chrome 149) and Pixel 9 ran S4 on each page and its `-depth32` twin. They ran at the High preset that the visual page picks, with the governor on. The runs are `20261005-142108-bench` and `20261005-152006-bench`, of commit cd216b832, before the depth snap:

| Phone | WebGPU GPU time, 16-bit | 32-bit | Stability, 16-bit (limit 0.05%) | 32-bit |
| --- | --- | --- | --- | --- |
| Galaxy S25 | 7.57 ms | 7.63 ms | WebGPU 0.095%, WebGL2 0.085%: fail | 0.000%, 0.001% |
| Pixel 9 | 6.36 ms | 6.55 ms | WebGPU 0.092%, WebGL2 0.001% | 0.000%, 0.000% |

WebGL2 reports no GPU time, and its CPU time was the same. The contact gap grew from 0.025 to 0.028 px to 0.030 to 0.032 px, under the limit of 0.06 px. On the S25, 219 of 230,400 pixels changed between the two stability frames. They lay from the nearest rows to the farthest. Most were partial values at edges, such as 235 to 255: single reads of the filter that flipped.

The Mac timed commit cd216b832, before the depth snap. Chrome ran each page 5 times on the Mac's GPU, at 144 frames per second, with the load under 3.5. The records are `bench/results/20261005-174632-bench.json` (S4) and `bench/results/20261005-175841-bench.json` (S2):

| Scene and path | Main thread, 16-bit | 32-bit | GPU, 16-bit | 32-bit |
| --- | --- | --- | --- | --- |
| S4, WebGPU | 0.08 ms | 0.12 ms | 1.52 ms | 1.55 ms |
| S4, WebGL2 | 0.24 ms | 0.26 ms | none | none |
| S2 with 3 cascades, WebGPU | 0.13 ms | 0.16 ms | 0.61 ms | 0.61 ms |
| S2 with 3 cascades, WebGL2 | 0.30 ms | 0.34 ms | none | none |

The Mac's GPU gave the same failure, and the depth snap fixed it. The table gives the share of pixels whose shadow changed between frames in each benchmark scene's stability check. The limit is 0.05%. Chrome 154 ran them on 6 October 2026:

| Scene and path | 16-bit, no snap | 16-bit, snap | 32-bit, no snap |
| --- | --- | --- | --- |
| S4, WebGPU | 0.095% (fail) | 0.0013% | 0.0043% |
| S4, WebGL2 | 0.085% (fail) | 0.0004% | 0.0004% |
| S2 with 3 cascades, WebGPU | 0.0039% | 0% | 0% |
| S2 with 3 cascades, WebGL2 | 0.0017% | 0% | 0% |

With the snap, S4's edge offset was 0.085 and 0.080 px, and its contact gap 0.030 and 0.033 px. Its acne was 0.032% and 0.009%. All are under their limits. The visual checks ran with `bun run --cwd bench test visual.spec.ts`, and with `NULL3D_SWITCHES=shadowdepth=32` for 32-bit.

The Automate S25 (Chrome 149) and Pixel 9 ran S4 again with the snap and D-73's blend, on 7 October 2026, with the governor off. The run is `20261007-011242-bench`, of the build of commit 1bf8b65d8. Both phones passed on both paths:

| Phone | Stability, WebGPU (limit 0.05%) | Stability, WebGL2 | WebGPU GPU time |
| --- | --- | --- | --- |
| Galaxy S25 | 0.000% | 0.000% | 7.63 ms |
| Pixel 9 | 0.001% | 0.001% | 7.67 ms |

Over both phones and paths, the edge offset was 0.081 to 0.086 px and the contact gap 0.030 to 0.034 px. The acne on flat surfaces was 0.011% to 0.073%. Each page held its target frame rate in every frame. The S25's screen ran at 30 Hz, so its timings are only a guide. The Pixel 9's GPU time is higher than on 5 October (6.36 ms). That run had the governor on and no cascade blend, so the two figures do not compare.

The Automate S25 ran the 21 shadow image tests on main at 80a97ab51, which holds this work, on 7 October 2026. The tests are shadows, the 1, 2 and 4 cascade pages, the 5 x 5 filter, spot shadows and point shadows. Each ran on WebGPU, compatibility mode and WebGL2. They ran in Chrome 149 and in Samsung Internet 30.0. Its Chromium 143 is the oldest Chromium that BrowserStack offers on this phone. BrowserStack opens Chrome 149 whatever Chrome version a session asks for.

| Browser | 16-bit cascades, as built | 32-bit cascades (`?shadowdepth=32`) |
| --- | --- | --- |
| Chrome 149 | 22 of 22 | 22 of 22 |
| Samsung Internet 30.0 (Chromium 143) | 22 of 22 | 22 of 22 |

The runs are `20261007-033205-checks` (16-bit) and `20261007-034206-checks` (32-bit); each count includes the capabilities page. So the older Chromium draws the shadows right, and decision 28 adds no guard.

How the data was produced: `bun run test:images -g "shadow|depth-bias|debug-view|vertex-types|ao-|grading|material-maps|outline|skinning|s4|s5|s1"`, with `CI=1` for SwiftShader. The contact checks ran with `bunx playwright test shadow-contact.spec.ts`, once as built and once with `NULL3D_SWITCHES=shadowdepth=32`.

## Decision

- The cascades store `depth16unorm` on WebGPU and `DEPTH_COMPONENT16` on WebGL2, on every preset. The tiles stay `depth32float`.
- In each cascade, the receiver's bias toward the light is at least 1.5 steps of stored depth, in meters, before the one-texel cap. The receiver plane's margin is at least 1.5 steps of depth. The shader gets the step in the shadow uniform's spare `kernel.w` and the depth per meter from the cascade's matrix, so the block keeps its size. Both lookups of a receiver in the band between two cascades take each cascade's own floor. A step of 1.5 covers the half step of rounding on each side with room to spare. In S4's last cascade the floor is 21.6 mm. The one-texel cap there is 23 cm, so the cap never cuts the floor.
- Each cascade's box snaps along the light to whole 16-bit steps, as it snaps across the light to whole texels. Without the snap, the steps slid with the camera, and S4's stability check failed on the Automate S25 and Pixel 9. With it, both phones pass. The Mac's stability table under Data gives the figures with the snap.
- `?shadowdepth=32` keeps 32-bit cascades, and the `-depth32` bench pages use it, so a device can time the two in one session.
- WebGPU reads the cascades with `textureGather` through a plain sampler, not with the comparison sampler. So the Adreno comparison fault of decision 28 touches only the tiles there, and the format change does not widen it. WebGL2 reads the cascades through the comparison sampler, as before.

## Consequences

- `crates/null3d-render/src/shadows.rs` holds `CascadeDepth` and `CasterPasses`. Each caster bucket has a pipeline for the cascades and one for the tiles, each only while that kind of shadow is on ([implementation notes](../implementation-notes.md#shadows)).
- [Shadows](../../docs/concepts/shadows.md#bias) and [Quality presets](../../docs/concepts/quality-presets.md#the-settings-of-each-preset) give the format, the floor and the memory of each preset.
- Pending device runs: S4 on the iPad, each page against its `-depth32` twin, on WebGPU and WebGL2.
- The S25's shadow image tests passed in Chrome 149 and in Samsung Internet's Chromium 143, so decision 28 adds no guard (Data).
