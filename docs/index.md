---
id: index
title: null3D documentation
summary: "What null3D is and how the docs are organized."
---

# null3D documentation

null3D is a high-performance browser 3D engine for coding agents and the developers who work with them. It is built for two things: speed, and scenes that work on every current device.

- **Faster than three.js.** null3D beats three.js in five of its six benchmark scenes. A scene graph of 5,096 objects costs null3D 0.35 ms of CPU time per frame, and three.js 3.18 ms. The engine loses one scene, in which 100,000 boxes stand still. The [performance guide](guides/performance.md) shows how to keep your own scene fast.
- **Wide device compatibility.** One sketch runs on current computers, tablets and phones. The engine draws with WebGPU, and with WebGL2 where WebGPU is missing, from the same code. [GPU tiers and backends](concepts/backends.md) lists the browsers, and [Quality presets](concepts/quality-presets.md) says how the engine fits its work to each device.

Its core is Rust compiled to WebAssembly, and it runs on worker threads, so the page's main thread stays free.

In null3D, a 3D scene is called a **sketch**. A sketch is a TypeScript module that builds its scene with `defineSketch` and updates it every frame. It runs in a worker of its own, while the page keeps the HTML.

## How the pages work

Each page names the limits of its feature, with a workaround where one exists. Coding agents use only the APIs that these pages and the engine's type declarations show. The null3D agent skills follow the same rule.

Each `api/` page links to its API reference, which the engine's doc comments generate, so it always matches the code.

## Where to start

- [Architecture: threads and the frame](concepts/architecture.md) explains where sketch code runs, and why.
- [GPU tiers and backends](concepts/backends.md) shows which browsers get WebGPU and which get WebGL2.
- The [performance guide](guides/performance.md) shows where frame time goes, and how to measure your scene.
- [Phones and tablets](guides/phones.md) says what the engine does on a small device, and how to test on one.
- [Hosting and cross-origin isolation](getting-started/hosting.md) covers the two HTTP headers that turn on worker threads.
- To port an app from three.js, the [three.js to null3D mapping](porting/threejs-mapping.md) gives the null3D equivalent of each three.js API that a port is likely to meet.

Coding agents can look pages up by ID. A page's ID is its path under `docs/` without `.md`, such as `concepts/architecture`. From version 0.1, the same pages ship inside the `@null3d/engine` package, so they always match the installed engine.

## All pages

[All pages](pages.md) lists every page by area.
