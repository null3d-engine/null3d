# D-36: Outlines

Status: decided, 2026-10-04. Date: 2026-10-04. Task: M2-F4.

## Question

1. How does the engine find the outlined objects and draw their mask, on both GPU paths?
2. How does the mask know which parts other objects hide, as three.js's `OutlinePass` does?
3. How does the engine draw the line from the mask: with `OutlinePass`'s soft edge and glow, or with a crisp line?
4. What does the sketch set: one style for every outlined object, or one per object?

## Rule

- Outlines draw on every tier ([D-21](D-21-effect-chain.md)'s rule for effects).
- The outline is a look, so its technique is chosen on quality and cost, and the porting skill maps three.js's settings onto it ([D-52](D-52-intent-parity.md)). The comparison with three.js is a sanity check, with a limit of its own.
- Outlines cost nothing while nothing is outlined. Steady frames with outlines allocate nothing, and a new render scale makes no GPU object.
- No draw samples a texture that it draws into (the Adreno rule of the [implementation notes](../implementation-notes.md)).

## Data

### The owner's ruling

On 4 October 2026 the owner made a crisp line the default outline. The line has one width in CSS pixels and two colors, with no blur. `OutlinePass`'s glow, its pulse and its blurred edge leave the core. They go to the `three-compat` add-on in M3, for ports that need that look. The reasons:

- A crisp line costs less. It needs no pass after the mask, and no target at half or a quarter of the size.
- A crisp line stays sharp at every pixel ratio and render scale. Its width counts pixels of the canvas. `OutlinePass`'s edge counts texels of a half-size target, so it grows blurrier on a phone's dense screen.
- No engine that the technique analysis read has a better mask step than this record's. The mask stays as it was.
- No setting of a crisp line can reach a blurred glow, so the glow cannot stay as a setting. It goes to the add-on instead of a three.js-look mode in the core, as D-52 requires.

### Parity with three.js

The twin page, `bench/pages/threejs/outline.html`, draws the same scene (`bench/scenes/outline.ts`) with an `EffectComposer`. Its passes are a `RenderPass`, an `OutlinePass` with an `edgeStrength` of 0, and an `OutputPass` with ACES. A last `ShaderPass` draws null3D's crisp line from the `OutlinePass`'s mask. So three.js's own mask decides which parts are hidden, and the comparison checks the mask and where the line falls. Both sides draw without anti-aliasing, as the composer's targets have no MSAA.

Pixels that differ from three.js by its rule, 4 October 2026:

| Scene | GPU | Core WebGPU | Compatibility mode | WebGL2 |
| --- | --- | --- | --- | --- |
| `outline-plain`: a white line of 2 pixels, no hidden line | Chrome on the Mac's GPU | 0.015% | 0.015% | 0.000% |
| `outline-plain` | SwiftShader | 0.105% | 0.105% | 0.000% |
| `outline-hidden`: an orange line of 3 pixels, a blue hidden line | Chrome on the Mac's GPU | 0.015% | 0.015% | 0.000% |
| `outline-hidden` | SwiftShader | 0.106% | 0.106% | 0.000% |

`bun run parity -- --scene outline-plain,outline-hidden`, and the same with `CI=1` for SwiftShader, gives these figures. On SwiftShader's WebGPU, most of the pixels that differ lie on the ground's far edge, and on the top edge of the plain box. Those are the scene's own edges, which SwiftShader's WebGPU draws a row apart from WebGL. So the outline scenes pass under a limit of 0.15% (`OUTLINE_MAX_DIFFERENT_PERCENT` in `bench/lib/parity.ts`).

A fault put on purpose into the twin shows what the limit catches. The twin drew its line around the hidden parts as if nothing hid them, in the visible color. The scenes then differed in 0.173% to 0.188% (`outline-plain`) and 0.215% to 0.230% (`outline-hidden`) on the Mac's GPU, so the fault fails on every tier.

The outlined box floats 10 cm above the ground. `OutlinePass` packs the depth of the other objects into the four channels of a half float target. Near a contact line that depth is too coarse, and three.js counted the lowest rows of a box on the ground as hidden. null3D tests against the scene's own depth, so those rows count as visible.

### Cost

- While nothing is outlined, or outlines are off, no outline pass runs and no outline target exists. The final pass reads one more flag of its settings and binds a blank texture.
- The mask pass draws each outlined object twice, from the outline view's culled lists. It writes one color target of the render size and reads the scene's depth. three.js draws the depth of every other object again, then the outlined objects.
- The final pass reads the mask once at each pixel. Outside the outlined objects it reads it 8 more times. So the line costs at most 9 filtered reads per pixel of the canvas, and no pass of its own. The soft outline drew 5 more passes. Over those and the final pass, it read 9.6 texels per pixel.
- Target memory per pixel of the render size: 4 bytes of mask, and 16 more with 4 MSAA samples, which resolve into it. The soft outline also took 7 bytes per pixel of the canvas in its half and quarter size targets. The scene's depth must also be stored for the mask pass.
- GPU time on phones and tablets is not measured yet. Prototype P4 measures the crisp line on the iPad and a cloud phone, and sets the default width.

### The depth bias of the visible parts

The mask's second draw marks the parts that nothing hides. It draws with the depth test and a bias toward the camera. So a surface passes against the depth that the scene drew for it. The first bias had 4 depth steps and a slope of 1. A surface turns edge-on at the top and bottom of a sphere's outline. There the slope term grew past the distance to the wall in front of it. So a few hidden pixels counted as visible. The crisp line then drew a short white mark on the wall, in about 20 pixels of `outline-plain`. The soft outline had drawn the same mark, blurred. The mask places each vertex with the same invariant position as the scene's passes. So the 4 steps alone let a surface pass against its own depth. The bias has no slope term now, and the marks are gone. No other pixel of the outline images changed.

## Decision

1. Outlined objects form a layout of their own, beside the scene's and the shadow casters'. It groups them by mesh, as the casters' layout does. A new view after the shadow atlas's tiles, the outline view, culls that layout with the camera's frustum and layers. WebGPU culls it in a culling pass of its own, and WebGL2 on the job workers. So outlined objects out of view cost nothing. The mask pass reuses every piece of the casters' path: bucket tables, culling, bundles on WebGPU and index lists on WebGL2. The call `setOutlined` sets a scene flag (`OUTLINED`), which rebuilds the draw tables, as `setCastShadows` does. Instance batches take no outline. The outline view skips the WebGL2 path's software occlusion ([D-41](D-41-software-occlusion.md)). So an outlined object behind a blocker still draws its mask, and the hidden line shows it through the blocker.
2. The mask pass draws into a mask of the scene's samples. Its depth target is the scene's depth, which it tests and never writes. Each outlined object draws twice with the mask template (`outline_mask.wgsl`). The first draw has no depth test and marks every part in red. The second has the depth test and a bias of 4 depth steps toward the camera. It marks the parts that nothing hides in green (the `OUTLINE_VISIBLE` build). The mask template places its vertices as the depth template does, with an invariant position.
3. The outline is a crisp line. The final pass reads the mask at the pixel, and at 8 places on a circle of the line's width around it. The 8 lie across, down and on both diagonals, and each read uses the mask's linear filter. Outside the outlined objects, the highest coverage that the reads find is the line's coverage. So the line ends as sharply as the objects' own edges, with no blur. The line takes the visible color where a read finds a part that nothing hides. It takes the hidden color where the reads find only hidden parts, and between the two it mixes them by their share. The pass paints the line over the canvas color after the output transform and before the color grading. So the line shows its colors exactly, also on the 8-bit path. The mask is binding 11 of the final pass's group, with a blank texture there while no outline draws. A flag of the pass's settings turns the line on. So turning outlines on builds no pipeline of the final pass.
4. One outline style covers every outlined object, as one `OutlinePass` has one. `post.set({ outline })` takes `color`, white by default, and `hiddenColor`, `false` by default for no line around hidden parts. It also takes `width` in CSS pixels, 2 by default. The engine multiplies the width by the device's pixel ratio.
5. The porting skill maps `OutlinePass` and pmndrs's `OutlineEffect` onto these settings. The colors map one to one: `visibleEdgeColor` to `color`, and `hiddenEdgeColor` to `hiddenColor`. With pmndrs, `xRay: false` becomes `hiddenColor: false`. The edge of `OutlinePass` is drawn at half size, so an `edgeThickness` of t becomes a `width` of about 2t. The line is opaque, so `edgeStrength` has no setting. Some ports set `edgeGlow` above 0, a `pulsePeriod`, or pmndrs's `blur` or `pulseSpeed`. They need the soft outline of `three-compat`, once it exists. Until then the skill draws the crisp line and lists the difference.

## Options rejected

- `OutlinePass`'s soft outline as the default. This record first built it. An edge step and a blur of the thickness's radius ran at half size, and the glow's blur at a quarter of the size. The final pass added them before the tone mapping. It matched three.js in 0.015% of the pixels on the Mac's GPU. It costs 5 passes and 2 more targets, and its edge grows blurrier on dense screens. A crisp line is the better default by D-52. Those steps stay for the `three-compat` add-on. They live in pull request #280's history at commit 798ec599, and on the branch `keep/three-compat-soft-outline`.
- The soft outline as a mode of the core, beside the crisp line. D-52 keeps three.js-look modes out of the core: a second path to test and document, and code that every page with outlines would load.
- Fewer reads for the line, such as 4 across and down only. The line along a diagonal edge then thins to about 0.7 of the width, so a circle's line thins at its diagonals.
- A line through jump flooding, which finds the distance to the nearest outlined pixel at any width. It needs passes of its own: a seed pass, and one pass for each doubling of the width. It is planned for outlines wider than about 4 pixels, where the 8 reads can step over parts thinner than the width.
- An object color per outline, as the first sketch of the API (`setOutlined(true, { color, width })`) had. The mask would have to carry an object number through a single-sample target. It is planned as a later step.
- A layer bit for outlined objects. Layers are the sketch's 32 bits, as three.js's are, so no bit is free.
- Drawing the outlined objects one by one, without a view. WebGL2 reads instances from data textures through index lists, so a draw per object needs the same lists that a view culls. The view path also skips outlined objects out of view.
- Reading the scene's depth as a texture in the mask's fragment shader. A multisampled depth cannot be sampled on WebGL2, and compatibility mode cannot read depth textures with `textureLoad`. The depth test against the scene's own depth target needs neither.
- Drawing the other objects' depth again, as three.js does for its hidden parts. That draws the whole scene a second time in every frame.
- A slope term in the visible draw's bias. It lifts edge-on parts in front of the objects that hide them, as "The depth bias of the visible parts" shows.

## Notes

- The scene's depth must outlive the scene's render pass while outlines draw. Where the device has transient attachments, the depth loses that usage then, and on a tile-based GPU it is written to memory.
- The 8-bit path draws the same line as the HDR path, as both hold display color where the final pass paints it.
- An outlined skinned object draws its mask in its pose of the frame. On WebGPU the mask pass reads the vertices that the skinning pass wrote, as the scene and shadow passes do ([D-20](D-20-webgpu-skinning.md)). With the switch that skins in the vertex shader, and always on WebGL2, the mask template's `SKIN` build skins them, as the depth template's does.
- The mask clears to zero, where every other render pass clears its color to the scene's background. A cleared mask must hold no coverage and no visible part.
- The outline's passes and targets are switched on only while outlines are on and some object is outlined. Then the final pass runs in the build of its declaration that reads the mask: one declaration for each pair of bloom and outline.
- A line wider than about 4 pixels of the canvas can leave a gap beside a part thinner than the width. The 8 reads step over such a part. Jump flooding is the later fix.

## Consequences

- Code: `crates/null3d-render/src/outline.rs`, and the outlined layouts of both builders (`gpu_driven/layout.rs`, `cpu_culled/layout.rs`). The outline view (`ViewId::OUTLINE`), and the frame graph's outline passes and final pass declarations. `wgsl/outline_mask.wgsl` and the line in `wgsl/final.wgsl`. The `OUTLINED` scene flag, the core call `setOutline`, `post.set`'s `outline`, and `setOutlined` on meshes and prefab copies.
- Tests: the render crate's `outline.rs` and the outline graph and allocation tests, the image tests `outline-plain`, `outline-hidden`, `outline-scale-50`, `outline-8-bit`, `skinning-outline` and `skinning-outline-vertex`, and the parity scenes `outline-plain` and `outline-hidden` with their limit.
- Docs: `api/post`, `api/objects`, `concepts/post-processing`, `guides/performance`, the mapping's `outline` entry, and both skills.
- [D-52](D-52-intent-parity.md) lists `OutlinePass`'s glow and pulse among the `three-compat` candidates.
- Device runs: the outline images and the line's GPU time on the iPad and a cloud phone (prototype P4).
