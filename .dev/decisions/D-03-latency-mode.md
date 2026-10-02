# D-03: Default latency mode

Status: decided by the owner on 2026-09-30. Date: 2026-09-30.

## Question

Should the engine run pipelined by default, or in low-latency mode?

- Pipelined: the sketch worker computes frame N+1 while the render worker draws frame N. Throughput is higher, and input shows on screen one frame later.
- Low latency: the sketch worker computes and draws each frame itself, with no render worker. Input shows sooner, and the drawing adds to the sketch worker's frame.

## Rule

Record throughput and frame pacing in both modes; the owner decides. A comment in the online spec asks this.

## Data

S1, runner bench plan, five runs of each page taking turns. Presented frames per second, frame interval at the 95th and 99th percentiles, and the busiest thread's CPU time per frame (the sketch worker in both modes), medians of runs.

| Device and browser | Path | Pipelined: fps, p95 / p99 ms, busiest ms | Low latency: fps, p95 / p99 ms, busiest ms |
| --- | --- | --- | --- |
| iPad Pro, Safari 26.6, 60 Hz, 240,000 boxes | WebGPU | 26.8, 38.2 / 38.5, 15.5 | 18.3, 56.2 / 57.8, 18.6 |
| iPad Pro, Safari 26.6, 60 Hz, 240,000 boxes | WebGL2 | 28.9, 35.7 / 36.0, 15.6 | 29.0, 35.8 / 36.1, 17.4 |
| Galaxy S24+, Chrome 154, 60 Hz, 240,000 boxes, throttled to level 2 | WebGL2 | 32.5, 33.6 / 33.8, 21.1 | 40.4, 33.5 / 33.6, 21.6 |
| MacBook Pro, Chrome | WebGPU and WebGL2 | pending | pending |

Runs: iPad `target/runs/20260929-155111-bench`; S24+ `target/runs/20260929-164448-bench` (4 pipelined runs: one failed to download its sketch module). On the S24+, three.js WebGL presented 44.1 frames per second in the same run.

Reading the data:

- On WebGPU, low latency loses a third of the frame rate (18.3 against 26.8). The GPU takes about 28 ms per frame there. In low-latency mode the sketch worker waits for each frame's GPU work before it starts the next frame, so the CPU and the GPU no longer overlap.
- On WebGL2 the two modes present the same frame rate, and low latency costs the sketch worker 1.8 ms more per frame, which is its drawing.
- On the S24+, low latency presents more frames than pipelined (40.4 against 32.5 per second), with the same CPU time. In pipelined mode a frame that misses the display's deadline waits a whole refresh, so the presented rate snaps toward 30 when frames take just over 16.7 ms. Low latency presents each frame as it finishes. The owner chose on 2026-09-29 to keep the pipelined pacing as it is; this record only reports what it costs on the phone.
- Low latency would show input about one frame sooner. The benchmarks do not measure input delay yet.

Later data, 2 October 2026 (run `target/runs/20261002-151739-bench`): S4 on the iPad in Safari 26.6 on WebGPU held its target frame rate. It did so in 55% of its seconds in low-latency mode, and in 100% pipelined. [D-06](D-06-success-targets.md) gives the other figures of those runs.

## Decision

The owner decided on 2026-09-30: pipelined stays the default, and low latency stays an option for pages that need input to show one frame sooner. The Mac row was not needed for the choice: on WebGPU, pipelined presents a third more frames on the iPad, and on WebGL2 the two modes present the same rate. The S24+ result for low latency comes from the pacing that the owner chose to keep, not from less work.

## Consequences

- `createEngine` keeps `latency: 'pipelined'` as its default; no code change.
- The docs on latency modes say when to choose low latency: input that must show one frame sooner. The cost is that the sketch worker waits for each frame's GPU work, which costs frames on WebGPU.
