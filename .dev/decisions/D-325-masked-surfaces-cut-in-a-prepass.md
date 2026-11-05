# D-325: masked surfaces cut their masks in a prepass on WebGPU under MSAA

Status: decided and built. With MSAA on, WebGPU's masked lit pairs draw their depth first. Their own
build cuts the mask there. WebGL2 is unchanged. The iPhone's remaining gap to its own frame without
MSAA is open. Task: none.

Summary: under MSAA, WebKit's WebGPU pays for every masked layer that a pixel shades through. A
prepass now cuts the masks, and the shading runs at that depth without them. In Safari on the Mac,
the near oak stand at Medium went from 31.5 to 10.6 ms of GPU time. On the iPhone 17 it went from
109.7 to 46.4 ms. Chrome draws the stand in the same time either way. Without MSAA the prepass costs
more than it saves, so it draws only with MSAA. At Medium the pictures stay the same to the last
pixel.

## Question

Six oaks at Medium took 132 ms a frame on the iPhone 17's WebGPU. Its own WebGL2 took 25 ms, and
WebGPU with MSAA off took 19.5 ms. What makes masked leaves so slow on WebKit's WebGPU? Which change
brings them back without a cost to Chrome or WebGL2?

## Rule

The lead's ruling sets four points:

- Opaque surfaces keep the GPU's own removal of hidden surfaces ([D-43](D-43-webgl2-prepass.md)).
  So the prepass holds only masked pairs.
- The prepass writes the coverage, which keeps alpha to coverage's soft edges.
- With MSAA off, the prepass must still win in WebKit and cost nothing in Chrome. If it does, it
  draws on WebGPU always. If not, it draws only with MSAA.
- WebGL2 stays unchanged.

## Data

The main pass's memory is not the cause. WebGPU's main pass holds 8 bytes a sample (rg11b10ufloat
color and depth32float), and WebGL2's holds 12. Shading per sample is not the cause either. The
sample mask that the shader writes is not the cause: alpha to coverage off saves 4 of the iPhone's
132 ms. The cause is WebKit's WebGPU with masked fragments under MSAA, layer upon layer. It shows
without plants too. The `alpha-mask-cost` page with `?layers=8` stacks eight masked curtains. Under
MSAA in Safari they took 6.48 ms, against 1.37 ms opaque. In Chrome on the same Mac they took 2.57
against 1.67 ms ([D-319](D-319-near-plants-split-by-distance.md#where-a-medium-frame-goes)). A
discard before the lighting helped only a little.

GPU time per frame in ms, masked prepass on against off:

| Page | Antialiasing | Prepass | No prepass | Device and browser |
| --- | --- | --- | --- | --- |
| Near shoots, Medium, 1.5 M shoots (prototype) | MSAA x4 | 46.4 | 109.7 | iPhone 17, WebGPU |
| Near shoots, Medium, 1.5 M shoots (prototype) | none | | 16.6 | iPhone 17, WebGPU |
| Near shoots, Medium, 1.5 M shoots (prototype) | MSAA x4 | 6.6 | 24.4 | Mac, Safari 26.6 |
| Near shoots, Medium, 1.5 M shoots (prototype) | MSAA x4 | 4.83 | 4.80 | Mac, Chrome |
| Near oak stand, Medium (`near-breakdown`) | MSAA x4 | 10.6 | 31.5 | Mac, Safari 26.6 |
| Near oak stand, Medium (`near-breakdown`) | none | 5.75 | 5.43 | Mac, Safari 26.6 |
| Near shoots, Medium, 1.5 M shoots | MSAA x4 | 4.81 | 4.73 | Mac, Chrome |
| Near shoots, Medium, 1.5 M shoots | none | 4.59 | 3.52 | Mac, Chrome |
| Eight masked curtains (`alpha-mask-cost?layers=8`) | MSAA x4 | 4.33 | 12.56 | Mac, Safari 26.6 |
| Eight masked curtains | none | 2.31 | 4.70 | Mac, Safari 26.6 |
| Eight masked curtains | MSAA x4 | 2.68 | 1.91 | Mac, Chrome |
| Eight masked curtains | none | 2.21 | 1.73 | Mac, Chrome |

How the data was produced:

- The prototype rows are earlier runs of the near shoots page, on the iPhone through BrowserStack
  and on the Mac. They used the prototype of this change.
- The Safari rows come from `bun tests/real-browsers.ts`, with `--plan near-breakdown` and with
  `--plan alpha-mask-cost`. Each run took the four pages of its plan with `--only`, for two or three
  rounds. They ran at commit 8cf645b80, with this change not yet committed.
- The Chrome rows are three rounds each in a parked Chrome for Testing window, at the Safari
  runner's window size. The machine's load stayed under 8. The near shoots row without MSAA is one
  round. Three earlier rounds under a load of 18 to 35 gave 4.8 ms both ways.
- The curtains' figures are the masked side's. The opaque side drew 2.0 to 2.3 ms in Chrome
  throughout.

With the prepass, the held frame of the near shoots sketch at Medium makes 248 draws, against 192.
It uses 22 pipelines, against 20. Each masked bucket draws once more, in the prepass.

## Look

At Medium, the held pictures of the near shoots sketch match to the last pixel with the prepass and
without it. That holds on WebGPU and on compatibility mode. The prepass writes the samples that the
mask's coverage takes. The shading then fills exactly those samples, so the resolved pixel does not
change.

At High with GPU occlusion culling, 0.52 % of the pixels move by more than 8 levels of 255, and
2.04 % by more than 3. High draws the depth prepass for its screen effects, and the leaves now enter
that depth. So ambient occlusion and the other screen effects see them. With the prepass, GPU
occlusion culling on or off draws the same picture.

Across the whole picture set on the Mac's GPU, 1,787 tests passed. Five pictures moved past their
limits for this reason:

- `alpha-mask-ao` on WebGPU and compatibility mode, by 0.300 and 0.288 % of the pixels. The grass
  now darkens the ground under the ball.
- `alpha-hash-shadows` on WebGPU, by 0.168 %. The occlusion darkens a few texels of the wall through
  the holes of the hashed cards.
- `impostors` on compatibility mode, by 0.153 %, at the spheres' rims.
- `creek-render-scale-route` on WebGPU, by 0.101 %, in the crowns.

With the prepass off by default, all five draw their old pictures. Compatibility mode has no sample
mask. There the wind pictures also move at scattered leaf edges, by about 1.6 % of the pixels. The
masked surfaces now take part in the screen effects as opaque surfaces do, which is the better look.
The few dark texels behind the hashed cards are the occlusion's own halo, which opaque surfaces show
too.

## Decision

The prepass draws only while the scene draws with MSAA. With MSAA off, it does not win in WebKit on
the oak stand: 5.75 against 5.43 ms. In Chrome it costs 0.5 ms of the curtains' 1.7 ms, and about
1 ms of the stand's 3.5 ms. So the rule for drawing it always fails. With MSAA, it takes WebKit's oak
stand to a third, and the iPhone's to under half. Chrome draws the stand in the same time. The eight
curtains are Chrome's worst case under MSAA, at 0.8 ms more. There every pixel shades through eight
masked layers, and no opaque surface hides any of them.

- The hard-edged form was rejected. It saves the same time, but it moves 5 to 7 % of the pixels and
  drops the soft leaf edges of alpha to coverage.
- A prepass of every opaque surface was rejected by the ruling. Opaque surfaces keep D-43's rule.
- A discard before the lighting was measured and removed. It saved little.

What stays open: with the prepass under MSAA, the iPhone 17 draws the stand in 46.4 ms. With MSAA
off it takes 16.6 ms. The prepass removes most of WebKit's cost per layer, but not all of it. The
WebKit repro page is kept for a report, which the owner holds back for now.

## Consequences

- `FrameGraph::depth_pass` gives `Prepass::Masked` where no depth prepass draws. That is a prepass
  of masked pairs alone. Where the depth prepass draws, it gives `Prepass::DepthAndMasks`. Both
  apply only with MSAA.
- `DrawKey::cuts_in_prepass` takes the masked pairs of the lit templates. These are the standard
  material's builds with and without maps, the light probe grid's, and custom materials'. Pairs
  that let light through stay out.
- `DrawKey::after_prepass` strips the mask, the hash, the fade's dither and alpha to coverage from
  their shading. That shading tests for equal depth.
- `lit.wgsl` gives each masked build an `fs_prepass` entry. It sets up the surface as the shading
  does, and writes the mask's coverage as a sample mask. Compatibility mode has no sample mask, so
  there it returns the alpha for the pipeline's alpha to coverage. Without alpha to coverage it
  discards at the cutoff.
- WebGL2 draws as before. Its prepass writes no fragment, so masked pairs stay out of it.
- `?masked-prepass=off` keeps masked pairs out of every prepass, for pages that measure what the
  prepass saves. The `alpha-mask-cost` and `near-breakdown` plans run it beside each MSAA page.
- The Mac set of the five moved pictures is redrawn with this record as the cause
  ([Image tests](../image-tests.md)). Their software pictures are owed to CI's next run.
