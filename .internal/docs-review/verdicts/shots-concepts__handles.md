# Shot and demo-link verdicts: concepts/handles

## Shots

### devtools-stale-handle: drop
- No demo can produce this error. The objects demo (examples/objects/sketch.ts) never destroys an object. It only creates crates, turns them and changes their parent. Its objects are local to the sketch, so a reader cannot reach them from the console to cause the error. The steps field is empty, and no steps would work without editing the demo.
- The picture adds little. The error is one line of text. The error page (docs/errors/E1101.md, from packages/engine/src/errors/codes.ts) already shows its example message: `E1101: setPosition() was called on "Crate" (slot 7), which was destroyed in frame 120.` A code block with that line under "## Stale handles" says the same thing, can be searched, and never goes out of date.
- Replacement: no image. Put the example message as a text block under the existing code sample in "## Stale handles".

## Demo links

### objects/ (Wrapper objects and setters): keep
- The code exists: the objects demo has no code field, so "objects/" is right.
- The sketch makes each crate with scene.createMesh, keeps the returned wrapper, and calls setRotationEuler and setParent on it every frame. That shows wrapper objects and setters. It does not show a getter that writes into an output array; the math demo does that (camera.getPosition into a scratch array).

### math/ (Per-object data in your own arrays): keep
- The code exists: the math demo has no code field, so "math/" is right.
- The sketch keeps each drone's steering weight in its own Float32Array, one entry per drone, and other per-drone values in arrays made once. It writes the engine's instance batch rows (positions, rotations) by row index, with scratch vectors made once. That is the pattern the section describes, with instance batches indexed by row.
- Minor: part of its per-drone data is an array of plain objects, not typed arrays, and one line in the loop builds a small array. The link still fits.

## Concepts said to have no demo

- The handle's bit layout: confirmed. It is not visible in any demo; the page's diagram and table cover it.
- Slot reuse: confirmed. No feature demo destroys an object and then makes a new one. The island showcase destroys and replaces its traffic once the models load, and the multiple-views demo destroys views, but neither shows a freed slot being taken by a new object.
