# Shot and demo-link verdicts: concepts/particle-buffer

## Shots

### particles-campfire: keep
- The source is right. `tests/image/references/chrome-real-gpu/webgpu/demo-particles.png` exists and shows the campfire glade demo's default view, with flames, embers and lit trees.
- It helps under the opening text: it shows what one buffer system looks like in a real scene.
- The alt text fits the picture. The demo's code is `particles/`.
- Caveat: the reference file is 320 x 180 pixels. Upscale it or render it again for the website.

### particles-wind-field: keep, with a corrected source
- The source type is wrong. The image already exists, so this is a "reference" shot, not a "scripted" one: `tests/image/references/chrome-real-gpu/webgpu/particles-wind.png`. It comes from the manifest entry `particles-wind` (the sketch `tests/pages/sketches/particles-sketch.ts?wind=on`). It is a test page, not a demo.
- On its own, the picture does not show the field's effect. The fountain, the smoke and the leaves fill the frame, and the dust row is small orange specks. Show it beside `webgpu/particles.png`, which is the same scene with the field off. Give it a caption that points at the row of dust carried to the right.
- Change the alt text to name the dust row, for example: "A row of dust carried sideways across the floor by the wind field".
- The source files should name the test sketch, plus the add-on's `windField` option in `packages/particles/src/system.ts`, which calls `setWind`.
- Same caveat: the file is 320 x 180 pixels.

## Demo links

### particles/ for "The core's emitter, through the particles add-on": keep
- The code `particles/` exists in examples/demos.ts.
- The demo builds every effect with `createParticles`. The add-on's system (`packages/particles/src/system.ts`) calls `configureEmitter` and `emitFrame` on its buffer, so the demo runs the core's emitter.

## Concepts said to have no demo

- Writing records by hand from sketch code: confirmed. No demo calls `createParticleBuffer` or `write` directly. Only the test page `tests/pages/sketches/particle-writes-sketch.ts` does.
- `writeRecords` and `shiftRecords`: confirmed. No demo uses them.
- The time base move: confirmed. The emitter moves the base only after 1,024 seconds, and no demo shows it.
- Soft particles: NOT confirmed. The `particles/` demo sets `softness: 0.25` on the campfire flames (examples/particles/sketch.ts), so the flames meet the ground softly. Link `particles/` from the soft-particle limit.
