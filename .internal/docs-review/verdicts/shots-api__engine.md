# Shot and demo-link verdicts: api/engine

## Shots

### transparent-canvas: keep, with a new source (scripted)
- The picture helps: it shows what "the page shows through" means under "A transparent canvas".
- The source is wrong. The reference image (tests/image/references/chrome-real-gpu/webgpu/demo-depth-only.png) is the canvas alone, 320 x 180, with alpha. The image test captures the engine's frame only, so the embedded page behind the canvas is not in it. The panes and pylons float on empty pixels. It does not match the alt text ("over an embedded web page").
- The page behind the canvas is a DOM layer that the demo runner adds for a demo with `backdrop: true` (examples/lib/run.ts, createBackdrop; the page label comes from the sketch's `page.post('label', ...)`). Only a screenshot of the browser page holds both layers.
- Corrected source (scripted): open the examples page at `?demo=depth-only`. Wait for the first frame (the loading overlay goes away). Screenshot the canvas's container element, not the canvas, so the ruled page backdrop and the "DEPTH ONLY" page label show under the glass. Default camera, no input. Save as docs/images/api/engine/transparent-canvas.webp.

### devtools-console-failure: drop
- A picture of a console line adds nothing that a short text block cannot hold. Text can be read, searched and copied. The page's first code sample already shows the handler that prints `error.code` and `error.message`.
- The "shows" text is wrong: an `onFailure` handler logs only what the page's own handler prints. The engine itself logs a failure only when no handler heard it.
- No steps are given, and no ordinary page makes a failure after the start on demand. `simulateGpuLoss()` recovers, so it logs no failure.
- If the page needs it, use a code block with a sample console line instead.

### devtools-memory-wasm: drop
- The point of "Memory" is the address space that the browser reserves for the memory's maximum. Chrome's Memory panel (a heap snapshot) shows the size of the memory's buffer now, not the reserved maximum. The picture would suggest the wrong thing.
- No steps are given, and the panel's view changes between Chrome versions. The section's numbers (bytes per instance row, engines per iPad) say more than a picture can.

## Demo links

### Transparent canvas -> depth-only: keep
- The demo exists (examples/demos.ts, name `depth-only`, no code value), so the link is https://github.com/null3d-engine/null3d/tree/main/examples/depth-only/ (trailing slash, per the contract).
- The demo shows a see-through canvas over a page: it sets no background, and `backdrop: true` makes the runner start it with `transparent: true`.
- Note for the link text: the `transparent` option is set by the shared demo runner (examples/lib/run.ts), not in the demo's folder. The sketch shows the other half: no `setBackground`, so the page shows through.

### Large worlds -> large-world: keep
- The demo exists (name `large-world`, no code value), so the link is .../examples/large-world/.
- It runs with `largeWorld: true` (demos.ts) and its sketch places a road 6,378 km from the origin. Same note: the runner passes the option.

### input: false with a page part -> replay/: keep
- The demo exists with code `replay/`. It has `pagePart: true`, so the runner starts it with `input: false`. Its page.ts takes the keys, mouse and pointer lock itself, which is exactly the "Input off" row.

## Concepts said to have no demo

- start stages and onProgress: confirmed. Only the shared demo runner (examples/lib/run.ts) uses `onProgress`; no demo's folder does, and the runner is not a demo link target.
- the preset check: confirmed. No demo uses `presetCheck` or `presetChecked`.
- screenshots with capture(): confirmed. No demo calls `capture()`; only the comparison helper in examples/lib calls `captureFrame()`.
- add-on version checks: confirmed. The example add-ons (examples/addons/) call neither `checkAddonVersion` nor `checkPluginInterface`.
