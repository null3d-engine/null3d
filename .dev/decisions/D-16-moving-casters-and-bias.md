# D-16: Moving casters in far cascades, and where shadows meet their casters

Status: decided. Date: 2026-10-03. Task: M1-F3.

## Question

Two faults showed in S4 on the iPad (WebGPU, Medium):

1. The cars' shadows jittered, and a gap opened behind each car while it drove. Since #198, the far cascades draw once every `farCascadeInterval` frames (4, 3, 2 and 2 on Low to Ultra) and keep their layers in between. A kept layer shows a car where it stood when the layer drew, so its shadow jumps forward on each draw and trails behind between draws. Since #211, every cascade past about 24 m does this.
2. Every object, at rest too, showed a thin lit line between its base and its shadow ("peter-panning"). It was widest in the far cascades.

After the first fix, the owner checked S4 on the iPad again. The cars' shadows followed the cars, but thin lines of light remained at objects' bases, and they appeared and vanished as the camera turned.

How should moving casters' shadows follow them in every frame, and how should the biases change so that shadows meet their casters without bringing back stripes of self-shadow (acne)?

## Rule

- A moving caster's shadow must sit where the caster is in every frame, on both GPU paths and every preset.
- A far cascade whose box holds still casters alone must still draw only in its turn.
- The fix must add no GPU memory and no per-frame allocation.
- Shadows must meet the base of a box on the ground in the near and the far cascades, and no surface may show acne in the shadow image tests or S4.
- Where a shadow meets its caster must not change while the camera turns on the spot.

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

### Why the lines changed as the camera turned

The first fix scaled each bias by texels of the cascade that holds the point. A point picked its cascade by its distance along the camera's view. That distance changes as the view turns on the spot, but the distance from the camera does not. So a turn moved points between cascades. With the defaults, one texel covers 2.8, 6.6 and 23 cm of the ground in the three cascades ([Where the cascades split](../../docs/concepts/shadows.md#where-the-cascades-split)). A point that moved to the next cascade got a bias three or four times larger. Its filter also read texels three or four times larger. So the lit line at a base widened or narrowed at once.

The options were:

1. Biases in meters, scaled by the surface's angle to the light, with one texel of the point's cascade as a cap. A bias in meters keeps its size in every cascade. The cap stops a bias set for coarse far texels from lifting a receiver many texels off a fine near map.
2. Biases in meters that are at least a share of a texel: a floor of 0.1 and 0.3 texels. In far cascades the floor is larger than any useful bias in meters. So the bias counts texels there again, and it still jumps between cascades.
3. A cap at the first fix's defaults, 0.2 and 0.3 texels, instead of one texel. A user who raised a bias to clear acne could then never go past those defaults on a fine map.
4. Receivers that pick their cascade by their distance from the camera, as Unity's "Stable Fit" cascades do. A turn on the spot then never moves a point to another cascade. The cascades' boxes stay as they are. Each box holds a sphere around its slice, which is wide enough for the points near the view's edges that this moves into it. A point that a box misses reads the next cascade, as before. Behind an orthographic camera, whose cascades have texels of one size, a receiver still uses its distance along the view.

three.js gives `normalBias` in world units, as option 1 does. It gives `bias` in depth units of the light's one map.

The `shadows-contact-turn` browser test draws the contact scene's `turn` view, about 27 m from a box. The box stands just past where the first cascade ends. The test turns the camera on the spot by 20 and 25 degrees, and maps each pixel of a turned frame onto the first frame. Then it counts the ground pixels whose brightness changed by more than a tenth of the lit ground's. The table gives the counts at 25 degrees, of about 78,400 ground pixels (Chrome on the Mac, WebGPU, 3 October 2026):

| Receivers pick their cascade by | Biases | Pixels that changed |
| --- | --- | --- |
| Distance along the view | 0.2 and 0.3 texels, the first fix | 214 (0.27%) |
| Distance along the view | none | 185 (0.24%) |
| Distance from the camera | 0.2 and 0.3 texels | 32 (0.04%) |
| Distance along the view | 0.01 and 0.02 m, capped at one texel | 186 (0.24%) |
| Distance from the camera | 0.01 and 0.02 m, capped at one texel | 36 (0.05%) |

So the change of cascade made most of the change, not the bias. Without option 4, biases in meters and even no bias left most of it. The filter reads three texels on each side, so a coarser cascade softens the base and widens its lit line, whatever the bias. The few pixels left change where a pixel rounds onto an edge. WebGL2 gave 39. The test allows 0.1%. With distance along the view, it fails on both GPU paths: 0.20% of the pixels changed at 20 degrees.

Option 4 has a cost. A point near the side of the view is further from the camera than along the view. So it can read a coarser cascade than before. In S4's hold frame on the Mac, 0.42% of the pixels changed by more than 30 in the sum of red, green and blue. The cars near the left edge of the view now read the last cascade's 23 cm texels. They read the middle cascade's 6.6 cm texels before, so their shadows are softer. Without option 4, the base of a box changes from soft to sharp as a turn moves it from one cascade to the next.

A lit line remains at a base with no bias at all. The box's bottom face lies at the ground's depth. So the filter's reads under the box compare equal depths, and about half of them read lit. Biases only widen that line.

Biases in meters make the lines in far cascades thinner. The next table gives the ground's brightness just past a box's base, as a share of the lit ground's brightness. It reads the 1st and 2nd pixel past the base in the `shadows-contact` views (Chrome on the Mac, WebGPU). All its figures come from one reading of the images, so they compare with each other. The first fix's table above used another reading. With this reading, the first fix's committed reference reads 0.62 from above.

| View | First fix (0.2 and 0.3 texels) | Meters (0.01 and 0.02 m, capped at one texel) | No bias |
| --- | --- | --- | --- |
| From above, last cascade | 0.62 | 0.57 | 0.56 |
| Low angle, last cascade | 0.53 and 0.59 | 0.45 and 0.50 | 0.42 and 0.48 |
| Low angle, first cascade | 0.54 and 0.44 | 0.51 and 0.42 | 0.43 and 0.40 |

WebGL2 read within 0.02 of each figure. Larger biases in meters thicken the lines again: 0.02 and 0.03 m read 0.58 from above, and 0.03 and 0.05 m read 0.59. With no bias at all, the `shadows`, `spot-shadows` and `point-shadows` scenes showed no acne. The casters draw only their faces that point away from the light. So a closed mesh's lit faces compare with its far side. Acne would need a caster drawn with both faces, such as a double-sided plane. A user who sees it there raises the biases, up to one texel.

## Decision

Option (b): a far cascade draws in every frame while a moving caster touches its box, or touched the box its layer holds. It is the only option that adds no memory, no pass and no shader read, and it costs a cascade's draw only where a moving caster needs it. Option (c) would save at most about half of that draw on the Mac, for 32 to 192 MiB of memory and a new depth path on WebGL2. Option (a) would double the filter's reads on most of S4's pixels.

The receivers scale their biases by their angle to the light. After the iPad's second check, options 1 and 4 of the bias options apply together. The biases are in meters, capped at one texel of the point's cascade or tile. A receiver behind a perspective camera picks its cascade by its distance from the camera. The defaults become 0.01 m for `bias` and 0.02 m for `normalBias`. Spot and point lights take the same biases in meters, capped at one texel of their tile at the point's distance from the light.

## Consequences

- `MovingCasters` and `CascadeSchedule::plan` in `crates/null3d-render/src/shadows.rs` hold the test; both frame builders call it through `SceneSettings::shadow_frame`. The Rust tests check the schedule with a moving caster, and that recording frames with one allocates nothing.
- `bias_offset` in `crates/null3d-shaders/wgsl/lib/shadows.wgsl` caps and scales the biases of the directional light and of spot and point lights, and `sun_shadow` picks the cascade. The shadow uniform holds the biases in meters and each cascade's texel size (`ShadowUniform` in `crates/null3d-render/src/shadows.rs`). The defaults are in `crates/null3d-core/src/lights.rs`.
- The browser test `moving-shadow.spec.ts` drives a dynamic box in the last cascade, live, with far cascades every 8th frame. The offset between the box and its shadow must match the offset with every cascade drawn in every frame, within 5 pixels. Without the fix, it strayed by 7.3 pixels in the first runs, and by 15 to 25 pixels in ten runs on 3 October 2026. The limit was 3 pixels at first. A texel of the last cascade covers about 3.6 pixels, and the shadow's edges step across whole texels as the box drives. So a shadow that follows its box still strays by up to 3.8 pixels on SwiftShader under load, which failed CI. Hold mode cannot show the lag, as it draws one frame, in which every cascade draws.
- The `shadows-contact`, `shadows-contact-near` and `shadows-contact-far` image tests hold the contact at the base. The `shadows-contact-turn` browser test holds it while the camera turns.
- The benchmark pages take `?far=<n>`, which S4 applies as its `farCascadeInterval`.
- `concepts/shadows` describes the changes, and the API notes give the biases in meters and their defaults.
- A user's bias above one texel acts as one texel. The cap binds the defaults only where a texel is under 2 cm. A 2,048 map's first cascade has 2.8 cm texels with the default distance, so the defaults act in full there.
- The iPad's S4 run on WebGPU at Medium, before and after, is still to come.
