# Verdicts: api/reference/raycast (shots and demo links)

## Shots

None proposed. Nothing to check.

## Demo links

### picking/ under "## `RaycastHit`": reject on this page

- The code exists: `picking` in examples/demos.ts has `code: 'picking/'`.
- The demo does not show `RaycastHit` or any scene query on this page. Its sketch says so in its own header: "object.on finds the piece with no raycast". It uses `object.on('pointerenter' | 'pointerleave' | 'click')` and reads `event.point`. The wall display (screens add-on) reads `event.hasUv` and `event.uv`. These are fields of the pointer event (packages/engine/src/scene/pointer-events.ts), not of `RaycastHit`.
- The engine casts one ray per pointer event inside, so the demo does show "a click finds the object under a ray, and the point it hit". That fits the concept page api/raycast.md, at the paragraph that says `object.on('click', handler)` casts the ray itself (line 106), or api/input.md under pointer events.
- This page is generated from doc comments. A link under `RaycastHit` would need a TSDoc edit on the `RaycastHit` interface. A reader who follows it finds no `RaycastHit`, no `scene.raycast` and no options, so the link misleads here.
- Recommendation: move the link to api/raycast.md near line 106, with text such as "The picking demo selects an object on click and marks the point the ray hit." Do not add it to the reference page.

## Concepts said to have no demo

- raycastBatch: confirmed. No file under examples/ calls `raycastBatch` or `raycastBatchFaces`.
- overlap queries: confirmed. No file under examples/ calls `overlapSphere` or `overlapBox`. The `overlap` function in examples/showcase/island/traffic.ts is a local helper for traffic cycles, not the engine query.
- Note: `scene.raycast` itself is called only by shared helpers (examples/lib/interact.ts, examples/lib/clearance.ts), not as the subject of a demo.
