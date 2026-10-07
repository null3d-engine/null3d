# D-96: When the page draws instead of a worker, and how long the probe worker may take

Status: decided. Date: 7 October 2026. Task: M2-K1 (follow-up of a merge queue failure).

Summary: The probe worker answers in 1.5 to 25 ms. Yet the engine waited only once, for 5 s, and then drew on the page for the whole session. A probe worker that gives no answer now gets a second one with a 10 s limit. When the page draws, `engine.mode.renderFallback` and a warning in development builds name the reason. A failed WebGPU check in the worker no longer hides the worker's WebGL2.

## Question

When a worker was meant to draw, what makes the engine draw on the page's thread instead? How long should the engine wait for the probe worker, which tests whether a worker can draw, before it gives up on worker drawing?

## Rule

Drawing on the page costs the page's thread for the whole session, so a passing stall must not cause it. A probe worker that hangs must still not hold the start for long. When the page draws, the engine and the test records must say why.

## Data

On 7 October 2026, the merge queue's Firefox job on Linux failed one page (run 37580372008). It ran Firefox 156 on llvmpipe, and the page said `image-held-webgl2-pipelined: drew on main, expected render-worker`. The page took 16 s, and the pages around it took about 1.5 s. The same page passed in 16 earlier queue runs, and in a later run on the same code. The engine draws on the page only when its probe says that a worker cannot draw. So the probe worker gave no answer within its 5 s, or answered that it had no WebGL2 context. The record could not tell which: a page that reports a result kept no trail of its steps.

The table gives the probe worker's time from its script's start to its answer, over 12 probes in one page. They ran on the Mac (M5 Max), at a load average of 17 to 21 from other work:

| Browser | Answer, median | Answer, slowest (the first) | WebGL2 check, median |
| --- | --- | --- | --- |
| Chrome, real GPU | 6.1 ms | 21.2 ms | 4.1 ms |
| Chrome, real GPU, CPU slowed 6 times | 7.3 ms | 8.8 ms | 5.0 ms |
| Chromium, SwiftShader | 3.7 ms | 5.9 ms | 2.6 ms |
| Chromium, SwiftShader, CPU slowed 6 times | 5.0 ms | 5.7 ms | 3.5 ms |
| Firefox (Playwright's build) | 10.1 ms | 25.0 ms | 10.0 ms |
| WebKit (Playwright's build) | 1.5 ms | 19.2 ms | 0.9 ms |

How the data was produced: a scratch page started a copy of the probe worker that timed each check. It ran in each browser through Playwright, on the dev server of this branch.

A reading of the code found a second way to lose worker drawing. The probe worker put a failed WebGPU check in its answer's `error` field. The engine read any answer with an `error` field as a probe that failed, and dropped its WebGL2 result with it. A browser whose WebGPU device request throws in a worker then drew WebGL2 on the page.

## Decision

1. The 5 s limit is about 200 times the slowest answer measured, so only a stall reaches it. When the first probe worker gives no answer, a second one starts, with a 10 s limit. After a passing stall of up to about 15 s, a worker still draws. A probe worker that hangs now holds the start for 15 s, not 5 s. Only a GPU call that never returns causes that wait, and the page then draws, as before.
2. A probe worker that fails to start is not tried again: its script will not load a second time either.
3. `CapabilityReport.worker` is either the worker's answer or a `WorkerProbeFailure`: `no-answer` or `failed-to-start`, with the reason in words. A failed WebGPU check goes in the answer's own `webgpuError` field, and the worker's WebGL2 result still counts.
4. `engine.mode.renderFallback` names why the page draws: `no-answer`, `failed-to-start` or `no-surface`, where a worker has no context of the GPU path. It is null when the thread that draws is the one the options asked for. A development build warns once per page, with the reason.
5. A test page whose engine fell back keeps its trail of steps in its result. The trail shows each probe worker's start and replies. A mode failure in the test runners names the reason too.

## Consequences

- `probeWorker` in `packages/engine/src/page/capabilities.ts` holds the limits. Its unit tests check the second worker, the failure after both limits and the start failure. A unit test of `chooseTier` checks that a WebGPU error keeps the worker's WebGL2.
- The engine's browser tests check the reason and the warning where a worker cannot draw. A further test stalls the first probe worker and checks that a worker still draws.
- The browser tests that stand in for the probe worker served their script without the server's cross-origin isolation headers. So the worker never started, and the page drew for that reason, not the one the tests meant. The reason check found it. The stand-in scripts now keep the server's headers.
- `docs/api/engine.md` lists `RenderFallback`, `WorkerProbeFailure` and the new mode field.
- The next failure like the one in run 37580372008 will show its cause. The page's record holds the probe workers' steps, and the failure line names the reason.
