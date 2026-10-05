# D-71: Custom effects and the tone-curve hook

Status: decided. Date: 2026-10-05; the device timings are pending. Task: M2-F5.

## Question

How do a sketch's own full-screen effects and its own tone curve join the post-processing chain?

1. Where in the chain does an effect run, and on what color?
2. Does each effect get a pass of its own, or do effects that read only their own pixel merge into one pass?
3. What can an effect read: its neighbors, the scene's depth, textures, uniforms?
4. How does a custom tone curve reach the 8-bit path, where each scene shader maps its own color?
5. What limits hold: how many effects, and how many uniforms?

## Rule

- One WGSL source serves all three tiers, and the Vite plugin builds it at build time, as it builds custom materials. Build errors name the sketch's own lines.
- Effects see the color that a camera sees: linear HDR color, before bloom and the tone curve (analysis 3.3 and 5.4 of the October review). three.js's `three-compat` add-on needs a curve hook for three.js's curves.
- No per-frame allocation. Setting a uniform every frame allocates nothing, on either thread.
- No new GPU object when a uniform changes, and none when the number of effects stays the same.
- Each new bind group layout, template and permutation bit takes a number from the coordinator's claims.

## Data

### Builds and tests

- `crates/null3d-shaders/tests/effect.rs` builds effects and curves into the repository's templates. An effect builds for WebGPU and WebGL2. One that reads depth adds a WebGPU build that reads a multisampled depth. A curve builds into the 8 variants of the final pass that are not `HALF` builds. Its problems name the sketch's own line. A wrong signature says which one the engine calls. Effects and curves import from the shader library.
- `packages/vite-plugin/src/wgsl.test.ts` checks a bad effect in a tagged template literal. The error names line 5, column 26 of the script, where the unknown name stands.
- `crates/null3d-render/src/frame_graph.rs` checks that effects run in order between the scene passes and bloom. Their targets share two textures, whatever the chain's length. The 8-bit path runs no effects.
- The image tests `effects`, `effects-reversed`, `effects-later`, `effects-curve`, `effects-bloom-curve`, `effects-scale-50` and `effects-8-bit` draw on all three tiers. They use two effects: a color split that reads the pixels beside each pixel, and a fog by distance that reads the depth. They also draw Reinhard's curve as a custom tone curve. All 23 pass on the Mac's GPU and on SwiftShader (5 October 2026). Effects added in another order, with orders that restore the first, draw the same image. So do effects added during play. In compatibility mode with MSAA the first effect moves the engine to HDR color with FXAA, as bloom does. With HDR turned off, the page draws the scene without effects or the curve, within the 8-bit path's usual edge differences.

### Allocation

`bun run bench:allocation --effects` adds two effects to S1, one of which reads depth, and changes a color uniform of each every frame. On 5 October 2026 both GPU paths passed, with no place of the effects' code in the sample. The first runs found 126 to 141 bytes per frame in the uniform writer, which the writer's change fixed ([benchmarks](../benchmarks.md)). Each effect pass adds about 64 bytes per frame to the WebGPU replay: the browser's render pass encoder.

### CPU time on WebGL2

- The cloud Pixel 10 (PowerVR, Chrome) ran the `effects` plan on 5 October 2026. On WebGL2, 4 effects raised CPU time per frame from 0.52 to 3.33 ms at a render scale of 1. At 0.5 they raised it from 0.53 to 3.68 ms. WebGPU moved from 0.60 to 0.64 ms. Bloom's 15 passes add 0.05 to 0.15 ms on WebGL2 on the Pixel 9 and the Pixel 11, so a pass alone does not cost this.
- The Mac does not show it. Chrome on ANGLE's Metal, OpenGL and SwiftShader back ends kept CPU time at 0.03 to 0.09 ms per frame with 4 effects, with the default anti-aliasing.
- The effect cost page now reports each thread's CPU time, and with `?gltiming` each WebGL call's time per frame. On the Pixel 10, the thread that draws took all of the added time. It made 2 framebuffers in every frame, and their completeness checks took 3.0 to 3.3 ms per frame, about 1.5 ms each. That check waits for the browser's GPU process.
- The render graph shares a target between a pass that draws with depth and one that draws without it, as the scene color and an effect's target. The backend kept one framebuffer per color target and made it again whenever the depth target changed, so such a target made 2 framebuffers a frame. A color target now keeps its framebuffer without depth apart, the one that resolves already use, beside the one with depth. A unit test replays 3 frames of that pattern: it now makes 2 framebuffers in all, and made 6 before.
- A first guess was that each frame's write of the effects' blocks, which hold the clock, waited for the GPU. The same run measured those writes at 0.04 ms per frame, so the blocks stay as they were.

### Pending timings

These two figures were asked for on the Mac. The Mac was not quiet enough to time them before this record, so they run on devices, as the other effect costs do:

1. The cost of one more full-screen pass at 1920 x 1080: the `effects` plan (`.dev/devices.md`, the effect cost plans). It adds 4 effects that each read their own pixel, so a quarter of the difference is one pass. Run it on the Mac in Chrome when its load is below 8, and on the iPad and the phone.
2. The GPU cost of the move to HDR color in compatibility mode. Compatibility mode is a Chrome mode on desktops, so the Mac measures it. The effect cost page takes `antialias`: load `tests/pages/effect-cost.html?gpu=compat&effect=effects&count=0&antialias=msaa`, which stays on the 8-bit path with MSAA, and the same with `antialias=fxaa`, which draws HDR color with FXAA. With no effects both sides of each load draw the same, so the difference between the two loads is the move's cost. Add `&preset=low` for Low's figure.

## Decision

1. Effects run on HDR color after the scene passes, and before bloom and the final pass. Each effect reads the color that the pass before it left, multiplied by its coverage. It writes the same kind of color into a target of its own. Bloom and the final pass read the last effect's target. An effect that brightens a pixel therefore makes it glow, as a camera would show it.
2. One pass per effect, in the sketch's `order`, at most 8 (`MAX_EFFECTS`). The render graph shares memory between the effects' targets. An effect's target lives until the next effect has read it, so two `rgba16float` textures serve any number of effects. A merge of per-pixel effects into one pass waits for a later change of the run-time build (see Options rejected).
3. An effect reads its own pixel (`input.color`), any other pixel (`effectPixel`, `effectColor`), and the scene's depth (`effectDepth`, `effectViewPosition`, `effectDistance`). A call to a depth function makes the build bind the depth. Effects that read no depth bind a blank texture, so the scene's render pass need not store its depth.
   - Core WebGPU with MSAA reads sample 0 of the multisampled depth, through a build with the `DEPTH_MULTISAMPLED` permutation bit (262144) and the layout `EFFECT_DEPTH_MS` (22).
   - Compatibility mode reads depth as unfilterable floats with `textureLoad`, through the layout `EFFECT` (21).
   - WebGL2 reads a copy of one sample of a multisampled depth, which the backend keeps as it does for ambient occlusion.
4. Uniforms: a `struct Uniforms` of up to 32 floats, packed as custom materials pack theirs ([D-32](D-32-typed-uniforms.md)), read as `uniforms.name`. TypeScript types `uniforms` and `setEffectUniform` from the struct. Effects take no textures yet: a texture input needs the `textures.fromPass` work of custom passes, and the same bind group for both GPU paths.
5. The tone-curve hook: WGSL that declares `fn toneCurve(color: vec3f) -> vec3f`, passed as `post.set({ toneMapping })`. The plugin builds it into every non-`HALF` variant of the final pass. The final pass calls it in place of the built-in curves and clamps its result to 0 to 1. A curve takes no uniforms.
6. A custom curve and effects need HDR color, as bloom does ([D-21](D-21-effect-chain.md), decision 2). On the 8-bit path that serves only MSAA, the first effect or custom curve moves the engine to HDR color with FXAA, for its life. Where the device has no HDR target in any mode, effects and the custom curve stay off. The built-in curve stays, and development builds warn once.
7. Errors reuse the custom material codes. E1215 is for WGSL that the plugin did not compile as an effect or a curve, and E1216 for a wrong uniform. A ninth effect throws E1213. An order that is not a number throws E1203, and a uniform set on a removed effect E1101.
8. The frame that adds an effect or changes the curve holds the screen until its pipelines are built (`Slot.PipelineHold`), as a preset change does. A pass whose pipeline still builds draws nothing. An effect's pass that drew nothing would leave its target blank, and the final pass would show it. Bloom and ambient occlusion instead join the frame once their pipelines are built. That suits a pass that adds to the image, but an effect replaces the image, and the curve replaces the final pass's own pipeline.

### Why the curve does not reach the 8-bit scene shaders

On the 8-bit path, each scene shader maps its own color with the `TONE_MAP` permutation bit. A custom curve there would need a build of every scene shader with the sketch's curve, in each of its permutations. That set holds the standard material, the unlit and instanced templates, skinning, morphs and every custom material. The engine has no shader compiler at run time, so the plugin would have to ship that whole set again for each curve. One WebGL2 set with morphs already takes 21 to 24 KB after Brotli. Custom materials would also need to know the sketch's curve when the plugin builds them, and they are built one WGSL at a time. A curve change during play would build every scene pipeline again.

The move to HDR costs less. Compatibility mode with MSAA is the only 8-bit path with an HDR target, and it moves in two frames, once ([D-21](D-21-effect-chain.md), the 8-bit path). A WebGL2 device with no float target keeps the built-in curve. No device in the engine's tests lacks the targets.

## Options rejected

- Effects after the tone curve, on display color, as three.js's `ShaderPass` after `OutputPass` sees it. Bloom would not see what the effects add, the 8-bit color would band in dark effects, and the October review placed effects in HDR. A port of a three.js pass that assumes display color adjusts its numbers instead (porting docs).
- Merging per-pixel effects into the final pass now. Each set of effects would need a final pass built with their functions together. The plugin builds each WGSL alone, at build time, so the build cannot know which effects a sketch runs at once. A run-time merge needs the engine to join WGSL at run time on both paths. That is a larger change, and the per-pass cost decides whether it pays (pending timings).
- An effect `stage` option (`'hdr'` or `'final'`), as the early docs drew it. One stage keeps one model: every effect sees HDR color, and the tone curve hook covers what a `'final'` effect would map.
- A `name` option. The returned `Effect` is the handle, so a name added nothing.
- A curve with uniforms. Its build joins the final pass, whose uniform block is fixed. Curves that three.js offers need no uniforms beyond the exposure, which the engine applies earlier.
- A ping-pong pair of targets owned by the effects module. The render graph's memory sharing gives the same two textures and keeps the declaration in one place.

## Consequences

- New: `post.addEffect`, `post.setEffectUniform`, `post.removeEffect`, the `Effect` class, `EffectOptions`, and `ToneCurve` in `post.set({ toneMapping })`.
- The shader manifest marks `effect.wgsl` with `custom_effects` and `final.wgsl` with `custom_tone_curves`. The Vite plugin returns compiled WGSL of the kinds `'effect'` and `'toneCurve'`.
- New claims: this record, the layouts `EFFECT` (21) and `EFFECT_DEPTH_MS` (22), and the permutation bit `DEPTH_MULTISAMPLED` (262144).
- The effect cost page gains `effect=effects`, and the device runner gains the `effects` plan.
- Docs: `api/post`, `concepts/post-processing`, `guides/custom-passes`, `porting/threejs-postprocessing` and the mapping entries `ShaderPass` and `FilmPass / GlitchPass / ...`. Skills: both skills' `shaders.md`, the port skill's `post-processing.md`, and the develop skill's recipes and quick reference.
