# D-261: Moment transparency, and what it beats

Status: decided, and neither the look nor the accuracy supports it yet. Built on both GPU paths,
and the layer has drawn on all three GPU paths: WebGL2, WebGPU and its compatibility mode drew the
four image tests at 480 by 270 on the tree of `e1fbc77f9`. The acceptance spec on the same tree,
`moment-transparency.spec.ts -g "nearer"`, fails on both paths: the moment image is farther from
the exact one than the weighted blending's. The picture references are held back and the patches at
overlapping edges stay under the Look section. The layer drew on a phone and a tablet on 29 October
2026, and the phone's cost figure is owed. Task: M3-F13.

Summary: Order-independent transparency from a store of four depth moments. Its accuracy is an
envelope: where the surfaces spread over a few meters or more, it is about two and a half times
nearer the exact image than the weighted blending; where five surfaces sit within a couple of
meters of one another, it is slightly farther. It is built on both GPU paths, costs 0.58 ms of GPU
time on the S1 benchmark at High on this computer, and is off on every preset.

## Question

Does a store of depth moments give a better picture than the weighted blending that the engine
draws today, and at what cost? Task M3-F13 asks for order-independent transparency in which
overlapping glass, foliage and particles blend correctly whatever order they draw in.

## Rule

The better look decides between options (hard rule 40). The test is whether the new technique is
nearer the exact back-to-front result than the weighted blending is. The cost then decides how it
ships. A technique that a phone cannot afford becomes a documented limit or a preset choice. It is
never a dropped feature (hard rule 39).

## Data

The figures come from a model of the composite. Each stack holds two to six surfaces. Each surface
has a random depth from 1 to 30 meters, a random optical depth from 0.15 to 1.2 and a random color.
Each method's result is compared with the exact back-to-front composite of the same stack. The
measure is the largest difference in any color channel.

| Measure | Four moments | Weighted blending |
| --- | --- | --- |
| Mean error over 400 stacks | 0.050 | 0.086 |
| Median error | 0.042 | 0.077 |
| 90th percentile | 0.102 | 0.167 |
| Worst stack | 0.188 | 0.279 |
| Stacks that four moments draws nearer | 314 of 400 (78%) | 86 of 400 |
| Two panes 8 meters apart | 0.000 | 0.183 |

The model evaluates the four-moment reconstruction as the shader does. It fits two atoms in the
warped depth. The weighted blending uses the engine's own weight: `alpha * clamp(0.03 / (1e-5 +
z^4), 1e-2, 3e3)`, where `z` is the depth over 200 meters.

Weighted blending loses because of that weight. It reaches its ceiling of 3e3 at every depth below
about 11 meters. Within a room it therefore weighs every surface alike. What is left is a plain
average of the surfaces' colors, with no term for which one is in front.

The image test that settles the choice draws five panes of glass at different depths, and compares
each approximation with the exact sorted image. On the 1280 plates its mean channel error is 1.683
for the moment layer and 1.432 for the weighted blending, and the layer is 1.983 from the blend. The
model's 78% does not hold on this scene: five panes at similar depth put the fit's two atoms close
together, and the renormalized average then keeps too much of the nearest pane's color.

A first attempt fitted the moments with a two-point Gaussian. It placed the atoms at the mean plus
and minus one standard deviation. It did not beat weighted blending. That is why the store holds
four power moments, and why the fit is the orthogonal-polynomial one and not a moment-matching
approximation. The fit is exact for one and for two surfaces. That is why the two-pane case shows
no error at all.

## The reconstruction

The record keeps the formula here because it is the part that takes work to derive. The moments
`b` are `(b0, b1, b2, b3)`, where `b0` is the total optical depth. The depth `u` is warped into 0 to
1 by a logarithm between the camera's planes. This gives the transmittance from the eye to `u`:

```wgsl
let mean = b.y / b.x;
let second = b.z / b.x;
let third = b.w / b.x;
let spread = second - mean * mean;          // the variance of the depth
let a0 = (mean * third - second * second) / spread;
let a1 = (mean * second - third) / spread;
let root = sqrt(max(a1 * a1 - 4.0 * a0, 0.0));
let low = clamp((-a1 - root) * 0.5, 0.0, 1.0);
let high = clamp((-a1 + root) * 0.5, 0.0, 1.0);
let near_share = clamp((high - mean) / (high - low), 0.0, 1.0);
let far_share = 1.0 - near_share;
let absorbed = select(0.0, near_share, u > low) + select(0.0, far_share, u > high);
let shown = exp(-b.x * absorbed);
```

A spread of nearly zero puts all the optical depth at the mean depth. A span of nearly zero does
the same. This form is exact for one surface and for two, and close for more.

## Decision

Build the layer with the four-moment store. The layer draws the transparent surfaces twice:

1. a moment pass, which adds four power moments of each fragment's optical depth into one target;
2. a color pass, which draws the same surfaces again. Each color is weighted by the transmittance
   that the moments give at that fragment's depth;
3. a composite, which reads both and blends the result over the scene.

The second draw cannot be avoided in this shape. A fragment's share of the picture depends on every
surface in front of it. No single draw knows its own transmittance. The one-pass alternative stores
color moments as well. That takes four color targets of 16-bit floats. No backend supports more
than two targets today, so that form is out of reach.

## Anti-aliasing

The scene color keeps MSAA's samples for opaque geometry. The layer's own targets have one sample,
so its surfaces get none. The moment store and the color sum are 16-bit float targets, which
compatibility mode cannot multisample. Four samples of the two would take 32 bytes per pixel.

A post-process anti-alias replaces those samples on the layer's surfaces. SMAA 1x, the subpixel
morphological method, runs in three steps: it marks the layer's edges, finds their ends and areas
from two lookup tables, and mixes each pixel with the neighbour that its weights name.

- **SMAA, not FXAA.** FXAA smooths the whole image, so it would soften the opaque edges that MSAA
  already smoothed and blur fine detail across the picture. SMAA runs under the share that the
  moment store covers, so it smooths the layer's edges alone and leaves the rest of the image as
  MSAA left it. It also reads the color's edges rather than the whole picture's contrast, which
  keeps thin glass and foliage sharper than FXAA does at the same cost.
- **SMAA, not more MSAA.** The layer cannot be multisampled on compatibility mode or on WebGL2
  devices without multisampled 16-bit float targets, and four samples of its two targets cost four
  times the bytes.

The share comes from the moment store's total optical depth, so no separate mask target is needed.
A pixel that the layer does not cover marks no edge. The three steps take 8 bytes per pixel for
their two 8-bit targets, plus the final color target they write.

## Faults that only a drawn picture found

The color builds read the moment store in the frame's bind group. The frame group already carries
the view's copy of the opaque color at binding 15, and every lit build declares that binding,
because the lit shader imports the screen-space reflection module, which reads the copy: the chain
`lit` to `ssr` to the copy is not conditional on a material. The moment store therefore takes
binding 19, and the layout has to be one entry smaller somewhere else to stay within WebGPU's 16
sampled textures in the fragment stage.

The first attempt removed binding 15 and gave it to the store. WebGPU refused the first draw with
E1408: a layout may not leave out a binding that its shader declares, read or not. WebGL2 binds by
name and drew, so only the WebGPU picture tests saw it.

The second attempt moved the copy into a module of its own, which only the transmission builds
were to import. It did not answer the fault: the copy came in through `ssr` as well, so every lit
build still declared it. That is the point to read the composed shader rather than the module list:
the composed text for the color build named binding 15 and no light probe grid.

The fix drops the light probe grid from the moment frame layout and from its bind groups. The color
builds declare no probe grid, so their fragment stage counts 16 sampled textures with the store:
nine sampled entries of the frame layout, the six of a material's maps, and the store. The build's
bind group and both backends' recorders omit the entry, and the pipeline test that sums each
stage's textures guards it.

Four more faults followed, and each was invisible until a picture drew:

1. The moment frame group replaced binding 15 with the store instead of adding the store, so its
   entry count was one short of the layout's. WebGPU refused the group.
2. The anti-aliasing's two bind groups named binding 1 for every entry. WebGPU refused the repeated
   binding; the blend group binds 0, 1, 2 and 3, and the resolve group binds 0, 1 and 2.
3. The anti-aliasing's lookup tables were created for sampling alone and then written, which WebGPU
   refuses: their usage includes `COPY_DST`.
4. The groups were recorded before the `CreateTexture` of the tables they bind, so the backend met
   the ids before the textures existed. The tables are made first.

One fault came from the fix itself: the WebGL2 frame group copied the environment's entries into
the words that remained after the other entries, which once the probe grid was present was longer
than the environment's ten words. The copy panicked, and the wasm trapped at the first frame. It now
copies exactly the environment's words. The WebGL2 builder's tests catch it.

## Cost

The moment store and the color sum take 8 bytes per pixel each. Each pass writes its own target
once a frame, so the layer writes 16 bytes per pixel, or 33 MB at 1920 by 1080. The color pass also
reads the store, so the traffic is about 50 MB a frame. The weighted blending writes 10 bytes a
pixel. The composite writes the scene color, and SMAA's two 8-bit steps take 8 bytes per pixel more.

The S1 benchmark page with its smoke switch measured the layer against the weighted blending in
Chrome 156 on this computer's GPU, at High, on the tree of `e1fbc77f9`. Its `moments=on` switch
draws the smoke in the camera's moment layer instead, so the page measures the same surfaces drawn
by each layer. The reading came from two runs taken back to
back under the same load (7.25 to 4.52 for the weighted side, 4.52 to 4.21 for the moment side;
medians of three runs of ten seconds):

| Path | Weighted, CPU | Moments, CPU | Weighted, GPU | Moments, GPU |
| --- | ---: | ---: | ---: | ---: |
| WebGPU | 3.16 ms | 3.21 ms | 3.61 ms | 4.19 ms |
| WebGL2 | 3.34 ms | 3.34 ms | 5.63 ms | 6.75 ms |

The layer is free on the processor: five hundredths of a millisecond on WebGPU and nothing on
WebGL2. Its cost is GPU time: 0.58 ms more on WebGPU, about sixteen per cent of that scene's GPU
frame, and 1.12 ms more on WebGL2, about twenty per cent. The WebGL2 figure is the frame total from
its timer extension rather than a per-pass figure.

That is a desktop GPU with a fraction of a phone's fill rate. The phone's figure decides the
preset, and it is owed. The desktop figure does not settle Ultra.

The layer also copies its two SMAA lookup tables, 362,496 bytes, into the upload arena at its first
frame. No other frame copies them, and no frame without the setting copies anything.

## Look

The layer keeps a near pane's color where the weighted blending washes it toward what lies behind,
and on the test scene it keeps too much of it: the front pane reads as though it were opaque, and
in the close-pane scene the image is 0.25 to 0.30 steps farther from the exact one than the
blend's, and in the spread scene it is two and a half times nearer. The edge patches below are the
close-pane error at overlaps.

The layer has an edge of its own where several panes overlap: rectangular patches about a tenth of
the picture's width show the panes behind mixed into the pane's own color. They come from the
reconstruction, not from the anti-alias step or any target's size. The moment store's coverage is
smooth across the same edge, and the color sum's weights step in the same rectangles: the fit's two
atoms hold the transmittance constant between their depths, and where the panes' edges succeed one
another the average takes a different weight in each rectangle. The patches scale with the picture
because they are the panes' own overlaps. The weighted blending has no such patches and washes the
near pane's color instead. Which look is better is the owner's ruling (hard rule 40): the mean
error favors the moments, and the patches are the price of them at close, overlapping depths.

## Consequences

- The setting is one flag on the quality settings, and `createEngine`'s `momentTransparency` option
  or the `?moments=` switch sets it. It is fixed at the start, and it is off on every preset. The
  quality presets page gives its row and its cost, so a page sees what it pays.
- The setting covers every blended surface that a moment build covers, whether its material blends
  normally or with `'weighted'`, so only one layered pass draws. A material with a feature that the
  moment builds lack, such as a clear coat, transmission, parallax or a mask, keeps the transparent
  pass's sort. The moment builds carry vertex colors, skins, morph targets, row values, shadows,
  area lights, light through a thin surface, displacement and the device's bits.
- Both paths fall back to today's sort where the device cannot draw into 16-bit float targets.
- A page without the setting draws exactly as it does today. The frame graph declares and records
  none of the layer's passes, and the sorted layout asks for none of its pipelines. A unit test
  compares the frame's steps with and without the setting.
- The permutation word is full. The moment pass takes the value of the outline view's bit. No mesh
  template lists that bit, so no other mesh build moves. The outline mask's own builds would move
  with it, because a first-use bit takes the builds of every template that lists its name. The
  manifest's first-use table therefore names the six mesh templates that the bit serves, and the
  outline mask's builds keep their device modules.
- The color pass cannot share a second value. The shader build names a build's first-use file by
  the names of its bits. A shared value would pull another template's builds into the moment file.
  The color pass becomes six shader entries instead, one for each mesh template with a moment
  build.
- The two lookup tables port the SMAA reference implementation, under its MIT notice.

## Acceptance and tests

The image test draws the scene twice, with moment transparency on and with today's sort. It draws
the same scene a third time with the weighted blending. The test measures each image's distance
from the sorted one, as the mean of every color channel over the whole picture. It passes when the
moment image is nearer than the weighted image.

On the tree of `e1fbc77f9`, with two scenes drawn at 480 by 270:

| Scene | Path | Weighted | Moments |
| --- | --- | ---: | ---: |
| five panes within about five meters | WebGPU | 1.427 | 1.680 |
| five panes within about five meters | WebGL2 | 1.385 | 1.684 |
| five panes spread over one to thirty meters | WebGPU | 4.007 | 1.602 |
| five panes spread over one to thirty meters | WebGL2 | 3.949 | 1.562 |

The spread scene is the model's range, and there the moment layer is nearer by about two and a half
times. The close scene is the hard case for a two-atom fit, and there it is 0.25 to 0.30 steps
farther. Both scenes stay in the manifest and the spec, and the close scene's failure stands.

Two more tests guard the property that gives the feature its name. The same panes added in the
opposite order draw the same picture, and both draw nearer the exact image than the weighted
blending does.

The same property held on real hardware. On 29 October 2026, at `b73dea690`, the four image pages
ran on a Galaxy S25 (SM-S931B) in Chrome 152 on Android 15 and on an iPad Pro 13 in Safari 26.6.1 on
iOS 26. Each ran on both tiers, WebGPU and WebGL2, with the panes in the forward order and in the
reverse order:

| Device | Tier | Forward and reverse |
| --- | --- | --- |
| Galaxy S25, Chrome 152, Android 15 | WebGPU | drawn, byte-identical |
| Galaxy S25, Chrome 152, Android 15 | WebGL2 | drawn, byte-identical |
| iPad Pro 13, Safari 26.6.1, iOS 26 | WebGPU | drawn, byte-identical |
| iPad Pro 13, Safari 26.6.1, iOS 26 | WebGL2 | drawn, byte-identical |

Every picture shows each pane in its true color through the ones in front of it. On each tier the
two orders hash the same, so the phone and the tablet prove the order independence that the two
tests prove on this computer. The runner marked all four checks failed only because they have no
reference image yet. A red run therefore does not mean that the layer refused; the pictures are in
`target/runs/20261029-085721-checks`, and the records under `.dev/tested-devices/` name the
sessions.

The frame graph's test holds the passes, their order, their bind groups and the tables' first use.
It also holds that an unused layer declares and records nothing.

## Remaining work

1. The measured cost on this computer's GPU, which the S1 benchmark run fills in.
2. The run on an S24-class phone, which replaces the phone figure.
3. The SwiftShader references of the four image tests, which come from a CI run.
