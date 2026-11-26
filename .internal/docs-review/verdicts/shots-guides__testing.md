# Shot and demo-link verdicts: guides/testing

## Shots

### hold-mode-frame: keep
- Reference image `tests/image/references/chrome-real-gpu/webgpu/demo-hold-mode.png` exists (also under compat and webgl2). It shows glossy balls in a stone pen, as the proposal says.
- The demo entry has `hold: 3`, and the sketch seeds `Math.random` and moves the balls in fixed steps, so the reference is the held frame.
- The image is only 320 x 180. It is still useful, because it is the real image-test reference: it shows the reader what a held frame and a reference image look like.

### stats-open: keep, steps corrected
- The overlay really has the parts the page names: the `Frame work` section with the `Sketch`, `Drawing` and `GPU` lanes, and the `GPU textures` and `GPU buffers` memory rows (packages/engine/src/debug/overlay-look.ts).
- `?stats=open` opens the overlay and overrides the demo runner's collapsed default (packages/engine/src/page/switches.ts).
- "Open instances/" is not a real address. The demo page picks a demo with `?demo=<name>` (examples/index.ts), and the engine reads its switches from that same page address.
- Corrected steps: open the examples page at `?demo=instances&gpu=webgpu&stats=open` on a dev server, let it play live for 5 s, and capture the canvas with the open overlay at the top right.

### save-recording: keep, source corrected
- The engine shows the **Save recording** button at the bottom left of any page opened with `?record` and no hold (packages/engine/src/page/engine.ts, page/record-button.ts).
- The replay demo is the wrong page for it. It starts the engine with `input: false` (examples/lib/run.ts, because of `pagePart`) and records the input with its own code. So an engine recording of it holds no input. Its own **Replay** and **Restart** buttons also sit along the bottom of the canvas. The shot would show two kinds of replay on one page.
- Corrected source: the hold mode demo, which reads engine input (the pointer moves a paddle) and has no buttons of its own. Steps: open the examples page at `?demo=hold-mode&record`, wait for the first frame, and capture the page with the button at the bottom left.

## Demo links

### hold-mode/ (Repeatable held frames): drop
- The demo exists (name `hold-mode`, no `code`, so `hold-mode/`), and it shows the concept.
- The page already links it in the same section: "The hold mode demo drops 400 balls..." (stats.json lists it). A second link adds nothing. The only change worth making is to give the existing link the contract's trailing-slash form, `examples/hold-mode/`.

### replay/ (Recorded input that replays to the same picture): drop in this section, move
- The code `replay/` exists in examples/demos.ts.
- It does not show what "Record a session that went wrong" teaches. That section covers the engine's `?record`, the Save recording button, `?replay=<file>` and `shot --replay`. The demo turns the engine's input off. Its page logs its own input by fixed ticks and replays that log from the seed.
- It is a good fit for "Browser tests of a whole app". There it matches the rule "Step the logic in fixed ticks, seed every random number ... A recording then replays to the same hash".

## Concepts without a demo

- `bunx @null3d/cli shot --script`: confirmed. No demo uses a timed script.
- `null3d.json` image tests: confirmed. The demos are image-tested through the repository's own manifest, not through `null3d.json`.
- Playwright browser tests of a whole app: confirmed. No demo ships a Playwright suite. The replay demo (`replay/`) shows the fixed-tick, seeded, input-log pattern that the section asks for.
