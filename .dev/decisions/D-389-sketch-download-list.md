# D-389: A sketch's download list, the first frame's signal, and the warning for serial loads

Status: decided and built: the `downloads` and `serialLoadWarning` options of `defineSketch`, the
list's start in the thread that loads the module, `ctx.engine.firstFrame`, and the development
warning. Pending: the owner's choice of demos that take the list and the signal.

Summary: A sketch names the files that its setup loads in `defineSketch(setup, { downloads })`. A
live start fetches the first two at low priority as soon as the module has loaded. Two download at
a time, and four at most while loads wait for them. The sketch's `ctx.engine.firstFrame` marks when
later files may start. A development build warns once about a load that waited for another. With
its eleven models listed, the Creek's cold first frame on a phone's link came at 21.3 s, not 25.9 s.

## Question

How does a scene start every file that its first frame needs, together and as early as the engine
can? The engine's own start files must keep their connections meanwhile. And how does a developer
learn that a setup loads its files one after another?

## Rule

- Measure before and after on the production build, on the phone's link (AGENTS.md, design
  principle 1). Measure on HTTP/1.1, where a page has six connections to a server, and on HTTP/2.
- One clear way to start a scene's files, and every error says how to fix it (design principle 10).
- Hold mode, a replay and a recording keep today's order ([D-387](D-387-sketch-module-starts-with-the-core.md)).
- A page that lists nothing downloads nothing more, and a production build gains no warning code
  ([D-14](D-14-js-budget.md)).
- The engine's own start files keep a free connection: the first frame's shader files must not
  queue behind the scene's files. Fetch priority cannot give them one, because it orders only the
  requests that wait for a connection, not the ones that hold it (D-387).

## Data

The runs used production builds of the examples from this branch's worktree. The examples'
preview server sent them over HTTP/1.1, and a copy whose server allows it sent them over HTTP/2.
Chrome for Testing 156 drew on the MacBook Pro's GPU. The timing helper's script (`measure.ts`)
sends each load through a proxy that makes one shared phone link. Its round trip is 150 ms, and it
carries 10 Mbit/s down and 5 Mbit/s up. The page runs at a quarter of the CPU's speed, and the service worker is off.
Each value is the median of 3 cold loads, in seconds from navigation start. Each run took the shared
timing lock, with no build or test beside it.

"Before" is the Creek as it is, with no list. Its setup waits for two light maps and builds the
land, then awaits seven garden models. It builds them, and only then starts four plant models.
"After" is the same build with all eleven models named in `downloads`. There a load of a listed
file that had not started started it at once. "After, with the limit" adds the limit of four listed
files while loads wait, and the glTF worker's early start. The figures of a shader file are its longest wait
for a connection in any of the three loads.

| Creek, cold, phone link | Before | After | After, with the limit |
| --- | --- | --- | --- |
| Setup start, HTTP/1.1 | 3.53 | 3.62 | 3.63 |
| First model request, HTTP/1.1 | 4.68 | 3.62 | 3.63 |
| First model byte, HTTP/1.1 | 4.90 | 3.82 | 3.82 |
| Last model byte, HTTP/1.1 | 23.8 | 20.0 | 20.0 |
| Link idle before the first frame, HTTP/1.1 | 3.3 | 0.2 | 0.2 |
| First frame done, HTTP/1.1 | 25.88 | 21.34 | 21.35 |
| A shader file's longest wait for a connection, HTTP/1.1 | 1.0 | 2.3 | 2.0 |
| First frame done, HTTP/2 | 28.02 | 26.00 | not run |
| A shader file's longest wait for a connection, HTTP/2 | 0.0003 | 0.0004 | not run |

- The list moves the first model request 1.1 s earlier, to the setup's start, and keeps the link
  busy. Its idle time before the first frame falls from 3.3 s to 0.2 s.
- Over HTTP/1.1, the Creek's setup asks for its seven garden models at once. Without the limit,
  those and the list's two held all six connections. The glTF loader's code then waited about 1 s
  for a connection, against 0.4 s before. A shader file waited up to 2.3 s, against 1.0 s. With the limit
  the first frame came at the same time, and the engine's files still waited about 1 s at the
  setup's burst. At that moment only four requests were in flight, so the list's connections do not
  explain that wait. The limit stays: it keeps two connections from the scene's own files, at no
  measured cost.
- HTTP/2 shares one connection, so no file waits for one. The proxy keeps a window of 256 KB in
  flight on each connection, so one connection there carries the phone link more slowly than six.
  Both HTTP/2 columns are slower than HTTP/1.1's for that reason.
- The island names no file, so its start shows the cost of the loader's new downloads part alone.
  Its first frame came at 9.19 s (9.12 to 9.26), against 9.08 s in D-387's final run.
- The glTF worker's early start was timed on the same link over HTTP/1.1. The builds were those of
  the "After" column and of the last column. The worker's script now loads while the model
  downloads, at 3.5 to 4.1 s. It loaded once the model had arrived before, at 7.2 s and 13.5 s. The glTF model
  demo's first frame came at 14.18 s instead of 14.31 s, and the character demo's at 7.65 s instead
  of 7.82 s.
- The two files that came one round trip late were timed on the splats demo over HTTP/1.1. The
  builds were that of the last column and one with both changes. The helper list's file now loads
  beside the task loader's, at 4.1 to 4.2 s. The chunked-row code loads beside the draw adapter, at
  3.9 to 4.0 s. Each came one round trip of about 160 ms later before. The demo asks for its first part at 4.57 s
  instead of 4.87 s. Its first frame waits for all 84 parts, so it came at 28.3 s against 28.4 s.
  The character demo came at 7.69 s against 7.65 s, within the runs' spread. The pictures of the
  splats tests and the splats and character demos stay the same on all three GPU tiers.
- The size check (`bun run build:check-size`) finds the assets loader's file larger by about 485
  bytes after Brotli. That is 7.0% on the page and 7.4% in the sketch worker, for the list's queue
  and the loads that wait in it. The
  sketch worker's start file grows by 0.8%, part of it D-387's code. The largest start, pipelined
  WebGL2, stays at 211.5 KB of its 256 KB. No development warning text reaches a production file.

## Look

The options draw the same frames. The list moves downloads in time, and the warning prints to the
console in development builds only.

## Decision

`defineSketch` takes `downloads`, an array of addresses that resolve against the page's address, as
the loading calls' do, and `serialLoadWarning`, true by default.

- **Where the list starts.** The thread that loads a live sketch's module starts the list as soon
  as the module has loaded. The sketch worker starts it from its `load-sketch` handler, which now
  carries the page's address. In single-threaded mode the page starts it once the module and the
  runner's code have arrived. The thread fetches the first two files at once, and imports the assets
  loader beside them. The loader's downloads part (`scene/downloads.ts`) needs no core. It reads
  those bodies as they arrive, so no unread body stalls its connection, and starts the rest in the
  list's order. The runner takes the same holder for the start. It begins the list at the setup
  when the thread did not, so the files start once, whichever comes first.
- **How many at once.** Two listed files download at a time while no load waits for one. One at a
  time would leave a phone's link idle for a round trip between files. More would take connections
  that the first frame's shader files need on HTTP/1.1. A load of a listed file that has not started
  moves it to the front of the queue, at the load's own priority. While loads wait for listed files,
  up to four download at once. A setup that asks for many together then still leaves two of the six
  HTTP/1.1 connections to the engine's own files. The listed fetches ask for low priority, which
  helps on HTTP/2.
- **What the loads take.** The setup's loads take the listed downloads, finished or under way, so a
  file downloads once. A listed file that fails keeps its error, and the load that takes it rejects
  with it. Its message names `defineSketch()`'s downloads. A file that no load takes costs its
  download, and its bytes stay in memory until the engine stops, as `preload`'s do.
- **Progress.** A listed file reads its body in chunks, so a progress handler that the setup adds
  later still sees its bytes arrive. The list's bytes count in `assets.onProgress`.
- **Modes.** Hold mode, a replay and a recording check the list and download each file at its load.
- **Errors.** An entry that is not an address fails the start with E1214 before the setup runs, in
  every mode. So does a list that is not an array. The fix names the option.
- **Files after the first frame.** The sketch's `ctx.engine.firstFrame` resolves once the GPU has
  finished the first frame, the moment of the page's `engine.firstFrame`. The thread that draws
  writes that time into the metrics buffer, which every engine thread shares. The runner checks it
  at each frame step until it appears, with a getter that returns a boolean, so the check allocates
  nothing. A scene starts the files that its first frame does not need when the promise resolves. A
  frame count does not mark the first frame done: with frames in flight, the sketch's second frame
  can start before the first has drawn. In hold mode and a replay the promise resolves once the
  engine has stepped the sketch to its last frame. No frame records after that one, so the work it
  starts never changes the frames that those modes show. Code that waits on it still runs. A
  recording is live, so its promise resolves on the real first frame.
- **The warning.** A development build watches the setup function of a live start. A load can start
  its download only after another load's file has arrived, while no other download runs. The first
  such load of a start prints one warning. It names both files, the two fixes and the option that
  turns it off. The fixes are to start both loads before awaiting either, or to name both in the
  list. A model's own files and the engine's decoders are not the sketch's loads, and loads after
  the setup are left alone. A load whose address comes from the file before it cannot start sooner.
  The warning cannot tell such a load in general, so it says to turn itself off then. It does tell
  one common case: a JSON file whose text holds the next file's name passes without a warning. The
  watch lives in `scene/serial-loads.ts`, which only development builds keep. An environment that
  the engine makes with no file, from `assets.builtinEnvironment` or `assets.skyEnvironment`,
  counts as an earlier load when it finishes. No file's address comes from such an environment, so
  a load that starts after it could always have started beside it.
- **The model reader's worker.** A model's load starts the glTF worker as soon as the loader's code
  has arrived, not once the file has. The worker's script and its start then overlap the download.
- **Two files that came one round trip late.** An add-on's first `runTask` asks for the thread's
  list of helper workers beside the task loader, whose file imports it. A worker gets no preload of
  a file's imports. The scene's `addFeatureInstances` asks for the chunked-row code beside the draw
  adapter, since its batch's `createChunkRows` call follows at once. The job workers already start while a
  task's WebAssembly compiles ([D-387](D-387-sketch-module-starts-with-the-core.md)).

Rejected:

- **`preload` as the option's name.** `createEngine`'s `preload` names shader features, so one word
  would name two kinds of thing.
- **`assets.preload` at the top of the setup.** It starts only when the setup runs, after the core
  and the runner, and it starts every file at once. On the examples' HTTP/1.1 server, eleven large
  files then hold all six connections. The first frame's shader files wait behind them.
- **Every listed file at once, at low priority.** D-387 measured that order on the island: its cold
  first frame came 0.74 to 0.98 s later, low priority or not.
- **The list's responses held until the runner exists.** The runner exists only once the core has
  arrived. A response whose body nobody reads fills the browser's buffer, and its connection then
  stalls. So the loader's downloads part loads beside the first two fetches, with no core, and reads
  them as they arrive.
- **The list in hold mode, replays and recordings.** Their runs must stay the same as without it,
  and they draw no start for a person to wait on.
- **A warning in production builds.** It would grow every page's start for a message that only a
  developer reads.
- **`firstFrame` resolved at once in hold mode and replays.** Its work would then run during the hold.
  Whether a later model landed before the held frame would depend on the network, and the held
  pictures would differ between runs.
- **`firstFrame` that never resolves in hold mode and replays.** Code that waits on it would never
  run there, and a promise that never settles hides that fault.

## Consequences

- The options and `SketchEngine.firstFrame` are in `sketch/define-sketch.ts`. The runner resolves
  the promise from `FrameRecorder.firstFrameDone` in `shared/metrics.ts`.
- The runner (`sketch/runner.ts`) holds `startListedFiles`, the list's check and the holder for a
  start, `ListedFiles`. The downloads part of the loader, with the list's queue, is
  `scene/downloads.ts`, which `scene/assets.ts` uses. The development warning is in
  `scene/serial-loads.ts`.
- The sketch worker, the worker protocol and the page start the list. E1214 covers it in
  `errors/fixes.ts` and `errors/codes.ts`.
- The sketch and assets pages describe the list, the signal and the warning. So do the loading
  screen guide, the network use and hosting pages, the maintainer notes' start order and the
  develop skill.
- Tests: `scene/downloads.test.ts`, the runner's download list and first frame tests, and
  `tests/image/download-list.spec.ts` in every thread mode.
