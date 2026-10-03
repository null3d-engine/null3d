# D-15: Where the directional light's cascades split

Status: decided. Date: 2026-10-03. Pull request: #211.

## Question

The directional light's cascades split the camera's view by distance. The split blends two spreads. In an even spread each cascade has the same length. In a logarithmic spread each cascade is a fixed number of times longer than the one before. How far should the split lean toward the logarithmic spread?

A second question came with it: can another weighting of the shadow map's texels hide the steps along shadow edges?

## Rule

The split must give finer texels to the middle distance, where a raised camera such as S4's sees the ground. It must not make the shadows at the feet of a camera at eye height more than twice as coarse as before. It must not cost frame time on the Mac or the S24+.

## Data

### Texels on the ground

The light's defaults are 3 cascades of 2,048 texels on each side, over 200 m. With them, a 60 degree view and a 16:9 canvas, one texel covers this much of the ground:

| Lean toward logarithmic | First cascade | Second cascade | Third cascade |
| --- | --- | --- | --- |
| 80%, before | 0.1 to 14 m: 1.65 cm | 14 to 39 m: 4.53 cm | 39 to 200 m: 23 cm |
| 65%, chosen | 0.1 to 24 m: 2.78 cm | 24 to 57 m: 6.55 cm | 57 to 200 m: 23 cm |
| 50%, three.js's practical split | 0.1 to 34 m: 3.91 cm | 34 to 75 m: 8.58 cm | 75 to 200 m: 23 cm |

The last cascade always ends at the shadow distance, so its texels depend only on the distance and the map size.

- S4's camera flies 42 m up and sees no ground nearer than about 40 m. At 80%, all its ground drew from the last cascade, with 23 cm texels. Its diagonal shadow edges showed steps on the iPad and on the Mac.
- At 65%, S4's ground from 40 to 57 m gets texels 3.5 times finer.
- A camera at eye height (1.7 m up) sees the ground a few meters ahead. At 50%, its shadows were 2.4 times as coarse as at 80%, and they looked soft and streaked. At 65% they are 1.7 times as coarse, and they look close to 80%.

three.js's cascaded shadow addon (`CSM`) splits with its "practical" mode at a lean of 50% by default. Its twin of S4 uses it, with cascades that end at 200 m as null3D's do.

### Cost

- Chrome on the MacBook Pro's GPU, `bun run bench:run --compare` against main: S4's nearest cascade pass took 0.087 ms of GPU time instead of 0.070 ms. That cascade now reaches 24 m instead of 14 m, so it holds more casters. The frame's GPU time stayed at 1.33 ms. S2 with 3 cascades changed in no GPU pass. CPU times stayed within the noise.
- S4 on the Galaxy S24+ in Chrome on WebGL2, 5 runs of 30 seconds at 60 Hz, then the governor's run, 3 October 2026:

| Measure | 80% | 65% |
| --- | --- | --- |
| Presented and finished frames per second | 59.9 and 59.9 | 59.9 and 59.9 |
| CPU ms per frame, median (lowest to highest run) | 3.90 (3.87 to 4.00) | 3.86 (3.84 to 4.11) |
| GPU delay, median ms | 15.89 | 15.92 |
| Seconds at 60 frames per second in the governor's run | 147 of 147 | 148 of 148 |
| Draw calls per frame | 52 | 54.5 |

WebGL2 on this phone has no GPU timer. The GPU delay stayed at one frame interval, and the governor lowered no setting, so the GPU does not limit S4 on this phone. The longer first two cascades hold more objects, which most likely gives the 2.5 more draw calls.

### Parity with three.js

The shadow scene of `bun run parity` moved closer to three.js. Chrome on the Mac's GPU: 0.229%, 0.264% and 0.235% of the pixels differ on WebGPU, compatibility mode and WebGL2, from 0.313%, 0.351% and 0.317%. SwiftShader: 0.243%, 0.282% and 0.256%, from 0.326%, 0.363% and 0.331%. [Image tests](../image-tests.md#parity-with-threejs) gives the limit.

### The filter's weighting

The filter weights the four texels of each hardware comparison by the point's place between them (Castaño's filter). It takes 4 reads for a 3 x 3 square and 9 for 5 x 5.

A simulation drew straight edges over a grid of lit and shadowed texels at many angles. It compared other weightings over the same texels: a cubic B-spline, a Hann window and a truncated Gaussian. None had smaller steps at shallow angles. There the steps come from the size of the texels, and only a wider filter or more texels per meter shrink them. No shape of 4 reads matches the 5 x 5 square either.

## Decision

The split leans 65% toward the logarithmic spread. It meets the rule. S4's ground gets texels 3.5 times finer, the shadows at eye height stay under twice as coarse, and no device lost frame time. 50% failed the rule at eye height, and 80% failed it for S4.

The filter keeps Castaño's weighting. The shadows page tells developers to shorten the shadow distance, raise the map size or add a cascade when edges show steps.

## Consequences

- The lean is `SPLIT_LAMBDA` in `crates/null3d-render/src/shadows.rs`. The Rust tests of turning and moving cameras check every cascade that holds a point, so shadow edges still stay still.
- `concepts/shadows` gives the texel table and says why steps remain at shallow angles.
- The shadow image tests with 2 to 4 cascades, the 5 x 5 filter and custom materials, and S4, have new references in both sets. The one-cascade test did not change.
- In S4's view the second cascade now hands over to the third at 57 m, where the texels grow from 6.55 cm to 23 cm. A blend between cascades could hide that hand-over.
- The iPad's rows, before and after the change on WebGPU, are still to come.
- The visual checks now measure what this choice fixed. With the lean back at 80%, the long shadow edge of the shadow check scene showed stair steps of 0.53 px, against 0.29 px. S4's shadow edges strayed 0.14 px from a reference with the largest map, against 0.095 px. The limits of those checks fail a return to 80% ([Image tests](../image-tests.md#visual-checks)).
