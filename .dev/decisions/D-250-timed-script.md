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
step with the names that are close, so a wrong name is easy to fix. The last dot separates the
object from its property, so an object's own name may hold dots.

`shot` holds once at each time that draws a shot or reads a dump. `test` does the same for a
`null3d.json` entry that gives `script` instead of `hold`, and each shot step becomes an image test
named `<test>-<state>`, with its own reference. A step that fails, such as a name that finds no
object, is recorded with the names that are close and fails the command.

## The pictures' state

A held frame's state comes from sketch time, not the wall clock. The engine sets each of hold
mode's frames from its step number at a fixed rate, and the sketch reads that time and the frame's
step, so a state that a script names is the same state on any machine and at any speed. A repeat run
of the whole script, minutes after the references were made, wrote byte-identical image files for
all three states. The references therefore show the state that their steps name, not whatever the
machine happened to be doing when the picture was taken.

## Consequences

- The CLI's `script.js` parses a script and checks every line. `runner.js` sets the page global for
  a hold, and `page.js` holds the program's types.
- The engine's `page/hold.ts` holds the program's types, and `sketch/runner.ts` performs it.
  `scene/scene.ts` gives the property reads and writes, and the closest names for a message.
- The docs page for the command describes the steps. The fixture project carries a script that
  drives three states, and an image test compares each state with its reference.
- M3-R15's input and frame-time recorder can feed this format later, so a recording from a phone
  becomes a script.
