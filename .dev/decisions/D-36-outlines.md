# D-36: Outlines

Status: decided, 2026-10-04. Date: 2026-10-04. Task: M2-F4.

## Question

1. How does the engine find the outlined objects and draw their mask, on both GPU paths?
2. How does the mask know which parts other objects hide, as three.js's `OutlinePass` does?
3. Which of `OutlinePass`'s steps does the engine keep, and what does the sketch set: one style for every outlined object, or one per object?

## Rule

- Outlines draw on every tier ([D-21](D-21-effect-chain.md)'s rule for effects).
- A port that copies `OutlinePass`'s colors, strength, thickness and glow keeps its look. On the Mac's GPU, the parity test passes three.js's rule, under 0.1% of the pixels. The outline scenes have a limit of 0.15%, because SwiftShader's WebGPU draws two of the scene's own edges a row apart from WebGL.
- Outlines cost nothing while nothing is outlined. Steady frames with outlines allocate nothing, and a new render scale makes no GPU object.
- No draw samples a texture that it draws into (the Adreno rule of the [implementation notes](../implementation-notes.md)).

## Data

### Parity with three.js

Pixels that differ from three.js by its rule, 4 October 2026:

| Scene | GPU | Core WebGPU | Compatibility mode | WebGL2 |
| --- | --- | --- | --- | --- |
| `outline-plain`: three.js's defaults | Chrome on the Mac's GPU | 0.015% | 0.015% | 0.000% |
| `outline-plain` | SwiftShader | 0.105% | 0.105% | 0.000% |
| `outline-glow`: a wide orange edge, a blue hidden edge and glow | Chrome on the Mac's GPU | 0.015% | 0.015% | 0.000% |
| `outline-glow` | SwiftShader | 0.104% | 0.104% | 0.000% |

The parity test (`bun run parity -- --scene outline-plain,outline-glow`, and with `CI=1` for SwiftShader) compares null3D's images with the twin `bench/pages/threejs/outline.html`. The twin draws the same scene (`bench/scenes/outline.ts`) with an `EffectComposer`: a `RenderPass`, an `OutlinePass` with the same settings, and an `OutputPass` with ACES. Both sides draw without anti-aliasing, as the composer's targets have no MSAA.

On SwiftShader's WebGPU, most of the pixels that differ lie on the ground's far edge and on the top edge of the box without an outline. So the outline scenes pass under a limit of 0.15%.

The outlined box floats 10 cm above the ground. When it rested on the ground, the scenes differed in 0.081% to 0.095% (`outline-plain`) and 0.305% to 0.320% (`outline-glow`) on the Mac. three.js drew its hidden color along the box's lowest rows, which nothing hides. `OutlinePass` packs the depth of the other objects into the four channels of a half float target, and the unpacked depth is too coarse near a contact line. null3D tests against the scene's own depth, so the box's lowest rows count as visible.

A fault put back on purpose shows what the test catches. The render graph cleared the mask to the scene's background color, so the mask's green channel held a little of the background. The edge step then found a visible part next to every edge, and drew the hidden parts in the visible color. The scenes differed in 0.24% to 0.26% (`outline-plain`) and 0.82% to 0.84% (`outline-glow`) on the Mac, so the fault fails the limit on every tier.

### Cost

- While nothing is outlined, or outlines are off, no outline pass runs and no outline target exists. The final pass reads one more flag of its settings and binds blank textures.
- The mask pass draws each outlined object twice, from the outline view's culled lists. It writes one color target of the render size and reads the scene's depth. three.js draws the depth of every other object again, then the outlined objects.
- Texture reads per pixel of the canvas, over the steps: 1 in the edge step, 4.5 in the thickness's blur, 1.1 in the glow's, and 3 in the final pass. That is 9.6. three.js reads 9.9, because it first copies the mask to half size.
- Target memory per pixel of the canvas, at most: 4 bytes of mask (16 more with 4 MSAA samples, which resolve into it), 6 bytes for the edge step and the thickness's blur at half size, and 1 byte for the glow's blur at a quarter size, in `rgba16float`. The scene's depth must also be stored for the mask pass.
- GPU time on phones and tablets is not measured yet.

## Decision

1. Outlined objects form a layout of their own, beside the scene's and the shadow casters', grouped by mesh as the casters are. A new view after the shadow atlas's tiles, the outline view, culls that layout with the camera's frustum and layers: on WebGPU in a culling pass of its own, and on WebGL2 on the job workers. So outlined objects out of view cost nothing, and the mask pass reuses every piece of the casters' path: bucket tables, culling, bundles on WebGPU and index lists on WebGL2. `setOutlined` sets a scene flag (`OUTLINED`), which rebuilds the draw tables, as `setCastShadows` does. Instance batches take no outline.
2. The mask pass draws into a mask of the scene's samples with the scene's depth as its depth target, which it tests and never writes. Each outlined object draws twice with the mask template (`outline_mask.wgsl`): once with no depth test, which marks every part in red, then with the depth test and a small bias toward the camera, which marks the parts that nothing hides in green (the `OUTLINE_VISIBLE` build). The bias, 4 steps and a slope of 1, lets a surface pass against the depth that the scene drew for it. The mask template places its vertices as the depth template does, with an invariant position.
3. The steps after the mask are `OutlinePass`'s: an edge step at half size, a separable blur of the thickness's radius at half size, and a blur of radius 4 at a quarter of the size for the glow. The blurs use the same Gaussian, with 4 taps on each side and sigma half the radius. They draw with bloom's step shader, which now filters alpha too. The edge step reads the mask itself, at the places of the texel centers of three.js's half-size copy, so the copy needs no pass. The final pass adds the overlay before the tone mapping, `(strength × (1 − mask))² × edges × alpha`, which is what three.js's additive blend with source alpha adds. Its mask and edge levels are bindings 11 to 13 of its group, a blank texture while no outline draws, and a flag of its settings turns the overlay on, so turning outlines on builds no final pass pipeline.
4. One outline style covers every outlined object, as one `OutlinePass` has one. `post.set({ outline })` takes `color`, `hiddenColor`, `strength`, `thickness` and `glow`, with `OutlinePass`'s meanings and defaults. `hiddenColor: false` draws no edge around hidden parts.

## Options rejected

- An object color per outline, as the first sketch of the API (`setOutlined(true, { color, width })`) had. The mask would have to carry a color through the resolve of its samples and the blurs, where colors of neighbors mix. three.js draws a second `OutlinePass` for a second style. A sketch that needs two styles can ask for it later.
- A layer bit for outlined objects. Layers are the sketch's 32 bits, as three.js's are, so no bit is free.
- Drawing the outlined objects one by one, without a view. WebGL2 reads instances from data textures through index lists, so a draw per object needs the same lists that a view culls. The view path also skips outlined objects out of view.
- Reading the scene's depth as a texture in the mask's fragment shader. A multisampled depth cannot be sampled on WebGL2, and compatibility mode cannot read depth textures with `textureLoad`. The depth test against the scene's own depth target needs neither.
- Drawing the other objects' depth again, as three.js does for its hidden parts. That draws the whole scene a second time in every frame.
- The final pass's overlay as a build of its shader. It doubles the final pass's builds, and turning outlines on would wait for a pipeline. A flag and blank textures cost three texture bindings.
- A pass of its own for the overlay, as three.js draws. It reads and writes the whole screen once more.

## Notes

- The scene's depth must outlive the scene's render pass while outlines draw. Where the device has transient attachments, the depth loses that usage then, and on a tile-based GPU it is written to memory.
- On the 8-bit path the scene color holds display color. The final pass maps the overlay alone through the tone mapping and adds it after, which matches the HDR path over dark pixels and gives weaker edges over bright ones.
- An outlined skinned object draws its mask in its pose of the frame. On WebGPU the mask pass reads the vertices that the skinning pass wrote, as the scene and shadow passes do ([D-20](D-20-webgpu-skinning.md)). With the switch that skins in the vertex shader, and always on WebGL2, the mask template's `SKIN` build skins them, as the depth template's does.
- The mask clears to zero, where every other render pass clears its color to the scene's background. A cleared mask must hold no coverage and no visible part.
- The outline's passes and targets are switched on only while outlines are on and some object is outlined. Then the final pass runs in the build of its declaration that reads the outline's textures: one declaration for each pair of bloom and outline.

## Consequences

- Code: `crates/null3d-render/src/outline.rs`, the outlined layouts of both builders (`gpu_driven/layout.rs`, `cpu_culled/layout.rs`), the outline view (`ViewId::OUTLINE`), the frame graph's outline passes and final pass declarations, `wgsl/outline_mask.wgsl`, `wgsl/outline_edge.wgsl`, the final pass's overlay, the `OUTLINED` scene flag, the core call `setOutline`, `post.set`'s `outline`, and `setOutlined` on meshes and prefab copies.
- Tests: the render crate's `outline.rs` and the outline graph and allocation tests, the image tests `outline-plain`, `outline-glow`, `outline-scale-50` and `outline-8-bit`, and the parity scenes `outline-plain` and `outline-glow` with their limit (`OUTLINE_MAX_DIFFERENT_PERCENT` in `bench/lib/parity.ts`).
- Docs: `api/post`, `api/objects`, `concepts/post-processing`, `guides/performance`, the mapping's `outline` entry, and both skills.
