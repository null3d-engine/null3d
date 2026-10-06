# D-71: Custom effects and the tone-curve hook

Status: decided. Date: 2026-10-05; the Mac's timings 2026-10-06, the iPad's pending. Task: M2-F5.

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

- The cloud Pixel 10 (PowerVR, Chrome 149) ran the `effects` plan on 5 October 2026. On WebGL2, 4 effects raised CPU time per frame from 0.52 to 3.33 ms at a render scale of 1. At 0.5 they raised it from 0.53 to 3.68 ms. WebGPU moved from 0.60 to 0.64 ms. On the Pixel 9 and the Pixel 11, bloom's 15 passes add 0.05 to 0.15 ms on WebGL2. So a pass alone does not cost this.
- The Mac does not show it. Chrome kept CPU time at 0.03 to 0.09 ms per frame with 4 effects, on ANGLE's Metal, OpenGL and SwiftShader back ends.
- The effect cost page now reports each thread's CPU time. With `?gltiming` it also reports each WebGL call's time per frame. On the Pixel 10, the thread that draws took all of the added time. It made 2 framebuffers in every frame. Their completeness checks took 3.0 to 3.3 ms per frame, about 1.5 ms each. That check waits for the browser's GPU process.
- The render graph shares a target between a pass that draws with depth and one that draws without it, as the scene color and an effect's target. The backend kept one framebuffer per color target. It made that framebuffer again whenever the depth target changed, so such a target made 2 framebuffers a frame.
- A color target now keeps its framebuffer without depth apart, beside the one with depth. Resolves already used that framebuffer. A unit test replays 3 frames of that pattern: it now makes 2 framebuffers in all, and made 6 before.
- A first guess was that each frame's write of the effects' blocks waited for the GPU, since each block holds the clock. The same run measured those writes at 0.04 ms per frame, so the blocks stay as they were.

| Pixel 10, WebGL2, CPU time per frame with `?gltiming` | Scale 1 | Scale 0.5 |
| --- | --- | --- |
| Before the fix (run `20261005-151823-effects`): no effects, 4 effects | 0.80, 3.90 ms | 0.69, 3.84 ms |
| After the fix (run `20261005-153215-effects`): no effects, 4 effects | 0.81, 0.83 ms | 0.82, 0.97 ms |

- `?gltiming` wraps every WebGL call, which adds about 0.15 to 0.3 ms per frame, so the table compares runs that both had it. After the fix, 4 effects add 0.02 and 0.15 ms of CPU time per frame. WebGPU's 4 effects add 0.04 ms. The framebuffer checks fell from 2 per frame to 0.01, which is the frames that add the effects.

### Timings on the Mac

The Mac ran both figures on 6 October 2026, in headless Chrome 154 on its GPU, at 1920 x 1080 and a render scale of 1. The load was 7.64 at the start and 3.69 at the end. Each page ran 3 rounds from the branch, and every page held 16.665 ms frames (60 Hz). WebGL2 has no GPU timer, so these are WebGPU figures.

1. One more full-screen pass costs about 0.05 ms of GPU time. The `effects` plan's page adds 4 effects that each read their own pixel, so a quarter of the difference is one pass.

| GPU path | No effects | 4 effects | One pass |
| --- | --- | --- | --- |
| WebGPU | 0.405 ms | 0.601 ms | 0.049 ms |
| Compatibility mode | 0.506 ms | 0.706 ms | 0.050 ms |

2. The move to HDR color in compatibility mode costs about 0.27 ms of GPU time. The page loads `?gpu=compat&effect=effects&count=0`, once with `antialias=msaa`, which stays on the 8-bit path with MSAA, and once with `antialias=fxaa`, which draws HDR color with FXAA. Both sides of each load draw the same, so the difference between the loads is the move's cost.

| Preset | 8-bit with MSAA | HDR with FXAA | The move |
| --- | --- | --- | --- |
| Default | 0.242 ms | 0.510 ms | 0.268 ms |
| Low | 0.229 ms | 0.508 ms | 0.279 ms |

Round 1's HDR pages were noisy, up to 1.55 ms. Rounds 2 and 3 agree within 0.03 ms. On the cloud Pixel 10's WebGPU (5 October 2026), 4 effects raised GPU time from 2.10 to 3.41 ms, about 0.33 ms a pass. The iPad's run of the `effects` plan is still pending: `bun tests/real-browsers.ts --plan effects --lan ipad-safari`.

## Decision

1. Effects run on HDR color after the scene passes, and before bloom and the final pass. Each effect reads the color that the pass before it left, multiplied by its coverage. It writes the same kind of color into a target of its own. Bloom and the final pass read the last effect's target. An effect that brightens a pixel therefore makes it glow, as a camera would show it.
2. Effects run in the sketch's `order`, at most 8 (`MAX_EFFECTS`). An effect that reads only its own pixel joins the pass of the effect before it, and the last pass folds into the final pass when nothing reads the image between them (Joining effects into fewer passes). The render graph shares memory between the passes' targets. A pass's target lives until the next pass has read it, so two `rgba16float` textures serve any number of effects.
3. An effect reads its own pixel (`input.color`), any other pixel (`effectPixel`, `effectColor`), and the scene's depth (`effectDepth`, `effectViewPosition`, `effectDistance`). A call to a depth function makes the build bind the depth. Effects that read no depth bind a blank texture, so the scene's render pass need not store its depth.
   - Core WebGPU with MSAA reads sample 0 of the multisampled depth, through a build with the `DEPTH_MULTISAMPLED` permutation bit (262144) and the layout `EFFECT_DEPTH_MS` (22).
   - Compatibility mode reads depth as unfilterable floats with `textureLoad`, through the layout `EFFECT` (21).
   - WebGL2 reads a copy of one sample of a multisampled depth, which the backend keeps as it does for ambient occlusion.
4. Uniforms: a `struct Uniforms` of up to 32 floats, packed as custom materials pack theirs ([D-32](D-32-typed-uniforms.md)), read as `uniforms.name`. TypeScript types `uniforms` and `setEffectUniform` from the struct. Effects take no textures yet: a texture input needs the `textures.fromPass` work of custom passes, and the same bind group for both GPU paths.
5. The tone-curve hook: WGSL that declares `fn toneCurve(color: vec3f) -> vec3f`, passed as `post.set({ toneMapping })`. The plugin builds it into every non-`HALF` variant of the final pass. The final pass calls it in place of the built-in curves and clamps its result to 0 to 1. A curve takes no uniforms.
6. A custom curve and effects need HDR color, as bloom does ([D-21](D-21-effect-chain.md), decision 2). On the 8-bit path that serves only MSAA, the first effect or custom curve moves the engine to HDR color with FXAA, for its life. Where the device has no HDR target in any mode, effects and the custom curve stay off. The built-in curve stays, and development builds warn once.
7. Errors reuse the custom material codes. E1215 is for WGSL that the plugin did not compile as an effect or a curve, and E1216 for a wrong uniform. A ninth effect throws E1213. An order that is not a number throws E1203, and a uniform set on a removed effect E1101.
8. The frame that adds an effect or changes the curve holds the screen until its pipelines are built (`Slot.PipelineHold`), as a preset change does. A pass whose pipeline still builds draws nothing. An effect's pass that drew nothing would leave its target blank, and the final pass would show it. Bloom and ambient occlusion instead join the frame once their pipelines are built. That suits a pass that adds to the image, but an effect replaces the image, and the curve replaces the final pass's own pipeline.

### Joining effects into fewer passes

The owner asked for this after the Pixel 10 figures (5 October 2026): on its WebGPU path, each extra effect pass cost about 0.33 ms of GPU time. Each pass reads and writes the whole image at 8 bytes per pixel each way. Joining effects removes that traffic. It does not change the work that the effects' own code does.

What joins:

- An effect joins the pass of the effect before it unless it reads its input image at other pixels, through `effectPixel` or `effectColor`. The build finds those calls as it finds the depth calls (`joins` in the compiled effect), so the sketch declares nothing. A call through a helper function counts too.
- An effect that reads depth joins. The scene's depth does not change between effects, so it reads the same at any pixel.
- A group starts with any effect, and the effects after it join while they read only their own pixel. So an effect that reads its neighbors starts a group, and the per-pixel effects after it join it.
- What never joins: a per-pixel effect before an effect that reads its neighbors. Joined, the per-pixel effect would run again for every neighbor that the next effect reads. Its cost would grow with the reads instead of shrinking. The image test `effects-fog-first-joined` puts the fog before the split and must draw the separate passes' image.
- The last group folds into the final pass when nothing reads the image between them: bloom off and FXAA off. Bloom reads the effects' image, and FXAA reads the pixels around each pixel. One per-pixel effect before the final pass is the common case, so folding saves that whole pass.
- Folding also needs a render scale of 1. Below it, the final pass blends four texels for each pixel, so the effects would run four times per pixel. The core stops folding once it sees the scale drop. A frame that still folds there runs the effects on each texel it blends, so its image stays right.
- Built-in passes do not join. Exposure, the tone curve, color grading and the vignette share the final pass already. Bloom, ambient occlusion, FXAA and the outline read neighbors.

How the shaders are made:

- The engine has no shader compiler at run time; shipping one would add about 866 KB after Brotli. So the build gives each effect a piece for each host and each build of it (`pieces.rs` in the shader crate). A piece holds the top-level items that the effect adds to the host's own build, as naga wrote them: its functions, structs and globals under a prefix of its own, its uniform loader, the library functions it calls, and the host's helpers that it calls.
- The hosts are engine shaders that load on first use, in the feature `effect_groups`: `effect_group.wgsl`, the group's template, and `final.wgsl`'s EFFECT_CHAIN build, the fold's. Each has a chain function, and the final pass a tone curve hook. A tone curve gets a fold piece too, so a fold holds the custom curve.
- A host binds every effect's block, an array of 8 blocks padded to 256 bytes each, the distance between blocks in the buffer. Each piece's run function takes its block's slot, the effect's place.
- At run time the thread that draws joins a host, the pieces in order with each shared item once, and a chain that calls each piece's run function (`effect-joiner.ts`). Only text moves. The joiner loads on first use, like the hosts, so pages without joined effects download neither. The sketch thread gives each group and fold a template, keyed by its effects' templates and places.
- naga makes names unique across a whole module, in order, so a function's argument names would depend on the functions before it. The text of a helper that two pieces share would then differ, and the joined shader would define it twice. The hosts' builds, and so the pieces', name each argument and local after its function (EFFECT_HOST). The GLSL uniform block of the blocks takes its name from a named struct, as a block named after a type's number would change with the types before it.

When a join draws:

- A group's or a fold's pipeline is asked for only once every effect in it draws alone. A frame that adds an effect during play waits for every pipeline that builds; a group that asked in that frame would hold it for the group's build too. Asked later, it builds in the background while its effects draw alone, and the core swaps it in once it is built (`PipelineCache::built`). No frame waits for it.
- Before the first frame, which waits for every pipeline, a group asks at once, so the first frame draws it. Hold mode and the image tests draw that frame.
- WebGL2 without `KHR_parallel_shader_compile` would wait for a joined program's compile at its first draw. So after the first frame such a device keeps the effects in separate passes.
- Uniform changes need no new shader. Adding, removing or reordering effects makes a new one.

Limits:

- A group's size has a cap, so no joined shader grows past what drivers are known to build: the WGSL that its pieces add, 22 KB for a group and 8 KB for a fold. The group's host is about 1.7 KB and the final pass about 15.3 KB, so a joined shader stays within 24 KB. A Pixel 11's PowerVR driver failed a 50 KB shader and built its 17 KB parts, and the final pass draws on every device the engine was tested on ([implementation notes](../implementation-notes.md#browser-faults)). A driver's failure can show as a lost context rather than an error, so the cap holds before any build. A larger group splits.
- If a joined shader still fails to build, the engine does not stop. The thread that draws writes its template to the control slot `JoinFailed`, and the sketch thread draws those effects one pass each from then on. Development builds warn.
- Between joined effects, color stays at 32-bit float precision instead of a 16-bit target's. The images can differ very slightly from separate passes. The effect image tests pass within the usual tolerance on all three tiers and both reference sets, with joining on and with `?join=off`.

Measurement:

- The `?join=off` switch keeps every effect in a pass of its own. The `effects` plan uses it, so its quarter of the difference stays one pass's cost.
- The `effects-joined` plan runs the effect cost page with 4 effects joined and with `join=off`, at render scales of 1 and 0.5 on each GPU path. At 1 they fold into the final pass; at 0.5 they draw as one group.
- GPU time comes from WebGPU's timestamps and, new here, from `EXT_disjoint_timer_query_webgl2` on WebGL2, which most desktop browsers offer and phones mostly do not. Without a timer, the plan's heavy pair on WebGL2 draws 8 effects at the display's whole pixel ratio, so the GPU limits the frame rate, and compares frame intervals.
- Each joined page reports how long each joined shader took to build (`joinBuilds`), which development builds keep. On WebGL2 the time ends at the frame that finds the compile done, so it counts up to a frame more.

### Why the curve does not reach the 8-bit scene shaders

On the 8-bit path, each scene shader maps its own color with the `TONE_MAP` permutation bit. A custom curve there would need a build of every scene shader with the sketch's curve, in each of its permutations. That set holds the standard material, the unlit and instanced templates, skinning, morphs and every custom material. The engine has no shader compiler at run time, so the plugin would have to ship that whole set again for each curve. One WebGL2 set with morphs already takes 21 to 24 KB after Brotli. Custom materials would also need to know the sketch's curve when the plugin builds them, and they are built one WGSL at a time. A curve change during play would build every scene pipeline again.

The move to HDR costs less. Compatibility mode with MSAA is the only 8-bit path with an HDR target, and it moves in two frames, once ([D-21](D-21-effect-chain.md), the 8-bit path). A WebGL2 device with no float target keeps the built-in curve. No device in the engine's tests lacks the targets.

## Options rejected

- Effects after the tone curve, on display color, as three.js's `ShaderPass` after `OutputPass` sees it. Bloom would not see what the effects add, the 8-bit color would band in dark effects, and the October review placed effects in HDR. A port of a three.js pass that assumes display color adjusts its numbers instead (porting docs).
- The shader compiler at run time, to join effects' WGSL and write GLSL there. It would add about 866 KB after Brotli, for a saving that text joining gives.
- One shader for all of a sketch's effects, with a loop over the effects that a uniform lists and a switch on each. It needs no build per order, but every pixel pays the loop and the switch, and the plugin builds each WGSL alone, so it cannot know a sketch's effects.
- Joining a per-pixel effect into the pass of a neighbor reader after it. The per-pixel effect would run once for every pixel that the reader samples.
- Only a fallback after a failed build, without a cap. Some drivers report a shader that is too large as a lost context, not as an error.
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
