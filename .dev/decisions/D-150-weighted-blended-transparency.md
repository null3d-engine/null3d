# D-150: Weighted blended transparency

Status: decided by the helper of M2-EX33, for the owner's review. Built: the weighted blending is on main (`21ac1bf03`). Not built yet: weighted builds for custom materials and for the particles add-on. The owner's review is pending. Task: M2-EX33.

Summary: A material with `blending: 'weighted'` blends with other such surfaces in any order, by McGuire and Bavoil's method with three.js's default weight. After the transparent pass they draw into a color sum and a coverage sum of `-log2(1 - alpha)`, so every GPU path needs one pass. A full-screen step blends them over the scene, and nothing runs or downloads until a material asks for it.

## Question

The showcase scenes need smoke and fire in Battle, steam in Night town and glass ([D-142](D-142-more-techniques-before-1-0.md)). Blended surfaces sort far to near by object or by row ([concepts/materials](../../docs/concepts/materials.md#the-transparent-pass)). Puffs of smoke inside each other, and panes of glass that cross, have no right order, so they pop as the camera moves. How does a scene blend such surfaces in any order, on all three GPU paths, at no cost to scenes that do not ask?

## Rule

- The best technique by default ([D-52](D-52-intent-parity.md)), and three.js's intent where three.js has the feature: its `OITPassNode` (WebGPURenderer add-on).
- One look on WebGPU, compatibility mode and WebGL2, or a fallback that the docs state.
- Zero cost while no material asks: no pass, target, pipeline or shader download.
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1). WebGPU's default limits and compatibility mode's lower ones (hard rule 6).
- New shader code loads on first use ([D-56](D-56-first-use-shader-files.md)).

## Options

### The technique

| Option | Verdict |
| --- | --- |
| A: weighted blended OIT (McGuire and Bavoil 2013): a weighted color sum and a coverage, then one full-screen blend | Chosen. Fixed memory, ordinary blending, one geometry pass. three.js's `OITPassNode` draws it |
| B: depth peeling, as Babylon.js's `useOrderIndependentTransparency` | Rejected. Each layer is one more geometry pass: smoke of ten layers costs ten passes |
| C: per-pixel linked lists or k-buffers | Rejected. They need storage buffers and atomics in fragment shaders, which compatibility mode and WebGL2 lack (hard rule 6) |
| D: stochastic transparency, as the alpha hash | Rejected for smoke. It needs many samples, or a temporal filter that the engine does not have ([D-129](D-129-temporal-anti-aliasing.md)). The `hash` alpha mode stays for fades |

Weighted blending is an approximation: where a dark and a bright surface overlap at a similar depth, both show. Its weight makes near surfaces count for more. Sorted blending stays the default, because it is exact where an order exists.

### How a material asks for it

| Option | Verdict |
| --- | --- |
| A: a fourth `blending`, `'weighted'`, per material | Chosen. Only `normal` blending depends on the order: `additive` and `multiply` give the same result in any order. One option, one place |
| B: a scene-wide switch, as three.js's pass takes every transparent material of normal blending | Rejected. Glass that is in front of all else wants the exact sort, and a switch beside the option would be a second way to do one thing ([design principle 10](../../AGENTS.md#design-principles)). A port sets the option on the materials that the pass blended |

A material with `transmission` sorts, as three.js's pass leaves such materials out, and throws E1217 with `'weighted'`. Custom materials and lines throw E1217 too. A custom material's builds are made at build time for every bit it lists, so the weighted bit would double them.

### Two targets with one blend

The paper's coverage target multiplies `1 - alpha` into itself: blend factors zero and one minus the source color. Its color target adds. Compatibility mode requires one blend state across a pipeline's color targets, and WebGL2 needs `OES_draw_buffers_indexed` for two. The options:

| Option | Verdict |
| --- | --- |
| A: the coverage target adds `-log2(1 - alpha)`, and the composite takes two to the power of minus the sum | Chosen. The product of `1 - alpha` equals two to the power of minus the sum of their logarithms, so the result is the same. Both targets add, so every path draws one pass |
| B: two passes on compatibility mode and WebGL2, one per target | Rejected. The surfaces' vertex work runs twice, which smoke of many sprites feels |
| C: one RGBA16F target with the coverage in its alpha, and no depth weight | Rejected. Without the weight the result is a plain average, which loses McGuire's near-over-far ordering, the reason for the method |

Alpha is held below 0.9995, so a fully opaque fragment adds a finite 10.97. The sum lives in a 16-bit float (`format::R16_FLOAT`), which every path draws and blends at one sample.

### The weight

three.js's default, equation 9 of the paper: `w = alpha * clamp(0.03 / (1e-5 + (z / 200)^4), 1e-2, 3e3)`, with `z` the depth along the view. The engine scales it by 1/32, since only the ratio of weights shows. Bright HDR colors of many near layers then stay inside the range of 16-bit floats. three.js's floor of the composite's divisor scales with it.

### Samples and depth

The layer draws at one sample on every path:

- Compatibility mode cannot multisample 16-bit float targets (plan appendix A.4).
- At 4x MSAA, the two targets would take 40 bytes per pixel, about 100 MB on a 1080 x 2400 phone without transient attachments.

The weighted pass tests the scene's depth and writes none. A one-sample scene lends its own depth. A multisampled scene's weighted pass creates a one-sample depth target. Its first draw copies the first sample of each pixel's depth into it (template `WEIGHTED_DEPTH`, which writes `frag_depth`). WebGPU reads the multisampled depth as unfilterable floats, which compatibility mode allows. WebGL2's backend hands the copy its one-sample blit, as it does for ambient occlusion. MSAA therefore does not smooth the edges of weighted surfaces. three.js's pass matches the scene's samples on WebGPU and turns MSAA off on WebGL2.

The copy draws first in the weighted pass, which saves a render pass. As a pass of its own, its one target would be a subset of the weighted pass's targets, so the render graph would join the two, and their formats would not match. Its pipeline names both color targets of the pass and writes no color (`template::draws_two_targets`).

### Where the layer draws

After the camera's transparent pass, as three.js's pass does. Weighted surfaces show over the other blended surfaces and the surfaces that let light through, where nothing nearer wrote depth. The composite then blends over the scene color in a render pass of its own, before the outline, the effects, bloom and the final pass.

Rejected: before the transmission copy, so glass would bend the smoke behind it. Smoke in front of glass would then show behind it. That is the common case in the showcase scenes: steam in a street in front of shop windows.

### Fallbacks

Each weighted sorted bucket keeps the pipeline of its normal blending beside its weighted one. These draw weighted surfaces far to near, as normal blending, in their transparent pass:

- views other than the camera's: scene passes and reflection passes;
- WebGL2 devices that cannot draw 16-bit float targets (no `EXT_color_buffer_float` or `EXT_color_buffer_half_float`; capability `FLOAT16_TARGETS`);
- frames before the layer's first-use shaders are built.

### The draw list

`BeginRenderPass` takes an optional tenth operand, a second color target of one sample, which clears and stores as the first. A pipeline with the `WEIGHTED` permutation bit, or of the depth copy's template, draws into its color format and `r16float`. The WebGPU backend adds the second attachment and target. The WebGL2 backend keeps a framebuffer with two color attachments and calls `drawBuffers`. The mock GPU checks that only `WEIGHTED` pipelines draw into a pass with two targets.

### Numbers

Permutation bit `WEIGHTED` (1 << 31) takes the last bit of the 32-bit word. Later features that need a shader variant use shader entries of their own, as decals do, or widen the word. Material feature 524288, templates 64 and 65, bind layouts 41 and 42, format 25 and capability 1 << 16, as `m1-claims.md` records.

## Data

The allocation check drew the production S1 page at 100,000 instances, with its smoke switch on, on the Mac (`bun run bench:allocation --weighted`). A frame's bytes, from the sample that allocated least:

| Place | Budget | S1 without weighted surfaces | S1 with them, WebGPU | S1 with them, WebGL2 |
| --- | ---: | ---: | ---: | ---: |
| sketch worker | 240 | pass | 228.2 | 219.5 |
| render worker, the draw list's replay | 320 | | 168.6 | |
| render worker, in all | 320 a place | 160.1 | 550.9 | 170.7 |

How the data was produced: the WebGPU column comes from `bun run bench:allocation --weighted --gpu webgpu`, two samples of 5 s after 30 s, over 1,209 frames. Every place of the render worker is inside its budget. That run includes `27126d489`, so the WebGPU pass setup boxes no clear colors, and an allowance of 32 bytes for the staging write in `WEIGHTED_BUDGETS`. Without those two, the replay allocates about 410 bytes a frame. The other columns come from a run of `bun run bench:allocation --weighted` without them. Run with the browser's inlining off, the check names the real places of a frame's bytes. The smoke puffs' code (`onUpdate`, `visibleEntries`, `occludedEntries`) is the benchmark page's own.

The size check: the `WEIGHTED` builds and the sets they share with skinning, sprites, transmission and texcoords add 45 first-use shader files of 3 KB to 20 KB after Brotli each, all inside the 32 KB budget of a first-use file. None of them loads at a page's start. A page downloads the weighted layer's two steps and its templates' `WEIGHTED` builds only when its first weighted material draws, so a scene without one downloads and runs none of it.

The GPU check: the two-step `bun run bench:gpu-check` (prepare, then measure) is recorded by the `GPU-Checked:` trailer on the commit that lands this feature.

## Decision

Options A throughout: weighted blended OIT per material, both targets additive, one sample, after the camera's transparent pass, with sorted blending as the fallback.

## Consequences

- Code: `crates/null3d-render/src/weighted.rs` holds the composite and the depth copy. The frame graph, `frame_graph.rs`, holds the two passes and the second color target. The sorted layout, `sorted.rs`, holds each bucket's weighted pipeline and the choice of rows per pass, beside both builders' transparent passes. The pipeline keys have `DrawKey::weighted`, and the material table has `feature::WEIGHTED`. The shaders are `lib/weighted.wgsl` and `weighted_layer.wgsl`, with the `WEIGHTED` builds of `lit.wgsl`, `unlit.wgsl`, `unlit_map.wgsl` and `sprite.wgsl`. They load as the first-use set `weighted`. The WebGPU and WebGL2 backends draw two color targets.
- Docs: `api/materials` (Weighted blending), `api/sprites`, `api/points`, `api/lines`, `concepts/materials`, the E1217 page, and the mapping entries `oit-pass` and `mat-flags`.
- Skills: the develop skill's quick reference, and the port skill's materials notes.
- Tests: the frame graph's test of the layer and the first-use download test. The image tests are `weighted`, `weighted-reverse` (the same images in the reverse order) and the demo `weighted-transparency`.
- Pending: weighted builds for custom materials on request, and a weighted build of the particles add-on (M2-EX20). A half-size layer can become a step of the quality governor if a scene needs it.
