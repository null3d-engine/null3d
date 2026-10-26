# Code review

The code review covers all the code that ships in a game: the engine package and the controls package. Each finding is confirmed by reading the code path end to end, by a probe, or by a test. A finding ID names the reviewer's area and number, such as R4-07.

This page lists the findings that are still open, each with what the engine needs and why. The [technique review](technique-review.md) lists the open changes from the comparison with other engines.

## Queries test skinned characters in their bind pose (R4-07)

Scene queries test a skinned character's mesh in its bind pose, moved by its object's matrix. So a ray misses a limb that the animation moves out of its rest place, and it hits the space where the limb rests. three.js's `Raycaster` tests the posed vertices of a `SkinnedMesh`. The raycast API page states the difference, and GPU picking draws each character as it is posed ([D-30](decisions/D-30-scene-queries.md#skinned-characters)).

Queries need to test the capsules per bone of [D-27](decisions/D-27-bvh.md#skinned-characters). The capsule test exists (`crates/null3d-core/src/bvh/capsule.rs`), but no query uses it.

## The compute skinning pass copies values that never change (code issue 3)

On WebGPU the vertex shaders skin by default ([D-20](decisions/D-20-webgpu-skinning.md)). The compute pass skins the objects that the vertex shaders cannot skin, such as morphed meshes. It skips poses that did not change, and it writes 8-bit normals and tangents. It still copies each object's texture coordinates, and the color of a mesh that no target morphs, into the object's skinned region (`crates/null3d-render/src/gpu_driven/skin.rs`). Those values never change, so the copies cost memory for nothing. The skinned format needs to read them from the mesh instead.

## No upper limit on job workers (D-07)

The engine starts job workers only when its parallel loops take 0.2 ms or more per frame ([D-126](decisions/D-126-lazy-job-workers.md)). The most it starts is the logical cores less 2, and at least 1 (`packages/engine/src/page/switches.ts`). Only the core's limit of 255 caps that count. On a desktop with many cores, a heavy scene can start dozens of workers, and each holds its own memory. [D-07](decisions/D-07-job-workers.md) needs an upper limit. Its Mac sweep, which would show where more workers stop paying, is not measured.

## Mali with MSAA and uniforms in several bind groups (R6-02's device checks)

Godot found that MSAA crashed Mali-G52, G72 and G76 GPUs on its Vulkan mobile path. Its fix, [godot#114785](https://github.com/godotengine/godot/pull/114785), moved all uniforms to set 0. The engine binds its uniforms in several bind groups. A Mali phone with MSAA on must run the shadow and custom material image tests on WebGPU to rule the fault out ([implementation notes](implementation-notes.md#browser-faults)). The fault is a driver crash, so only a device run can show it.

## Closed findings

Every other finding of the review is fixed or settled. The table names the code, test or record that closes each one.

| Finding | Subject | Closed by |
| --- | --- | --- |
| R1-01 | sparse accessors with 2 or more values refused | `packages/engine/src/scene/gltf-parse.ts` |
| R1-02 | accessor type "constructor" | [D-59](decisions/D-59-file-limits.md) |
| R1-03 | no limit on a file's total allocation; strips | [D-59](decisions/D-59-file-limits.md) |
| R1-04 | quadratic parent-loop check | [D-59](decisions/D-59-file-limits.md) |
| R1-07 | `mesh.destroy()` and `prefab.destroy()` | [D-75](decisions/D-75-mesh-and-prefab-destroy.md) |
| R1-10 | KTX2 size check | `packages/engine/src/scene/ktx2-file.ts` |
| R2-01 | WebGL2 GPU reset mid-frame ends with E1404 | `tests/image/gpu-loss.spec.ts` |
| R2-02 | WebGL2 loss during the shader download never restored | `packages/engine/src/render/renderer.test.ts` |
| R2-04 | WebGPU validation and out-of-memory errors never seen | `packages/engine/src/render/loss.ts`, `packages/engine/src/render/loss.test.ts` |
| R3-01 | frame loop breaks after start | `tests/image/failures.spec.ts` |
| R3-02 | job worker breaks after start | `packages/engine/src/page/engine.ts` |
| R3-03 | a new engine on the same canvas after `destroy()` | [D-58](decisions/D-58-failure-handling.md) |
| R3-04 | un-awaited warm-up records while the main loop records | `packages/engine/src/sketch/runner.ts`, `packages/engine/src/sketch/runner.test.ts` |
| R3-05 | sketch leftovers reach the next engine | `packages/engine/src/scene/memory.ts` |
| R3-06 | preset check counts hidden-tab time | `packages/engine/src/sketch/preset-check.ts`, `packages/engine/src/sketch/preset-check.test.ts` |
| R4-01 | checks in every build | `packages/engine/src/scene/queries.ts`, `crates/null3d-core/src/bvh/top.rs` |
| R4-02 | long clip resample bound | `crates/null3d-core/src/animation/resample.rs`, `crates/null3d-core/tests/animation.rs` |
| R4-03 | stale query trees after a late move | `crates/null3d-core/tests/queries.rs` |
| R4-04 | additive play stops base clips | `crates/null3d-core/tests/animation.rs` |
| R4-05 | step tracks hold the wrong key at a clip's end | `crates/null3d-core/tests/animation.rs` |
| R4-06 | stored-tree reader accepts a damaged slot | `crates/null3d-core/src/bvh/format.rs`, `crates/null3d-core/tests/bvh.rs` |
| R5-01 | per-frame GPU command list | `crates/null3d-gpu/src/drawlist.rs`, `crates/null3d-render/tests/capacities.rs` |
| R5-02 | skinning past GPU limits | [D-57](decisions/D-57-capacities.md) |
| R5-03 | half-applied frame | `crates/null3d-render/src/frame.rs` |
| R5-04 | mesh allocation fails inside the core and stops it | `crates/null3d-render/src/meshes.rs`, `tests/image/limits.spec.ts` |
| R5-05 | texture arrays briefly double; [D-69](decisions/D-69-texture-budget.md) | `crates/null3d-render/src/textures.rs`, `crates/null3d-render/src/textures.rs` |
| R5-06 | lit holes for narrow cameras; M2-R1 | `crates/null3d-render/src/shadows.rs` |
| R5-07 | spot and point shadows stale after a layer change; M2-R9, [D-61](decisions/D-61-shadow-tile-redraws.md) | `crates/null3d-render/tests/shadow_tiles.rs` |
| R5-08 | stale on a still animated character | `.dev/implementation-notes.md` |
| R5-09 | one light's shadow toggle rebuilds the pass plan | `.dev/implementation-notes.md` |
| R6-01 | memory growth without refreshed views | `packages/engine/src/scene/scene.ts`, `packages/engine/src/scene/memory.ts` |
| R6-02 | Mali array lowering in custom-material GLSL | `.dev/implementation-notes.md`, `crates/null3d-shaders/tests/material.rs` |
| R6-03 | duplicate GLSL sources | `crates/null3d-shaders/src/typescript.rs` |
| R7-01 | (see its fix group) | `crates/null3d-shaders/wgsl/lib/color.wgsl`, `crates/null3d-shaders/wgsl/lib/tonemap.wgsl` |
| R7-02 | HALF roughness floor 0.089 | `crates/null3d-shaders/wgsl/lib/half.wgsl`, `crates/null3d-shaders/tests/build.rs` |
| R7-03 | joint texture within 2,048 texels | `crates/null3d-render/src/skinning.rs`, `skin.wgsl` |
| R8-01 | CSP-safe start | `packages/engine/src/shared/wasm.ts`, `packages/vite-plugin/src/index.ts` |
| R8-02 | (see its fix group) | `tools/lib/size-report.ts` |
| R8-03 | license notices, Draco and add-ons included | `packages/engine/THIRD-PARTY-NOTICES.txt`, `packages/vite-plugin/src/index.ts` |
| R8-04 | room.ktx2 leaves the package | `packages/engine/package.json`, `packages/engine/src/scene/builtin-environments.ts` |
| R8-05 | docs state the needed policy; clear error without `'wasm-unsafe-eval'` | `docs/getting-started/hosting.md`, `docs/errors/E1418.md` |
| R8-06 | workers from another origin; shared `blob:` bootstrap, [D-54](decisions/D-54-addon-modules.md) | `packages/engine/src/shared/worker-start.ts`, `worker-start.test.ts` |
| R8-07 | plain bundlers rule | Settled: `.dev/decisions/D-54-addon-modules.md`, `docs/getting-started/install.md` |
| R8-08 | (see its fix group) | `packages/engine/src/page/engine.ts`, `.dev/implementation-notes.md` |

The text of R2-03, R2-05, R2-06, R2-07, R3-07 is not in the repository, so no one checked them one by one. The records of their fix groups say that each group is built.
