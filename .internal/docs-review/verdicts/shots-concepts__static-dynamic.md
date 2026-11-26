# Shot and demo-link verdicts: concepts/static-dynamic

## Shots

### instances-columns: KEEP, with changes
- The reference exists: tests/image/references/chrome-real-gpu/webgpu/demo-instances.png. It shows the field of columns at golden hour, the lamp and the car lights in the sky. That is the demo's default view.
- The demo's batch is dynamic (`dynamic: true` in examples/instances/sketch.ts). Put the picture beside the first code block (the dynamic batch) and say so in the caption, for example "One dynamic batch: the sketch writes every column's height in every frame." Do not let it suggest a static batch.
- The reference is only 320 x 180 pixels on every tier. That is a thumbnail and will look soft on the website. Better source: a scripted capture of the instances demo at full size with `?hold=2` (the demo's hold time).

### e1110-console: REJECT
- No demo or test page writes a static batch row without markDirty. The named source does not exist.
- The nearest page is the test sketch tests/pages/sketches/unmarked-write-sketch.ts. It writes a static mesh named "Crate", not a batch row, through internal arrays that no public call exposes.
- A picture of one line of console text helps less than the text itself, which readers can search and copy. Quote the message in a code block instead, from the example in packages/engine/src/errors/codes.ts: `E1110: the position of "Crate" (slot 7) changed without a setter.` The E1110 page already shows it.

## Demo links

### instances/ (Dynamic and static instance batches): KEEP, narrow the concept
- The code exists in examples/demos.ts. The sketch shows a dynamic batch only: it writes every row's height in every frame with no markDirty. Label the link as the dynamic-batch example, not "dynamic and static".

### terrain/ (markDirty on a static batch): KEEP
- The code exists. The sketch makes the boulders as a static batch, writes every row once at setup, then calls `boulders.markDirty()` (examples/terrain/sketch.ts, near line 130). That is the static-batch pattern.
- It marks the whole batch, not a range of rows, and the demo is mostly about terrain. Say "the boulders" in the link text so readers find the lines.
- A closer match for "marked now and then" is compare/night-town/ (examples/compare/night-town/sketch.ts, near line 697): static window batches whose rows change and are marked every 23 seconds. It is a long comparison sketch, so terrain stays the simpler link.

### hold-mode/ (Hold mode): REJECT
- The folder exists, and the demo has no code value, so "hold-mode/" is the right form.
- But the demo shows repeatable frames of bouncing balls. It never shows hold mode stopping at an unmarked write, which is the point of that sentence. Link the testing guide's hold mode section (guides/testing.md#hold-mode) instead. The stop-at-E1110 behavior is checked only by tests/image/hold.spec.ts with the unmarked-write test sketch, which is not a demo.

## Concepts said to have no demo

- Hidden groups that stop recomputing: CONFIRMED. Demos hide single meshes (the paddle in hold-mode, the dot in picking, weapon nodes in character). None hides a group with many moving children, and the saving would not show in a picture anyway.
- Grid cells kept in view by a static object: CONFIRMED. No null3D demo calls setFrustumCulled; the only hits are three.js comparison files. far-from-origin and large-world use grid cells but not this effect.
