# D-250: A timed script that hold mode performs

Status: decided by the helper of M3-R14, for the owner's review. Built: the engine performs a
script in hold mode, the `shot` command draws each of its shot steps, and a `test` entry takes a
script. A script drives the night town showcase's image tests. Task: M3-R14.

Summary: A text script lists steps at sketch times: key presses, pointer events, property writes,
dumps and shots. Hold mode performs the input and property steps on the sketch thread, and the
commands hold once at each step that reads a dump or draws a shot. The same script then drives a
page through several states, and every image is the deterministic state at its step.

## Question

How does a coding agent drive a page through several states that input and property changes cause,
and capture each state, when hold mode deliberately reads no input and draws one frame?

## Rule

An image is useful only when it shows a state that a step names, and a script must draw the same
images on every machine. So a step's effect must land at an exact sketch time, and every run must
start from time 0 in the same way.

## Data

| Measure | One hold per output step | One hold that captures many frames | Real input through the browser |
| --- | --- | --- | --- |
| Input at an exact sketch time | Yes | Yes | No: the browser delivers events on its own clock |
| State at a step is reproducible | Yes, each hold replays from 0 | Yes | No |
| Engine change to capture a frame mid-hold | None | Reads back each frame from the canvas | None |
| Runs per script | One per dump or shot time | One | One, but each state waits on wall time |

How the data was produced: a design comparison, no measurement. The engine reads back the held frame
once, after the hold, in `holdFrame` (`packages/engine/src/page/engine.ts`). Capturing several frames
needs a readback path for each step, and a script's images are small in number, so the extra holds
cost a few seconds each and no new readback path.

## Decision

A script is a text file, one step to a line, each line starting with the sketch time in seconds. The
steps are `key`, `pointer`, `set`, `dump` and `shot`. The parser checks every line and names the
line that is wrong.

The command passes the steps that act to the engine as a program. The engine reads the program from
the page's `__null3dHoldScript` global as it starts in hold mode, and the command sets that global
with a Playwright init script before any page script runs. A URL switch was rejected: a script can
be long, and a switch needs escaping. A live engine ignores the global, so a page that starts
without hold mode never performs a script.

Hold mode writes a script's key and pointer steps into the input ring on the sketch thread, before
the frame at their time, and reads them with the ordinary input reader. It reads the ring only when
a script is present, so a hold without a script still depends on no input. A `set` step reuses the
property paths of `animateProperty` (`position`, `rotation`, `scale`, `visible`, and a light's or a
camera's own values), and lands before the frame at its time. A `dump` step reads the state after
that frame.

A step names an object by the name that the scene gave it, or by a component that the scene holds:
`#camera` is the active camera, and an object that is a light or a camera answers to that
component's own properties, such as `intensity` or `fov`. A name that finds no object fails the
step with the names that are close, so a wrong name is easy to fix.

A `set` step splits its name from its property at the last dot, so an object's own name may hold
dots. A `dump` step splits at the last dot only when the part after it is a property name. An
object whose own name ends in one therefore cannot be dumped whole.

`shot` holds once at each time that draws a shot or reads a dump. `test` does the same for a
`null3d.json` entry that gives `script` instead of `hold`, and each shot step becomes an image test
named `<test>-<state>`, with its own reference. A step that fails, such as a name that finds no
object, is recorded with the names that are close and fails the command.

## The pictures' state

A held frame's state comes from sketch time, not the wall clock. The engine sets each of hold
mode's frames from its step number at a fixed rate, and the sketch reads that time and the frame's
step, so a state that a script names is the same state on any machine and at any speed. The
references therefore show the state that their steps name, not whatever the machine happened to be
doing when the picture was taken.

The Mac's Chrome 156 drew the night town script twice on the real GPU, 46 minutes apart. The
second drawing came from the image test's own run of the command line tool, which compares each
image with its reference. The first ran the command below at the High preset:

```text
bun packages/cli/bin/null3d.js shot --script tests/image/showcase-night-town.script --page
'/tests/pages/image.html?sketch=/examples/showcase/night-town/sketch.ts&size=320x180&preset=high'
--size 320x180 --gpu webgl2 --out target/night-town.png
```

The two runs wrote byte-identical images for all three states. The SHA-256 values were
`4d2eeae1eaac0f8b7e6db179c14550a2d8565670e8f07c50123a971c582f8843` for `turned`,
`200e850a0591b058648c0949ad25923c109658433658fa9e83c9ddb16536c7fa` for `walked`, and
`221735b5b7b63afd4add45e3b22ee07b8248f94528bea21dbf90595df4a65cff` for `closer`.

## Consequences

- The CLI's `script.js` parses a script and checks every line. `runner.js` sets the page global for
  a hold, and `page.js` holds the program's types.
- The engine's `page/hold.ts` holds the program's types, and `sketch/runner.ts` performs it.
  `scene/scene.ts` gives the property reads and writes, and the closest names for a message.
- The docs page for the command describes the steps. [The showcase and the image
  tests](#the-showcase-and-the-image-tests) says which showcase the image tests drive and what
  those tests compare.
- M3-R15's input and frame-time recorder can feed this format later, so a recording from a phone
  becomes a script.

## The showcase and the image tests

The task's Done-when names a showcase. `tests/image/showcase-night-town.script` drives the night
town showcase through three states on WebGL2. They are `turned` at 2 s, `walked` at 3.5 s and
`closer` at 5 s. The `c` key takes the camera off its route at the opening view, where it holds
still. A left pointer drag then turns it around the square, the `w` key walks it toward the town,
and the wheel brings it closer. Every state therefore comes from a key or pointer step that the
showcase already reads, and no step undoes an earlier one. A `dump` step at each shot time reads
the camera's position. The spec requires each state's position to stand more than a meter from the
route's opening and from the other states' positions.

`tests/image/cli-script.spec.ts` runs a script in two places. In the fixture project the script
drives a key, the pointer, a property write and a dump. That test checks that each of the three
images differs from the other two, and those images have no references. In the repository the
spec draws the showcase script at 320 by 180 pixels and compares each of the three images with its
reference. On this Mac the spec passed four of four on Chrome's real GPU in 10.0 seconds, and all
three images matched their references. The runs are `script-demo-night-town-turned`, `-walked` and `-closer` in
`tests/image/script-runs.ts`, and each keeps its own references. The real GPU draws at the High
preset, and the software GPU at Low, as the image manifest's showcase tests do.

The real GPU's three references are in the repository, drawn on this Mac. The software GPU's
references are drawn on CI's SwiftShader: the spec saves each new picture as a candidate, and
accepting one makes it a reference. CI run `40445667147` drew the three, and a local run with
`CI=1` then compared them and passed four of four in 1.4 minutes.

The rejected option drove `examples/input`, a basic demo, for its input steps. The showcase reads
its own camera keys and the pointer, so the night town script drives those. The fixture project
still shows a property write and a dump.

The engine's unit tests run in CI's `docs-and-tools` job, which runs `bun run test`. A run of the
suite on the loaded Mac, whose log is not kept, reported 4,279 tests across 357 files, with 41 tests skipped. The
command-line tool's script tests pass, 11 of 11.
