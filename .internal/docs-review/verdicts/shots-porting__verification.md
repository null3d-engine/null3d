# Verdicts: screenshots and demo links for porting/verification

## Shots

### test-diff: keep, with new steps

The picture helps. Step 4 of "Compare the port with image tests" tells the reader to open an image and its `-diff.png`. A picture of a result, its reference and the diff shows what to look for. The command does write `test-results/null3d/<environment>/<tier>/<name>-diff.png`, and the diff marks the differing pixels in red over a faded copy (`packages/cli/src/compare.js`, `packages/cli/src/test.js`).

The steps are wrong. A copy of the night town comparison cannot run under `bunx @null3d/cli test`. The comparison is three files that import the examples' own helpers and start a three.js worker. It has no `null3d.json`, and its image tests run in the repository's own test suite, not in the command. Also, `compare/night-town/` is not a page or a demo the command can open.

Corrected steps: make a project with `bunx @null3d/cli create`, using the product template. Add one test to `null3d.json`, for example `{ "name": "overview", "sketch": "sketch.ts", "hold": 0, "size": "800x450" }`. Run `bunx @null3d/cli test --update-references` once to write the reference. Change the color of one material in the sketch. Run `bunx @null3d/cli test` again. Put three files side by side: `tests/references/chrome-real-gpu/webgpu/overview.png`, `test-results/null3d/chrome-real-gpu/webgpu/overview.png` and `test-results/null3d/chrome-real-gpu/webgpu/overview-diff.png`. Source files: `packages/cli/src/test.js`, `packages/cli/src/compare.js`, `packages/cli/templates/product/`.

### inspector: drop

The `?inspect` panel exists (`packages/engine/src/debug/inspector.ts`, the `inspect` page switch). The picking demo names its pieces (Box, Sphere, Torus and so on), so the panel would show a readable tree. The steps also need one fix: on the examples page the address is `/?demo=picking&inspect` on the dev server.

But the picture does not help this page much. Step 5 is one sentence that links to the in-page inspector section of the Debugging guide. That page is where the picture belongs. Here it repeats that page and adds a large image to a short step about image tests.

### stats-overlay: drop

This page never mentions the stats overlay or `?stats`. The "Compare performance" section uses `bunx @null3d/cli bench` and `engine.measure(seconds)`. A picture of the overlay would show a tool the text does not name, and the reader would not know how it relates to the table of measures. Also, "expand the overlay" needs no click: `?stats=open` opens it at the start (`packages/engine/src/page/switches.ts`). If the page later describes the overlay, use `/?demo=instances&stats=open`.

## Demo links

- `compare/battle/`, "Timing both engines on one scene": the code exists in `examples/compare/comparisons.ts`, and the comparison does time both engines on one scene. Drop it only because it repeats the factory link for the same concept. The battle scene also loads model files and runs a long hold, which makes it a noisier example.
- `compare/factory/`, "Timing both engines on one scene": keep. The code exists. The comparison runs both engines on one scene description, with the same pixel ratio, 4x MSAA, a fixed preset and a fixed-step simulation (`examples/lib/compare.ts`). Its three.js half also counts only the frames that drew (`DrawnFrames` in `examples/lib/three-worker.ts`), as this page tells the reader to do.
- `compare/night-town/`, "Image parity of two engines": drop. The code exists, but the comparison does not check image parity. Each engine draws each effect its own way (CSM against cascades, a Reflector against the reflection pass, and so on). The image tests keep a separate reference for each engine (`compare-night-town-null3d.png` and `compare-night-town-threejs.png`). Nothing compares one engine's image with the other's. A reader would take a performance comparison for a parity check.
- `hold-mode/`, "Frames that repeat on every run": keep, but place it under "Compare the port with image tests", at step 2, where `hold` appears. The demo has no `code` value, so `hold-mode/` is the correct path. The demo shows null3D's held frame: the engine seeds `Math.random` and runs fixed steps up to the hold time. The section "Capture the three.js images" is about making the three.js app repeat its frames, and this demo does not show that.

## Concepts said to have no demo

- The capture helper: confirmed. No demo or comparison reads its canvas into an image (no `toDataURL` in examples).
- `bunx @null3d/cli bench`: confirmed. It is a command, and no demo runs it.
- Counting finished frames with fences: confirmed. The comparisons count frames that drew, and time the GPU with timestamp queries. None uses `fenceSync` or `onSubmittedWorkDone`. `compare/factory/` shows only the "frames that drew" half.
- Image parity of two engines (added): no demo shows it. The engine's own three.js parity checks are tests in `tests/image/`, not demos.
