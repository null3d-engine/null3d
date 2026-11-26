# D-403: The first frame builds only the engine pipelines that it draws with

Status: decided and built. The light clustering's and the depth reduction's compute pipelines come with the first frame only where it runs them, and so does the final pass's second step. Otherwise they build behind it. GPU culling and occlusion culling keep their pipelines in the first frame. Pending: a first visit on a phone, measured with the device runner. No phone was attached for this run.

Summary: A first frame on WebGPU built the 8 compute pipelines of the light clustering and its depth reduction in every scene. Both paths built the upscale's pipeline wherever the render scale could drop. A small lit page at Low now builds 4 pipelines in its first frame on WebGPU instead of 13, and 4 instead of 5 on WebGL2. On a software GPU its first-frame warm-up fell from 2.17 to 2.09 s; on the Mac's GPU the start did not move. The rest build in the background once the first frame shows, and no picture changes.

## Question

Which of the engine's own pipelines must the first frame wait for? Can the others build after it without a hitch or a changed picture?

## Rule

- The first frame's picture, and every held picture, stays the same on both GPU paths.
- A pipeline that the first frame runs stays in its list. Only one that the frame records no use of may leave it.
- A pipeline that leaves the first frame still builds before most pages need it. It starts in the frame after the first, in the background, so no later frame waits for it.

## Data

The engine's stored list of a first frame (`gpu/early-builds.ts`) names each pipeline that it built. A port of a small lit page decoded it: a sun with shadows, a sky and one material. Its first frame on WebGPU at Low built 14 pipelines, against 6 on WebGL2:

| Pipelines of that first frame | WebGPU, Low | WebGPU, High | WebGL2, Low |
| --- | --- | --- | --- |
| GPU culling (`CULL`) | 1 | 1 | 0 |
| Light clustering (`LIGHT_FIT`, `LIGHT_COUNT`, `LIGHT_PLACE`, `LIGHT_WRITE`) | 4 | 4 | 0 |
| Depth reduction (`LIGHT_DEPTH_CLEAR`, `LIGHT_DEPTH`, and each `_MS` twin) | 4 | 4 | 0 |
| Occlusion culling (`DEPTH_PYRAMID`, `OCCLUSION_EARLY`, `OCCLUSION_LATE`) | 0 | 3 | 0 |
| The final pass's second step (`FINAL` with `UPSCALE`) | 1 | 1 | 1 |
| The scene's own: its material, shadows, prepass, sky and final pass | 4 | 7 | 5 |

The page has no point, spot or area light, and Low leaves the depth fit off and draws one sample. So none of the 8 light pipelines dispatched in that frame. The light pass records a dispatch only for a view whose grid lists a light (`gpu_driven/lights.rs`), and the reduction only while the fit is on. The second step draws only below the whole render scale or while the sketch sharpens ([D-236](D-236-final-pass-upscale-build.md)). The page drew its first frame at the whole scale.

GPU culling writes the counts of every indirect draw, so each first frame on the indirect path runs it. Occlusion culling runs on WebGPU at High and Ultra on desktops only. Its first frame already tests its objects against the pyramid that it draws ([D-40](D-40-gpu-occlusion.md)). Leaving it out of the first frame would change the frame's plan, and no phone runs it.

The start bench ran on the MacBook Pro (`bun run bench:startup`): five cold loads of each kind, in Chrome for Testing 156, of the engine test page's production build. `?sketch=lit` draws the small lit page above, without a sky, at the preset's own range of render scales. The empty sketch has no scene and keeps the whole scale. Main is 47488a89a, built in a worktree of its own; the branch is the same commit with this change. Each pair ran one after the other.

| Sketch, GPU path, preset | First-frame pipelines, main | Branch | Setup to first frame done at full speed, main | Branch | The same on Slow 4G, main | Branch |
| --- | --- | --- | --- | --- | --- | --- |
| Lit, WebGPU, Low | 13 | 4 | 47 ms | 43 ms | 58 ms | 42 ms |
| Lit, WebGPU, High | 24 | 15 | 51 ms | 47 ms | 1,277 ms | 1,265 ms |
| Lit, WebGL2, Low | 5 | 4 | 56 ms | 54 ms | 58 ms | 56 ms |
| Lit, WebGL2, High | 11 | 10 | 56 ms | 57 ms | 1,467 ms | 1,482 ms |
| Empty, WebGPU, Low | 10 | 2 | 31 ms | 30 ms | 28 ms | 26 ms |
| Empty, WebGPU, High | 10 | 2 | 28 ms | 25 ms | 33 ms | 29 ms |
| Empty, WebGL2, Low and High | 1 | 1 | 36 and 41 ms | 38 and 38 ms | 40 and 26 ms | 43 and 34 ms |

The setup's end is the bench's Ready column, and each figure is the difference of two medians. The Mac's GPU builds the light pipelines in a few milliseconds and in parallel. So its start moves by at most 16 ms, within the spread of the loads. The loads on Slow 4G at High wait about a second for files that the first frame's other pipelines need.

A software GPU compiles slowly, as a weak phone's driver does. The same builds drew the lit sketch on WebGPU in headless Chromium 153 on SwiftShader. The first frame's warm-up (`load.warmUpMs`) took a median of 2,167 ms on main over 3 loads (2,165 to 2,295). It took 2,085 ms on the branch over 7 loads (2,013 to 2,200). At High one load of each drew: 3,346 ms on main and 2,977 ms on the branch. Most loads of both builds lost their GPU before the first frame (E1302) in this setup, so these figures are few.

How the data was produced: `bun run bench:startup --runs 5 --gpu <path> --network slow-4g,full --switches "sketch=<sketch>&preset=<preset>"` in each checkout, in turns. The load average was 2.3 to 6.4, with other work on the Mac. The Pipelines column is `engine.measure().load.firstFramePipelines`. For the SwiftShader loads, a script served each checkout's start pages with `vite preview` and read the page's result in headless Chromium. The script is kept with the maintainers' notes.

## Look

The options draw the same pictures: each changes when a pipeline builds, not what a frame draws.

## Decision

- The light clustering's four pipelines come with the first frame when the scene holds a point, spot, rectangle or tube light (`LightTable::has_local_lights`). The depth reduction's four come with them when the GPU fits the slices (`lightFit`). Otherwise both sets come in the first frame after the thread that draws reported a built frame (`pipelines_built` above zero).
- The final pass's second step asks for its pipeline in the first frame only when that frame draws below the whole render scale or sharpens. Otherwise it asks in the first frame after the device drew.
- Each such pipeline sits at the front of its frame's list, so the thread that draws builds it in the background. That frame does not wait, because the first frame has drawn.
- A light that comes before the clustering's pipelines are built lights nothing for those frames. The thread that draws skips a dispatch whose pipeline still builds. A render scale that drops before the second step is built draws at the whole scale for those frames. Both last one build's time after the first frame.

Rejected:

- **Build them at the first frame that needs them.** A light added during play would then wait a build, and a lowered render scale would draw at the whole scale meanwhile. Building behind the first frame costs the same builds and has them ready.
- **A first frame with only the multisampled or only the single-sample reduction.** The frame learns the scene depth's sample count only when its graph compiles, after the list's pipelines. It would save 2 builds only where the fit runs, at Medium and up, beside the scene's own builds.
- **Occlusion culling and GPU culling out of the first frame.** Above.

## Consequences

- `gpu_driven/mod.rs` creates the light pipelines through `LightClusters::create_pipelines` and `LightDepths::create_pipelines`. `FrameGraph::set_scaling` takes the render scale that the frame asks for. `tests/lights.rs` and the frame graph's unit tests check both rules.
- `bench:startup` reports the first frame's pipelines in a column of its own, and the engine test page's `?sketch=lit` draws the small lit page.
- `docs/guides/start-time.md`, `docs/guides/loading-screens.md`, `docs/guides/performance.md` and the develop skill's performance reference say which engine pipelines wait for a first frame. `.dev/implementation-notes.md` ("Pipelines and warm-up") gives the rule.

## Checks

- `cargo fmt --all --check` and `cargo clippy --workspace --all-targets -- -D warnings` pass.
- `cargo test -p null3d-core -p null3d-render` passes 1,631 tests.
- `bun test ./bench/lib/startup.test.ts ./tests/lib/runs.test.ts` passes 105 tests.
- `bun run build` passes. `bun run build:check-size` finds no measured file past its limit, and the largest start is pipelined, WebGL2 at 223,054 of 262,144 bytes after Brotli.
- `bun run bench:gpu-check` passes on the Mac's GPU. The GPU time per frame is the same at Medium and High for both scenes; the branch's trailer commit holds the full line.
- CI runs the browser and picture tests on both GPU paths, so every first frame and held picture is compared with its reference.
- A first visit on a phone is still to be measured with the device runner. No phone was attached for this work.
