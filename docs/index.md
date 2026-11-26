---
id: index
title: null3D documentation
summary: "What null3D is and how the docs are organized."
---

# null3D documentation

null3D is a high-performance browser 3D engine for coding agents and the developers who work with them. It is built for two things: speed, and scenes that work on every current device.

- **Faster than three.js.** null3D beats three.js in five of its six benchmark scenes, and loses S1-static, in which 100,000 boxes stand still. In the S2 benchmark, a scene graph of 5,096 objects, null3D takes 0.35 ms of CPU time per frame. three.js takes 3.18 ms. Both figures come from Chrome on a MacBook Pro. [What gets faster](porting/threejs-overview.md#what-gets-faster) lists every scene, and the [performance guide](guides/performance.md) shows how to keep your own scene fast.
- **Wide device compatibility.** One sketch runs on current computers, tablets and phones. The engine draws with WebGPU, and with WebGL2 where WebGPU is missing, from the same code. [GPU tiers and backends](concepts/backends.md) lists the browsers, and [Quality presets](concepts/quality-presets.md) says how the engine fits its work to each device.

Its core is Rust compiled to WebAssembly, and it runs on worker threads, so the page's main thread stays free.

In null3D, a 3D scene is called a **sketch**. A sketch is a TypeScript module that builds its scene with `defineSketch` and updates it every frame. It runs in a worker of its own, while the page keeps the HTML.

## How the pages work

Each page names the limits of its feature, with a workaround where one exists. Coding agents use only the APIs that these pages and the engine's type declarations show. The null3D agent skills follow the same rule.

Each `api/` page links to its API reference, which the engine's doc comments generate, so it always matches the code.

## Where to start

- New to null3D: [Install null3D](getting-started/install.md), then [Your first scene](getting-started/first-scene.md). To try it with no install, [Try null3D from a CDN](getting-started/cdn.md). To start from a template, [Project structure](getting-started/project-structure.md).
- Porting from three.js: [Porting from three.js](porting/threejs-overview.md), with the [three.js to null3D mapping](porting/threejs-mapping.md) as the lookup table.
- Working with a coding agent: [Working with AI agents](guides/agents.md).
- Shipping: [Hosting and cross-origin isolation](getting-started/hosting.md) and [Deploying](guides/deploying.md).
- How it works: [Architecture: threads and the frame](concepts/architecture.md), [GPU tiers and backends](concepts/backends.md), the [performance guide](guides/performance.md) and [Phones and tablets](guides/phones.md).

Coding agents can look pages up by ID. A page's ID is its path under `docs/` without `.md`, such as `concepts/architecture`. The same pages ship inside the `@null3d/engine` package, so they always match the installed engine.

## All pages

[All pages](pages.md) lists the pages of each area and group. [Error codes](errors/index.md) lists every error code.
