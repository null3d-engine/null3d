# D-398: Start data from the page to the sketch's setup

Status: decided and built. `createEngine({ sketchData })` gives the setup `ctx.data`, in every
thread mode, in hold mode and in a replay, and a recording keeps it.

Summary: The page passes plain JSON data as `sketchData`, up to 64 KiB as JSON text. The start
message carries the text as one string, the sketch's thread parses it once into `ctx.data`, and a
recording keeps the text, so a replay's setup reads the session's data.

## Question

A page can message its sketch only after `createEngine` resolves, which is after the setup and,
in hold mode, after the held frame. How does a page give the setup a state that it knows at the
start, such as the section that its address names, a saved color mode or a level number? A
scroll-driven page opened at `?stop=city` must draw that stop in its first frame, and
`bunx @null3d/cli shot --page "/?stop=city"` must draw it in the held frame.

## Rule

The data reaches the setup before the first frame, in the same form on every thread: the sketch
worker, the page's thread with `sketchThread: 'main'`, and the single-threaded build. Hold mode
and a replay give the same setup as a live start. A replay must start from the recorded session's
scene, so the recording keeps what the setup read (D-251). The start message stays small, and the
data is copied as few times as the threads allow.

## Data

| Measure | JSON text | Structured clone |
| --- | --- | --- |
| Values that pass | Objects, arrays, strings, finite numbers, booleans, null | Those, and Map, Set, Date, typed arrays, ArrayBuffer and more |
| What a recording can keep | The text itself | No browser API writes a structured clone as bytes |
| The sketch's copy on the page's thread | One parse, a copy of its own | A `structuredClone` call, or the page's own object |
| Copies on the way to a worker | The string, which the start message carries | The object graph, cloned by `postMessage` |
| A bad value | Refused at `createEngine`, with its place in the data | Refused only by `postMessage`, in a worker mode |

How the data was produced: from the browser's structured clone and JSON specifications, and the
unit tests in `shared/sketch-data.test.ts`.

## Look

The options draw the same scene. The data changes only what the setup builds.

## Decision

**Plain JSON data.** `sketchDataText` on the page walks the value once and refuses, with E1213,
any value that JSON would change or drop: a Date, a Map, a typed array, an instance of a class, a
function, a bigint, NaN, an infinity, undefined in an array, and an object that holds itself. It
names the value's place, such as `sketchData.when`. A property whose value is undefined is left
out, as JSON leaves it out, so `{ stop: params.get('stop') ?? undefined }` works. The text may
take 64 KiB in UTF-8, which the recording's reader also takes as its limit for the field. Larger
data is a file, which the sketch loads with `ctx.assets`.

**One string on the way.** The page turns the data into JSON text once. The worker's start
message and the page's own runner carry that string, and the runner parses it once into
`ctx.data`. So the sketch gets its own copy in every thread mode. On the page's thread, a change
to the page's object after the start does not reach the sketch, as it cannot in a worker.

**Recordings keep it.** The recording's version 2 header holds the text after the sketch's
address, behind a flag bit, and a reader still takes version 1 files as recordings without data.
A replay gives the setup the recording's data, never the data of the page that plays it. A page
that replays reads its own address and storage again, which can differ from the session's, such
as a replay of a phone's file on a computer.

**Types.** `defineSketch<Data>(setup)` types `ctx.data` as `Data | undefined`. It is undefined
when the page passes none, as a sketch test's page and the command line's own sketch page do.

Options rejected:

- Structured-clone data. A recording could not keep a Map or a typed array, so a replay would
  start from other data than the session. Two rules, one for a live start and one for a
  recording, would also break principle 10's one clear way.
- Data in the sketch module's address, such as `sketch.ts?stop=city`, which some image tests use.
  A module's address includes its query, so each value makes the browser download and run the
  module again. The query holds only text, and the recording would still need to keep it.
- A message that the engine holds until the setup registers a handler. The setup would need to
  wait for it, and its order against the setup's own awaits would differ by thread mode.
- Letting the replaying page's data win. A replay would then build another scene than the
  session's whenever the address or storage differs.

## Consequences

- `shared/sketch-data.ts` checks and writes the text; `page/engine.ts` calls it in
  `createEngine` before any thread starts, and passes the text to the runner or the sketch
  worker's start message (`workers/protocol.ts`, `workers/sketch-worker.ts`).
- `sketch/runner.ts` parses the text into `ctx.data`, takes a replay's text over the page's, and
  gives the recorder the text. `shared/recording.ts` writes and reads it (D-251).
- `tests/image/sketch-data.spec.ts` checks a held frame of each thread mode, and a replay whose
  page passes other data.
- The four demos with choice buttons start at a choice that the address names, such as
  `?layout=inset`, through the examples page's start data.
- `docs/api/page.md` holds the user docs, with `api/engine`, `api/sketch`, the content pages
  guide's scroll-driven camera, the testing guide and the command line page. The develop and
  porting skills point to it.
