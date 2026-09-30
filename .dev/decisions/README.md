# Decision records

A decision record settles one design question with measured data. It states the question and the rule that decides it, then the data, the choice and what the choice changes. Write one when a design choice depends on measurements, such as a default or a pick between two designs. Start from [TEMPLATE.md](TEMPLATE.md), and add the record to the table below.

| Record | Status | Summary |
| --- | --- | --- |
| [D-01: Own GPU layer or wgpu](D-01-gpu-layer.md) | Decided, 2026-09-29 | Keep the engine's own GPU layer: wgpu would ship over five times the code |
| [D-02: Replay loop in WebAssembly or TypeScript](D-02-replay-language.md) | Decided, 2026-09-29 | Keep the replay loop in TypeScript, the faster of the two on the S24+ in every scene |
| [D-03: Default latency mode](D-03-latency-mode.md) | Decided by the owner, 2026-09-30 | Pipelined stays the default; low latency stays an option for pages that need input to show one frame sooner |
| [D-04: WebAssembly shared memory maximum](D-04-memory-maximum.md) | Decided by the owner, 2026-09-30 | Keep 1024 MiB as the default maximum, and let a page ask for up to 4096 MiB |
| [D-05: WebGL shared-memory upload path on Safari](D-05-safari-shared-uploads.md) | Decided, 2026-09-29 | Upload straight from shared memory wherever the startup test passes, which is every browser measured; copies stay as the fallback |
| [D-06: Success targets](D-06-success-targets.md) | Decided for the desktop target's measure, 2026-09-27 | The desktop target measures each engine's own CPU work on its busiest thread, apart from the game's code. Addenda keep the 600 KB budget and add the phone runs |
| [D-07: Job worker count](D-07-job-workers.md) | Decided by the owner, 2026-09-30 | Keep "logical cores minus 2, at least 1" job workers |
| [D-08: WebGL2 depth mode](D-08-webgl2-depth.md) | Proposed, 2026-09-30 | Draw `reversed` depth where the browser has `EXT_clip_control`, and `reversed-gl` elsewhere; the phone and tablet rows are pending |
| [D-11: Preset values, the governor's thresholds, and frames in flight](D-11-frames-in-flight.md) | Frames in flight decided, 2026-09-30; the preset check's thresholds proposed | Hold new frames while two are unfinished on the GPU, on both paths. The preset check targets the refresh rate up to 60, held at 90%. The iPad rows, the preset values and the governor's thresholds are pending |
| [D-13: Shader variants](D-13-shader-variants.md) | Proposed, 2026-09-30 | Ship the shaders of each GPU path in one file for each value of the permutation bits that a device fixes, and load only the device's own; the phone and tablet warm-up times are pending |
| [D-14: The engine's JavaScript budget through M1](D-14-js-budget.md) | Decided, 2026-09-30 | Up to 70 KB for the engine's JavaScript that a page downloads, per thread mode and GPU path, for now; any further raise needs the owner's approval |
