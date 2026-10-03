# D-16: Moving casters in far cascades, and where shadows meet their casters

Status: decided. Date: 2026-10-03. Task: M1-F3.

## Question

Two faults showed in S4 on the iPad (WebGPU, Medium):

1. The cars' shadows jittered, and a gap opened behind each car while it drove. Since #198, the far cascades draw once every `farCascadeInterval` frames (4, 3, 2 and 2 on Low to Ultra) and keep their layers in between. A kept layer shows a car where it stood when the layer drew, so its shadow jumps forward on each draw and trails behind between draws. Since #211, every cascade past about 24 m does this.
2. Every object, at rest too, showed a thin lit line between its base and its shadow ("peter-panning"). It was widest in the far cascades.

How should moving casters' shadows follow them in every frame, and how should the biases change so that shadows meet their casters without bringing back stripes of self-shadow (acne)?

## Rule

- A moving caster's shadow must sit where the caster is in every frame, on both GPU paths and every preset.
- A far cascade whose box holds still casters alone must still draw only in its turn.
- The fix must add no GPU memory and no per-frame allocation.
- Shadows must meet the base of a box on the ground in the near and the far cascades, and no surface may show acne in the shadow image tests or S4.

## Data

### What caching the far cascades saves

S4 in Chrome on the MacBook Pro, WebGPU, High (far cascades every 2nd frame), `bun run bench:run --scenes s4 --pages null3d-webgpu --runs 3 --seconds 8`, with and without `--switches far=1`, on main before this change:

| Measure | Far cascades in turn | Every cascade in every frame |
| --- | --- | --- |
| GPU ms per frame | 1.40 | 1.59 |
| Nearest cascade's pass | 0.087 ms | 0.087 ms |
| Far cascade passes | 0.163 ms, one per frame | 0.162 and 0.200 ms |
| Draw calls per frame | 63 | 70 |

So one far cascade's pass costs 0.16 to 0.20 ms, and drawing the far cascades in turn saves 0.19 ms per frame here.

### The options for moving casters

- (a) A second depth target for the moving casters, drawn in every frame, beside the kept layer of still casters. Each receiver in a far cascade then reads both: twice the filter's reads, 8 instead of 4 with the 3 x 3 filter and 18 instead of 9 with the 5 x 5. Most of S4's pixels lie in far cascades. It also needs a second shadow map binding in every scene pipeline, and a layer of GPU memory for each far cascade.
- (b) Draw a far cascade in every frame while a moving caster touches its box. It adds no memory, pass or shader change. Its cost is the cascade's draw, 0.16 to 0.20 ms per far cascade on the Mac, only in frames where a moving caster is in the box.
- (c) Keep a copy of each far cascade's still casters, and in every frame copy it into the layer, then draw the moving casters over it. Each far cascade then needs a copy of its layer and a pass that loads and stores it in every frame. A pass that loads and stores one 2,048-texel layer took 0.045 ms on the Mac (Chrome's GPU timestamps, 250 frames), against 0.012 ms for a pass that clears and stores it. The copy itself does not show between pass timestamps. Its cache takes 16 MiB per far cascade at 2,048 texels and 64 MiB at 4,096: 32 MiB for the light's defaults, and 192 MiB for 4 cascades of 4,096. The draw lists cannot copy depth textures on WebGL2, so that path would need a pass that writes depth from a texture.

three.js's cascaded shadow addon (`CSM`) draws every cascade in every frame, as option (b) does where moving casters fill the far cascades.

### What option (b) costs

The engine lists the scene objects that cast shadows and move in every frame: each dynamic object, and each object under a dynamic one. It lists them again only when the scene's structure changes. In each frame it tests each listed caster's sphere against the box of each far cascade whose turn has not come, and against the box that the cascade's layer holds. The test works in 64-bit floats from the world's origin. A cascade that a moving caster touches draws. A cascade whose layer drew a moving caster draws once more after the caster leaves, so its old shadow goes.

In S4, 200 dynamic cars drive through every cascade's box, so every cascade draws in every frame. On the Mac, S4's cascade passes took 0.087, 0.162 and 0.203 ms per frame, with 70 draw calls: the figures of `far=1` on main above, so about 0.19 ms per frame more than main. The frame's own GPU time could not be compared cleanly in that hour, as other work on the Mac moved the scene's pass from 0.8 to 3 ms between runs. A scene whose moving objects stay near the camera, such as a character in a town, keeps the whole saving.

The governor lengthens `farCascadeInterval` when frames run long. Where moving casters fill the far cascades, that step now saves nothing, and the governor's other steps do the work.

### Where shadows meet their casters

Casters draw only their faces that point away from the light, as three.js draws them. A box's bottom face is one of those, and it lies on the ground. Each receiver moved its point along its normal by `normalBias` texels, and its depth toward the light by `bias` texels, then compared over a square of 3 or 5 texels. Near a box's base, the moved point stood above the bottom face, so the filter's reads that landed under the box read "lit". A cascade's texels grow with distance, so the lit line widened in the far cascades: 28 cm texels in the test below, and 23 cm in S4's last cascade.

The fix scales both biases by the surface's angle to the light: the normal offset by the angle's sine, and the depth offset by its tangent, up to twice the setting. A surface that faces the light takes little of either, and one at a steep angle, where depth changes fastest across a texel, takes more. Unity's built-in shadows scale their normal offset by the same sine. The defaults then drop from 0.5 and 1 to 0.2 and 0.3. Spot and point lights take the same shares, in texels of their tiles.

The `shadows-contact` image tests place car-sized boxes on a street under S4's sun, with a 512-texel map so the last cascade's texels are about S4's. The table gives the brightness of the ground just past each box's base, as a share of the lit ground's (Chrome on the Mac, WebGPU). Full shadow reads about 0.34. "Before" draws the old constant biases: on this ground, under this sun, the new shares give the same offsets with a `bias` of 0.68 and a `normalBias` of 1.69.

| View | Before (0.5 and 1, constant) | After (0.2 and 0.3, scaled) | No bias |
| --- | --- | --- | --- |
| From above, last cascade: first pixel past the base | 0.75 | 0.56 | 0.50 |
| Low angle, first cascade: first and second pixel | 0.67 and 0.59 | 0.53 and 0.44 | 0.43 and 0.40 |
| Low angle, last cascade: first and second pixel | 0.72 and 0.82 | 0.58 and 0.63 | 0.47 and 0.53 |

The new defaults close about three quarters of the lit line from above, and most of it at a low angle. With the new defaults, these image tests drew within their tolerances of their old references on the Mac: the shadow tests with 1 to 4 cascades, the 5 x 5 filter, custom materials, half precision and the depth prepass, the spot and point light tests, and S4. None showed stripes.

## Decision

Option (b): a far cascade draws in every frame while a moving caster touches its box, or touched the box its layer holds. It is the only option that adds no memory, no pass and no shader read, and it costs a cascade's draw only where a moving caster needs it. Option (c) would save at most about half of that draw on the Mac, for 32 to 192 MiB of memory and a new depth path on WebGL2. Option (a) would double the filter's reads on most of S4's pixels.

The receivers scale their biases by their angle to the light, and the defaults become 0.2 for `bias` and 0.3 for `normalBias`.

## Consequences

- `MovingCasters` and `CascadeSchedule::plan` in `crates/null3d-render/src/shadows.rs` hold the test; both frame builders call it through `SceneSettings::shadow_frame`. The Rust tests check the schedule with a moving caster, and that recording frames with one allocates nothing.
- `bias_shares` in `crates/null3d-shaders/wgsl/lib/shadows.wgsl` scales the biases of the directional light and of spot and point lights. The defaults are in `crates/null3d-core/src/lights.rs`.
- The browser test `moving-shadow.spec.ts` drives a dynamic box in the last cascade, live, with far cascades every 8th frame. The offset between the box and its shadow must match the offset with every cascade drawn in every frame, within 3 pixels. Without the fix, it strayed by 7.3 pixels. Hold mode cannot show the lag, as it draws one frame, in which every cascade draws.
- The `shadows-contact`, `shadows-contact-near` and `shadows-contact-far` image tests hold the contact at the base.
- The benchmark pages take `?far=<n>`, which S4 applies as its `farCascadeInterval`.
- `concepts/shadows` describes both changes, and the API notes give the new defaults.
- The iPad's S4 run on WebGPU at Medium, before and after, is still to come.
