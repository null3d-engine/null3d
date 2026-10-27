# D-16: Moving casters in far cascades, and where shadows meet their casters

Status: decided by the owner and built on every preset. The owner accepted the cost of following moving casters at Low, and the receiver plane's cost on the iPad ([D-83](D-83-m1-gate-rulings.md), rulings 11 to 13). [D-169](D-169-anti-acne-plane-cost.md) found no cheaper form of the plane that keeps the images. Not done yet: an iPad check of S4 at Medium on WebGPU with the casters' offset. Tasks: M1-F3 and M1-K5.

Summary: Far cascades follow moving casters on every preset, at no memory cost and 0.1 to 0.3 ms of GPU time at Low on the iPads. The biases are 0.01 and 0.02 m, scaled by each surface's angle to the light and capped at one texel. Receivers pick cascades by distance from the camera, casters' back faces move toward the light, and the sun's texels compare with the receiver's plane.

## Question

Without this record's design, S4 on the iPad (WebGPU, Medium) shows three faults:

1. The cars' shadows jitter, and a gap opens behind each car while it drives. Far cascades draw once every `farCascadeInterval` frames (4, 3, 2 and 2 on Low to Ultra) and keep their layers in between (#198). A kept layer shows a car where it stood when the layer drew. So its shadow jumps forward on each draw and trails behind between draws. With the split of [D-15](D-15-cascade-split.md), every cascade past about 24 m does this.
2. Every object, at rest too, shows a thin lit line between its base and its shadow ("peter-panning"). It is widest in the far cascades, and it appears and vanishes as the camera turns.
3. Low flat casters, such as the pavement slabs, show rings and stripes of self-shadow (acne). The reference frame, with a 4,096-texel map, shows none.

How should moving casters' shadows follow them in every frame? How should the biases change so that shadows meet their casters without bringing back acne? What else keeps a lit line at a base?

## Rule

- A moving caster's shadow must sit where the caster is in every frame, on both GPU paths and every preset.
- A far cascade whose box holds still casters alone must still draw only in its turn.
- The fix must add no GPU memory and no per-frame allocation.
- Shadows must meet the base of a box on the ground in the near and the far cascades. No surface may show acne in the shadow image tests or S4.
- Where a shadow meets its caster must not change while the camera turns on the spot.

## Data

### What caching the far cascades saves

S4 in Chrome on the MacBook Pro, WebGPU, High (far cascades every 2nd frame), `bun run bench:run --scenes s4 --pages null3d-webgpu --runs 3 --seconds 8`. It ran with and without `--switches far=1`, on a build whose far cascades keep their turns around moving casters:

| Measure | Far cascades in turn | Every cascade in every frame |
| --- | --- | --- |
| GPU ms per frame | 1.40 | 1.59 |
| Nearest cascade's pass | 0.087 ms | 0.087 ms |
| Far cascade passes | 0.163 ms, one per frame | 0.162 and 0.200 ms |
| Draw calls per frame | 63 | 70 |

So one far cascade's pass costs 0.16 to 0.20 ms, and drawing the far cascades in turn saves 0.19 ms per frame here.

### The options for moving casters

- (a) A second depth target for the moving casters, drawn in every frame, beside the kept layer of still casters. Each receiver in a far cascade then reads both. That doubles the filter's reads: 8 instead of 4 with the 3 x 3 filter, and 18 instead of 9 with the 5 x 5. Most of S4's pixels lie in far cascades. It also needs a second shadow map binding in every scene pipeline, and a layer of GPU memory for each far cascade.
- (b) Draw a far cascade in every frame while a moving caster touches its box. It adds no memory, pass or shader change. Its cost is the cascade's draw, 0.16 to 0.20 ms per far cascade on the Mac. It pays that only in frames where a moving caster is in the box.
- (c) Keep a copy of each far cascade's still casters. In every frame, copy it into the layer, then draw the moving casters over it. Each far cascade then needs a copy of its layer and a pass that loads and stores it in every frame. On the Mac, a pass that loads and stores one 2,048-texel layer took 0.045 ms (Chrome's GPU timestamps, 250 frames). A pass that clears and stores it took 0.012 ms. The copy itself does not show between pass timestamps. Its cache takes 16 MiB per far cascade at 2,048 texels and 64 MiB at 4,096. That is 32 MiB for the light's defaults, and 192 MiB for 4 cascades of 4,096. The draw lists cannot copy depth textures on WebGL2, so that path would need a pass that writes depth from a texture.

three.js's cascaded shadow addon (`CSM`) draws every cascade in every frame, as option (b) does where moving casters fill the far cascades.

### What option (b) costs

The engine lists the scene objects that cast shadows and move in every frame: each dynamic object, and each object under a dynamic one. It lists them again only when the scene's structure changes. In each frame it tests each listed caster's sphere against the box of each far cascade whose turn has not come. It also tests the box that the cascade's layer holds. The test works in 64-bit floats from the world's origin. A cascade that a moving caster touches draws. A cascade whose layer drew a moving caster draws once more after the caster leaves, so its old shadow goes.

In S4, 200 dynamic cars drive through every cascade's box, so every cascade draws in every frame. On the Mac, S4's cascade passes took 0.087, 0.162 and 0.203 ms per frame, with 70 draw calls. These are the figures of `far=1` above: about 0.19 ms per frame more than cascades in their turns. The frame's own GPU time could not be compared cleanly in those runs. Other work on the Mac moved the scene's pass from 0.8 to 3 ms between runs. A scene whose moving objects stay near the camera, such as a character in a town, keeps the whole saving.

The governor lengthens `farCascadeInterval` when frames run long. Where moving casters fill the far cascades, that step saves nothing, and the governor's other steps do the work.

### Moving casters at Low

Phones and tablets run S4 at Low. The soak opens S4 with no preset, so the engine picks one. A tablet starts at Medium, and the preset check lowers it when Medium misses 90% of the target. On the owner's iPad, S4 at Medium measures 30 to 46 fps, so the check picks Low. The cloud iPad's soak runs Low too.

#### Why Low follows moving casters

With far cascades in their turns at Low, every car's shadow in S4 jerks behind its car, and the trail reaches every shadow on screen. Low has two cascades, and the nearest ends 37.9 m from the camera. S4's camera flies 42 m up and sees no ground nearer than about 40 m ([D-15](D-15-cascade-split.md)). Receivers pick their cascade by their distance from the camera, so every receiver reads the far cascade. At Low's interval of 4, its layer draws once in 4 frames. Each car's shadow holds still for 3 frames, then jumps 4 frames of driving. For S4's cars at 6 to 14 m/s, that is 0.4 to 0.9 m, 15 times a second. The governor's far cascade step can double the interval to 8, which makes the trail 7 frames, up to 1.6 m. By the owner's ruling, no lag is better than lag, so Low follows moving casters, as Medium and up do.

While `followMovingCasters` is off, the governor takes no far cascade step. A far cascade then keeps its turns around moving casters, and a longer interval would only make their shadows trail further. So the trail never passes the interval that the sketch set, as the docs say.

Only a test of moving shadows at each preset's own setting catches a trail. Image tests draw one frame in hold mode, in which every cascade draws, and the Mac runs High. A test that sets `followMovingCasters` itself never runs a preset's own value. Device runs that judge frame rates and GPU time measure no moving shadow.

#### The cost on the iPads

The cloud iPad 10th, in Safari 27.0, timed three builds in turns. S4 ran on WebGPU at Low, with the governor off, for 30 s per run. One build kept Low's far cascade in its turns (56 draw calls, and 63 in 1 frame of 4). One followed moving casters (63 in every frame), and one used the still-caster cache below. The cloud session streams the screen, and that sets how long each frame waits for the GPU. The wait differed between sessions, so only GPU times from sessions with a similar wait compare. The figures are each run's median GPU time per frame:

| Sessions | Turns at Low | Following | Still-caster cache |
| --- | --- | --- | --- |
| Wait of about 12 ms | 6.36 ms | 6.47 ms | no run |
| Wait of about 45 ms | 13.18 ms | 13.65 ms | 13.76 and 13.13 ms |

So following costs about 0.1 ms of GPU time per frame on the cloud iPad. The slow sessions doubled every time, and no build differed there by more than 0.6 ms.

The owner's iPad Pro 11-inch (iPadOS 26.7, Safari 26.6.2, Limit Frame Rate on, 60 Hz) checked the build that follows moving casters at Low, 21fbae72c. It ran against main at 8699fab4e, which kept Low's turns. The two differ only by that change. The check had three parts:

1. By eye. The soak opened S4 with no preset, and the engine's check picked Low (Medium 35.3 fps, Low 57.6 fps). It ran 5 minutes at a median of 59.6 fps, with no GPU loss and flat memory. The owner approved the cars' shadows.
2. The moving shadow page, on the build that follows. It ran Low and Medium on both GPU paths, with far cascades every 8th frame and in every frame. Each run read 60 frames. The largest gaps between the two were 3.24 px (WebGPU, Low), 4.11 px (WebGPU, Medium), 3.02 px (WebGL2, Low) and 3.27 px (WebGL2, Medium). The limit is 5 px.
3. GPU time. S4 ran on WebGPU at Low, with the governor off, for 30 s per run, the two builds in turns. A first run with turns held only 55.5 fps, so a further pair replaced it.

| Run | GPU ms per frame: median, p95, p99 | Draw calls: median, p99 | Frame rate |
| --- | --- | --- | --- |
| Turns at Low | 11.42, 12.48, 12.68 | 56, 63 | 60.0 fps |
| Turns at Low | 11.64, 12.95, 13.28 | 56, 63 | 60.1 fps |
| Following | 11.73, 12.93, 13.06 | 63, 63 | 59.9 fps |
| Following | 11.70, 13.00, 13.14 | 63, 63 | 59.9 fps |
| Following | 11.99, 13.19, 13.33 | 63, 63 | 59.9 fps |

The turns' medians average 11.53 ms, and following's 11.81 ms. So following costs about 0.3 ms of GPU time per frame (2.4%) on this iPad, and every run held 60 fps. With the governor on, for 300 s, the turns took 22 quality steps and following 21. Both held 60 fps in 98% of the seconds, and neither went below a render scale of 0.7. The owner accepted the 0.3 ms.

A GPU timer that times one frame in 8 can time no frame that holds a far cascade drawn once in 4 frames. It then reads the turns as cheaper than they are. The gate's comparison with such a timer put the cost at about 1 ms (10%) on the iPads.

#### The still-caster cache

Option (c) at Low alone: a far cascade draws its still casters into a cache layer of 4 MiB in its turns. Every other frame copies that layer in and draws only the cars over it. It was built, and its draw calls matched the design: 64 between turns and 71 in them, against 63 in every frame when following. It can save at most following's 0.1 ms on the cloud iPad. For that, Low pays 4 MiB, a second shadow pass in its turns and a depth copy. Both frame builders also split still and moving casters. The owner dropped it.

### Where shadows meet their casters

Casters draw only their faces that point away from the light, as three.js draws them. A box's bottom face is one of those, and it lies on the ground. Each receiver moves its point along its normal by `normalBias`, and its depth toward the light by `bias`. Then it compares over a square of 3 or 5 texels. Near a box's base, the moved point stands above the bottom face, so the filter's reads that land under the box read "lit". A cascade's texels grow with distance, so with biases in texels the lit line widens in the far cascades. Their texels are 28 cm in the test below, and 23 cm in S4's last cascade.

Both biases scale by the surface's angle to the light. The normal offset scales by the angle's sine, and the depth offset by its tangent, up to twice the setting. A surface that faces the light takes little of either, and one at a steep angle, where depth changes fastest across a texel, takes more. Unity's built-in shadows scale their normal offset by the same sine. Spot and point lights take the same shares.

The `shadows-contact` image tests place car-sized boxes on a street under S4's sun, with a 512-texel map so the last cascade's texels are about S4's. The table gives the brightness of the ground just past each box's base, as a share of the lit ground's (Chrome on the Mac, WebGPU). Full shadow reads about 0.34. On this ground, under this sun, constant biases of 0.5 and 1 texel give the same offsets as scaled shares of 0.68 and 1.69.

| View | Constant (0.5 and 1 texel) | Scaled (0.2 and 0.3 texels) | No bias |
| --- | --- | --- | --- |
| From above, last cascade: first pixel past the base | 0.75 | 0.56 | 0.50 |
| Low angle, first cascade: first and second pixel | 0.67 and 0.59 | 0.53 and 0.44 | 0.43 and 0.40 |
| Low angle, last cascade: first and second pixel | 0.72 and 0.82 | 0.58 and 0.63 | 0.47 and 0.53 |

Scaling closes about three quarters of the lit line from above, and most of it at a low angle. With scaled biases, no stripes showed in the shadow tests with 1 to 4 cascades or the 5 x 5 filter. The tests of custom materials, half precision and the depth prepass showed none. The spot and point light tests and S4 showed none either.

### Why the lines change as the camera turns

Biases in texels of the cascade that holds a point take that cascade's texel size. A point can pick its cascade by its distance along the camera's view. That distance changes as the view turns on the spot, but the distance from the camera does not. With the defaults, one texel covers 2.8, 6.6 and 23 cm of the ground in the three cascades ([Where the cascades split](../../docs/concepts/shadows.md#where-the-cascades-split)). A point that moves to the next cascade gets a bias three or four times larger. Its filter also reads texels three or four times larger. So the lit line at a base widens or narrows at once.

The options:

1. Biases in meters, scaled by the surface's angle to the light, with one texel of the point's cascade as a cap. A bias in meters keeps its size in every cascade. The cap stops a bias set for coarse far texels from lifting a receiver many texels off a fine near map.
2. Biases in meters that are at least a share of a texel: a floor of 0.1 and 0.3 texels. In far cascades the floor is larger than any useful bias in meters. So the bias counts texels there again, and it still jumps between cascades.
3. A cap at 0.2 and 0.3 texels instead of one texel. A user who raised a bias to clear acne could then never go past those figures on a fine map.
4. Receivers that pick their cascade by their distance from the camera, as Unity's "Stable Fit" cascades do. A turn on the spot then never moves a point to another cascade. The cascades' boxes stay as they are. Each box holds a sphere around its slice, which is wide enough for the points near the view's edges that this moves into it. A point that a box misses reads the next cascade. Behind an orthographic camera, whose cascades have texels of one size, a receiver still uses its distance along the view.

three.js gives `normalBias` in world units, as option 1 does. It gives `bias` in depth units of the light's one map.

The `shadows-contact-turn` browser test draws the contact scene's `turn` view, about 27 m from a box. The box stands just past where the first cascade ends. The test turns the camera on the spot by 20 and 25 degrees, and maps each pixel of a turned frame onto the first frame. Then it counts the ground pixels whose brightness changed by more than a tenth of the lit ground's. The table gives the counts at 25 degrees, of about 78,400 ground pixels (Chrome on the Mac, WebGPU):

| Receivers pick their cascade by | Biases | Pixels that changed |
| --- | --- | --- |
| Distance along the view | 0.2 and 0.3 texels | 214 (0.27%) |
| Distance along the view | none | 185 (0.24%) |
| Distance from the camera | 0.2 and 0.3 texels | 32 (0.04%) |
| Distance along the view | 0.01 and 0.02 m, capped at one texel | 186 (0.24%) |
| Distance from the camera | 0.01 and 0.02 m, capped at one texel | 36 (0.05%) |

So the change of cascade makes most of the change, not the bias. Without option 4, biases in meters and even no bias leave most of it. The filter reads three texels on each side, so a coarser cascade softens the base and widens its lit line, whatever the bias. The few pixels left change where a pixel rounds onto an edge. WebGL2 gave 39. The test allows 0.1%. With distance along the view, it fails on both GPU paths: 0.20% of the pixels changed at 20 degrees.

Option 4 has a cost. A point near the side of the view is further from the camera than along the view. So it can read a coarser cascade. In S4's hold frame on the Mac, option 4 changes 0.42% of the pixels. Each changes by more than 30 in the sum of red, green and blue. The cars near the left edge of the view read the last cascade's 23 cm texels, so their shadows are softer. Distance along the view gives them the middle cascade's 6.6 cm texels. Without option 4, the base of a box changes from soft to sharp as a turn moves it from one cascade to the next.

A lit line remains at a base with no bias at all. The box's bottom face lies at the ground's depth. So the filter's reads under the box compare equal depths, and about half of them read lit. Biases only widen that line.

Biases in meters make the lines in far cascades thinner. The next table gives the ground's brightness just past a box's base, as a share of the lit ground's brightness. It reads the 1st and 2nd pixel past the base in the `shadows-contact` views (Chrome on the Mac, WebGPU). All its figures come from one reading of the images, so they compare with each other. The table of scaled biases above used another reading; with this reading, biases of 0.2 and 0.3 texels read 0.62 from above.

| View | 0.2 and 0.3 texels | Meters (0.01 and 0.02 m, capped at one texel) | No bias |
| --- | --- | --- | --- |
| From above, last cascade | 0.62 | 0.57 | 0.56 |
| Low angle, last cascade | 0.53 and 0.59 | 0.45 and 0.50 | 0.42 and 0.48 |
| Low angle, first cascade | 0.54 and 0.44 | 0.51 and 0.42 | 0.43 and 0.40 |

WebGL2 read within 0.02 of each figure. Larger biases in meters thicken the lines again: 0.02 and 0.03 m read 0.58 from above, and 0.03 and 0.05 m read 0.59. With no bias at all, the `shadows`, `spot-shadows` and `point-shadows` scenes showed no acne. The casters draw only their faces that point away from the light. So a closed mesh's lit faces compare with its far side. Acne would need a caster drawn with both faces, such as a double-sided plane. A user who sees it there raises the biases, up to one texel.

### Lit lines at the base

With biases in meters, S4 on the iPad (WebGPU, Medium) shows rarer and thinner lit lines at the bases of objects, but some remain. They also seem to move as the camera turns.

Casters draw only their faces that point away from the light, and a box's bottom face is one of those. It lies on the ground, so the map holds it at the ground's depth under the box. The filter reads a square of texels around each point. Near a box's base, some of those reads land under the box. Where the ground there is level with the point, or further from the light, the read compares equal or lower depths. It then comes out lit. So the ground just past the base shows a thin lit line, even with no bias. Coarser texels reach further under the box, so the line widens in far cascades.

The contact check measures the line ([Image tests](../image-tests.md)). It finds each foot of a dark side on the ground in the normals view. Then it adds the light between the foot and the start of the shadow, in pixels of full light. The table gives the figures of the `shadow-contact` scene's views and of S4's hold frame, on WebGPU and WebGL2 (Chrome on the Mac):

| View | Without the offset | Without the offset or a bias | With the offset |
| --- | --- | --- | --- |
| Near the camera, first cascade | 0.159 and 0.152 | 0.072 and 0.064 | 0.020 and 0.016 |
| From far away, last cascade | 0.204 and 0.198 | 0.147 and 0.153 | 0.077 and 0.080 |
| Just past the end of the first cascade | 0.194 and 0.183 | 0.093 and 0.088 | 0.045 and 0.039 |
| The same, turned 25 degrees on the spot | 0.182 and 0.187 | | 0.032 and 0.033 |
| S4's hold frame | 0.050 and 0.040 | | 0.024 and 0.027 |

SwiftShader gave 0.159 and 0.169 without the offset and 0.023 and 0.025 with it, near the camera. In the last cascade it gave 0.224 and 0.223 without it and 0.087 and 0.088 with it. Just past the first cascade, it gave 0.254 and 0.252 without it and 0.061 with it. In S4's frame, it gave 0.072 without it and 0.042 and 0.043 with it.

With no bias, half to three quarters of the line remained. So the biases are not its main cause, and smaller biases cannot remove it. A turn does not widen the line either: it measured about the same at both angles. A turn moves the base's pixels across the texels, so the line breaks up in other places, and it seems to move. With the offset, little light remains at either angle.

The options:

1. In the shadow pass, move each caster's faces that point away from the light toward the light. The move is part of a texel of the map at the face. The bottom face then stays in front of the ground.
2. Draw the casters' front faces, as Unity's and Unreal's shadows do. The box's top then sits in the map above the ground at its base, and no read comes out lit. But every lit face then compares with itself. That needs biases of about a texel of each cascade. Such biases bring back the jumps between cascades that the biases in meters removed. It also brings acne back to every lit surface at a steep angle to the light.
3. Compare each of the filter's samples with the depth of the receiver's plane at the sample, which the surface's normal gives ("receiver plane depth bias"). On its own, it makes the line worse. The bottom face then compares equal at every read under the box. Together with option 1, it closed the line a little more, and it removed acne on a floor that casts shadows. But where option 1's offset fell short, it left more light than no change at all. With a 256-texel map and an offset capped at 10 cm, it raised the figures of the three views by 38% to 53%.

Option 1 takes three choices:

- How much of the offset each face takes. A full texel for every face that points away from the light closes the line in every view. But it shadows the boxes' own lit tops near their edges, as the walls below those edges move toward the light too. In the last cascade, the shadow on the tops past their edges is 0.69 pixels with a full texel, against 0.21 with no offset. So each face takes the square of the cosine of its angle away from the light. A box's bottom under S4's sun takes about two thirds of a texel. A wall that the light only grazes takes almost none. With that share, the tops' figure is 0.24 pixels.
- How large the offset is: one texel of the map at the face, times that share. Half a texel left about twice as much light at the bases near the camera.
- A cap in meters. A floor that casts shadows compares its lit top with its own bottom. A far cascade's texels can be larger than the floor is thick, and then the offset shadows the floor's top. The `far` view with a floor 20 cm thick that casts shadows shows it. With the 512-texel map, a full texel for every face, uncapped, put 54.6% of the frame in shadow, against 9.05% with no offset. With a 256-texel map, the weighted offset put 72.9% in shadow, uncapped, against 9.2% with no offset. A cap of 10 cm put 15.9% in shadow, and a cap of 5 cm 9.4%. With the 512-texel map, the 5 cm cap gave 9.10%. Larger caps close a little more of the line in the last cascade, so the cap is the largest that keeps such a floor clear.

A double-sided caster keeps its depth. Both its faces draw, so the map holds its lit face, which would then shadow itself. Spot and point lights take the same offset, in texels of their tiles at the face's distance from the light.

The offset brings no acne on the surfaces that the light grazes. The `shadow-contact` scene's `lit` view looks at the boxes' lit sides, one at 19 degrees to the light. Its share in shadow is 34.74% with and without the offset, uncapped too. S4's share in shadow is 23.35% with the offset, against 23.31%. The acne on S4's low flat casters, such as pavements, shows with and without the offset. It comes from the comparison of a flat caster's top with its own bottom, across coarse texels. The next section gives its cause.

### Acne on flat casters

S4's pavement slabs are 20 cm thick, and they cast shadows. Casters draw only their faces that point away from the light, so the map holds each slab's bottom under its lit top. The top and the bottom are parallel. S4's sun stands 54 degrees above the horizon. Under it, the bottom lies about 25 cm behind the top along the light, less the casters' offset of up to 5 cm. Across the filter's square, the bottom rises toward the light as fast as the top does. Per texel, it rises by the texel's size times the tangent of the light's angle to the top: 0.72 under S4's sun.

A filter that compares all its reads with one depth, the receiver's at its own point, shadows the slab's own top. The 5 x 5 filter reads texels up to 3 texels away. In S4's last cascade, with 23 cm texels, the bottom there rises 50 cm, so it stands in front of the top's point. Those reads come out shadowed, in stripes along the texel rows, and in rings where the stripes beat against the pixel grid. With the reference's finer texels, the bottom stays behind the top across the square.

The acne check measures it ([Image tests](../image-tests.md#visual-checks)). It finds the pixels of level surfaces that the reference shows in full light, at least 3 pixels from any shadow of the reference. The figure is the mean shadow on those pixels, in percent: each adds one less its shadow factor. The contact scene's `slabs` switch stands the boxes on a slab 20 cm thick that casts shadows, and `sun` lowers the sun. These views use the 5 x 5 filter and the scene's 512-texel map, whose last cascade has texels of about S4's.

The candidate causes:

- Depth precision in the far cascades. The map holds 32-bit floats. The stripes follow the filter's reads and the texel size, and they vanish when the reads follow the receiver's plane, with the same depths. So precision does not cause them.
- A normal offset that does not grow with the cascade's texels. Or a slope-scaled bias too small for level surfaces at a low sun. Either lifts the receiver by the same amount for every read. Raising them far enough to clear the far reads brings back the lit lines at bases. The biases in meters and the casters' offset remove those. Without a receiver plane, biases of 0.05 and 0.1 m cut the acne of the slab view under S4's sun from 15.77% to 8.40%. But the gap at the boxes' feet grows from 0.020 to 0.318 px near the camera. In the last cascade it grows from 0.077 to 0.265 px. Biases of 0.1 and 0.3 m cut it to 1.65%, with gaps of 0.564 and 0.639 px (WebGPU).
- The 5 x 5 filter's far reads, compared with one receiver depth. This is the cause: comparing each read with the receiver's plane removes most of the acne.

The options:

1. Each read compares with the receiver's plane at the read. It does so wherever the plane there lies nearer the light than the receiver's own depth. Each read of the comparison sampler blends four texels against one depth. So the plane's depth comes from the lowest of the four texels' centers, less 1 cm. The cascade's projection is orthographic, so the plane stays a plane in the map. Two directions along the surface give its change of depth per texel. A caster below the plane, such as the slab's own bottom, leaves the receiver lit. A caster on the plane or in front of it still shadows it. Every texel of the four lies at least as near the light as the lowest. So a box's bottom and its walls on the plane shadow the ground at their base. No read compares with a depth below the receiver's own, so no surface gets more shadow than with one depth.
2. Option 1, with the plane raised by the casters' offset, which every face that lies on the receiver took. It removed more of the acne, but walls that stand on the ground take a smaller offset than bottoms do, or none. Their reads near the base then came out lit.
3. A receiver plane depth bias at the read's own point, without the receiver's depth as a floor. This is option 3 of the contact options. It made the lit lines worse where the casters' offset fell short.
4. Compare each texel with the plane at its own center. The comparison sampler gives one result for four texels. So this needs four raw depths for each read: one gather on WebGPU, or four fetches on WebGL2. It also needs a second sampler binding.

The table gives the acne figure on WebGPU and WebGL2 (Chrome on the Mac):

| View | One depth | Option 1 | Option 2 |
| --- | --- | --- | --- |
| S4's hold frame, Medium and High | 0.720 and 0.694 | 0.035 and 0.014 | 0.033 |
| S4's hold frame, Low | 1.590 and 1.589 | 0.920 and 0.915 | 0.921 |
| Slabs from far away, S4's sun | 15.77 and 15.60 | 3.85 and 3.70 | 0.24 |
| Slabs from far away, sun 35 degrees up | 20.52 and 20.36 | 6.54 and 6.38 | 6.54 |
| Slabs from far away, sun 20 degrees up | 21.18 and 21.02 | 7.40 and 7.24 | 7.40 |
| The far view with a floor that casts, 3 x 3 filter | 9.71 and 9.55 | 9.71 and 9.55 | 0.07 |

Option 2 ran on WebGPU alone. It doubles the contact gaps: 0.041 px against 0.020 px near the camera, and 0.083 px against 0.045 px just past the first cascade.

Option 1 keeps the contact scene's gaps. They rise only where a slab casts, because the plane keeps acne from darkening the ground beside a foot, which the check counts as shadow. With a slab that casts no shadow, the slab views give the same gaps with and without the plane.

Option 1 leaves stripes where a read's four texels differ. Across them, the slab's bottom rises by up to the texel's size times the tangent, along each axis of the map. That rise can exceed the slab's depth behind its top. Then the texels that the read blends with small weights still compare in front, so faint stripes stay. The 3 x 3 filter's reads lie within a texel or two of the point, so it keeps most of its acne. The floor that casts keeps 9.71%. The stripes remain on S4 at Low, whose last cascade has texels twice as large, and in the slab views at a low sun. A larger map, a shorter distance or another cascade removes them, and so does option 4.

### One depth per texel

With option 1, S4 at Low in Chrome on the Mac (`?gpu=webgpu&preset=low&governor=off`) shows jagged bright lines. They lie between the bases of buildings and objects and the start of their shadows on the ground. The shadow seems to start a little away from each base, with a lit strip with stair-step edges in between.

Screenshots show the cause. They cover S4 at Low, Medium and High, on WebGPU, compatibility mode and WebGL2, and the three.js twin at the same settings. Medium and High show no lines. At Low, the pavement slabs show bright diagonal stripes, one shadow texel apart. Where the stripes meet a shadow's edge beside a building, they cut it into lit teeth. At the same camera, the three.js twin draws the nearest slabs without stripes, and the slabs a little further away with fainter ones.

The `'shadows'` debug view shows the stripes. So they are in the shadow factor, not in the specular light or in ambient occlusion, which Low turns off.

These are the stripes that option 1 leaves at Low. S4's Low preset has 2 cascades of 1,024 texels over 200 m. So a texel of its last cascade is about twice as large as Medium's 23 cm, about 46 cm. Each read of the comparison sampler blends four texels against one depth: the receiver's plane at the lowest of their centers, less 1 cm. Across one texel, under S4's sun, the slab's bottom rises toward the light by about 27 cm along the sun's direction. The bottom lies only 20 cm behind the top along the light, once the casters' offset has moved it. So in a read's texels toward the light, the slab's bottom stands in front of that one depth. Those texels then shadow the slab's own top.

The three.js twin's cascaded shadow addon splits the cascades halfway between the even and the logarithmic spread, against the engine's 65% ([D-15](D-15-cascade-split.md)). So its first cascade reaches further, and holds slabs near the camera that the engine's last cascade holds. Its slabs in its coarse cascade show the same stripes.

Other causes are ruled out:

- The biases. Both are in meters, capped at one texel and scaled by the surface's angle to the light. On S4's ground they move a receiver about 2 cm toward the light, against texels of 46 cm. Option 4 removes the stripes with the same biases.
- A normal offset that does not grow with the texels. It would lift every read by the same amount, and the stripes follow the texels of each read.
- The filter's size. Low's 3 x 3 square shows the stripes, and Medium's 5 x 5 square over finer texels hides most of them. But the comparison makes them: option 4 removes them with Low's 3 x 3 square.
- The casters' bottom faces. The slab's bottom is 20 cm below its top, as it should be. The buildings' bottoms lie on the slabs' tops, and the casters' offset keeps them in front of the ground.
- The three.js twin's settings. Its `normalBias` is null3D's default, 0.02 m, and its `bias` is the cascaded shadow addon's default, 0.000001.

Option 4 reads the four texels' depths on WebGPU with one `textureGather`, so the filter keeps its number of reads. The map binds as a float texture with a sampler that does not filter, because compatibility mode allows only comparison samplers on depth textures. WebGL2's shading language has no such read. There, the comparison sampler tests each texel at its center, so WebGL2 makes four reads for each of WebGPU's.

The contact scene's views, in Chrome on the Mac, WebGPU and WebGL2. Acne is the mean shadow on lit flat surfaces, in percent. The gap is the light between a box's foot and its shadow, in pixels. The rim is the shadow on the boxes' lit tops past their edges, in pixels. The `far-slabs-low` view has a 256-texel map and the 3 x 3 filter. So its last cascade's texels are about as large as S4's at Low.

| View | Acne, option 1 | Acne, option 4 | Gap, option 1 | Gap, option 4 | Rim, option 1 | Rim, option 4 |
| --- | --- | --- | --- | --- | --- | --- |
| `near` | 0.008 and 0.008 | 0.008 and 0.008 | 0.020 and 0.016 | 0.020 and 0.016 | 0.131 and 0.130 | 0.128 and 0.128 |
| `far` | 0.068 and 0.066 | 0.068 and 0.066 | 0.077 and 0.080 | 0.077 and 0.081 | 0.203 and 0.157 | 0.182 and 0.142 |
| `turn` | 0.000 and 0.000 | 0.000 and 0.000 | 0.045 and 0.039 | 0.045 and 0.039 | 0.204 and 0.173 | 0.199 and 0.170 |
| `far-ground` | 9.709 and 9.548 | 0.068 and 0.066 | 0.078 and 0.078 | 0.077 and 0.081 | 0.220 and 0.177 | 0.182 and 0.142 |
| `far-slabs` | 3.856 and 3.699 | 0.249 and 0.216 | 0.051 and 0.052 | 0.058 and 0.058 | 0.275 and 0.219 | 0.184 and 0.135 |
| `far-slabs-sun-35` | 6.539 and 6.376 | 0.378 and 0.345 | 0.217 and 0.234 | 0.221 and 0.238 | 0.411 and 0.351 | 0.229 and 0.178 |
| `far-slabs-sun-20` | 7.398 and 7.238 | 0.445 and 0.414 | 0.335 and 0.311 | 0.348 and 0.332 | 0.457 and 0.403 | 0.169 and 0.123 |
| `far-slabs-low` | 10.898 and 10.733 | 0.395 and 0.385 | 0.075 and 0.092 | 0.072 and 0.101 | 0.344 and 0.283 | 0.161 and 0.113 |

With option 4, a ground that casts shadows shows the acne of a ground that casts none. The gaps keep their figures. The slab views' gaps rise a little, as with option 1, because less acne beside a foot counts as shadow. The shadow on the boxes' own tops falls in every view. With option 4, SwiftShader gave 0.216 and 0.208, 0.352 and 0.343, and 0.419 and 0.412 in the three slab views. It gave 0.393 and 0.384 in `far-slabs-low`, and 0.071 and 0.069 with the casting ground.

S4 at Low was held at 2 s on the visual page, at 1,920 x 1,080. Its acne figure is 0.319% on WebGPU and 0.311% on WebGL2 with option 4, against 1.683% with option 1. Held at 25 s, from the side where the shadows face the camera, it is 0.375% against 1.836%. The contact gap stays at 0.005 pixels.

What remains comes from surfaces that are not planes across the filter's square. At a slab's edge, for example, the texels beyond the edge hold other surfaces.

GPU time of S4 at Low on the Mac (WebGPU, `bun run bench:run --compare`, 6 runs of 8 s each, medians of the runs' medians):

| Form of option 4 | Option 1 | The form | Change |
| --- | --- | --- | --- |
| Four comparisons per block | 1.568 ms | 1.637 ms | +0.069 ms |
| One gather, a loop over blocks with weights in arrays | 1.556 ms | 1.573 ms | +0.017 ms |
| One gather, with the blocks written out | 1.560 ms | 1.454 ms | -0.106 ms |

The loop indexed arrays by its counters, and the written-out form has no array at all. Each of its 6 runs was faster than each of option 1's 6 runs. At High, with the 5 x 5 filter, 4 runs each gave 1.822 ms with option 1 and 1.599 ms with the written-out form. Chrome on the Mac reports no GPU time for WebGL2, so WebGL2's four comparisons per block are not measured. Its CPU time did not change.

The Galaxy S24+ ran S4 at Low on WebGL2, with the governor off. It runs Chrome 154 on an Xclipse 940 through ANGLE on Vulkan, with its display at 60 Hz. Each turn ran 30 s, in the order option 1, option 4, option 1, option 4. The phone was cool at each start (thermal status 0, skin 32.2 °C to 33.2 °C through the turns, Samsung throttle level 0).

| Turn | Version | Seconds at 60 fps | Frame interval median / p95 / p99, ms | CPU ms median / p95 | All threads, ms | GPU delay median / p95, ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Option 1 | 30 of 30 | 16.67 / 16.80 / 16.92 | 4.26 / 6.72 | 5.50 | 15.88 / 20.15 |
| 2 | Option 4 | 29 of 29 | 16.67 / 16.81 / 16.98 | 4.28 / 6.71 | 5.49 | 15.81 / 17.33 |
| 3 | Option 1 | 29 of 29 | 16.67 / 16.79 / 16.88 | 3.97 / 6.53 | 5.16 | 15.88 / 17.84 |
| 4 | Option 4 | 29 of 29 | 16.67 / 16.78 / 16.89 | 4.26 / 6.66 | 5.49 | 15.82 / 17.52 |

Both versions held 60 fps for every measured second, with the same frame intervals. The CPU time did not change: option 4's two turns gave 4.28 and 4.26 ms, and option 1's gave 4.26 and 3.97 ms. The phone reports no GPU time. Chrome on Android has no WebGL2 timer queries, and the engine's WebGL2 path does not use them. The display caps the frame at 60 Hz. So the four reads per block fit inside the frame at Low, and do not show in the frame interval. The GPU delay is the time from a frame's submit to its end on the GPU. It includes the wait for the display, so it does not give the GPU's work either. Option 4's flat-surface acne was 0.012% against option 1's 0.014%, and its shadow edge offset 0.081 px against 0.102 px. The contact gap was 0.026 px on both.

To measure the cost itself on the phone, a page must draw faster than the display, as the effect cost page does. It draws frames back to back, with a pixel read at the end of each batch.

### The shadow reads on WebGL2 on Apple GPUs

With the governor off, the owner's iPad Pro 11 (Safari 26.6.2) draws S4 at Medium at 59.3 fps on WebGPU. WebGL2 draws 17.2 fps (run `20261006-010647-bench`). WebGL2 waited 56.4 ms per frame for the GPU, and its CPU time was 4.1 ms.

WebGL2 reads each texel of the sun's shadow map on its own. Medium's 5 x 5 filter then makes 36 reads per pixel on WebGL2 against 9 on WebGPU. GLSL ES 3.00 has no `textureLod` for an array comparison sampler. So naga writes each read at level 0 as `textureGrad` with zero gradients. ANGLE on Metal turns that into a Metal comparison with explicit gradients, which Apple's GPUs may run more slowly. On the S24+ at Low, the display's 60 Hz hides the 36 reads' cost, and Chrome on the Mac reports no WebGL2 GPU time.

A switch that only the measurements used picked one of four ways to read the sun's map on WebGL2:

1. `grad`: the reads that naga writes, with zero gradients.
2. `implicit`: the same comparisons with `texture()`, at the texture's own level.
3. `nearest`: naga's reads through a comparison sampler that does not filter.
4. `fetch`: `texelFetch` of each depth, compared in the shader, as WebGPU compares the depths that it gathers.

In Chrome on the Mac, all four drew the same image in the 5 image tests of the sun's shadows. That held on the Mac's GPU and on SwiftShader. 0.0000% of pixels differed.

S4 at Medium, governor off, drawing on the page's main thread, one setting changed per run. 20 s per run, in two rounds, the second in reverse order. Each cell gives frames per second and the median GPU delay in ms, round 1 then round 2.

| Run | Mac, Chrome 154 (M5 Max, 120 Hz) | iPad Pro 11, Safari 26.6.2 (60 Hz) |
| --- | --- | --- |
| WebGPU | 120.0 / 4.6, 120.0 / 5.0 | 58.5 / 24.2, 55.5 / 26.7 |
| WebGL2 | 98.4 / 17.1, 103.8 / 16.7 | 15.8 / 61.8, 15.6 / 62.2 |
| `implicit` reads | 120.0 / 8.2, 120.0 / 8.2 | 17.0 / 57.9, 16.9 / 58.2 |
| `nearest` reads | 108.5 / 16.7, 120.0 / 9.7 | 15.7 / 62.0, 15.7 / 62.5 |
| `fetch` reads | 120.0 / 8.2, 120.0 / 8.2 | 16.2 / 60.1, 16.1 / 60.6 |
| Filter of 3 x 3 | 117.8 / 16.2, 120.0 / 8.2 | 18.1 / 54.0, 18.0 / 54.5 |
| FXAA instead of 4x multisampling | 92.9 / 23.7, 110.2 / 16.7 | 17.8 / 54.6, 17.6 / 54.8 |
| Pixel ratio capped at 1.5 | 120.0 / 8.9, 120.0 / 8.2 | 26.6 / 36.9, 26.5 / 37.1 |
| 2 cascades of 1,024 texels | 106.8 / 16.7, 116.7 / 16.6 | 16.1 / 60.4, 16.2 / 60.1 |
| Far cascade every 4th frame | 104.1 / 16.7, 117.6 / 16.5 | 15.8 / 61.9, 15.8 / 61.6 |
| No cascade blend | 108.9 / 16.7, 120.0 / 15.0 | 16.1 / 61.0, 16.0 / 61.1 |
| No software occlusion culling | 107.8 / 16.7, 120.0 / 9.6 | 15.7 / 62.1, 15.7 / 62.1 |
| Low preset | 120.0 / 8.2, 120.0 / 8.2 | 36.3 / 26.7, 36.2 / 26.7 |

The Mac ran at a 1-minute load of 11.7 at the start and 2.8 at the end. The iPad's runs are `20261006-042859-bench` to `20261006-045519-bench`, on power. On the iPad, WebGPU's GPU time was 18.0 and 19.0 ms. Every WebGL2 run on the iPad was GPU-bound: the GPU delay matched the frame interval, and the CPU took 1.3 to 4.8 ms.

On the Mac, the `implicit` and `fetch` reads halved WebGL2's GPU delay, to Low's. On the iPad, `implicit` was the fastest read. Its frames took 59 ms against 62 to 63 ms, in both rounds: about 5% more frames. `fetch` saved 1 to 2 ms, and `nearest` nothing.

The shadow reads therefore explain only about 3 ms of the iPad's 62 ms. The frame time follows the pixel count: 1.78 times fewer pixels took 37 ms. Low, at the same pixel count as that run, took 27 ms. WebGPU at Medium took 18 to 19 ms for 1.78 times as many pixels. So on the iPad, WebGL2 costs about three times WebGPU's GPU time per pixel at every preset. Other iPad runs agree: S4 at Low drew about 30 fps on WebGL2 ([D-09](D-09-half-precision.md)). That per-pixel cost is the real cause of the gap between WebGL2 and WebGPU on the iPad. It lies outside the shadow reads, and it is open.

### The receiver plane's cost on the iPad, and a cheaper form

The gate's second comparison of S4's GPU time ran on the owner's iPad, at Low on WebGPU with the governor off. Each build ran 30 s twice, in the order A, B, D, E, F, G, H ([Releases](../releases.md#s4s-gpu-time-at-low-the-second-comparison)). Every build had the newer GPU timer, the cascade loops of #364, and no copies of #353's argument buffers, unless its row says otherwise. Every run drew 60 fps with 56 draw calls in most frames.

| Build | GPU ms per frame, median, the two runs | Against B |
| --- | --- | --- |
| A: f46c0686, the older commit | 9.74, 9.89 | -1.08 ms |
| B: main 8699fab4 | 10.95, 10.84 | |
| D: the gate commit fdf14a28 | 10.30, 10.24 | -0.62 ms: every change merged after the gate commit |
| E: B without #343's cascade blend and box fitting | 10.46, 10.33 | -0.50 ms |
| F: B with the sun's receiver plane off | 9.70, 9.70 | -1.19 ms |
| G: B without #350's later timestamp reads | 11.09, 10.91 | +0.11 ms, within the runs' spread |
| H: B with #353's argument copies, as Safari makes them | 10.91, 10.80 | -0.04 ms |

So the receiver plane of [Acne on flat casters](#acne-on-flat-casters) costs 1.19 ms of the iPad's frame at Low, 11% of it. That is more than the whole gap of 1.08 ms to the older commit: without the plane, S4 took 0.12 ms less than that commit. Both runs of F failed the shadow check, as the plane's acne fix predicts. They put 0.870% of open lit ground in shadow, against a limit of 0.2%. The band of #343 reads a second layer, plane and all, so its share overlaps the plane's. On the Mac in Chrome, the plane cost 0.10 ms of about 1.33 ms, 7.5%.

By the owner's rulings, the plane's arithmetic may change if the image does not ([D-83](D-83-m1-gate-rulings.md), rulings 11 to 13). Whatever cost the cheaper form leaves is accepted as this record's cost.

`receiver_plane` works out the plane from the normal. Each cascade's projection is orthographic, so each of its matrix's first three rows is one of the light's axes, scaled. So the depth's change per texel along each axis is the normal's share along that axis over its share toward the light. The rows' squared sizes scale it. That takes one matrix product of the normal and three dot products. The plane from two directions along the surface takes two cross products, a normalize, three matrix products and a determinant. In double precision, 20,000 random normals and cascade boxes gave the same slope to within 7.6e-15 of its size. The plane in the band of [D-73](D-73-cascade-blend.md) gets cheaper the same way.

The cheaper form draws the same images. The image tests of the sun's shadows, S2, S4, the lit materials and the cascade seam pass with no reference changed. They pass 92 of 92 on the Mac's GPU and 92 of 92 on SwiftShader. The shadow checks, contact, turn and moving shadow specs pass too: 96 of 96 on the Mac's GPU, and 93 with 3 skipped on SwiftShader.

On the owner's iPad Pro 11-inch (Safari 26.6.2), S4 at Low on WebGPU with the governor off, the cheaper form wins back about 0.1 ms. Five builds ran in turns, 30 s each, 2 rounds, all at 60 fps (runs 20261006-160634-bench to 20261006-163236-bench). Every run passed the shadow image check. GPU time per frame, the mean of the 2 rounds:

| Build | GPU ms per frame |
| --- | --- |
| gr-a11: the older commit f46c0686, with the new GPU timer | 9.68 |
| gr-q3: main at 8699fab4e without #353, with the cascade loop fix | 10.79 |
| gr-q3p: gr-q3 with the cheaper form | 10.71 |
| gr-m0: main at 90729ce39 | 11.20 |
| gr-m: gr-m0 with the cheaper form | 11.10 |

Main with the cheaper form takes 1.42 ms (15%) more than the older commit. The plane takes about 1.1 ms of that, and #359's far layers about 0.3 ms. S4 at Low holds 60 fps, with about a third of the frame spare. [D-169](D-169-anti-acne-plane-cost.md) looked for why the plane costs this much on Apple GPUs, and for a cheaper method. It found no cheaper form that keeps the images.

## Decision

Moving casters: option (b) holds on every preset. A far cascade draws in every frame while a moving caster touches its box, or touched the box its layer holds. The `followMovingCasters` quality setting holds the choice: on for every preset, and live, so a sketch can turn it off. While it is off, the governor takes no far cascade step. Option (b) is the only option that adds no memory, no pass and no shader read. It costs a cascade's draw only where a moving caster needs it. At Low it costs about 0.1 ms of GPU time per frame on the cloud iPad. On the owner's iPad it costs about 0.3 ms, which the owner accepted. Surfaces that face away from the sun skip the shadow lookup.

Biases: options 1 and 4 of the bias options apply together. The receivers scale their biases by their angle to the light. The biases are in meters, capped at one texel of the point's cascade or tile. A receiver behind a perspective camera picks its cascade by its distance from the camera. The defaults are 0.01 m for `bias` and 0.02 m for `normalBias`. Spot and point lights take the same biases in meters, capped at one texel of their tile at the point's distance from the light.

Contact: option 1 of the contact options applies. The shadow pass moves each caster's faces that point away from the light toward it. A face moves by one texel of the map at the face, times the square of the cosine of its angle away from the light. It moves at most 5 cm. Double-sided casters keep their depth.

Flat casters: option 4 of the flat caster options applies, on every preset. The directional light's filter compares each texel with the receiver's plane at the texel's center. Where the receiver's own depth lies nearer the light, it uses that. WebGPU reads four texels at once, with the blocks written out, and WebGL2 compares them one at a time. In WebGL2's `standard` depth mode, the comparison sampler passes every test, so every surface stays lit there. The plane takes the cheaper form. Spot and point lights keep the comparison sampler's blend and one depth for all reads. Their tiles' projections are not orthographic, and the `spot-shadows` and `point-shadows` scenes show no such acne.

WebGL2 reads every comparison sampler at level 0 with `texture()`, at the texture's own level, where naga writes `textureGrad` with zero gradients. That covers the sun's shadow map and the atlas of spot and point lights. Each shadow map has one level, so the reads give the same result. The filter keeps its 4 comparisons per block of 2 x 2 texels on WebGL2.

### The receiver's plane comes from the mesh's triangle

The filter compares each stored depth with the receiver's plane, so that plane must be the plane of the triangles that the shadow map holds. A material's normal map bends the shading normal, and a plane built from that bent normal tilts off the triangle. Within the filter's square, the plane's depth then rises by more than the distance between a near caster and the ground. A texel that the triangle's own plane shadows then compares as lit. The picture shows that as ground lit inside the shadow, most of all along the shadow's edge nearest the light.

The shader builds the plane from the triangle's own normal, turned toward the sun. It reads that normal from the change of the position between pixels. The receiver moves off its surface along the mesh's own normal, before a normal map bends it. three.js offsets a receiver along its vertex normal too. A decal takes the same plane from the normal that its depths make. `sun_shadow` takes both normals, the mesh's and the triangle's. `sun_layer` and `receiver_plane` build the comparison from the triangle's. Point and spot lights take the mesh's own normal for their offset alone. Their tiles compare every read with one depth.

`tests/image/normal-map-shadow.spec.ts` draws a box standing on a normal-mapped ground under a low sun, on WebGPU, compatibility mode and WebGL2. It reads the shadow of the ground's own plane from the shadows debug view, which reads the vertex normal. Every texel there must keep the ambient light that the frame shows with the sun off. With the shading normal, the test lights 29, 34 and 33 texels of the true shadow, by up to 13, 14 and 14 of 255. It fails on all three tiers. With the triangle's normal it lights none, and it passes on all three. A comparison of the scene's 960 by 540 frames, before and after, differs in 4,115 pixels by more than 2 of 255. The change lies within the shadow below and to the right of the box.

The stored picture references still judge the pictures. The Mac's real GPU passes all 1,623 pictures against its set. The Mac's SwiftShader passes 1,620 of 1,623; the three failures are the canvas-screen demo's digits, which CI's Linux software GPU draws another way. The same demo fails by the same shares with the old shading, so the difference is the canvas content, not the shadow term. The contact scene's acne is unchanged. Its `far-slabs-low` view reads 0.563% on WebGPU and 0.551% on WebGL2, the highest of its views, against the limit of 1.5%. S4's acne is unchanged too: 0.078% on WebGPU and 0.059% on WebGL2, against the limit of 0.2%.

The GPU check against the build before the change reads four times. S4 at Medium goes from 4.16 to 4.34 ms (+2.9%). S6 at Medium goes from 4.74 to 4.80 ms (+0.7%). S4 at High goes from 4.31 to 4.45 ms (+0.8%). S6 at High goes from 5.28 to 5.40 ms (+2.3%).

## Rejected options

- Option (a), a second depth target for the moving casters. It doubles the filter's reads on most of S4's pixels.
- Option (c), a copy of each far cascade's still casters. It saves at most about half a cascade's draw on the Mac. It costs 32 to 192 MiB of memory and a new depth path on WebGL2. At Low alone it was built and dropped ([The still-caster cache](#the-still-caster-cache)). It stays open if a scene with far more moving casters than S4 shows a real cost.
- Far cascades in their turns at Low. The trail reaches every shadow on screen in S4 ([Why Low follows moving casters](#why-low-follows-moving-casters)).
- A held far cascade that draws early once a moving caster in it has moved more than one texel. Low's far cascade has texels of 0.28 to 0.39 m in S4 on the iPad, and the fastest cars cross one in under 2 frames. So the cascade draws about every 2nd frame, and the shadow lags by up to a texel and steps at 30 Hz. It stays open if Low's GPU time must come down.
- The receiver plane off at Low. The stripes and acne come back on S4's pavements, and the owner keeps the plane on every preset.
- The plane at the lowest of each read's four texels (flat caster option 1). It leaves stripes at Low ([One depth per texel](#one-depth-per-texel)).
- Four comparisons per block on WebGPU too. It needs no new binding, but it costs 0.069 ms more than option 1 at Low on the Mac. One gather with the blocks written out saves 0.106 ms there. A loop over blocks keeps each file of shader modules smaller, but it costs GPU time on the Mac.
- A larger map or another cascade on Low. It costs memory and a pass on phones, and stripes return with a lower sun or a thinner caster.
- The three.js twin's split of 50%. It moves the stripes further out, and it undoes D-15's choice for cameras at eye height.
- The `fetch` reads on WebGL2. They need the shader to know WebGL2's `standard` depth mode, where the map holds depths the other way round. They were also slower on the iPad than `implicit`.

## Consequences

- `MovingCasters` and `CascadeSchedule::plan` in `crates/null3d-render/src/shadows.rs` hold the test; both frame builders call it through `SceneSettings::shadow_frame`. The Rust tests check the schedule with a moving caster, and that recording frames with one allocates nothing.
- `ShadowQuality::follow_movers` in `crates/null3d-render/src/shadows.rs` carries `followMovingCasters` to the schedule. Without it, the schedule tests no moving caster. A Rust test checks that the far cascades keep their turns around a dynamic caster then. The bench page test of S4 at Low holds its draw calls: 63 in every frame, as the cars keep the far cascade drawing.
- The governor's `setShadows` takes `followMovingCasters`, and its far cascade steps are none while it is off (`packages/engine/src/quality/governor.ts`). A unit test holds that ladder.
- The browser test `moving-shadow.spec.ts` drives a dynamic box in the last cascade, live, with far cascades every 8th frame. The offset between the box and its shadow must match the offset with every cascade drawn in every frame, within 5 pixels. Without option (b), it strays by 7.3 to 25 pixels. A texel of the last cascade covers about 3.6 pixels, and the shadow's edges step across whole texels as the box drives. So a shadow that follows its box still strays by up to 3.8 pixels on SwiftShader under load. That is why the limit is 5 pixels, not 3. Hold mode cannot show the lag, as it draws one frame, in which every cascade draws.
- The test runs twice. First it sets `followMovingCasters` itself, so it tests option (b) on whatever preset its browser gets. Then it runs each preset with that preset's own setting and its far cascades every 8th frame (the governor's longest). It reads 60 frames, or 24 on SwiftShader ([D-88](D-88-software-gpu-loads.md)). Every offset must stay within 5 pixels of the run with every cascade in every frame. The box drives in the last cascade, past any preset's nearest one.
- The box in that test moves a fixed step in each frame: 1/6 m, which is 10 m/s at 60 frames a second. So every GPU reads the box at about the same places on the image. The offset depends on where the box is on the image. The box's top stands 1.5 m nearer the camera than the ground under its shadow. The perspective spreads the two apart, and more so toward the image's sides. The shadow's edges also step across the texels. A box moved by the clock covers about 4 m of the drive in 8 reads 3 frames apart on the Mac's GPU. On SwiftShader, at a few frames a second, it covers all 16 m. Then in ten runs of each GPU path, the offsets spread over about 7 pixels, and one read strayed 4.6 pixels from its run's median. With the fixed step, ten runs of each GPU path spread over 4.9 pixels, and no read strayed more than 3.1 pixels. The test passed 20 of 20 runs alone, and 20 of 20 with two at once while the Mac ran other work. With the moving caster's draw turned off, it fails 10 of 10 runs, with reads 7 to 130 pixels off. At 1/6 m per frame, a shadow 2 frames behind is about 5 pixels off.
- The device soak's report gives each GPU path's preset and the preset check's rounds, so a soak tells which preset ran.
- The benchmark pages take `?far=<n>`, which S4 applies as its `farCascadeInterval`.
- `bias_offset` in `crates/null3d-shaders/wgsl/lib/shadows.wgsl` caps and scales the biases of the directional light and of spot and point lights, and `sun_shadow` picks the cascade. The shadow uniform holds the biases in meters and each cascade's texel size (`ShadowUniform` in `crates/null3d-render/src/shadows.rs`). The defaults are in `crates/null3d-core/src/lights.rs`.
- A user's bias above one texel acts as one texel. The cap binds the defaults only where a texel is under 2 cm. A 2,048 map's first cascade has 2.8 cm texels with the default distance, so the defaults act in full there.
- The `shadows-contact`, `shadows-contact-near` and `shadows-contact-far` image tests hold the contact at the base. The `shadows-contact-turn` browser test holds it while the camera turns.
- The `CASTER_OFFSET` builds of `crates/null3d-shaders/wgsl/shadow_depth.wgsl` move the faces, with `CASTER_OFFSET_TEXELS` and `CASTER_OFFSET_MAX`. `caster_of` in `crates/null3d-render/src/frame.rs` picks them for casters that draw only their back faces. Each shadow pass's frame uniform holds the light as its camera and the map's texels as its target size (`ShadowFrame::view_frame` and `TileView::frame`). The pass reads each vertex's normal, which every vertex format has.
- The contact check (`contactFigures` in `tests/pages/lib/shadow-check.ts`) runs in the visual page. `tests/image/shadow-contact.spec.ts` holds the contact scene's figures under `CONTACT_LIMITS`, and S4's gap has a limit in `VISUAL_LIMITS`. The benchmark summary and the device runner's bench plan print S4's gap beside the other visual figures.
- `receiver_plane`, `sun_texels`, `sun_block` and `sun_filtered` in `crates/null3d-shaders/wgsl/lib/shadows.wgsl` give each texel its comparison, with `PLANE_MARGIN` and `MAX_PLANE_SLOPE`. `filtered` serves the shadow atlas alone. The plane comes from the mesh's triangle turned toward the sun, which the shading reads from the position's change between pixels, and the offset comes from the mesh's own normal before a normal map bends it. A normal map's tilt therefore cannot move the plane off the triangles whose depths the map holds.
- The frame group binds the shadow map as an `unfilterable-float` texture on WebGPU, with a non-filtering sampler (`SHADOW_TEXEL_SAMPLER` in `crates/null3d-render/src/gpu_driven/mod.rs`). The WebGL2 path keeps its comparison sampler.
- The written-out blocks add 0.6 to 1.7 KB after Brotli to each file of shader modules, 2.0% to 5.4%.
- The acne check (`acneFigures` in `tests/pages/lib/shadow-check.ts`) runs in the visual page. `CONTACT_LIMITS` in `tests/lib/visual-checks.ts` holds acne limits of 1.5% for the casting ground, every slab view and `far-slabs-low`. Each limit sits between the figures of options 1 and 4. `VISUAL_LIMITS` holds S4's limit of 0.2%. The benchmark summary and the device runner's bench plan print S4's figure as "Flat-surface acne".
- `implicit_comparison_levels` in `crates/null3d-shaders/src/glsl.rs` rewrites the reads in each GLSL stage. A test in `crates/null3d-shaders/tests/build.rs` checks that no zero-gradient read is left.
- A shadow map that gets more than one level would need another read on WebGL2, as `texture()` would then pick a level from the screen's gradients.
- WebGL2's slower pixels on Apple GPUs remain. The [implementation notes](../implementation-notes.md#safaris-webgl2-path) keep the figures.
- `concepts/shadows` describes the design and the reads, with their cost on WebGL2, and the API notes give the biases in meters and their defaults.
- The owner approved the moving shadows on the iPad (WebGPU, Medium) by eye. The cars' shadows stay on the cars, and the shadows at the edges of the screen are soft and hold still. Not done yet: an iPad check of S4 at Medium on WebGPU with the casters' offset.
