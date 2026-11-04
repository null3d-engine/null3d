# D-186: A showcase page that sometimes never reaches its controls

Status: decided: the fault is parked, and no fix is built. Task: the showcase controls test on a software GPU.

Summary: On a software GPU the showcase page sometimes never reaches its controls, most often with several pages drawing at once. The same address and browser reach them in four seconds in one run, and never in five minutes in another. The fault is parked as the engine's start on a software GPU: on CI the sketch's setup does not run at all, and a page that does start stalls later, in the drawing thread's WebGPU adapter request. No test budget covers it.

## Question

Does a test that waits for the page's controls fail on its own budget, or on the page? The answer decides whether a timeout is raised or the fault is recorded as one.

## Data

| Case | The page's start |
| --- | --- |
| One page of the night town, alone, on SwiftShader | controls up in 3.6 to 4.2 s, in four runs of six |
| The same page, browser and flags | controls still hidden after the full 300 s wait, in two runs of six |
| Five pages of the same demo drawing at once | three pages reached their controls in 19 s each; two never did inside 300 s |
| Forced `&gpu=webgpu` and `&gpu=compat` | controls hidden after 90 s, in both |

In the stalled runs the overlay reads "Starting the sketch", and the canvas keeps its default size. The engine's warning is present throughout. The page draws instead of a worker, "because no probe worker answered within its time limit (5 s, then 10 s)". That warning is present in the runs that start in four seconds too. So the fallback is not the cause.

Two comments in `packages/engine/src/page/capabilities.ts` disagree about a quiet probe worker. `WORKER_PROBE_TIMEOUTS_MS` says the checks take milliseconds, so a worker quiet for five seconds has stalled. The note above `pageWorkerProbe` says a software renderer's links take seconds. A start's probe can then outlast its limits. The measurements here match the second.

How the data was produced: the showcase spec and a page probe ran on a Mac's software GPU. One run held a single page, and another held five at once. The figures are in the green-main landing task's run logs.

### Where the start stalls

A probe of the island page on a Mac's software GPU logs each step of the start. The sketch posts its controls at 4.3 to 9.6 s, and its town and trees finish by 12.4 s. The environment maps then never arrive, because they wait for the drawing thread's first renderer.

The drawing thread's start is where the stall is. `createRenderer` loads its device shaders and its renderer modules in 27 to 90 ms. Its `navigator.gpu.requestAdapter(...)` call with the compatibility feature level and the high-performance preference does not settle: no answer arrives within 120 to 380 s of waiting, and the graphics process runs at 900 to 1,000 per cent of one CPU throughout.

The same request answers at once everywhere else. The page's capability probe, the probe worker, a plain module worker, and a worker that holds a transferred OffscreenCanvas after a WebGL2 probe all answer in 1 to 2 ms. The stall is the engine's start under load, not the browser's adapter path in general.

The commit that shows a showcase's controls before the scene is built stalls in the same way, and so does the branch before it. The stall therefore predates that change. With the controls shown early, the overlay appears at 4 to 10 s; the page's first frame still waits on this stall, so a test then fails at its wait for the first frame rather than at its wait for the controls.

How these figures were produced: `CI=1 bunx playwright test image/showcase-hud.spec.ts --workers=1` on a Mac, and a probe page that logged the sketch's steps, the render worker's steps and the graphics process's CPU.

### The CI failures stall earlier still

The CI failures are a stage before the drawing thread's start. In run 41659084006 three of the four showcase HUD jobs failed with the overlay at "Starting the sketch" and the HUD element hidden while carrying its children. The children are made at the start of `startDemo`, before the engine starts, so the page ran and built the controls' container. The controls' message never arrived. The island posts that message synchronously at the start of its setup, before any environment await or scene build, so the sketch's setup did not run on those pages. The fourth job, the toasts test, passed on the same run, so a page's start does complete on CI. The fault is therefore in the sketch worker's start: whether it receives the page's init, starts its core, or loads the island's module. The page's snapshot cannot separate those three; a capture of the worker's console can.

## Decision

Park the fault as the engine's start on a software GPU, and raise no test budget for it. A page that never reaches its controls is not short of time. The same page reaches them in four seconds when the machine is quiet.

## Consequences

A red browser test whose page waits for the controls can be this fault, and not its own subject. Whoever meets it should first run the page alone. A page that comes up alone and not in a busy shard is this fault.

A showcase page now shows its controls as soon as its sketch posts them, before the scene's geometry and its GPU-made maps exist, so its controls no longer wait on this fault. Its first frame still does: a test that waits for the frame can meet the stall even when the controls came at once.

The fault belongs to no page and no test. Its guide line sits in the image tests' "Tests on slow machines" section, beside the software GPU's other capacity limits.
