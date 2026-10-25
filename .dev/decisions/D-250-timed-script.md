# D-250: A timed script that hold mode performs

Status: decided by the helper of M3-R14 on 23 October 2026, for the owner's review. Date:
2026-10-23. Task: M3-R14. Built: the engine performs a script in hold mode, the `shot` command
draws each of its shot steps, and a `test` entry takes a script.

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

On 26 October 2026 this Mac's Chrome 155 on the real GPU drew the night town script twice, two and
a half minutes apart, with the command below and the High preset:

```text
bun packages/cli/bin/null3d.js shot --script tests/image/showcase-night-town.script --page
'/tests/pages/image.html?sketch=/examples/showcase/night-town/sketch.ts&size=320x180&preset=high'
--size 320x180 --gpu webgl2 --out target/night-town.png
```

The two runs wrote byte-identical images for all three states. The SHA-256 values were
`7c93e8ec835abfa52130509ad012be466d170b3923f442e8b031daf7b49b3967` for `opening`,
`7c904be490549d802918d7ba81855523cac251d8dc86cf60a3a7a8881eefcb53` for `wide`, and
`3f534a0f3e875995f9fa6b436b45e440e11a48a5ab9b76696cb71be0f2bd93f0` for `square`.

## Consequences

- The CLI's `script.js` parses a script and checks every line. `runner.js` sets the page global for
  a hold, and `page.js` holds the program's types.
- The engine's `page/hold.ts` holds the program's types, and `sketch/runner.ts` performs it.
  `scene/scene.ts` gives the property reads and writes, and the closest names for a message.
- The docs page for the command describes the steps. The addendum of 26 October 2026 below says
  which showcase the image tests drive and what those tests compare.
- M3-R15's input and frame-time recorder can feed this format later, so a recording from a phone
  becomes a script.

## Addendum, 26 October 2026: the showcase and the image tests

The task's Done-when names a showcase. `tests/image/showcase-night-town.script` drives the night
town showcase through three states on WebGL2. They are `opening` at 0.5 s, `wide` at 2 s and
`square` at 30 s. The scene's camera follows a route of the sketch time, and hold mode sets that
time exactly, so each state is a fixed pose. A `set` step widens the active camera's lens to 60
degrees for the second state, and a `dump` step reads the value back. A second `set` step returns
the scene's own lens before the third state. The states therefore show both the route and the
script's writes.

`tests/image/cli-script.spec.ts` runs a script in two places. In the fixture project the script
drives a key, the pointer, a property write and a dump. That test checks that each of the three
images differs from the other two, and those images have no references. In the repository the
spec draws the showcase script at 320 by 180 pixels and compares each of the three images with its
reference. On 26 October 2026 the spec passed four of four on this Mac's Chrome in 38.5 seconds,
and all three images matched their references. The runs are `script-demo-night-town-opening`,
`-wide` and `-square` in `tests/image/script-runs.ts`. The opening run borrows the reference of
the manifest's
`demo-night-town`, which holds the same frame and keeps the only picture of it. The other two runs
keep their own references. The real GPU draws at the High preset, and the software GPU at Low, as
the image manifest's showcase tests do.

The real GPU's references are on the branch. The software GPU's two references come from CI: the
pushed branch's run drew them and saved them as candidates, and accepting those made them
references. Run 40223500231 drew them on `33122b8eb`. Every commit after it changed only
documentation, the remake command, or the pictures, so the scene is unchanged. Each test then
compares against the picture that the same run drew. The next run on the branch is the green one
for that set. The branch keeps no local-reference note, because neither software picture is kept
from a local drawing.

The earlier version of this addendum drove `examples/input`, a basic demo, because a showcase was
thought to need input steps. That is not so: a showcase's camera moves with the sketch time. The
input demo's script and references are therefore gone, and the fixture project still drives the
key and pointer steps.

The engine's unit tests run in CI's `docs-and-tools` job, which runs `bun run test`. The branch is
pushed. This Mac ran the suite on 26 October 2026 while the machine was loaded, and it reported
4,279 tests across 357 files, with 41 tests skipped. The command-line tool's script tests pass,
11 of 11.
