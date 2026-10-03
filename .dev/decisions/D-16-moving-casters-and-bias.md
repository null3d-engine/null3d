# D-16: Moving casters in far cascades, and where shadows meet their casters

Status: decided. Date: 2026-10-03. Task: M1-F3.

## Question

Two faults showed in S4 on the iPad (WebGPU, Medium):

1. The cars' shadows jittered, and a gap opened behind each car while it drove. Since #198, the far cascades draw once every `farCascadeInterval` frames (4, 3, 2 and 2 on Low to Ultra) and keep their layers in between. A kept layer shows a car where it stood when the layer drew, so its shadow jumps forward on each draw and trails behind between draws. Since #211, every cascade past about 24 m does this.
2. Every object, at rest too, showed a thin lit line between its base and its shadow ("peter-panning"). It was widest in the far cascades.

After the first fix, the owner checked S4 on the iPad again. The cars' shadows followed the cars, but thin lines of light remained at objects' bases, and they appeared and vanished as the camera turned.

After the biases moved to meters, the owner checked S4 on the iPad a third time. The lines were rarer and thinner, but some remained.

After the contact fix, S4's shadows view still showed rings and stripes of self-shadow (acne) on low flat casters, such as the pavement slabs. The reference frame, with a 4,096-texel map, showed none.

How should moving casters' shadows follow them in every frame, and how should the biases change so that shadows meet their casters without bringing back stripes of self-shadow (acne)? What else keeps a lit line at a base?

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

### Lit lines at the base, after the iPad's check

The owner checked S4 on the iPad (WebGPU, Medium) on 3 October 2026, with the biases in meters. Thin lit lines at the bases of objects were rarer and thinner than before, but some remained. They also seemed to move as the camera turned.

Casters draw only their faces that point away from the light, and a box's bottom face is one of those. It lies on the ground, so the map holds it at the ground's depth under the box. The filter reads a square of texels around each point. Near a box's base, some of those reads land under the box. Where the ground there is level with the point, or further from the light, the read compares equal or lower depths. It then comes out lit. So the ground just past the base shows a thin lit line, even with no bias. Coarser texels reach further under the box, so the line widens in far cascades.

The contact check measures the line ([Image tests](../image-tests.md)). It finds each foot of a dark side on the ground in the normals view. Then it adds the light between the foot and the start of the shadow, in pixels of full light. The table gives the figures of the `shadow-contact` scene's views and of S4's hold frame, on WebGPU and WebGL2 (Chrome on the Mac, 3 October 2026):

| View | Before | Before, with no bias | After |
| --- | --- | --- | --- |
| Near the camera, first cascade | 0.159 and 0.152 | 0.072 and 0.064 | 0.020 and 0.016 |
| From far away, last cascade | 0.204 and 0.198 | 0.147 and 0.153 | 0.077 and 0.080 |
| Just past the end of the first cascade | 0.194 and 0.183 | 0.093 and 0.088 | 0.045 and 0.039 |
| The same, turned 25 degrees on the spot | 0.182 and 0.187 | | 0.032 and 0.033 |
| S4's hold frame | 0.050 and 0.040 | | 0.024 and 0.027 |

SwiftShader gave 0.159 and 0.169 before and 0.023 and 0.025 after near the camera. It gave 0.224 and 0.223 before and 0.087 and 0.088 after in the last cascade. Just past the first cascade, it gave 0.254 and 0.252 before and 0.061 after. In S4's frame, it gave 0.072 before and 0.042 and 0.043 after.

With no bias, half to three quarters of the line remained. So the biases were not its main cause, and smaller biases could not remove it. A turn did not widen the line either: it measured about the same at both angles. A turn moves the base's pixels across the texels, so the line breaks up in other places, and it seems to move. With the fix, little light remains at either angle.

The options were:

1. In the shadow pass, move each caster's faces that point away from the light toward the light. The move is part of a texel of the map at the face. The bottom face then stays in front of the ground.
2. Draw the casters' front faces, as Unity's and Unreal's shadows do. The box's top then sits in the map above the ground at its base, and no read comes out lit. But every lit face then compares with itself. That needs biases of about a texel of each cascade. Such biases bring back the jumps between cascades that the biases in meters removed. It also brings acne back to every lit surface at a steep angle to the light.
3. Compare each of the filter's samples with the depth of the receiver's plane at the sample, which the surface's normal gives ("receiver plane depth bias"). On its own, it makes the line worse. The bottom face then compares equal at every read under the box. Together with option 1, it closed the line a little more, and it removed older acne on a floor that casts shadows. But where option 1's offset fell short, it left more light than no change at all. With a 256-texel map and an offset capped at 10 cm, it raised the figures of the three views by 38% to 53%.

Option 1 took three choices:

- How much of the offset each face takes. A full texel for every face that points away from the light closed the line in every view. But it shadowed the boxes' own lit tops near their edges, as the walls below those edges moved toward the light too. In the last cascade, the shadow on the tops past their edges rose from 0.21 to 0.69 pixels. So each face takes the square of the cosine of its angle away from the light. A box's bottom under S4's sun takes about two thirds of a texel. A wall that the light only grazes takes almost none. With that share, the tops' figure rose only to 0.24 pixels.
- How large the offset is: one texel of the map at the face, times that share. Half a texel left about twice as much light at the bases near the camera.
- A cap in meters. A floor that casts shadows compares its lit top with its own bottom. A far cascade's texels can be larger than the floor is thick, and then the offset shadows the floor's top. The `far` view with a floor 20 cm thick that casts shadows shows it. With the 512-texel map, a full texel for every face, uncapped, put 54.6% of the frame in shadow, against 9.05% with no offset. With a 256-texel map, the weighted offset put 72.9% in shadow, uncapped, against 9.2% with no offset. A cap of 10 cm put 15.9% in shadow, and a cap of 5 cm 9.4%. With the 512-texel map, the 5 cm cap gave 9.10%. Larger caps close a little more of the line in the last cascade, so the cap is the largest that keeps such a floor clear.

A double-sided caster keeps its depth. Both its faces draw, so the map holds its lit face, which would then shadow itself. Spot and point lights take the same offset, in texels of their tiles at the face's distance from the light.

The offset brings no new acne on the surfaces that the light grazes. The `shadow-contact` scene's `lit` view looks at the boxes' lit sides, one at 19 degrees to the light. Its share in shadow stayed at 34.74%, with the offset uncapped too. S4's share in shadow rose from 23.31% to 23.35%. S4's frame shows older acne in the shadows view: rings and stripes on low casters that lie flat, such as pavements. The reference frame, with a 4,096-texel map, shows none. The frames before and after this change both show them. They come from the same comparison of a flat caster's top with its own bottom, across coarse texels. On the contact scene's floor, option 3 removed such acne, at the cost given above.

### Acne on flat casters

S4's pavement slabs are 20 cm thick, and they cast shadows. Casters draw only their faces that point away from the light, so the map holds each slab's bottom under its lit top. The top and the bottom are parallel. S4's sun stands 54 degrees above the horizon. Under it, the bottom lies about 25 cm behind the top along the light, less the casters' offset of up to 5 cm. Across the filter's square, the bottom rises toward the light as fast as the top does. Per texel, it rises by the texel's size times the tangent of the light's angle to the top: 0.72 under S4's sun.

The filter compared all its reads with one depth: the receiver's, at its own point. The 5 x 5 filter reads texels up to 3 texels away. In S4's last cascade, with 23 cm texels, the bottom there rises 50 cm, so it stands in front of the top's point. Those reads came out shadowed, in stripes along the texel rows, and in rings where the stripes beat against the pixel grid. With the reference's finer texels, the bottom stays behind the top across the square.

The acne check measures it ([Image tests](../image-tests.md#visual-checks)). It finds the pixels of level surfaces that the reference shows in full light, at least 3 pixels from any shadow of the reference. The figure is the mean shadow on those pixels, in percent: each adds one less its shadow factor. The contact scene's `slabs` switch stands the boxes on a slab 20 cm thick that casts shadows, and `sun` lowers the sun. These views use the 5 x 5 filter and the scene's 512-texel map, whose last cascade has texels of about S4's.

The candidate causes:

- Depth precision in the far cascades. The map holds 32-bit floats. The stripes follow the filter's reads and the texel size, and they vanish when the reads follow the receiver's plane, with the same depths. So precision does not cause them.
- A normal offset that does not grow with the cascade's texels. Or a slope-scaled bias too small for level surfaces at a low sun. Either lifts the receiver by the same amount for every read. Raising them far enough to clear the far reads brings back the lit lines at bases. The biases in meters and the casters' offset removed those. Without the change below, biases of 0.05 and 0.1 m cut the acne of the slab view under S4's sun from 15.77% to 8.40%. But the gap at the boxes' feet rose from 0.020 to 0.318 px near the camera, and from 0.077 to 0.265 px in the last cascade. Biases of 0.1 and 0.3 m cut it to 1.65%, with gaps of 0.564 and 0.639 px (WebGPU).
- The 5 x 5 filter's far reads, compared with one receiver depth. This is the cause: comparing each read with the receiver's plane removes most of the acne.

The options were:

1. Each read compares with the receiver's plane at the read. It does so wherever the plane there lies nearer the light than the receiver's own depth. Each read of the comparison sampler blends four texels against one depth. So the plane's depth comes from the lowest of the four texels' centers, less 1 cm. The cascade's projection is orthographic, so the plane stays a plane in the map. Two directions along the surface give its change of depth per texel. A caster below the plane, such as the slab's own bottom, leaves the receiver lit. A caster on the plane or in front of it still shadows it, since every texel of the four lies at least as near the light as the lowest. So a box's bottom and its walls on the plane shadow the ground at their base as before. No read compares with a depth below the receiver's own, so no surface gets more shadow than before.
2. Option 1, with the plane raised by the casters' offset, which every face that lies on the receiver took. It removed more of the acne, but walls that stand on the ground take a smaller offset than bottoms do, or none. Their reads near the base then came out lit.
3. A receiver plane depth bias at the read's own point, without the receiver's depth as a floor. This is option 3 of the contact options. It made the lit lines worse where the casters' offset fell short.
4. Compare each texel with the plane at its own center. The comparison sampler gives one result for four texels. So this needs four raw depths for each read now: one gather on WebGPU, or four fetches on WebGL2. It also needs a second sampler binding. It would remove the rest of the acne at four times the reads on WebGL2.

The table gives the acne figure on WebGPU and WebGL2 (Chrome on the Mac, 3 October 2026):

| View | Before | Option 1 | Option 2 |
| --- | --- | --- | --- |
| S4's hold frame, Medium and High | 0.720 and 0.694 | 0.035 and 0.014 | 0.033 |
| S4's hold frame, Low | 1.590 and 1.589 | 0.920 and 0.915 | 0.921 |
| Slabs from far away, S4's sun | 15.77 and 15.60 | 3.85 and 3.70 | 0.24 |
| Slabs from far away, sun 35 degrees up | 20.52 and 20.36 | 6.54 and 6.38 | 6.54 |
| Slabs from far away, sun 20 degrees up | 21.18 and 21.02 | 7.40 and 7.24 | 7.40 |
| The far view with a floor that casts, 3 x 3 filter | 9.71 and 9.55 | 9.71 and 9.55 | 0.07 |

Option 2 ran on WebGPU alone. Its contact gaps rose from 0.020 to 0.041 px near the camera, and from 0.045 to 0.083 px just past the first cascade.

With option 1, the contact scene's gaps kept their figures. They read 0.020 and 0.016 px near the camera, and 0.077 and 0.080 px in the last cascade. Just past the first cascade they read 0.045 and 0.039 px. The shadow on the boxes' tops past their edges fell, from 0.236 to 0.203 px in the last cascade on WebGPU. S4's gap moved from 0.026 to 0.027 px on WebGPU and from 0.024 to 0.025 px on WebGL2. The gaps rise only where a slab casts. With a slab that casts no shadow, the slab views gave the same gaps with and without the change. They read 0.056, 0.221 and 0.349 px under the three suns (WebGPU). So the rises come from acne that no longer darkens the ground beside a foot, which the check counted as shadow. S4's share in shadow fell from 23.16% to 23.08%. Its edge offset moved from 0.091 to 0.085 px on WebGPU, and from 0.075 to 0.083 px on WebGL2.

SwiftShader gave 0.698 and 0.699 before and 0.012 and 0.011 after in S4's frame. In the slab views it gave 15.66, 20.95 and 20.79 before, and 3.83, 6.97 and 6.99 after (WebGPU). The contact scene's gaps kept their figures there too. S4's gap moved from 0.043 to 0.046 px on WebGPU and from 0.046 to 0.047 px on WebGL2, under its limit of 0.06 px.

The limits sit between the figures before and after: 0.2% for S4, and 6%, 10% and 11% for the slab views under the three suns.

What remains comes from each read's four texels. Across them, the slab's bottom rises by up to the texel's size times the tangent, along each axis of the map. That rise can exceed the slab's depth behind its top. Then the texels that the read blends with small weights still compare in front. So the stripes stay faint. The 3 x 3 filter's reads lie within a texel or two of the point, so it keeps most of its acne: the floor that casts kept 9.71%. They remain on S4 at Low, whose last cascade has texels twice as large, and in the slab views at a low sun. A larger map, a shorter distance or another cascade removes them, and so would option 4.

## Decision

Option (b): a far cascade draws in every frame while a moving caster touches its box, or touched the box its layer holds. It is the only option that adds no memory, no pass and no shader read, and it costs a cascade's draw only where a moving caster needs it. Option (c) would save at most about half of that draw on the Mac, for 32 to 192 MiB of memory and a new depth path on WebGL2. Option (a) would double the filter's reads on most of S4's pixels.

The receivers scale their biases by their angle to the light. After the iPad's second check, options 1 and 4 of the bias options apply together. The biases are in meters, capped at one texel of the point's cascade or tile. A receiver behind a perspective camera picks its cascade by its distance from the camera. The defaults become 0.01 m for `bias` and 0.02 m for `normalBias`. Spot and point lights take the same biases in meters, capped at one texel of their tile at the point's distance from the light.

After the iPad's third check, option 1 of the contact options applies. The shadow pass moves each caster's faces that point away from the light toward it. A face moves by one texel of the map at the face, times the square of the cosine of its angle away from the light. It moves at most 5 cm. Double-sided casters keep their depth.

After the acne on S4's pavements, option 1 of the flat caster options applies. Each read of the directional light's filter compares with the receiver's plane at the lowest of its four texels, less 1 cm. It does so where that lies nearer the light than the receiver's own depth. Spot and point lights keep one depth for all reads: their tiles' projections are not orthographic, and the `spot-shadows` and `point-shadows` scenes show no such acne.

## Consequences

- `MovingCasters` and `CascadeSchedule::plan` in `crates/null3d-render/src/shadows.rs` hold the test; both frame builders call it through `SceneSettings::shadow_frame`. The Rust tests check the schedule with a moving caster, and that recording frames with one allocates nothing.
- `bias_offset` in `crates/null3d-shaders/wgsl/lib/shadows.wgsl` caps and scales the biases of the directional light and of spot and point lights, and `sun_shadow` picks the cascade. The shadow uniform holds the biases in meters and each cascade's texel size (`ShadowUniform` in `crates/null3d-render/src/shadows.rs`). The defaults are in `crates/null3d-core/src/lights.rs`.
- The browser test `moving-shadow.spec.ts` drives a dynamic box in the last cascade, live, with far cascades every 8th frame. The offset between the box and its shadow must match the offset with every cascade drawn in every frame, within 5 pixels. Without the fix, it strayed by 7.3 pixels in the first runs, and by 15 to 25 pixels in ten runs on 3 October 2026. The limit was 3 pixels at first. A texel of the last cascade covers about 3.6 pixels, and the shadow's edges step across whole texels as the box drives. So a shadow that follows its box still strays by up to 3.8 pixels on SwiftShader under load, which failed CI. Hold mode cannot show the lag, as it draws one frame, in which every cascade draws.
- The `shadows-contact`, `shadows-contact-near` and `shadows-contact-far` image tests hold the contact at the base. The `shadows-contact-turn` browser test holds it while the camera turns.
- The benchmark pages take `?far=<n>`, which S4 applies as its `farCascadeInterval`.
- `concepts/shadows` describes the changes, and the API notes give the biases in meters and their defaults.
- A user's bias above one texel acts as one texel. The cap binds the defaults only where a texel is under 2 cm. A 2,048 map's first cascade has 2.8 cm texels with the default distance, so the defaults act in full there.
- The owner checked S4 on the iPad (WebGPU, Medium) on 3 October 2026 and approved the change. The cars' shadows stay on the cars, and the shadows at the edges of the screen are soft and hold still. Thin lit lines where objects meet their shadows are rarer and thinner than before, but some remain. They also shift as the camera turns. [Lit lines at the base, after the iPad's check](#lit-lines-at-the-base-after-the-ipads-check) gives their cause and fix.
- The `CASTER_OFFSET` builds of `crates/null3d-shaders/wgsl/shadow_depth.wgsl` move the faces, with `CASTER_OFFSET_TEXELS` and `CASTER_OFFSET_MAX`. `caster_of` in `crates/null3d-render/src/frame.rs` picks them for casters that draw only their back faces. Each shadow pass's frame uniform holds the light as its camera and the map's texels as its target size (`ShadowFrame::view_frame` and `TileView::frame`). The pass reads each vertex's normal, which every vertex format has.
- The contact check (`contactFigures` in `tests/pages/lib/shadow-check.ts`) runs in the visual page. `tests/image/shadow-contact.spec.ts` holds the contact scene's figures under `CONTACT_LIMITS`, and S4's gap has a limit in `VISUAL_LIMITS`. The benchmark summary and the device runner's bench plan print S4's gap beside the other visual figures.
- An iPad check of S4 at Medium on WebGPU, after this change, is still to come.
- `receiver_plane` and `read_depth` in `crates/null3d-shaders/wgsl/lib/shadows.wgsl` give each read its depth, with `PLANE_MARGIN` and `MAX_PLANE_SLOPE`. The plane comes from the normal that the shading passes to `sun_shadow`. A normal map's normal tilts it, which can light a read that a bumpy surface's own plane would shadow.
- The acne check (`acneFigures` in `tests/pages/lib/shadow-check.ts`) runs in the visual page. `CONTACT_LIMITS` holds the slab views' acne figures, and `VISUAL_LIMITS` S4's. The benchmark summary and the device runner's bench plan print S4's figure as "Flat-surface acne".
