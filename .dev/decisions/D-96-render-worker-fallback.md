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

## The cause, and one probe per page

Date: 7 October 2026, later the same day. Task: M2-R23 (follow-up of a merge queue failure).

Summary: Firefox makes a new WebGL2 context wait for the WebGL work that other contexts have queued. On a software renderer a shader link takes seconds, so the probe worker can wait past both of its limits. That caused the failure above and a second one, E1301 on a canvas that a worker already held. The engine starts of a page now share one probe answer. A lost GPU drops it, so the next start probes again.

### Data

A second merge queue run failed one Firefox page on Linux (run 37592179592, #384): `same-canvas-webgl2-low-latency-then: E1301`. The page starts an engine, destroys it without a wait and starts two more on the same canvas, as React's StrictMode does. Its record held its steps. The last start's probe worker posted that it had loaded and then gave no answer. The page took 6.7 s, and the pages around it took 2.4 to 2.9 s. CI's Firefox 156 has no WebGPU, so the probe's only GPU call was its WebGL2 context. The canvas already belonged to a worker, so the start could not fall back to the page, and it failed.

The Firefox jobs of the last 30 queue runs held 46 logs. Two failed this way: the `drew on main` page above (run 37580372008) and this E1301. The same pages passed in the other 44 jobs.

The tests ran stock Firefox 157 for Linux (arm64) in a container on the Mac, under a virtual display. WebGL2 then draws with llvmpipe, as on CI. The test pages came from the Mac's dev server.

| Test | Result |
| --- | --- |
| 400 WebGL2 contexts kept open at once | all made, none lost: Firefox has no low context limit here |
| One worker links a shader of 6,000 terms (2.8 s); a second worker asks for a context 0.3 s later | the context takes 2.5 s and comes 12 ms after the link ends |
| The same with 2,000 terms (0.8 s) | the context takes 0.54 s |
| The same-canvas pages, 500 loads with nothing else running | 0 failures; the probe's context takes 17 ms at the median and 94 ms at most |
| The same-canvas pages, pipelined and low latency, with one link of 14 to 54 s that starts as the second engine's drawing worker stops: main with the second probe worker above | 6 of 6 fail with E1301 |
| The same, with one probe per page | 13 of 13 pass; each page starts one probe worker |

A link that starts while an engine stops delays that engine's stop too. The next start then waits for the stop, and its probe comes after the link. A stall reaches a probe only when the work queued before it outlasts the probe's limits. On CI that work is the shader links of an engine that stopped a moment before, which Firefox still runs. CI's Firefox reports no `KHR_parallel_shader_compile`, so its links block the queue.

How the data was produced: a scratch page ran the same-canvas pages in frames, one after another, as the runner page does. It posted each result and its steps to a small server on the Mac. A worker linked one large shader at a chosen moment. The pages and scripts were not committed.

### Decision

1. The engine starts of a page share one probe answer (`pageWorkerProbe` in `packages/engine/src/page/capabilities.ts`). A start that begins while a probe runs waits for that probe. A full answer serves every later start. A worker's abilities hold for the page's life, and a later start then never waits behind another engine's shader work. It also saves later starts the probe's 40 to 100 ms.
2. A failed probe is not kept, so the next start tries again after a passing stall.
3. A lost GPU drops the kept answer: the page's own loss, or a worker's that the engine reports as E1302. The next start then probes again.
4. The limits stay at 5 s and then 10 s. The wait comes from the WebGL work that other contexts queued, which has no bound: one link took 14 to 54 s in the tests. A probe that truly hangs holds a page's first start for 15 s, and the page then draws, as before. A later start in that page waits 15 s again, as no failure is kept. A start that reuses a kept answer waits for no probe.

### Consequences

- Unit tests check three things. Starts at once share one worker. A kept answer serves a later start until a lost GPU drops it. A failure is not kept.
- A stall can still reach a page's first probe when another page's engine has queued work. An example is a frame that a runner page removed a moment before. The second probe worker covers stalls of up to about 15 s there.
