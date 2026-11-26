# Shot and demo-link verdicts: api/quality

## Shots

### presets-side-by-side: keep (steps corrected)
The four presets of one scene help a reader see what `quality.preset` changes. The steps work: the demos page reads `?preset=` itself, and a development build reads `?hold=`. The creek demo's image test holds it at 0.5 s. Capture on the WebGPU path: on WebGL2 the GPU path caps Ultra to Medium, so two panels would match.
Corrected steps: open `examples/?demo=creek&preset=low&hold=0.5` in a development build on WebGPU. Repeat with medium, high and ultra, and join the four frames.

### render-scale: keep, as a reference shot
Both frames already exist as references, so no capture is needed. The `render-scale-100` test reuses the `scene` reference, and both pictures show the same boxes at the same 320 x 180 size.
Source: `tests/image/references/chrome-real-gpu/webgpu/scene.png` (scale 1) beside `tests/image/references/chrome-real-gpu/webgpu/render-scale-50.png` (scale 0.5).

### debug-overlay-governor: drop
The stats overlay does not show the governor's steps. Its heading shows only the GPU tier, the preset and the render scale (debug/overlay.ts). Its "GPU steps" are the GPU passes of a frame. "Slow the GPU" is no step that a demo or a switch can take: `?target-fps=` only lowers the target. `?tier=lowest` would show a scale of 0.33, but that is the lowest tier, not a governor step. The picture would mislead.

### devtools-performance: drop
A manual shot of the browser's developer tools fits the rule, but it does not show the section's point. The section explains `setBudget` and its rules, and a Performance panel shows no budgets. The instances demo registers no budget. A governor step cannot be staged on purpose, so the shot cannot be repeated.

## Demo links

### Counts that drop on phones -> instances/: keep, but move it
The code exists in demos.ts. The instances demo sets its column count from `quality.preset` and calls `quality.onChange` to fit it again, so it shows a sketch that lightens its own work. It does not use `setBudget`. Under "Budgets for the sketch's own systems", the link suggests that it does. Put it under "The frame-budget governor", beside the sparks example, which shows the same pattern. The galaxy demo does the same with its star count.

## Concepts said to have no demo

- setBudget: confirmed. No file under examples/ calls `setBudget`.
- Texture memory budget: confirmed. No demo reads `textureMemory` or sets `textureMemoryMiB`. Only the test page `tests/pages/texture-budget.html` shows it, and that is no demo.
- setPreset from a menu: wrong. The Creek, Island and Skyway showcase demos have a Quality menu in their on-screen panel. It calls `quality.setPreset` and shows presets above `quality.highest` as unavailable (examples/lib/showcase-effects.ts). Link https://github.com/null3d-engine/null3d/tree/main/examples/showcase/creek/ under "Switching presets".
