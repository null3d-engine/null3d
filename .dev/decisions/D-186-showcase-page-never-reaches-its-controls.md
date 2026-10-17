# D-186: A showcase page that sometimes never reaches its controls

Status: decided. Date: 2026-10-16. Task: the showcase controls test on a software GPU.

Summary: On a software GPU the showcase page sometimes never reaches the state where its controls appear. The same address and browser reach them in four seconds in one run, and never in five minutes in another. The engine's own loading overlay stays at "Starting the sketch" while the engine says it draws on the page's own thread. Five copies of one demo drawing at once made this common: three reached their controls in 19 seconds, and two never did inside five minutes. The fault is parked, and no test budget covers it.

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

How the data was produced: on 16 October 2026, the showcase spec and a page probe ran on a Mac's software GPU. One run held a single page, and another held five at once. The figures are in the green-main landing task's run logs.

## Decision

Park the fault as the engine's start on a software GPU, and raise no test budget for it. A page that never reaches its controls is not short of time. The same page reaches them in four seconds when the machine is quiet.

## Consequences

A red browser test whose page waits for the controls can be this fault, and not its own subject. Whoever meets it should first run the page alone. A page that comes up alone and not in a busy shard is this fault.

The fault belongs to no page and no test. Its guide line sits in the image tests' "Tests on slow machines" section, beside the software GPU's other capacity limits.
