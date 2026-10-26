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
