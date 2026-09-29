---
id: api/debug
title: Debug drawing and stats
status: planned
since: "0.1"
summary: "debug.line, box, axes, grid, frustum; debug.view; debug.stats."
---

<!-- null3d:placeholder -->

# Debug drawing and stats

> Planned for null3D 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists the APIs the engine has now. The rest of the page is not written yet.

This page will cover: debug.line, box, axes, grid, frustum; debug.view; debug.stats.

## API reference

### `FrameMetrics`

Interface `FrameMetrics`, which extends `FrameSummary`.

What `engine.measure` returns: the per-frame figures, memory, load time and download size.

| Member | Description |
| --- | --- |
| `seconds: number` | Length of the measurement. |
| `memory: MemoryStats` | The engine's WebAssembly memory and the JavaScript heap. |
| `load: { engineStartMs: number; probeMs: number; coreMs: number; firstFrameMs: number \| null; firstFrameDoneMs: number \| null; }` | How long the engine took to start and to draw its first frame, in milliseconds. |
| `downloadBytes: { wasm: number \| null; }` | Bytes of the engine's WebAssembly file as the page downloaded it. |
| `lostRecords: number` | Frame records the page read too late; nonzero means some frames are missing from the figures. |
| `completionSignal: 'queue' \| 'fence'` | How the renderer learned that the GPU finished a frame: its queue (WebGPU) or a fence (WebGL2). |
| `refreshHz: number \| null` | The display's refresh rate in hertz, as the thread that draws measured it, or null before then. |
| `mainThread: MainThreadStats \| null` | The page's own thread during the measurement, where the browser reports it, or null. |

### `FrameSummary`

Interface `FrameSummary`.

Per-frame figures of a measurement: CPU time by thread, GPU time, frame intervals, uploads and draw calls.

| Member | Description |
| --- | --- |
| `frames: number` | Frames that the sketch computed and the renderer drew within the measurement. |
| `cpuMs: Percentiles` | CPU time per frame of the busiest thread, the time that limits the frame rate. |
| `cpuMsAllThreads: Percentiles` | CPU time per frame summed over every thread. |
| `threads: Record<string, ThreadStats>` | Per thread, by name: `main`, `sketch-worker`, `render-worker`, `job-0` and so on. |
| `gpuMs: Percentiles \| null` | GPU time per frame, where the device has timestamp queries: from the frame's first command to the end of its last pass. Where the browser cannot time the commands before the first pass, as in Safari, the time starts at the first pass. The engine times one frame in eight, which keeps the cost of measuring small. |
| `gpuPassMs: GpuPassStats[] \| null` | The parts of the GPU time per frame, in the order the frame runs them: the copies before the first pass, where the browser times them, each pass, and the time between passes. In a frame with more passes than the engine times one by one, the last pass it times also counts the passes after it. Null where `gpuMs` is. |
| `gpuStepMs: number \| null` | The step between GPU times when the browser rounds its timestamps, or null when they look exact. Chrome rounds them unless its WebGPU developer features are turned on. |
| `intervalMs: Percentiles` | Time between presented frames. |
| `presentedFps: number` | Frames per second that the renderer presented. |
| `completedFps: number \| null` | Frames per second that the GPU finished. Below `presentedFps`, frames queue on the GPU, and the display shows fewer than the presented rate suggests. The engine tracks one frame in eight: the GPU finishes frames in order, so each tracked frame also accounts for the frames before it. Null when no completion arrived. |
| `gpuLatencyMs: Percentiles \| null` | Time from a frame's submit to the GPU finishing it, on one frame in eight. With a WebGL2 fence, the engine sees completion at its next frame callback, so the figure rounds up to frame intervals. The figure ends when the thread that draws sees the finish, so it also counts time that the thread spends blocked. In Safari, the copy of a worker's frame to the page blocks the worker until the GPU has finished the frame. |
| `uploadBytes: Percentiles` | Bytes uploaded to the GPU per frame. |
| `drawCalls: Percentiles` | Draw calls per frame. |
| `visibleEntries: Percentiles \| null` | Entries per frame in the list of visible objects on WebGL2, where the job workers cull. Each visible object or instance row is one entry. So is each visible group of 64 rows in a static batch that has stopped changing. The list uploads 4 bytes per entry in each frame that changes it. Null on WebGPU, where the GPU culls and the CPU never learns the count. |
| `rebuilds: number` | Frames whose structure change rebuilt the draw tables: objects created or destroyed, meshes or materials changed, or batches created or destroyed. Steady play has none; showing or hiding objects and changing a batch's active count do not rebuild. |
| `pipelines: number` | GPU pipelines built during the measurement. A build can stall the frame it happens in. The engine builds its pipelines in the first frame and after the browser replaces the GPU, so steady play builds none. |

### `GpuPassStats`

Interface `GpuPassStats`.

GPU time per frame of one part of the frame, in `FrameSummary.gpuPassMs`.

| Member | Description |
| --- | --- |
| `name: string` | The part: `copies` for the copies before the frame's first pass, a pass by its kind and its place among the passes of that kind, such as `compute 1` or `render 2`, or `between passes`. |
| `ms: Percentiles` | GPU time per frame of the part. |

### `MainThreadStats`

Interface `MainThreadStats`.

The page's own thread during a measurement: tasks that kept it busy for 50 ms or more, and the delay before the page handled input.

| Member | Description |
| --- | --- |
| `longTasks: number` | Tasks of 50 ms or more on the page's thread. |
| `longestTaskMs: number` | The longest of them, or 0 when there were none. |
| `inputDelayMs: Percentiles \| null` | Time from each input event to the page starting to handle it, or null without input. |

### `MemoryStats`

Interface `MemoryStats`.

Memory figures of a measurement.

| Member | Description |
| --- | --- |
| `wasmBytes: number \| null` | Size of the engine's WebAssembly memory at the end of the measurement. |
| `jsHeap: { bytes: number; byScope: Record<string, number>; } \| null` | JavaScript heap by global scope: the page and its workers when a measurement of them finished during the run, otherwise the page alone where the browser reports that. Chrome adds shared memory, such as the engine's own, to the figure of each worker that holds it, so worker figures overlap and can far exceed the worker's own heap. |
| `jsHeapSamples: { atSeconds: number; bytes: number; }[]` | Measurements of the page and its workers that finished during the run, for long runs. |
| `jsHeapNote: string \| null` | Why the heap figures cover only the page, or null when they also cover the workers that run JavaScript each frame. |

### `Percentiles`

Interface `Percentiles`.

A summary of per-frame samples.

| Member | Description |
| --- | --- |
| `count: number` | The number of samples. |
| `median: number` | The middle value. |
| `p95: number` | The 95th percentile: 95% of samples are at or below it. |
| `p99: number` | The 99th percentile: 99% of samples are at or below it. |
| `mean: number` | The average. |

### `PhaseName`

```ts
type PhaseName =
	| 'update'
	| 'commands'
	| 'transforms'
	| 'batches'
	| 'cull'
	| 'record'
	| 'upload'
	| 'replay';
```

A step of a frame that `engine.measure` times. The `update` step is the sketch's own code, and the other steps are the engine's.

### `ThreadStats`

Interface `ThreadStats`.

One thread's CPU time per frame, in `FrameSummary.threads`.

| Member | Description |
| --- | --- |
| `busyMs: Percentiles` | CPU time per frame on this thread. |
| `phases: Partial<Record<PhaseName, Percentiles>>` | CPU time per frame of each phase that ran on this thread. |
