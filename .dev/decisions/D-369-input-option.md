# D-369: An option that keeps the engine from listening for input

Status: built, and under the owner's study. The option `input: false` of `createEngine` is built and tested. The owner has asked for a deeper study of how the engine takes input before the design settles. The study weighs input that is off unless a page asks for it, input in an add-on, and no engine input at all. Task: none.

Summary: The option `input: false` starts the engine with no pointer, key, wheel, focus, visibility, pointer lock or gamepad listener and no pointer capture. The sketch's `ctx.input` then stays at rest, for a page whose input another library records. The owner's study of the engine's input may rework or drop it.

## Question

A game whose server replays its simulation records the player's input with a library of its own. null3D's page listens for input too, and a page cannot tell it not to. How does such a page keep null3D from listening?

## Rule

- With the option, the engine adds no input listener and captures no pointer. The sketch then reads nothing that the input log lacks.
- The option is small: it changes nothing else the engine does, and a page without it runs as before.

The owner asked for a small option that turns null3D's own input off, for games whose input another library records.

## Data

The page's input capture listens for itself. It takes pointer events on the canvas, with `setPointerCapture`, keys and blur on the window, and the gamepads once per display frame. Without the option, only hold mode and a replay turn it off. What it hears reaches only the sketch's `ctx.input`, never a game's simulation. A study of a vbz game measured clockwork2's input helper on the game's mount element. It still recorded a press that landed on null3D's canvas. So the option is not needed for input to reach the simulation. It makes "the sketch reads no input" a fact of the engine rather than a habit of the game. It also drops a second gamepad poll and the canvas's pointer capture.

`tests/image/input.spec.ts` measures the option in each thread mode, in Chromium on SwiftShader. With the option, a key press, a click, a drag, the wheel and a stand-in gamepad leave the sketch's input at rest. The engine adds none of its five canvas listeners, makes no pointer capture call and never reads the gamepads. A context menu event keeps its default. Without the option, the same page adds the listeners and captures the pointer, and the test checks that it sees them.

## Look

The option draws nothing: it has no look.

## Decision

The option `input: false` of `createEngine` starts the engine without its input capture. The engine adds no pointer, key, wheel, focus, visibility, pointer lock or gamepad listener. It captures no pointer on the canvas, and leaves the canvas's context menu to the browser. The sketch's `ctx.input` stays at rest, as in hold mode. Every key, button and action is up, and the pointer rests at the canvas's top-left corner. Objects get no pointer events. The default is `true`, so a page that sets nothing listens as before.

Options rejected:

- Input off by default, an add-on that holds input, or no engine input at all: each changes every page, and the owner's study weighs them.
- An option that also refuses `engine.requestPointerLock()`: the lock belongs to the page and the browser. A page whose input another library records locks the pointer through that library, which reads the movement.

## Consequences

- `packages/engine/src/page/engine.ts` reads the option where hold mode and a replay already turn input off.
- `tests/pages/input.ts` takes `?noInput`, and `tests/image/input.spec.ts` holds the option to its rule in every thread mode.
- `api/engine`, `api/input`, `guides/deterministic-simulation`, the develop skill's quick reference and recipes, and the porting skill's input table describe it.
- The option and all of its text sit in one change of their own. The owner's study can rework or drop it without touching the maths entry of [D-368](D-368-maths-entry-and-create-math.md).
