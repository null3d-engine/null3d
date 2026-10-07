# D-01: Own GPU layer or wgpu

Status: decided. Date: 2026-09-29. Task: M0-G1.

Summary: Keep the engine's own GPU layer: wgpu would ship over five times the code.

## Question

Does null3D keep its own GPU layer (Rust draw lists replayed by a thin TypeScript layer into WebGPU or WebGL2), or adopt wgpu with its `webgpu` and `webgl` features?

## Rule

Keep the own layer if it needs at least 20% less CPU time per frame on the S24+ and the iPad (WebGL2), **or** ships at least 30% less compressed code. Otherwise adopt wgpu.

The two halves are joined by "or", so either one alone keeps the own layer. The size half was measured first, because it needs no port of the scenes to wgpu.

## Data

Sizes after Brotli (quality 11). Engine at commit 9b792d0. wgpu 30.0.1 (wgpu-core, wgpu-hal and naga 30.0.1), features `webgpu`, `webgl`, `wgsl`, `std`, default features off. Both builds use the engine's exact flags from `tools/build-wasm.ts` (threaded: atomics, bulk memory, SIMD, rebuilt standard library; single: SIMD), full LTO, one codegen unit, wasm-opt -O3.

| Measure | Own layer | wgpu lower bound | Build |
| --- | --- | --- | --- |
| Engine core wasm | 54,042 B | 54,042 B | threaded |
| Core glue | 4,076 B | counted as zero | threaded |
| Engine JavaScript (page, sketch, render, job and probe workers) | 77,507 B | counted as zero | both |
| wgpu's WebAssembly increment (probe minus an empty module) | none | 735,063 B | threaded |
| Total | 135,625 B | 789,105 B | threaded |
| Total | 134,788 B | 788,929 B | single |

The own layer ships 17.2% (threaded) and 17.1% (single) of the wgpu lower bound. The rule needs at most 70%.

How firm it is:

- The rule would flip only if wgpu's increment were below 139,708 B, 19% of what was measured.
- The probe uses less of wgpu than a real renderer would (formats, queries, mipmaps, more pipelines), so its size is a floor. Shared standard-library code cannot exceed the whole core (54 KB), so the increment stays above 681,000 B.
- A fuller estimate (keep the engine's JavaScript apart from its GPU layer, add wgpu's WebAssembly and glue) gives about 849,000 B for wgpu; the own layer is 16% of it.

The probe is a real renderer, not a size stub. It draws 1,000 instanced boxes in a dedicated worker on an OffscreenCanvas, with the structure of the engine's WebGL2 path. It reads an `R32Uint` index list and an `Rgba32Float` matrix texture with `textureLoad`, and uses a uniform buffer with a dynamic offset. It resolves 4x MSAA with reversed depth into the target. On WebGPU it also runs a compute pass, a render bundle and an indexed indirect draw. It drew the same frame (26,962 of 65,536 pixels, from its own readback) with WebGL2 and WebGPU, in the threaded build (shared memory, atomics) and the single build. It ran in Chrome on the MacBook Pro, with no console errors and no workarounds.

How the data was produced: a size probe built outside the repository, on 2026-09-29. One of its scripts builds and measures the modules; another runs the four configurations in Chrome. The full tables stay with the probe.

## Decision

Keep the own GPU layer. The size half of the rule decides it on its own: the own layer ships about a sixth of the code that wgpu alone would add.

The CPU half was not measured, and it cannot change the result. The full comparison in M0-G1 (S1 and S2 on wgpu's WebGL2 path, CPU times on the S24+ and the iPad) is therefore not needed. The wgpu build is not kept in the repository.

## Consequences

- The GPU layer is decided (D-01, 2026-09-29): own layer; wgpu ships over five times the code.
- M0-G1 is closed by this record; M0-J2 no longer runs a wgpu build.
- No public docs change: they already describe the engine's own GPU layer.
- Finding for later: the engine ships its GPU layer's JavaScript (`packages/engine/src/gpu/`, `generated/shaders.ts`, `generated/gpu.ts`) three times, in the page chunk, the sketch worker and the render worker. That is 37,500 B of the 132 KB, 28%. One shared chunk, or keeping the layer out of chunks that do not draw, would save about 25,000 B. Offered to the owner as a separate change.
- A note for wgpu, should it come back: with atomics its objects are neither `Send` nor `Sync`, so they must stay on the thread that made them, which fits the render worker. On WebGL2, naga translates WGSL to GLSL at run time in the browser.
