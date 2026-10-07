---
id: index
title: null3D documentation
status: experimental
since: "0.1"
summary: "What null3D is; how the docs are organized; status labels."
---

# null3D documentation

null3D is a browser 3D engine for games and heavy 3D apps. Its core is Rust compiled to WebAssembly, and it runs on worker threads, so the page's main thread stays free. It draws with WebGPU, and with WebGL2 where WebGPU is missing, from the same code.

In null3D, a 3D scene is called a **sketch**. A sketch is a TypeScript module that builds its scene with `defineSketch` and updates it every frame. It runs in a worker of its own, while the page keeps the HTML. Its names follow three.js where the ideas match.

null3D is in early development. Some pages here describe planned features, and each page's status label says which is which.

## Status labels

Every page has a status in its front matter:

| Status | Meaning |
| --- | --- |
| `planned` | The engine does not have the feature yet. The page describes how it will work, and an API page also lists the APIs the engine has now. |
| `experimental` | The feature works, but its API can still change between versions. When the engine has only part of a page's feature, the note at the top of the page names the parts that are not built yet. |
| `stable` | The API follows semantic versioning. |
| `generated` | A tool writes the page from a single source, such as the three.js mapping data. |

Coding agents must never use an API whose page is `planned`. The null3D agent skills follow the same rule.

Each `api/` page links to its API reference, which the engine's doc comments generate, so it always matches the code.

The version column in [All pages](pages.md) gives the first engine version with the page's feature. Version 0.1 is the first release.

## Where to start

- [Architecture: threads and the frame](concepts/architecture.md) explains where sketch code runs, and why.
- [GPU tiers and backends](concepts/backends.md) shows which browsers get WebGPU and which get WebGL2.
- [Hosting and cross-origin isolation](getting-started/hosting.md) covers the two HTTP headers that turn on worker threads.
- If you are porting a three.js app, the [three.js to null3D mapping](porting/threejs-mapping.md) lists the three.js APIs with their null3D equivalents.

Coding agents can look pages up by ID. A page's ID is its path under `docs/` without `.md`, such as `concepts/architecture`. From version 0.1, the same pages ship inside the `@null3d/engine` package, so they always match the installed engine.

## All pages

[All pages](pages.md) lists every page by area, with its status and the version that brings its feature.
