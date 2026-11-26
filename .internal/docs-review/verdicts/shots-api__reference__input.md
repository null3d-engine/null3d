# Verdicts: api/reference/input (screenshots and demo links)

Generated page. Links go into the TSDoc of the exports in
packages/engine/src/sketch/input.ts (`Input`) and packages/engine/src/scene/pointer-events.ts (`ObjectPointerEvent`).

## Shots

None proposed. Agreed: an API reference page needs no picture. The topic page (docs/input.md) is the place for one.

## Demo links

- KEEP `input/` at "## `Input`" (Input and actions).
  The demo entry has no `code` field, so `input/` (its name) is right. examples/input/sketch.ts calls
  `input.actions.define` with keyboard and gamepad names, then `input.value` and `input.wasPressed`.
  It shows actions directly. It does not use the pointer or touch members.
- KEEP `picking/` at "## `ObjectPointerEvent`" (object pointer events).
  The code `picking/` exists. examples/picking/sketch.ts registers `pointerenter`, `pointerleave` and `click`
  with `object.on` and reads `event.point`. Its wall display (picking/screen.ts, through addons/screens)
  reads `event.hasUv` and `event.uv`. So the demo shows most of this interface.

## Concepts without a demo

- InputTouch: CONFIRMED, no demo shows it. No demo sketch reads a finger's `id`, `x`, `y`, `dx` or `dy`.
  walk-and-fly/sketch.ts only counts `input.touches.length` to hand over the camera.
  The shared helper examples/lib/cinematic.ts reads two fingers for a pinch, but it is not a demo and has no code value.
