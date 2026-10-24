# D-251: A recording of input and frame times for bug reports

Status: decided by the helper of M3-R15 on 25 October 2026, for the owner's review. Date:
2026-10-25. Task: M3-R15. Built: the engine records a session's frames and the input that the sketch
read, saves them as a small file, and replays the file on any machine.

Summary: A page that opens with `?record` records what its sketch read at each frame: the frame's
step and the input records. The recording holds the session's random seed, so the sketch's setup
draws the same scene on replay. `?replay=<file>` runs the frames from the file's first one, with
each frame's recorded step and the input that it had, so a session on a phone draws the same frames
on a computer.

## Question

A bug shows on a phone and not on the Mac. How does the owner capture what led to it, so that the
same frames run on the Mac, when the phone's frame rate, its hitches and its input timing cannot be
repeated?

## Rule

A replay is only useful if it gives the sketch the same time, the same step and the same input in
every frame, in the same order. The recording must therefore start at the session's first frame, so
that a replay starts from the same setup, and it must keep each frame's step exactly, because a
sketch that moves by `dt` gives a different state if a rounded step changes which fixed steps fall
due.

## Data

| Measure | Whole session from frame 1 | Rolling window of the last seconds |
| --- | --- | --- |
| Replays from the sketch's setup, on any machine | Yes | No: the scene's state at the window's start is not in the file |
| Size of a ten-minute session at 60 frames a second | about 324 KB with no input | the same |
| Captures a bug that has already happened | No: the user reloads with the switch first | Yes |

How the data was produced: an encoding of 36,000 frames with no input through the recorder wrote
324,026 bytes, of which 24 are the header. Every frame took nine bytes: its step as an eight-byte
number and a count of no input as one byte.

The rolling window fails the rule: without a copy of the scene, a replay cannot start where the
window starts. A snapshot of the scene would be far larger than the input, and would carry the
engine's internal tables. The session therefore records from its first frame, and the file says
when it stopped at its limit.

## Decision

**Where the recorder lives.** On the sketch's thread, inside the input reader's own read of each
frame. What the page wrote to the input ring is not what the sketch read: a press after a release in
one frame waits for the next frame, and a ring that overflowed releases everything. Recording the
records that the reader consumed captures the truth, so a replay that writes the same records into
the ring gives the same frames from the same code.

**The frame timeline.** Each frame stores its step in seconds as an `f64`, and the replay sums the
steps to get the sketch time, as the live clock did. A step rounded to microseconds or milliseconds
drifts: over an hour, half a microsecond a frame is nearly two milliseconds, which moves a fixed
step from one frame to the next and changes the sketch's state. The values of `x` and `y` are
`f32`, exactly as the input ring holds them.

**The seed.** A recording seeds the sketch thread's random numbers with a fixed seed, which the file
keeps, before the sketch module loads. The sketch's setup therefore draws the same random numbers on
replay. A page without `?record` keeps the browser's own random numbers.

**The file.** A short binary format, version 1:
- A header: the marker `N3DR`, the version, flags, the fixed-step rate, the seed, the sketch's
  address, a dictionary of the key names that the input used, and the frame count.
- Each frame: its step as an `f64`, the count of its input records as a varint, then each record:
  the type, the key's dictionary index or the record's code, the flags, the id, the buttons, and
  `x` and `y` as `f32`.
A ten-minute session at 60 frames a second with no input takes about 324 KB: 36,000 frames of nine
bytes each, and 24 bytes of header. The key names are the only text, and each appears once.

**The limit.** A recording stops at 600 seconds of sketch time, as hold mode does, and the file's
flag says it stopped there. A longer session needs a bigger buffer than a bug report needs, and a
silently cut file would replay to a state that the user never saw.

**How a replay runs.** A replay is a hold of many frames: the runner steps the recording's frames in
order during the setup, each with the recorded step, and writes each frame's records into the ring
before the frame reads them. The last frame is the one that the thread that draws draws, and the
page publishes it with the replay's facts under `__null3dHold`, whose `replay` field names the
frame count, the final time and the sketch. A page that replays reads no live input, so the user's
keys cannot mix with the recording's.

**Saving.** The `?record` switch shows a save button, which saves the session's file and puts the
bytes on the page as `__null3dRecording`, for a tool that reads them. `engine.saveRecording()`
returns the same bytes for a sketch or a tool, and `bunx @null3d/cli shot --replay <file>` serves a file to
the page and draws the replay's last frame, so the Mac replays a phone's file with one command.

## Evidence

A Galaxy S24 on Chrome 152, through BrowserStack, recorded a session of 20 frames whose longest
step was 0.25 seconds, with a key and a touch. The file replayed on the Mac, and every one of the
20 frame lines matched the phone's: the frame number, the sketch time, the step, the key state, the
pointer position and the seeded number. The long step is part of what matched, so the replay
carries a hitch instead of smoothing it. The run is in `.dev/tested-devices/`, its recording is kept in
`tests/fixtures/recordings/`, and `tests/image/recording-replay.spec.ts` repeats the comparison on
every run.

## Consequences

- `packages/engine/src/shared/recording.ts` holds the format, the recorder and the reader. Its code
  loads only for a page that records or replays, so the start's download does not grow.
- `sketch/input.ts` reports each record that it reads; `sketch/runner.ts` records the frames, seeds
  the random numbers, and runs a replay; `page/engine.ts` reads `?replay` before the start, passes
  the program, and publishes the result.
- `page/switches.ts` reads `?replay` and `?record`; `page/record-button.ts` draws the save button.
- The command-line tool's `shot` takes `--replay`, and `recording-page.js` serves the file to the
  page.
- A sketch that reads the quality preset or the device's capabilities can draw differently on
  replay, because the replay picks the machine's own preset. The recording keeps the sketch's time,
  step and input, which is what its frame sequence depends on; the test's sketch reads only those.
- The phone's frames are reproduced; the phone's GPU is not. Pixels differ between devices by the
  tolerance that image tests already use, so a replay proves the frames, not the picture.
