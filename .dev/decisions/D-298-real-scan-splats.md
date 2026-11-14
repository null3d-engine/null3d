# D-298: Real scans draw sharp and fast in the splats add-on

Status: decided by the owner: the Bolton Priory scan as the demo's scan, converted to an SPZ stream by script; prefixes that grow their splats; unlit surfaces for custom materials; and a one-sample layer for the splats on multisampled frames. Built: the conversion, the card along the ellipse's axes, the importance by covered area, the growth, the unlit hook, the one-sample layer, the stream's `settle`, and the demo. The scan holds the display's rate on the cloud iPad Pro 13 and Galaxy S24 at Low ([Tested devices](../tested-devices.md#a-real-scan-in-the-splats-add-on-ipad-pro-13-and-galaxy-s24)).

Summary: The first real scan in the splats add-on drew as streaks, then at 4 fps on Ultra. A card that spans the projected ellipse's own axes fixed the streaks. An unlit surface hook took the splat pass from about 300 ms to 15 ms at 160,000 splats, and a one-sample layer removes the four-sample blend that held 400,000 splats to 33 fps: with it, Ultra draws its full 800,000 at 120 fps with MSAA on.

## Question

How should the splats add-on draw a real scan of 1.7 million splats, so that it looks like the scan and keeps the frame rate on each preset?

## Rule

The scan must look as it does in the viewer of the site that publishes it, at the preset's budget, and the frame must stay inside the preset's frame budget on the owner's Mac. The better look wins where options differ (hard rule 40).

## Data

All figures are from the splats demo on the owner's MacBook Pro (M3 Max), in Chrome 153 under Playwright with a visible window at 1280 x 800 CSS pixels and a device pixel ratio of 2, on WebGPU, with the stats overlay's GPU steps. The camera circles the site from 26 units away and 24 up.

| Draw | Splats | GPU time of the splat pass | Frame rate |
| --- | --- | --- | --- |
| Lit surface function, a projection per pixel, Ultra (4x MSAA) | 160,000 | about 300 ms | 4 fps |
| The same with the fade from the card's coordinates | 160,000 | 174 ms | 5 fps |
| The same, prefixes not grown | 160,000 | 122 ms | 8 fps |
| Unlit hook, Ultra (4x MSAA) | 160,000 | 15 ms | 50 to 60 fps |
| Unlit hook, Ultra (4x MSAA) | 400,000 | not read | 33 fps |
| Unlit hook, Ultra, antialias `none` | 400,000 | not read | 120 fps |
| Unlit hook, Ultra, antialias `none` | 800,000 | not read | 120 fps |
| Unlit hook and one-sample layer, Ultra (4x MSAA) | 800,000 | not read | 120 fps |
| Unlit hook and one-sample layer, WebGL2 at its preset (4x MSAA) | 120,000 | not read | 118 to 121 fps |
| Lit surface function, Low (FXAA, lower render scale) | 100,000 | 15.7 ms | 62 fps |

The frame-budget governor lowers the splat count to 160,000 on Ultra whenever frames run slow, so the rows at 160,000 are what the governor left.

The look came from screenshots of the same view. Each card used to span the projections of the splat's first two axes only. A flat splat whose third axis carried its screen size, or whose first two axes lined up on the screen, got a sliver of a card. The scan then drew as streaks with the background showing through, and after the fix it matched the publisher's viewer. With the budget at 160,000 of the scan's 1.7 million splats, the prefixes left the ground sparse and white until they grew their splats.

## Look

- The card along the projected ellipse's own axes is the correct footprint of a Gaussian and looks like the publisher's viewer. The card of the first two axes looks broken on any real scan.
- Prefixes that grow their splats keep a chunk's surface covered. Prefixes that keep their sizes leave gaps that show the background. The growth stops at three times a splat's spreads, so a far chunk never draws as a few large blobs.
- A growth from the prefix's share of the chunk's summed cover inflated a dense cloud: the test knot, kept at a quarter of its splats, drew as a tube about one and a half times as thick, though its kept splats already covered it. A growth from the share of the chunk's surface that the prefix leaves uncovered keeps the knot at its own thickness and the scan's ground covered.
- A splat's importance is its opacity times the area of its largest cross-section. A scan's splats are mostly flat discs whose thickness says nothing of the surface, so the volume ranked them almost at random.
- Unlit splats match the lit surface that set only `emissive` on a bright canopy, but not on dark ground. The lit surface also reflected the sky, and that reflection was a large share of the dark moss's light. The garden's ground carries the reflection in its own color. Its mesh wears the capture's light rather than the stage's, so the sky cannot band it.
- The softness fade measures the opaque depth behind the pixel. A flat ground seen at a grazing angle reads the mesh about a meter behind, so the fade saturates, though the splats sit a few centimeters above the mesh. A perpendicular measure still leaves about a third of a meter on rolling ground. Keeping a ground layer blended at every angle needs the fade's own measure to change in the engine. The garden gives its ground layer the capture's light instead.
- The one-sample layer draws the splats' own pixels the same. A mesh's anti-aliased edge in front of splats tests the layer against one sample, so a faint fringe can show there, and splats composite over the camera's other blended objects instead of sorting with them.

## Decision

- **The scan.** Dok11's Bolton Priory scan from SuperSplat, under CC BY 4.0, 24.4 MB as published. Rejected: a scan under a non-commercial or no-derivatives licence; scans of people, game characters or branded cars; and the castle, the manor and the tree scans, which had more stray splats or showed the detail levels less well.
- **Conversion.** A script converts the published SOG file to a stream of SPZ chunks, with libwebp's own decoder ([Sample content](../sample-content.md#splat-scans-converted-by-script)). Rejected, by the owner: a SOG reader in the add-on. A browser's WebP decoder gives exact bytes in a worker on Chrome and Firefox only through WebGL readback. Safari 26 has no `ImageDecoder` and ignores `premultiplyAlpha: 'none'` in `createImageBitmap`, which changed 3.4 million bytes of the scan's color image, since every splat's color pixel is partly transparent. Also rejected: a WebP decoder of our own in TypeScript, and a Rust decoder in WebAssembly, which the owner did not want; and keeping the 404 MB PLY file, over the 40 MB limit.
- **The card** spans the 2D covariance's eigenvectors, scaled by the square roots of its eigenvalues, in the batch's shader and in the glTF shader. The glTF shader also writes color that its alpha multiplied, as the engine's blending takes it.
- **Growth.** As a chunk is built, the add-on sees it from three directions, along each axis, through cells about the size of its middle splat. Each splat hides the cells under its projected ellipse by its own Gaussian, and a cell counts as covered once its splats hide half of what lies behind. The share of the whole chunk's covered cells that each prefix covers is kept at prefix lengths that halve every two steps. A prefix grows its splats by the square root of the inverse of its share, at most three times. Rejected, by the owner, as each looked worse: a growth from the prefix's share of the summed cover of its splats, which inflated dense clouds; and a lower cap on that growth, which left holes in the scan's ground. Also rejected: a measure in 3D cells across each splat's plane, which made round splats in a volume cover too little; and thinning the scan when it is converted, which needs a merge of neighbouring splats, and raising the preset budgets, which the owner keeps.
- **Unlit surfaces.** A custom material declares `fn unlit(input: SurfaceInput) -> vec4f` in place of `surface`. The template shows that color with the fog, the exposure and the output, and none of the lighting ([Unlit surfaces](../../docs/shaders/surface-functions.md#unlit-surfaces)). It keeps the uniforms, the textures and the scene depth, which the splats need. Rejected: a full shader for the splats, which reaches neither a material's uniforms nor the scene depth, so `extent` and `softness` would stop working.
- **One-sample layer.** On a multisampled frame the camera draws the splats into a layer of one sample, tested against a one-sample copy of the opaque depth, and composites it over the scene in the transparent pass's render pass, as the weighted and moment layers do ([D-150](D-150-weighted-blended-transparency.md), [D-261](D-261-moment-transparency.md)). Rejected: drawing into the resolved scene color, which the render graph cannot name, and which is the canvas itself on the 8-bit path; and turning MSAA off for the page, which costs every mesh its smooth edges.
- **The stream's `settle`** waits for the chunks that its selection wants, so a still picture shows its whole view.

## Consequences

- `packages/splats`: the card, the unlit shader, the importance by cover, the growth in `packRows`, `settle` for streams, and the draw's frame point for the layer. Their unit tests cover the growth of a sparse sheet and of a dense crowd, its cap and the importance.
- `crates/null3d-shaders`: the `unlit` hook in `material.rs` and its builds in `lit.wgsl`, with tests in `tests/material.rs`. Builds without the hook compile as before.
- The renderer: the one-sample layer and its composite, on both GPU paths. The upload arena reuses the smallest free large block that holds a copy and gives back the ones it outgrew: the splats demo at Ultra held 556 to 1,013 MiB of engine memory and failed with E1109 after a drag, and holds 404 to 457 MiB with no failure ([Implementation notes](../implementation-notes.md)). `tests/single_layer_memory.rs` holds a large layered batch within 64 KiB of the same batch in the transparent pass.
- `tools/samples/splats/bolton-priory.ts` converts the scan, and `copyNamedSamples` copies a named stream's chunks.
- The splats demo (`examples/splats/`) shows the scan, with a drone of meshes that the splats mix with.
- Docs: the unlit surfaces in `shaders/surface-functions`, the splats page, the custom shaders guide, and the skill's shader and splat notes.
