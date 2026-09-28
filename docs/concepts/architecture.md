---
id: concepts/architecture
title: "Architecture: threads and the frame"
status: planned
since: "0.1"
summary: "Main thread, game worker, render worker, job workers; the pipelined frame; latency modes."
---

# Architecture: threads and the frame

> Planned for null3d 0.1. No release has these APIs yet, so coding agents must not use them.

```mermaid
flowchart LR
    subgraph main["Main thread"]
        shim["Page shim<br/>canvas, input, resize"]
    end
    subgraph game["Game worker"]
        code["Your game code<br/>(TypeScript)"]
        core["Engine core<br/>(Rust, WebAssembly)"]
    end
    subgraph jobs["Job workers"]
        work["Transforms, culling,<br/>animation, draw lists"]
    end
    subgraph render["Render worker"]
        gpu["GPU layer<br/>WebGPU or WebGL2"]
    end
    shim -- "input and resize,<br/>through shared memory" --> game
    game <-- "parallel loops" --> jobs
    game -- "frame snapshot" --> render
```

null3d runs your game in a worker thread and draws from a second worker. The page's main thread keeps nothing but the page, so scrolling, input and page UI stay smooth while the game runs. All threads share one block of WebAssembly memory, so they pass scene data by reading the same arrays.

## The four kinds of thread

| Thread | What runs there | How many |
| --- | --- | --- |
| Main thread | The page and a thin engine shim. The shim picks the engine build, hands the canvas to the render worker, and writes input and resize events into shared memory. | 1 |
| Game worker | Your game code and the engine core. Reading or writing scene data is a plain memory access here. | 1 |
| Render worker | The GPU device and the canvas. It uploads changed data and replays draw lists into WebGPU or WebGL2 calls. It runs no game code. | 1 |
| Job workers | Parallel loops over scene data in Rust: transforms, culling, animation and draw-list recording, plus asset decoding. | Logical cores minus 2, at least 1 |

## Why the work is split this way

Game code runs in a worker so that it can touch scene data directly. The engine keeps positions, rotations and other fields in shared arrays, and your code reads and writes those arrays with no copy and no message.

One thread owns the GPU because browser GPU objects cannot move between workers. The parallel work therefore happens before any GPU call: job workers write binary draw lists, and the render worker replays them.

The render worker runs no game code. A garbage-collection pause in your code cannot delay the frame that the player sees.

The busy loops stay inside WebAssembly. Each call from JavaScript into WebAssembly has a cost, so the API crosses into WebAssembly once per batch of work.

## One frame

In the default mode the two workers overlap. The render worker draws frame N while the game worker computes frame N+1.

The game worker, computing frame N+1:

1. Wakes when the render worker signals a new frame, and reads the new input from shared memory.
2. Runs your `onUpdate`. Your code writes transforms straight into the shared arrays and queues structural changes, such as creating, destroying and reparenting objects.
3. Applies the structural changes in one batch.
4. Runs parallel jobs: animation, transforms by hierarchy depth, bounds, level of detail, and culling on the WebGL2 path.
5. Records the frame's draw lists. Long lists, such as those of the WebGL2 path, are recorded in chunks on the job workers.
6. Publishes the finished frame by flipping one shared index, then signals the render worker.

The render worker, drawing frame N inside its own `requestAnimationFrame` callback:

1. Takes the next complete frame. The game worker runs at most one frame ahead, so no frame is skipped. If none is ready, it draws nothing, and the browser keeps showing the last frame.
2. Applies a canvas resize that arrives with the frame. The frame was built for that size, so the canvas and the frame's render targets always agree.
3. Uploads the changed byte ranges to GPU buffers. On WebGPU, uploads from 64 KiB up to 4 MiB have two routes: the direct write call, and staging buffers that the browser keeps mapped. The render worker times both on the device and takes the faster one. Chrome favors the staging buffers, and Safari the direct call.
4. Replays the draw lists into WebGPU or WebGL2 calls and submits them. The browser shows the frame when the callback returns.

The engine times each step on every thread, job workers included. The [performance guide](../guides/performance.md) shows how to read those figures.

## Latency modes

| Mode | The render step runs on | Added latency | Best for |
| --- | --- | --- | --- |
| Pipelined | The render worker, one frame behind | 1 frame | Most games: the highest throughput and the steadiest frame pacing |
| Low latency | The game worker, in the same frame | None | Games where input delay matters most, when the frame budget allows |
| Single-threaded | One thread, in sequence | None | Pages without cross-origin isolation, and older iPhones |

Pipelined is the default when the page can use threads, and single-threaded otherwise. You pick a mode with `createEngine({ latency })`.

## Rules the engine keeps

- No thread waits for another on the critical path. Work that needs the GPU's answer, such as pixel-exact picking, returns its result in a later frame through a promise.
- No worker makes a blocking call to the main thread. Messages to the page never wait for a reply.
- Each frame's data has two copies. The game worker writes one while the render worker reads the other, so neither waits on a lock.
- Frame work comes before background work such as asset decoding. A worker that finishes early takes the remaining chunks from the others, so a phone's slower cores never hold up a frame.
- A hidden tab pauses the frames, because the browser stops `requestAnimationFrame` there. The job workers then sleep.

## Game code on the main thread

`createEngine({ gameThread: 'main' })` runs your game code on the page's main thread. Use it for apps that work mostly with the DOM, and for debugging. The API stays the same.

## Without cross-origin isolation

Worker threads need shared memory, and browsers allow shared memory only on cross-origin isolated pages. On any other page the engine loads its single-threaded build, which runs the same code on one thread. [Hosting and cross-origin isolation](../getting-started/hosting.md) shows how to send the two headers that turn isolation on.

## Related pages

- [Handles and objects](handles.md): how your code names scene objects.
- [Static and dynamic objects](static-dynamic.md): which objects the engine recomputes each frame.
- [GPU tiers and backends](backends.md): what the render worker draws with.
