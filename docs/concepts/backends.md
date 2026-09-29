---
id: concepts/backends
title: GPU tiers and backends
status: planned
since: "0.1"
summary: "WebGPU core, compatibility mode and WebGL2; capability flags; the portable budget; never branching on GPU names."
---

# GPU tiers and backends

> Planned for null3d 0.1. No release has these APIs yet, so coding agents must not use them.

```mermaid
flowchart TD
    start["Page loads: the engine runs feature tests"] --> adapter{"Does the browser give<br/>a WebGPU adapter?"}
    adapter -- "yes, with core features" --> core["WebGPU core"]
    adapter -- "yes, compatibility mode only" --> compat["WebGPU compatibility mode"]
    adapter -- "no" --> gl["WebGL2"]
```

null3d draws with WebGPU where the browser offers it, and with WebGL2 everywhere else. The same sketch code runs on both, with no backend checks in it. The engine picks the tier once, at startup, from feature tests.

## The three tiers

| Tier | Where it runs | What it gives | Main limits |
| --- | --- | --- | --- |
| WebGPU core | Chrome and Edge 113+ on Windows, macOS and ChromeOS; Chrome 121+ on Android 12+ with ARM, Qualcomm or Intel GPUs; Safari 26 on macOS, iOS and iPadOS; Firefox 141+ on Windows and 147+ on Apple silicon Macs | Compute shaders, indirect draws, render bundles, storage buffers | Optional features differ from device to device |
| WebGPU compatibility mode | Chrome 146+ on devices that have only OpenGL ES 3.1 or Direct3D 11 | Compute shaders and indirect draws on older GPUs | About 45% of these devices allow no storage buffers in vertex shaders; 16-bit float targets cannot use MSAA; uniform bindings stop at 16 KB |
| WebGL2 | Every other supported browser: iPhones before iOS 26, Android phones without WebGPU (including phones with Samsung Xclipse GPUs), Firefox on Android and Linux | Instancing, uniform buffers, MSAA | No compute shaders, no indirect draws, no storage buffers |

These facts were checked in September 2026. Browser support changes often, so this table can go out of date. At run time, the engine's feature tests decide.

## How each path draws

On WebGPU, the GPU culls the scene itself. The engine records each group of objects that share a pipeline, a mesh and a material once, in a render bundle. The GPU then fills in the draw counts every frame. The CPU's cost per frame grows with the number of those groups, and stays almost flat as the object count grows.

On WebGL2 there are no compute shaders, so the job workers cull in parallel on the CPU and group the visible objects the same way. Each object's matrix sits in a data texture on the GPU. Static objects upload theirs only when they change. Moving instance batches write theirs each frame into the next of three textures. A frame then never writes a texture that the GPU may still read. Each frame lists the visible objects, 4 bytes each, and uploads the list only when it changed. A static instance batch that has stopped changing is culled in groups of 64 nearby rows, with one test and one list entry per group. A group partly in view draws all its rows, and the GPU clips the ones outside. Where the browser has the `WEBGL_multi_draw` extension, one call draws every group with the same shading and the same mesh buffer. Firefox lacks the extension, so there each group takes one call.

Every feature works on both paths, or its page describes its WebGL2 fallback.

## Capability flags

The engine reads what the device can do at startup and exposes it as `engine.capabilities`:

```ts
engine.capabilities;
// { tier: 'webgpu' | 'webgpu-compat' | 'webgl2', threaded, features, limits }
```

The features it tests include:

- compute shaders and indirect draws
- storage buffers in vertex shaders
- multi-draw
- each texture compression family: BC, ETC2 and ASTC
- filtering of 32-bit float textures
- GPU timer queries
- MSAA on 16-bit float targets

Sketch code that uses an optional feature checks this object first.

## The portable budget

The WebGPU path stays inside WebGPU's default limits, and inside compatibility mode's limits where those are lower. Anything beyond them needs a capability flag and a fallback. Some of the numbers the engine plans around:

| Limit | Budget |
| --- | --- |
| Bind groups | 4 (the engine uses 3) |
| Compute threads per workgroup | 128 |
| Uniform binding size | 16 KB |
| Color attachments | 4 |
| Texture size | 4096 pixels (8192 only after a check) |
| Texture array layers | 256 |
| Buffer size | 256 MB |
| Storage binding size | 128 MB |
| Objects and instance rows in one scene | 2,097,152, since each takes 64 bytes of a storage binding |

The storage binding is the one limit the engine raises past this budget. When a device offers larger storage bindings and buffers, the engine asks for them. A scene there can hold more objects and instance rows, up to the 8,388,480 that one culling pass covers. `engine.capabilities.maxInstances` gives the number for the device. A call that would take a scene past it fails with E1501.

Development builds warn once when a scene passes 2,097,152, because a device with the default limits refuses that scene.

On WebGL2 the limit follows the largest texture the device allows. Each object's matrix takes 3 texels of a data texture, 512 matrices to a texel row. That is 2,097,152 objects and instance rows at 4,096 pixels, and 8,388,608 at 16,384. WebGL2 promises at least 2,048 pixels, which holds 1,048,576. `engine.capabilities.maxInstances` gives the number on WebGL2 too.

Engine memory holds the rows too. A page with worker threads gives the engine at most 1 GiB, which holds about 5 million instance rows. A call that needs more memory than the engine can get fails with E1109.

A 2018 iPad Pro on iPadOS 26 reports almost exactly WebGPU's default limits, which makes it a good test that the budget holds.

## Never branch on GPU names

Some browsers hide the GPU's name. Firefox on macOS reports every adapter detail as empty, and Brave can hide them by design. A name also does not tell you which features the engine turned on. Read `engine.capabilities` instead, on the page or in your sketch.

## Devices with two GPUs

Some laptops have a separate graphics chip next to the one built into the processor. The browser picks one of them, often the one that saves battery. `createEngine({ powerPreference: 'high-performance' })` asks for the faster one, and `'low-power'` for the one that saves battery. The engine's capability check and its renderer ask for the same GPU, so the reported features and limits match the GPU that draws. A device with one GPU ignores the option.

## Choosing a tier for testing

`createEngine({ gpu: 'webgl2' })` forces a tier, and so do the URL switches `?gpu=webgpu`, `?gpu=compat` and `?gpu=webgl2`. A device can then test every path it supports. Use them for testing only; in production, let the engine choose.

On WebGL2, uploads read straight from the engine's shared memory. A browser that refuses to read shared memory gets a copy of each upload instead. The switch `?uploads=copy` makes the engine copy everywhere, so one device can test both routes.

## When the GPU goes away

A WebGPU device can be lost, for example after a driver reset, and so can a WebGL2 context. The thread that draws then makes a new device, or waits for the context to come back. It draws the whole scene again from data the engine kept. The sketch worker keeps running, so your sketch's state survives. If the GPU is lost more than twice within one minute, or no new device starts, the engine stops drawing and reports E1302.

## Minimum browsers

| Browser | Minimum version |
| --- | --- |
| Safari on macOS and iOS | 16.4 |
| Chrome and Edge | 91 |
| Firefox | 89 |

WebAssembly SIMD sets these minimums. An older browser gets a clear "browser not supported" message instead of a slow path.

## Related pages

- [Architecture: threads and the frame](architecture.md): the render worker that owns the GPU.
- [Hosting and cross-origin isolation](../getting-started/hosting.md): the headers that turn on worker threads.
