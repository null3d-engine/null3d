# D-02: Replay loop in WebAssembly or TypeScript

Status: decided. Date: 2026-09-29. Task: M0-D3.

## Question

The render worker replays each frame's binary draw list into WebGPU or WebGL2 calls. Does that loop run in TypeScript, reading the list through typed-array views, or in Rust compiled to WebAssembly, calling the browser's APIs through wasm-bindgen imports?

## Rule

Keep the faster one on the S24+ WebGL2 path; if they are within 5%, keep the one that is simpler to maintain.

## Method

1. An upper bound first. A loop in WebAssembly still makes every browser call, each through a JavaScript import, so it can save at most the time the TypeScript loop spends in its own code. `bun run bench:profile --android` (PR #23, fixed in #25) sampled Chrome's CPU profiler on the S24+'s render worker, WebGL2, default counts:

   | Scene | Replay per frame | Engine's own code | Browser calls |
   | --- | --- | --- | --- |
   | S1, 100,000 moving boxes | 0.48 ms | 5.2% | 94.8% (texSubImage2D 84%) |
   | S1-static, 100,000 still boxes | 0.19 to 0.195 ms | 21.6% to 29.0% (two runs) | 71% to 78% |
   | S2, 5,096 objects in trees | 0.36 to 0.365 ms | 15.1% to 16.2% | 84% to 85% |

   The engine's share was over 5% in two scenes, so the bound did not settle the rule, and the full comparison followed.

2. A head-to-head. A replay loop in Rust (`crates/null3d-wasm/src/webgl2_replay.rs`, on branch `feat/wasm-replay`, kept as a patch outside the repository) ports the TypeScript WebGL2 backend command for command, with the same state cache. It decodes the draw list straight from engine memory, holds the GL objects as JavaScript references, and calls WebGL2 through web-sys. Uploads and multi-draw arrays read typed-array views of engine memory made once, so a frame creates no JavaScript objects; `texSubImage2D` and `invalidateFramebuffer` use imports declared without web-sys's exception wrapper, which allocates per call. `?replay=wasm` picks it. It draws the reference images in pipelined, low-latency and single-threaded modes, after a GPU loss, and through copied uploads; its hold frames match the WebGL2 references in S1, S1-static and S2.

## Data

Render worker, WebGL2, busiest-thread protocol of the device runner: the two pages take turns, five runs of 5 s warm-up and 30 s measured for each scene. Default counts (S1 and S1-static 100,000, S2 5,096). The medians are of each run's median.

Galaxy S24+, Chrome, 60 Hz (`target/runs/20260929-115552-bench`, 30 of 30 runs passed; skin 33.5 to 36.1 °C, Samsung throttle level up to 1, which affected both pages alike because they alternate):

| Scene | TypeScript replay | WebAssembly replay | WebAssembly / TypeScript | Render worker busy, TS / Wasm |
| --- | --- | --- | --- | --- |
| S1 | 0.470 ms (0.435 to 0.480) | 0.520 ms (0.470 to 0.545) | 111% | 0.480 / 0.535 ms (111%) |
| S1-static | 0.300 ms (0.290 to 0.305) | 0.345 ms (0.285 to 0.365) | 115% | 0.355 / 0.395 ms (111%) |
| S2 | 0.445 ms (0.430 to 0.485) | 0.510 ms (0.495 to 0.525) | 115% | 0.505 / 0.560 ms (111%) |

MacBook Pro, Chrome, WebGL2 forced, 120 Hz (`bun run bench:run`, `target/bench/20260929-115642-bench`):

| Scene | TypeScript replay | WebAssembly replay | WebAssembly / TypeScript |
| --- | --- | --- | --- |
| S1 | 0.145 ms | 0.150 ms | 103% |
| S1-static | 0.045 ms | 0.045 ms | 100% |
| S2 | 0.070 ms | 0.065 ms | 93% |

The Mac's times are a few steps of the clock that a cross-origin isolated page gets (5 microseconds), so they cannot tell the loops apart. The S24+ is the device the rule names.

The WebAssembly loop is slower although the TypeScript loop spends 15% to 29% of its replay in its own code. The WebAssembly loop decodes faster, but every WebGL call leaves WebAssembly through a JavaScript stub that wasm-bindgen generates, and then crosses into the browser's binding. The TypeScript loop calls the binding directly from optimized code. With tens of calls per frame, the stubs cost more than the decoding saves.

## Decision

Keep the replay loop in TypeScript. On the S24+ WebGL2 path it is the faster of the two, by 10% to 13% of the WebAssembly loop's time in every scene; the rule's 5% tie band does not apply.

## Consequences

- The GPU commands are decided (D-02, 2026-09-29): replay in TypeScript.
- The WebAssembly replay is not merged. The whole experiment is kept as a patch outside the repository, with how to rebuild and re-run it, in case browsers make calls from WebAssembly cheaper. Direct imports of Web APIs are one way they could. The patch also holds one change made after the runs: bind group setup reads its entries in place instead of copying the list. That saves well under a microsecond per frame and cannot close a gap of 10%.
- Kept from the experiment: the device runner's `--pages` and `--scenes` options, and the GPU interface of each benchmark page kind, which any comparison on a phone needs.
- The profile (`bun run bench:profile`) shows where the TypeScript loop's own time goes on the S24+: the replay switch, starting and ending the render pass, and bind group setup. They are the places to look when the WebGL2 path's render thread needs to get faster. Among the browser calls, the MSAA resolve (`blitFramebuffer`, `invalidateFramebuffer`, `bindFramebuffer`) takes about a quarter of S1-static's replay.
- No public docs change: the architecture page says the render worker replays draw lists without naming the language, which stays true.
