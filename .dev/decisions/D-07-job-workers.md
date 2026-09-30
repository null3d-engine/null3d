# D-07: Job worker count

Status: decided by the owner on 2026-09-30. Date: 2026-09-30. Test: T-09.

## Question

How many job workers should the engine start? Today it starts the reported logical cores minus 2 (one core each for the sketch worker and the render worker), and at least 1.

## Rule

Keep "logical cores minus 2", or set values per device class from measured scaling.

## Data

### What browsers report (T-09)

`navigator.hardwareConcurrency`, and the job workers the default rule starts:

| Device | Browser | Reported cores | Job workers |
| --- | --- | --- | --- |
| iPad Pro 11-inch | Safari 26.6 | 8 | 6 |
| iPad Pro 11-inch | Brave, Shields on | 3 | 1 |
| Galaxy S24+ (10 cores) | Chrome 154 | 10 | 8 |
| Galaxy S24+ | Brave | 9 in four runs, 6 in one | 7, once 4 |
| MacBook Pro (18 cores) | Chrome, Firefox | 18 | 16 |
| MacBook Pro | Safari | 8 | 6 |

Privacy features change the number: Safari on the Mac caps it at 8, and Brave varies it from load to load, low enough on the iPad to leave one job worker.

### Scaling

S1 at 240,000 boxes, the runner's bench plan with `--jobs 2,4,6,8 --runs 3`, null3D's two GPU paths at each count, pages taking turns, 60 Hz. Run `target/runs/20260929-161342-bench`, 2026-09-30. Medians of 3 runs; the busiest thread is the sketch worker at every count.

| Job workers | S24+ Chrome, WebGL2: CPU per frame | S24+: sketch worker's own work | iPad Safari, WebGPU: CPU per frame | iPad Safari, WebGL2: CPU per frame |
| --- | --- | --- | --- | --- |
| 2 | 20.86 ms | 4.95 ms | 15.70 ms | 15.84 ms |
| 4 | 21.01 ms | 6.03 ms | 15.66 ms | 15.78 ms |
| 6 | 21.47 ms | 7.23 ms | 15.66 ms (default) | 15.78 ms (default) |
| 8 | 22.04 ms (default) | 7.42 ms | 15.68 ms | 15.88 ms |

The S24+ has no WebGPU, so its WebGPU pages failed with E1301 (the run left out `--allow-no-webgpu`). The iPad's sketch worker does about 0.8 ms (WebGPU) and 1.1 ms (WebGL2) of its own work at every count.

Reading the data:

- On the iPad, the count makes no difference in S1: its parallel work is small next to the scene code on the sketch worker.
- On the S24+, this sweep made more job workers look costly: the sketch worker's own work grew by half from 2 workers to the default 8, and the frame by 5.7%. But the phone heated up during the sweep (the runs at 2 workers spread from 13.4 to 21.5 ms). The controlled sweep below, with the phone cooled before each run, shows the opposite: 8 workers beat 2.

S1-static at 240,000 boxes, where WebGL2 culls on the job workers each frame, the same sweep (run `target/runs/20260929-162924-bench`):

| Job workers | S24+ Chrome, WebGL2: CPU per frame | iPad Safari, WebGPU | iPad Safari, WebGL2 |
| --- | --- | --- | --- |
| 2 | 0.97 ms | 0.16 ms | 0.14 ms |
| 4 | 0.89 ms | 0.14 ms | 0.14 ms |
| 6 | 0.99 ms | 0.14 ms | 0.14 ms |
| 8 | 0.89 ms | 0.14 ms | 0.14 ms |

S1-static costs under 1 ms per frame on both devices at every count, so its culling gives the job workers too little work to show scaling.

The job workers' own time in the same S1 sweep on the S24+ (each job worker's chunk time per frame, medians of the run; the sketch worker's batch pass beside it):

| Job workers | Presented fps | Each job worker | Job workers' time, summed | Sketch worker's batch pass |
| --- | --- | --- | --- | --- |
| 2, first run (cool) | 58.8 | 2.9 ms | 5.8 ms | 2.58 ms |
| 2, later runs | 30.0 to 30.4 | 3.3 to 3.8 ms | 6.6 to 7.6 ms | 3.08 to 3.63 ms |
| 8, all runs | 30.0 to 30.5 | 1.7 to 3.2 ms | 16.7 to 23.9 ms | 5.18 to 5.36 ms |

The job workers' total time for the same rows grows about three times from 2 workers to 8. The 8-worker runs came later in the sweep, on a hotter phone, so heat and core count are mixed in this table; the controlled sweep below separates them. A profile of the sketch worker on a cool phone at the default 8 workers shows the job system's own work is 0.36 ms per frame. The cost is in the chunks, not in handing them out. The profile is in [D-06](D-06-success-targets.md#addendum-2026-09-30-where-the-s24-sketch-workers-time-goes-in-s1), in the addendum on where the S24+ sketch worker's time goes.

The controlled sweep, 2026-09-30: S1 at 240,000 boxes, Chrome 154, WebGL2, one run at a time, alternating 2 and 8 job workers, three runs of each. Before each run the phone rested until its thermal status was 0 and its battery was at 32 °C or less. Runs `target/runs/20260929-183519-bench` to `20260929-190207-bench`.

| Job workers | Presented fps | Sketch worker, median per frame | Its batch pass | Job workers' time, summed (mean per frame) | Render worker |
| --- | --- | --- | --- | --- | --- |
| 2 | 59.0, 59.6, 59.5 | 13.51, 13.46, 13.58 ms | 2.76 to 2.85 ms | 6.4 to 6.7 ms | 1.41 to 1.50 ms |
| 8 (default) | 59.8, 59.9, 59.8 | 12.89, 12.50, 12.67 ms | 1.92 to 2.09 ms | 7.0 to 7.6 ms | 1.04 to 1.05 ms |

On a cool phone the default of 8 is better: the sketch worker's frame is 0.8 ms (6%) shorter, and the job workers spend about 0.8 ms more in all. The earlier sweep pointed the other way because its 8-worker runs came later, on a hotter phone. With 8 workers, each job worker's median time per frame is 0 (its mean is about 0.9 ms). In most frames the sketch worker and a few awake workers take every chunk before the rest wake up.


Still to measure before a decision: the Mac sweep (`bun run bench:run --jobs 1,2,4,8,16`). No scene yet gives the job workers heavy work; the M1 scenes (shadows, clustered lights) will.

## Decision

The owner decided on 2026-09-30: keep "logical cores minus 2, at least 1". The controlled S24+ sweep shows 8 job workers beating 2 on a cool phone, and the iPad shows no difference in S1. The Mac sweep (`bun run bench:run --jobs 1,2,4,8,16`) still runs as a record, and the M1 scenes with heavy parallel work (shadows, clustered lights) measure the rule again.

## Consequences

- The rule in `packages/engine/src/page/engine.ts` (`RESERVED_CORES`) does not change.
- A browser that reports few cores (Brave with Shields, Safari's cap of 8) gets fewer job workers; the engine still starts at least 1.
