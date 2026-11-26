# Verdicts: api/reference/engine (screenshots and demo links)

Shots: none were proposed. Nothing to check.

## Demo links

1. hold option -> `hold-mode/` (at `## EngineOptions`). KEEP.
   The demo "Repeatable frames" exists (name hold-mode, no code value, so `hold-mode/` is the right form).
   Its sketch's opening comment explains hold mode: with `?hold=3` the engine seeds Math.random and steps
   in 1/60 s frames, so the held frame is the same on every run. That matches the `hold` row, which also
   names the `?hold=<seconds>` switch. Note: the demo turns hold mode on with the page switch, not with the
   `hold` option itself; the link text should say "hold mode", not "the `hold` option".

2. largeWorld option -> `large-world/` (at `## EngineOptions`). KEEP.
   The demo "Large worlds" exists (name large-world, no code value). Its entry sets `largeWorld: true`,
   which the demo runner passes to the engine. The sketch draws a road 6,378 km from the origin and its
   comment says large-world mode keeps 0.03 mm precision there, the same figures the option row gives.
   Note: the option is set in the demo list and runner, not in the sketch file the link opens.

3. transparent canvas -> `depth-only/` (at `## EngineOptions`). KEEP, with a caveat.
   The demo "Depth-only holdout" exists (name depth-only, no code value). It is the only demo with
   `backdrop: true`, and the runner starts the engine with `transparent` set from that flag. The sketch
   sets no background, so the page shows through. It is the only demo that shows a see-through canvas.
   Caveat: the demo's main point is a depth-only plane (colorWrite off), not the canvas option, and
   `transparent: true` appears in the runner, not in the sketch. Link text should say "a see-through
   canvas over a page, with a depth-only plane".

## Concepts said to have no demo

- registerVideo: CONFIRMED. No demo or comparison calls registerVideo or textures.fromVideo. The
  canvas-screen demo uses a canvas texture, not a video. Only a test page uses video.
- saveRecording: CONFIRMED. No demo calls it or uses the `?record` switch. The `replay/` demo records
  its own input in page code with a seed; it does not use the engine's recording file.
- simulateGpuLoss: CONFIRMED. Only a test page calls it.
- capture: CONFIRMED. No demo calls engine.capture. The comparison helper calls captureFrame for held
  runs, which is test plumbing, not a demo of capture.

## Extra (not proposed)

The `replay/` demo starts the engine with `input: false` (its page module takes the keys, the mouse
and the pointer lock itself). It is a good demo link for the `input` option row in `## EngineOptions`.
