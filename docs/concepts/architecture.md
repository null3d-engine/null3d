---
id: concepts/architecture
title: "Architecture: threads and the frame"
status: experimental
since: "0.1"
summary: "Main thread, sketch worker, render worker, job workers; where the sketch runs; the pipelined frame and its passes; grid cells; latency modes."
---

# Architecture: threads and the frame

> Ships in null3D 0.1, with the passes and helper workers of models, effects and scene passes from 0.2. The API is experimental, so it can still change between versions.

```mermaid
flowchart LR
    subgraph main["Main thread"]
        shim["Page shim<br/>canvas, input, resize"]
    end
    subgraph sketch["Sketch worker"]
        code["Your sketch code<br/>(TypeScript)"]
        core["Engine core<br/>(Rust, WebAssembly)"]
    end
    subgraph jobs["Job workers"]
        work["Transforms, animation, instance batches,<br/>sorting, culling on WebGL2"]
    end
    subgraph render["Render worker"]
        gpu["GPU layer<br/>WebGPU or WebGL2"]
    end
    shim -- "input and resize,<br/>through shared memory" --> sketch
    sketch <-- "parallel loops" --> jobs
    sketch -- "frame snapshot" --> render
```

In null3D, a 3D scene is called a sketch: a module that builds the scene and updates it every frame. null3D runs your sketch in a worker thread and draws from a second worker. The page's main thread keeps nothing but the page, so scrolling, input and page UI stay smooth while the sketch runs. All threads share one block of WebAssembly memory, so they pass scene data by reading the same arrays. Texture images are the exception: the sketch's thread sends each image in a message to the thread that draws.

## The kinds of thread

| Thread | What runs there | How many |
| --- | --- | --- |
| Main thread | The page and a thin engine shim. The shim tests the browser and picks the engine build, the GPU path and the quality preset. It hands the canvas to the thread that draws, and writes input and resize events into shared memory. It also moves the HTML elements of [labels](../api/ui.md) to the places of the frame on screen. | 1 |
| Sketch worker | Your sketch code and the engine core. Reading or writing scene data is a plain memory access here. | 1 |
| Render worker | The GPU device and the canvas. It uploads changed data and replays draw lists into WebGPU or WebGL2 calls. It runs no sketch code. | 1 |
| Job workers | Parallel loops over scene data in Rust: the animation of clips, transforms and bounds, instance batches, and the sort of see-through objects. On WebGL2 they also cull, hide what occluders hide, and list the lights of each cluster. Between frames, they compute the normals and tangents of new meshes, build the trees that raycasts use, cast batches of rays, and run decoders such as the KTX2 transcoder. | None at the start. They start as the work grows, up to the logical cores minus 2, and at least 1 |
| Helper workers | Short-lived workers that start on first use. A glTF worker reads model files and decodes their images and meshopt data. A panorama worker reads HDR and EXR files. A task worker runs decoders where the engine has no job workers. They run no frame work. | One of each kind, on first use |

### When the job workers start

A job worker is a whole browser thread, and each costs about 3.5 MiB of memory even when it waits. So the engine starts none at first. The sketch thread times the parallel loops that it hands out. Over each 30 frames, it takes the mean time of those loops per frame. At 0.2 ms or more, it asks for 2 job workers. After each later such window, it asks for twice as many, up to the most. The first decoders, such as the KTX2 transcoder, ask for 2 too. They ask for more while every job worker has a task. A model with animation clips asks for 2 as well, because only job workers resample the clips. Until a job worker is ready, the sketch thread runs its share of each loop. Job workers that started stay until the engine stops. After a window with too little parallel work, the sketch thread stops timing its loops for 270 frames, because each reading of the browser's clock allocates. Once it has asked for the most, it stops for good. A small scene never starts one. On an 18-core Mac, a scene with 100,000 moving boxes started 4 to 16 job workers on WebGPU, more when the Mac was busy. On WebGL2, where the job workers also cull, it started all 16 within 1 second. `engine.mode.jobWorkers` gives the most job workers that the engine may start. The stats overlay counts the ones that run.

## Why the work is split this way

Sketch code runs in a worker so that it can touch scene data directly. The engine keeps positions, rotations and other fields in shared arrays, and your code reads and writes those arrays with no copy and no message.

One thread owns the GPU because browser GPU objects cannot move between workers. The parallel work therefore happens before any GPU call. The sketch worker records each frame as binary draw lists, and the render worker replays them.

The render worker runs no sketch code. A garbage-collection pause in your code cannot delay the frame on screen.

The busy loops stay inside WebAssembly. Each call from JavaScript into WebAssembly has a cost, so each step of the frame is one call that covers every object.

## One frame

In the default mode the two workers overlap. The render worker draws frame N while the sketch worker computes frame N+1.

The sketch worker, computing frame N+1:

1. Wakes when the render worker signals a new frame, and reads the new input from shared memory.
2. Judges the frames so far for [dynamic resolution and the frame-budget governor](quality-presets.md#dynamic-resolution). They can change this frame's render scale, the live shadow settings, bloom's base or the size of ambient occlusion.
3. Calls the handlers of the pointer events on objects. Each event's ray comes from the frame that was on screen at the event. Then it calls the handlers of the last frame's animation events, and runs your `onFixedUpdate` once for each fixed step that fell due, then your `onUpdate`. Your code writes transforms straight into the shared arrays and queues structural changes, such as creating, destroying and reparenting objects.
4. Applies the structural changes in one batch. When the scene's object tables are three quarters full, they double here ([Scene](../api/scene.md#limits)).
5. Runs parallel jobs: the animation step, which poses the animated objects, then the transforms by hierarchy depth, with their bounds. A skinned mesh's bounds follow its pose.
6. Runs your `onLateUpdate`, then updates the objects that it moved and the objects below them.
7. Runs more parallel jobs: the instance batches.
8. Gathers the point and spot lights nearest the camera, and tests each grid cell against each view. A view is the camera's, a shadow cascade's, a shadow tile's or a scene pass's. Parallel jobs then cull the see-through objects and sort them back to front. On the WebGL2 path, they also cull the objects of the cells in view and test them against the occluders. They list the lights of each cluster too. When textures take more memory than the preset's budget, the engine drops their largest mip levels here ([Quality presets](quality-presets.md#texture-memory)).
9. Records the frame's draw lists: the new GPU objects and the uploads first, then each pass in the order that the [render graph](render-graph.md) sets. It also keeps the frame's camera for rays from the pointer, and places the frame's labels.
10. Publishes the finished frame: it stores the frame's number in one shared slot, which the render worker reads in its next frame callback.

The render worker, drawing frame N inside its own `requestAnimationFrame` callback:

1. Takes the next complete frame. The sketch worker runs at most one frame ahead, so no frame is skipped. If none is ready, it draws nothing, and the browser keeps showing the last frame. It also draws nothing while two frames are unfinished on the GPU. The sketch worker then waits too, so at most two frames wait on a GPU that falls behind.
2. Applies a canvas resize that arrives with the frame. The frame was built for that size, so the canvas and the frame's render targets always agree. A new pixel ratio, as when the window moves to another screen, resizes the canvas too.
3. Uploads the changed byte ranges to GPU buffers, and on WebGL2 to data textures. On WebGPU, uploads from 64 KiB up to 4 MiB have two routes: the direct write call, and staging buffers that the browser keeps mapped. The render worker times both on the device and takes the faster one. Chrome favors the staging buffers, and Safari the direct call. On WebGL2, uploads read straight from shared memory, or from a copy in a browser that refuses to read it. Textures upload in bands of rows, within the quality preset's budget of bytes per frame, and the GPU then makes their mip levels.
4. Replays the draw lists into WebGPU or WebGL2 calls and submits them. The browser shows the frame when the callback returns.

The thread that draws builds GPU pipelines in the background. The shaders of some features, such as skinning and bloom, download the first time a sketch uses them, before their pipelines build. The first frame waits until its pipelines are built. After that, an object whose pipeline is still building draws nothing until the build ends. `scene.warmUp()` waits for the builds ([Loading screens and warm-up](../guides/loading-screens.md)).

The engine times each step of the sketch worker's frame, the replay on the drawing thread, and each job worker's busy time. The [performance guide](../guides/performance.md) shows how to read those figures.

## The passes of a frame

A frame's draw list holds a series of passes, and the [render graph](render-graph.md) puts them in order. A pass is one job for the GPU, such as drawing the scene from the camera. The engine declares its own passes, and a sketch adds [scene passes](../api/render.md) that draw the scene from other cameras into textures. A frame runs the passes in this order:

1. Light clustering, on WebGPU: a compute pass lists the point and spot lights of each cluster of the camera's view ([Lighting and environment](lighting.md#clustered-forward-shading)).
2. Culling, on WebGPU: a compute pass for each view tests the objects and instance rows against the view, on the GPU. In a scene over several grid cells, it skips the still objects of the cells out of view ([Culling](culling.md)).
3. Skinning, on WebGPU: a compute pass skins each skinned mesh that some view draws, once, into a buffer of skinned vertices. The same pass morphs each morphed mesh by its weights first. A mesh whose pose did not change since its last skin keeps its vertices, so a still character costs no work. The shadow passes and the scene passes draw that buffer ([Animation](../api/animation.md#skinned-meshes)).
4. Shadows: while a directional light casts shadows, each cascade that draws in the frame draws its casters' depth into its layer of the shadow map. Each tile of the shadow atlas of spot and point lights draws too, but only in a frame in which it must draw again ([Shadows](shadows.md)).
5. Scene passes: each scene pass that something shows draws the scene from its camera into its texture. It culls, draws its opaque and blended objects and its background color, as the camera's view does below ([Render graph API](../api/render.md)).
6. The depth prepass, when `depthPrepass` is on, as it is on WebGL2 by default: the depth of the opaque objects, before they are shaded ([Quality presets](quality-presets.md#the-depth-prepass)). Ambient occlusion turns the prepass on too.
7. Ambient occlusion, while it is on: three passes at half size read the prepass's depth, and the opaque pass reads their result ([The post-processing chain](post-processing.md)).
8. The opaque pass draws the objects in view into the scene color and depth, with 4 samples per pixel in the MSAA mode. With GPU occlusion culling on WebGPU, an occluders' pass first draws the depth of the objects that showed in the camera's last frame. A compute pass builds a depth pyramid from that depth and culls every object in view against it. The opaque pass then draws the objects that show ([Culling](culling.md#gpu-occlusion-culling-on-webgpu)). After the opaque objects, the same render pass draws a texture, environment, cube map or sky background into the pixels that no object covers.
9. In development builds, a frame with [debug drawing](../api/debug.md) draws the lines after the opaque pass, in the same render pass.
10. While some object blends, the transparent pass draws the blended objects back to front, in the same render pass.
11. Custom effects, on the HDR path: the sketch's own WGSL effects, joined into as few passes as their reads allow ([Custom passes](../guides/custom-passes.md)).
12. Bloom, on the HDR path: passes down and up a chain of mip levels.
13. Outlines, while some object is outlined: a pass draws the outlined objects into a mask.
14. The final pass draws the scene color into the canvas. On the HDR path it blends in bloom, and applies the vignette, the exposure and the tone mapping. Then it draws the outlines, applies the color grading table, encodes sRGB and dithers. It also smooths edges in the FXAA mode, and scales the image up to the canvas when the render scale is below 1. On the 8-bit path the scene's shaders tone map their own output. There, with MSAA and a lowest render scale of 1, the scene's render pass averages its samples straight into the canvas. The frame then has no final pass, unless a color grading table or the vignette needs it ([GPU tiers and backends](backends.md#color-and-anti-aliasing-on-each-tier)).

On WebGL2 the job workers cull, test the occluders and list the lights of each cluster before the frame records. The vertex shaders of the shadow and scene passes skin and morph the meshes. So the frame has no compute passes there. A new environment from a file, or the built-in room, adds GPU work to the next frame once. The GPU filters its map for each roughness before the frame draws ([Lighting and environment](lighting.md#environment-maps)). The graph works out the order only when the passes change, so a frame whose passes stay the same pays nothing for it.

## Precision far from the origin

Positions are 32-bit floats, as in three.js. Far from the origin such a value moves in coarse steps: about 8 mm at 100 km. The engine therefore keeps each world matrix relative to the center of a grid cell, 1,024 m wide. A root object takes the cell that holds its position, and its children take their root's cell. An instance row takes the cell that holds its own position.

Each frame, the engine computes the offset from the camera to each cell in use, in 64-bit floats. The GPU adds those offsets, so it draws positions relative to the camera, which stay precise near it. Static matrices stay on the GPU while the camera moves. [Culling](culling.md) describes the cells and their limits.

## Latency modes

| Mode | The render step runs on | Added latency | Best for |
| --- | --- | --- | --- |
| Pipelined | The render worker, one frame behind | 1 frame | Most sketches: the sketch's work and the GPU's work overlap, which gives the highest frame rate |
| Low latency | The sketch worker, right after the update | None | Sketches where input must show one frame sooner, when the frame budget has room for the drawing too |
| Single-threaded | One thread, in sequence | None | Pages without cross-origin isolation |

Pipelined is the default when the page can use threads, and single-threaded otherwise. On a page that can use threads, `createEngine({ latency: 'low' })` asks for low latency.

Low latency costs frame rate where the GPU is busy. In the S1 benchmark on an iPad Pro with WebGPU, it showed about a third fewer frames than pipelined mode. The GPU's work then overlaps less with the sketch's. With WebGL2 on the same iPad, both modes showed the same frame rate.

In pipelined mode, the render worker takes a new frame only at a display refresh. A frame that takes a little longer than one refresh waits for the next one. So on a 60 Hz display, frames that take just over 16.7 ms show at 30 frames per second. The [performance guide](../guides/performance.md#the-frame-budget) shows what this costs on a phone.

## Where the sketch runs

The engine puts the sketch, the drawing and the parallel work on threads by the page's mode:

| Mode | Your sketch and the engine core | Drawing | Parallel loops |
| --- | --- | --- | --- |
| Pipelined, the default | The sketch worker | The render worker | The job workers and the sketch worker |
| Low latency | The sketch worker | The sketch worker | The job workers and the sketch worker |
| Pipelined, where a worker cannot draw | The sketch worker | The page's main thread | The job workers and the sketch worker |
| Single-threaded | The page's main thread | The page's main thread | The page's main thread |
| Pipelined, with `sketchThread: 'main'` | The page's main thread | The render worker | The job workers and the page's main thread |
| Low latency, with `sketchThread: 'main'` | The page's main thread | The page's main thread | The job workers and the page's main thread |

A worker can draw only where the browser gives it a WebGPU or WebGL2 context for a canvas that the page hands over. The engine tests this at startup. Where a worker cannot draw, the page draws, and the sketch stays on its thread, in pipelined mode. Low latency with the sketch in its worker needs that worker to draw, so there the engine runs in pipelined mode instead. A development build logs a warning, and `engine.mode.latency` is `pipelined`. Read `engine.mode` for the build, the latency mode, the thread that runs the sketch, the thread that draws and the number of job workers.

`createEngine({ sketchThread: 'main' })` runs your sketch code and the engine core on the page's main thread, in the threaded build. Your sketch can then reach the DOM. Use it for apps that work mostly with the DOM, for a three.js port whose scene code still uses the DOM, and for debugging. The API stays the same. Your sketch's frames share the main thread with the page. Layout work and page scripts can delay a frame, and a slow frame delays the page's input. With the `?render=main` switch, the page draws too, as in low-latency mode, and `engine.mode.latency` is `low`. The page runs the sketch of one engine at a time. A second engine that asks for the main thread before the first has stopped fails with [E1415](../errors/E1415.md).

Worker threads need shared memory, and browsers allow shared memory only on cross-origin isolated pages. On any other page, the engine loads its single-threaded build, which runs the same code on one thread. [Hosting and cross-origin isolation](../getting-started/hosting.md) shows how to send the two headers that turn isolation on. The page switches `?threads=off`, `?render=main` and `?sketch-thread=main` force the other modes on one device, for tests ([Testing your sketch](../guides/testing.md)).

## Rules the engine keeps

- The render worker never waits for the sketch worker. Work that needs the GPU's answer, such as `engine.capture()`, returns its result through a promise.
- No worker makes a blocking call to the main thread. Messages to the page never wait for a reply.
- Each frame's data has two copies. The sketch worker writes one while the render worker reads the other, so neither waits on a lock.
- Each parallel loop splits into chunks, and a worker that finishes early claims the next chunk. A phone's slower cores then take fewer chunks, so they hold up the frame less.
- A hidden tab pauses the frames, because the browser stops `requestAnimationFrame` there. The job workers then sleep.

## The engine's lifetime

`createEngine` starts the threads, loads the core and runs the sketch's setup. `destroy` stops them all. A single-page app that leaves the view with the canvas, and comes back later, needs neither.

The page keeps the shared memory of an engine that stopped cleanly for about 30 seconds, for the next engine with the same memory maximum. That engine then asks the browser for no new memory. This matters in Safari, which can refuse a new memory for some seconds after a page drops one. Call `destroy({ release: true })` when the page will not start the engine again soon, so the browser can free the memory at once. When the browser refuses memory at the start, the engine tries again for about 45 seconds. [Engine](../api/engine.md#the-running-engine) describes both.

`engine.detach()` takes the canvas off the page and pauses the engine. The engine keeps its threads, its GPU resources and the scene, and stops reading input. Later, `engine.attach(element)` puts the canvas at the end of an element and resumes, with no new start.

Every handler call, such as `engine.onSketchMessage`, returns a function that removes the handler. A component that mounts again removes its old handler and adds a new one.

A kept engine holds its memory and GPU buffers. Destroy it once the app is unlikely to show the view again.

## Related pages

- [Handles and objects](handles.md): how your code names scene objects.
- [Static and dynamic objects](static-dynamic.md): which objects the engine recomputes each frame.
- [GPU tiers and backends](backends.md): what the render worker draws with.
- [The post-processing chain](post-processing.md): the passes of the effects.
- [Render graph](render-graph.md): how the engine orders and checks the passes.
- [Large worlds and precision](large-worlds.md): positions far from the origin.
