# Verdict: api-1-substance-18

## The finding as given

- page: api/grass
- anchor: First code block (lines 33-65)
- category: missing-content
- severity: medium
- claim: The example defines a height function but draws no ground, so a newcomer sees blades over an empty background. The text says to call grass.fit and grass.setSwayDistance when the preset changes, but the example does not.
- evidence: docs/api/grass.md:33-65, 69, 100; packages/grass/src/sway.ts:7-10; packages/engine/src/sketch/quality.ts:287 (quality.onChange).
- proposedEdit: Add a ground mesh built from the same height function, and a quality.onChange handler that calls grass.fit(preset) and grass.setSwayDistance(swayDistanceFor(preset)).
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

The preset half holds.
- docs/api/grass.md:69 says `grass.fit(preset)` takes a new preset. Line 100 says to call `grass.setSwayDistance` when the preset changes. The example (lines 33-65) does neither.
- packages/grass/src/grass.ts:484-499 fits the starting preset once. Nothing in the add-on listens for later changes, so the page must do it.
- The preset can change without the page asking. packages/engine/src/sketch/quality.ts:8-9 says the engine's preset check can lower the preset, and packages/grass/src/sway.ts:8-10 names a governor step that lowers it.
- The repository's own demo does exactly the proposed handler: examples/contact-shadows/garden.ts:383-386 calls `quality.onChange(() => { grass.fit(quality.preset); grass.setSwayDistance(swayDistanceFor(quality.preset)); })`. So the code is correct and fits in four lines.

The ground half is a real gap, but the proposed fix is wrong for this example.
- The example sets no background and adds no ground. docs/api/scene.md:115 says the default background is black. 20,000 tufts on a 40 m square leave black gaps between the tufts.
- No engine call builds a mesh from a height function. `geometry.plane` is a flat rectangle (docs/api/geometry.md:42). The vegetation demo builds its ground from its own vertex helper (examples/vegetation-wind/sketch.ts:55-59). The terrain add-on is a separate package. A ground "built from the same height function" adds a vertex-grid loop or a second add-on to a first example. That makes the example longer and moves it off its subject.
- A flat plane under the current sine hill does not work either: the hill goes 0.4 m above and below zero, so blades would float or sink into the plane.

## Corrected claim

The example does not do what the page tells the reader to do when the preset changes, and the engine can change the preset by itself. Add the `quality.onChange` handler. The example also shows grass over a black background with no ground. Fix that with a flat ground, not a mesh built from the height function.

## Corrected edit

1. Add after `createGrass` (same as examples/contact-shadows/garden.ts:383-386):

```ts
  quality.onChange(() => {
    grass.fit(quality.preset);
    grass.setSwayDistance(swayDistanceFor(quality.preset));
  });
```

2. Make the ground flat and draw it with a plane, as the cookbook does (docs/cookbook/index.md:244-248). Take `geometry` and `materials` from `ctx`, change the height to `const height = () => 0;`, and add:

```ts
  scene.setBackground('#8fb3cf');
  scene.createMesh({
    mesh: geometry.plane({ width: 40, height: 40 }),
    material: materials.standard({ color: '#4f6b2a' }),
    rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    receiveShadows: true,
  });
```

   After the example, add one sentence that links to the vegetation demo (https://github.com/null3d-engine/null3d/tree/main/examples/vegetation-wind/), which grows grass on a rolling ground built from the same height function.
