# D-387: The sketch module and the first downloads start with the core

Status: decided and built. Task: the start of the showcase demos on a phone's link. Open: a
page-side download of the sketch module that a module request can take from the cache.

Summary: A live start has the sketch worker import the sketch module as soon as the worker runs.
The module's own imports and its top-level code then run while the core downloads. On a phone's
link, the wait from the core to the setup falls from 853 to 471 ms in creek. It falls from 958 to
505 ms in skyway, and from 640 to 149 ms in the instances demo.

## Question

What did the start wait for between the core's arrival and the sketch's setup? Which of those waits
can run while the core downloads?

## Rule

- Measure before and after on the production build, on the phone's link, cold and warm (AGENTS.md,
  design principle 1).
- Hold mode, a replay and a recording load the sketch module after the runner has seeded the
  thread's random numbers. The module's top-level code then draws the same numbers on every run.
- The time at which the engine reports its first frame stays as it is. So does the preset check
  ([D-17](D-17-stored-preset-check.md)).
- No thread waits for another on the critical path (hard rules 4 and 5).

## Data

The sketch worker imported the sketch module only after it had started its core and its runner. The
module's imports came two to four rounds after the core. A module's top-level work ran after them.
The island's module builds its height grid, its layout and its tree places as it loads, about 1.2 s
in the worker. The page fetched the sketch file into the cache first. But the examples' server
answers with `Vary: Origin`. A module request carries an `Origin` header, and the page's `fetch` does
not. So the worker asked again, and waited 155 to 170 ms for a revalidation each time.

The runs used the production build of the examples at cbdd718e4, served by
`bun run examples:preview`. Chrome for Testing 156 drew on the MacBook Pro's GPU. The timing
helper's script (`measure.ts`) sends each load through a proxy that makes one shared phone link. Its
round trip is 150 ms, and it carries 10 Mbit/s down and 5 Mbit/s up. The page runs at a quarter of
the CPU's speed. The workers run at full speed, because Chrome refuses the throttle for workers. The
service worker is off. Each value is the median of 3 loads, in ms from navigation start. "Before" is
the timing helper's baseline run. "After" is this change's build with the same command lines. The
baseline ran while other helpers built on the same Mac. Its load average was about 10 to 17. The
after runs had no build or test beside them. So a difference outside the sketch's own path may come
from the load, not from this change.

| Demo, load | Core ready, before / after | Setup start, before / after | Core to setup, before / after | First frame done, before / after |
| --- | --- | --- | --- | --- |
| creek, cold | 3,001 / 3,052 | 3,855 / 3,523 | 853 / 471 | 25,703 / 25,255 |
| skyway, cold | 3,034 / 3,051 | 3,993 / 3,571 | 958 / 505 | 5,743 / 5,342 |
| instances, cold | 2,982 / 3,053 | 3,623 / 3,207 | 640 / 149 | 4,551 / 4,141 |
| island, cold | 3,161 / 3,140 | 5,362 / 5,023 | 2,202 / 1,886 | 8,870 / 9,084 |
| island, warm | 1,413 / 1,374 | 3,170 / 2,594 | 1,962 / 1,160 | 5,909 / 4,668 |

- The island's setup starts 339 ms sooner, but its cold first frame came 214 ms later. Its loads
  took 8,962 to 9,103 ms, against 8,632 to 9,245 ms before. During the warm-up, the first frame's
  shader files share six HTTP/1.1 connections with three material files and the town's models. In
  the three loads after, they waited about 0.93 s for a connection. One baseline load waited 0.95 s
  the same way, and took 9,245 ms. The job workers now start while the mesh levels task's
  WebAssembly compiles, so that task's script also downloads during the warm-up.

- The scene's code requests form a chain of 5 or 6 rounds in both builds. The chain now starts once
  the sketch worker's script has run, about 1.9 s into a cold load on the phone's link. Its last
  file arrives at 3.5 to 3.9 s, against 3.9 to 5.5 s before.
- In creek's cold loads, the setup asks for job workers. The first two loaded their script 4 ms
  after the page created them, against 158 ms before.
- The engine test page's startup benchmark (`bun run bench:startup --runs 5`) ran pipelined, cold,
  on Slow 4G and WebGPU. Before, its first frame came at a median of 7,285 ms (5 loads: 8,674,
  7,285, 7,314, 7,281 and 7,263), with 21 requests and 823.3 KB. After, it came at 7,314 ms (8,597, 7,316, 7,297, 7,301 and 7,314),
  with 22 requests and 825.3 KB. The one more request is the job worker's script, which the page
  now downloads at the start. That page's empty sketch imports nothing more, so the early import
  saves it nothing.

## Look

The options draw the same frames. The change moves downloads and module loads in time. Hold mode,
which draws the image tests' frames, keeps its order.

## Decision

For a live start, the page sends the sketch worker `load-sketch` as soon as it starts the worker.
The message holds the module's address. The worker imports the module at once. The start takes that
import when its address matches. Nothing that a module can reach as it loads needs the core or the
runner. Every call that makes scene data goes through the setup's context. A development build hears
the add-ons that the module loads from that message on. It hands them to the runner, as the page
does in single-threaded mode. The single-threaded path follows the same rule. So a replay and a
recording there load the module after the seed too.

The page also downloads the job worker's script at the start, and reports each job worker as soon
as it is ready. The first task asks for job workers while its WebAssembly compiles, and runs on the
first worker that is ready. Once two run, the first stays free for the frames. Hold mode can then
read its frame back while the second copy of a worker that did not start still fails. That failure
is reported, and it no longer ends the hold: the frames never needed the worker. The engine test's
three cases of job workers that do not start run in every thread mode that has job workers.

Rejected:

- **The page's `fetch` of the sketch file beside the early import.** Vite's servers vary their
  answers by `Origin`. There the worker's module request cannot take the page's copy, and both
  download the file. Safari may download a file twice when two requests overlap. The page keeps the
  fetch only for hold mode, replays and recordings.
- **A file call's download beside the assets code.** The assets loader's code loads with the first
  call that reads a file. Starting that call's file at once saves a round trip when the setup waits
  for it. But it moved the island's later models ahead of the first frame's shader files. The island
  starts its town's 2.85 MB of models in the middle of a setup that runs about 1.5 s without
  waiting. The loader's code had arrived, but it finishes loading only in a later task. So the
  town's calls took the early path. The examples' server speaks HTTP/1.1, so the page has six
  connections to it. Three models and three material files took all six, and the warm-up's shader
  requests waited 1.2 to 2.0 s for a connection. In every baseline load, the shader requests came 9
  to 17 ms before the models. The download started at the call, in the
  caller's own promise turn, in the thread's next task, and in that task at low priority. The
  island's cold first frame then came 0.74, 0.91, 0.98 and 0.91 s later. Low priority does not help: the models take the free
  connections before the shader requests exist.
- **The job workers' report once each batch has settled.** Both workers of a batch become ready
  within milliseconds of each other on this Mac, so the change saves little here. It does let the
  first task run on the first ready worker. The loader rebuilds its list of workers that take tasks
  whenever the page's list changes.

Not done here:

- **A page-side download that a module request can take from the cache**, such as
  `<link rel="modulepreload">` for the sketch module. The worker's own script takes about 0.5 s to
  arrive on the phone's link, so the scene's first file could start that much sooner. It costs a
  parse of the module on the page's thread. Each browser caches it in its own way. Measure it before
  taking it.
- **A smaller engine file for sketches.** Every sketch imports the page's engine file, 84 KB raw in
  the examples' build, with the page's start code. The package has no `sideEffects` field, so the
  bundler keeps every module of it. Marking it needs a review of each engine module that does work
  as it loads.
- **The island's later models after its first frame.** Left to the island's own change, which now
  starts its trees, its town's three model files and its people once its first frame has drawn. They
  then leave the six connections to the first frame's shader files ([Examples](../examples.md)).

## Consequences

- `workers/sketch-worker.ts`, `workers/protocol.ts`: the `load-sketch` message and the early import.
- `page/engine.ts`: the message, the job worker script's download, and each job worker reported as
  it is ready. `shared/worker-start.ts`: `workerScriptOf`, which reads a worker's built address
  without starting it.
- `shared/tasks.ts`: the first job workers start while a task's WebAssembly compiles. The workers
  that take tasks follow the page's newest list.
- `page/engine.ts`: a job worker that did not start does not end hold mode's read-back.
- `shared/version.ts`: `hearAddonsEarly`, which the page and the worker share.
- The maintainer notes ([Start order](../implementation-notes.md#start-order)) and D-126's rule
  describe the new order. So do the sketch and architecture pages, the hosting guide and the develop
  skill's start-up section.
