# Verdicts: concepts/large-worlds (slice concepts-1)

## Shots

### large-world: KEEP

- The reference exists for all three tiers: tests/image/references/chrome-real-gpu/{webgpu,compat,webgl2}/demo-large-world.png. The manifest makes `demo-<name>` from every demo, so this is the demo's default view.
- The picture matches the description: a road at golden hour with dashed lane marks, trees and hazy hills.
- Weak points: the reference is only 320 x 180 pixels, so the "sharp 15 cm lane marks" are a few pixels wide. And a still road looks the same at any distance, so the caption must carry the point (6,378 km from the origin, in large-world mode). If the website wants a larger image, capture the same default view of the demo at full size.

### jitter-compare: REJECT as written

- The test page exists: tests/pages/jitter.ts with tests/pages/sketches/jitter-sketch.ts (figures in tests/pages/lib/jitter.ts). cells.rs is not its source.
- The steps cannot run as written:
  - The page always starts the engine with `largeWorld: true`. There is no switch to turn the mode off. The "jitter" flights in the test are the "cells-off" flights (`?cellsFull`, every grid cell taken), not flights without large-world mode.
  - With `?images` the page saves only the first and last frames of each flight (steps 0 and 15), not frames 0 and 1.
  - The page draws no marks of movement. An overlay would need new code.
- The picture would not help much: white squares on black, and the jump is at most 7.8 pixels in a 480-pixel frame. Jitter is motion; a still frame does not show it. The page already gives the numbers (3.5 and 7.8 pixels).
- If a picture is still wanted, a better source is a small chart of each square's frame-to-frame movement, from the figures that the jitter page publishes (flights "6378km" and "6378km-cells-off"), compared with the flight at the origin. Its caption must say "with no free cell", since that is what the test runs.
- Side note for the text review: the page (line 99) says "without large-world mode, or with no free cell, jitters". The test measures only the "no free cell" case.

## Demo links

### large-world/: KEEP

- `large-world` is in examples/demos.ts with no `code` value, so `large-world/` is the right form. It has `largeWorld: true`.
- Its sketch shows both concepts: every position sits at the Earth's radius in large-world mode, and each stretch of road makes its lane marks, trees and hills with `createInstances(..., { origin })`.
- The page already links it under "Related pages" (line 126). Put the link in the section and drop or keep the duplicate as the page style says.

### far-from-origin/: KEEP

- `far-from-origin` is in examples/demos.ts with no `code` value, so `far-from-origin/` is right.
- It runs without large-world mode (no `largeWorld` flag). A group sits at the center of a grid cell 1,000 km out, and 2 cm keys and a wheel are its children. Grid cells and children sharing their root's cell keep them precise. This is the "Grid cells" concept.
- Its reference (demo-far-from-origin.png, all three tiers) shows the key tray and wheel and could go under "## Grid cells" as a second image. Its distance label is not in the reference.

## Concepts said to have no demo

- Floating-origin geometry: CONFIRMED. Both far demos build only centered built-in shapes and place them with positions and batch origins. That follows the rule, but no demo builds its own vertices far out or shows the wrong way.
- Depth far from the camera: CONFIRMED. Reversed depth is always on, so every demo uses it. large-world draws hills up to 900 m away with a near plane of 0.1 m, but nothing compares depth modes or shows close far surfaces.
- The cell limit: CONFIRMED. Only the jitter test page fills every cell (`?cellsFull`). No demo does.
