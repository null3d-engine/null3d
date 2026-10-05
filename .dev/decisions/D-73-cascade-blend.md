# D-73: The blend between shadow cascades, and what each cascade's box holds

Status: decided. Date: 2026-10-05. Task: M2-R1.

## Question

Each cascade's texels are larger than those of the cascade before it. Where one cascade hands over to the next, a shadow edge changes its softness in one row of pixels. In S4's view the second cascade hands over to the third at 57 m ([D-15](D-15-cascade-split.md)). How should the cascades blend there, and what must each cascade's box hold for the blend to work?

Three faults of the cascades' boxes came with the question (review of 4 October 2026):

- R5-06: views of 45 degrees or narrower got lit holes at the screen's sides, up to 0.44% of the ground. A receiver picks its cascade by its distance from the camera ([D-16](D-16-moving-casters-and-bias.md)), but each box held only its slice along the view.
- R5-21: after a camera cut, the far cascades kept their old boxes until their turns, so far ground drew lit for up to 7 frames.
- R5-22: the shadow distance followed the camera's scale, though the docs say meters.

## Rule

- No line shows where two cascades meet, in the shadow scene of the visual checks, on both GPU paths and both reference GPUs.
- No receiver in the view is left without a cascade, at any field of view from 20 to 90 degrees, with 2 to 4 cascades.
- Only the band's pixels pay for a second read. S4's draw calls and passes at Low stay as `bench/tests/pages.spec.ts` pins them, and its GPU time stays within the noise.
- A camera that moves smoothly keeps the far cascades to their turns.

## Data

### The seam

The visual checks gained a seam figure (`seamJump` in `tests/pages/lib/shadow-check.ts`). It follows the shadow scene's long wall edge, which crosses the seam between the first two cascades. In each row it measures the edge's soft width, between the shadow factors 0.9 and 0.1. A median of three rows takes out the texels' small steps. The figure is the largest change of that width from one row to the next.

| Measure | No band | Band of 10% | Device and browser |
| --- | --- | --- | --- |
| Seam figure, WebGPU | 3.19 px | 0.63 px | Chrome on the MacBook Pro's GPU |
| Seam figure, WebGL2 | 3.18 px | 0.68 px | Chrome on the MacBook Pro's GPU |
| Seam figure, WebGPU | 2.87 px | 0.65 px | Chromium on SwiftShader (CI's GPU) |
| Seam figure, WebGL2 | 2.88 px | 0.67 px | Chromium on SwiftShader |
| Stair steps of the long edge | 0.151 px | 0.152 px | Chrome on the Mac, WebGPU |
| S4's edge offset from the reference | about 0.10 px (D-15) | 0.085 px WebGPU, 0.081 px WebGL2 | Chrome on the Mac |

Without the band, the edge's soft width fell from 5.1 px to 1.7 px in one row, where the first cascade ends. With it, the width falls over 6 rows, at most 0.6 px per row. Elsewhere along the edge, neighboring rows differ by about 0.3 px. The limit of the seam figure is 1.2 px.

The band changed 154 of the shadow scene's 129,600 pixels, all in the band's rows. 166 of the 172 image tests that draw shadows kept their references on the Mac's GPU, and 160 of 172 on SwiftShader. The others were the new seam test and the float twin of the vertex types test. S5 also timed out under load on SwiftShader, and passed when run again.

### The boxes

Behind a perspective camera, a point at the view's corner is `sqrt(1 + k²)` times further from the camera than along its view. Here `k` is the tangent of the corner's angle from the view's axis. So each cascade's sphere is now fitted from the band of the cascade before it, divided by that factor, out to its own end. A test (`every_receiver_in_view_finds_a_box_and_band_receivers_find_the_next_box_too` in `crates/null3d-render/src/shadows.rs`) picks each point's cascade as the shader does. It checks views of 20 to 90 degrees, 2 to 4 cascades, 4 sun directions and 3 aspect ratios, about 2.8 million points. Every point finds a box, and every point in a band finds the next box too. With the old fit and no band, the test finds lit points at 20 degrees.

The new fit changes no box at 50 degrees and wider, with the default 3 cascades over 200 m. There the far corners alone set each sphere. Narrow views get a little larger boxes:

| Field of view, 16:9 | First cascade | Second cascade | Third cascade |
| --- | --- | --- | --- |
| 20 degrees | 13.61 m, no change | 23.34 to 24.41 m (+4.6%) | 90.48 to 92.73 m (+2.5%) |
| 40 degrees | 18.73 m, no change | 42.31 m, no change | 148.48 to 148.92 m (+0.3%) |
| 50, 60 and 90 degrees | no change | no change | no change |

The figures are each sphere's radius, half of each box's side.

### Kept boxes after a camera cut

A far cascade that skips a frame keeps its box. It now draws out of turn when its box no longer holds every corner of its fresh part of the view. A unit test simulates S4's camera path for 60 seconds at 30 and 60 frames per second, with each preset's cascades, map size and interval. No frame drew a far cascade out of turn. A first version kept the filter's reach of 3 texels inside the box's edges. It drew S4's far cascade out of turn in 2.4% of Low's frames at 30 frames per second. A far top corner of the view lies on the sphere. It left the reach by up to 0.35 m, in a box 416 m across. So a corner counts as held up to the box's edge. A cut of 500 m draws every cascade in that frame, and so does a turn of 120 degrees.

### Cost

S4 on WebGPU in Chrome on the MacBook Pro (Apple M5 Max), governor off, 5 October 2026. Each round ran Low and High with the band at 0 and at 0.1, one run of each, in turns. The figure is each run's median GPU time per frame:

| Preset | No band, rounds 1 to 4 | Band of 10%, rounds 1 to 4 | Quiet rounds 3 and 4: no band, band |
| --- | --- | --- | --- |
| Low | 2.957, 1.429, 1.214, 1.228 ms | 1.244, 1.227, 1.226, 1.236 ms | 1.221 ms, 1.231 ms |
| High | 1.558, 3.194, 1.504, 1.503 ms | 1.486, 1.516, 1.500, 1.507 ms | 1.504 ms, 1.504 ms |

Other programs used the Mac's GPU in rounds 1 and 2, and two runs took about twice as long. In the quiet rounds, the band cost 0.010 ms per frame at Low and nothing measurable at High. S4's camera looks down on the town from 42 m, so few pixels lie in a band. The records are `bench/results/20261005-094430-bench.json` to `20261005-095758-bench.json`.

S4 at Low draws 56 draw calls in most frames and 63 in one frame of 4, as before. The shadow uniform block grew by one vector, from 352 to 368 bytes. The band adds no pass, draw or texture.

S4 at Low on the cloud Galaxy S25 in Chrome, governor off, 5 October 2026 (run `20261005-122500-bench`): 22 of 22 pages passed. On WebGPU, the median of 5 runs' GPU time per frame was 7.67 ms with the band and 7.60 ms without it, 0.9% more. That lies within the spread of the runs without the band, 7.34 to 7.73 ms, so the band passes. Chrome on this phone gives WebGL2 no GPU timer. There, the CPU time was 0.88 ms per frame both ways, with 56 draw calls both ways. The phone's screen ran at 24 to 30 Hz, so only the GPU times compare, not the frame times.

## Decision

- Each cascade but the last blends into the next over a band at its far end, 10% of its length by default. The blend is linear in the receiver's distance from the camera. The last cascade has no band; the fade over the last tenth of the shadow distance ends it.
- The band is the live quality setting `shadowCascadeBlend`, from 0 to 0.5, 0.1 on every preset. Prototype S4 measures 0% against 10% on the cloud S25 and Pixel 9 at Low and the iPad at Medium. The `-blend-off` bench pages put both in turns in one session on each device, so heat and the device's other work slow both alike. Low can take 0 if it costs too much there.
- The second read sits behind a branch, so only the band's pixels pay for it. A band pixel reads the next cascade only where the next box holds it, with the filter's reach.
- Each cascade's sphere holds every point of the view whose distance from the camera falls between the band before it and its own end. This also fixes R5-06.
- The filter's square stays fixed in texels in every cascade. Godot widens it in near cascades to match the far ones' softness, which costs reads in every pixel. The band spreads the softness step over its rows instead.
- A kept far box that no longer holds every corner of its fresh part of the view draws out of turn (R5-21).
- The shadow distance is in meters: the core divides it by the camera's scale along its view (R5-22).

## Consequences

- `crates/null3d-render/src/shadows.rs` fits the boxes and the bands, and `CascadeSchedule::plan` tests the kept boxes. The shadows library of the shaders blends the two reads. The quality setting reaches the core through `setShadowQuality`.
- `concepts/shadows` has a section on the blend, and says that the distance stays in meters under a scaled camera. `api/quality` lists the setting. The three.js mapping maps the CSM addon's `fade` option onto it.
- The shadow scene of the visual checks has a seam limit of 1.2 px. A test runs the scene with no band, and the check must fail it ([Image tests](../image-tests.md#visual-checks)).
- The `shadows-seam` image test draws the shadow scene on all three tiers.
- The S4 benchmark page takes `?shadowCascadeBlend=` to measure the band against none.
