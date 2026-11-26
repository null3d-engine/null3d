# Shot and demo-link verdicts: api/objects

## Shots

### objects-turntable: KEEP (with a caption fix)
- The source is correct. `tests/image/references/chrome-real-gpu/webgpu/demo-objects.png` exists. It is the default held view of the objects demo, held at 2.5 s.
- Limit: a still image cannot show `keepWorld`. At 2.5 s, three crates have already stepped off onto the stage, but the picture cannot show that. The caption must say that the demo moves the crates. It must not say that the picture shows the parent change.
- Suggested alt text: "Six crates in six materials on a turntable on a dark studio stage".

### objects-one-material: REJECT for this page
- The file exists, and the image test `demo-objects-one-material` uses the `?look=one` setting. But the Look button sets `scene.overrideMaterial`. It does not call `setMaterial` (examples/objects/sketch.ts lines 101 and 103). Under "Mesh calls", next to `setMaterial`, the picture would mislead the reader: it shows a scene-wide override, not a material change on one mesh.
- Better place: docs/api/scene.md, at the `scene.overrideMaterial` paragraph (line 563), next to the objects-turntable picture or the demo link.

### layers: KEEP (alt text is wrong)
- The source is correct. `tests/image/references/chrome-real-gpu/webgpu/demo-layers.png` exists, and so do the compat and webgl2 copies.
- The image is held at 5 s. The camera changes its layers every 2 s, so this frame shows the third view, street and pins without roofs (examples/layers/sketch.ts lines 22, 24 and 131). The picture has no roofs: the rooms show, with a red pin above each house. The proposed alt text says that the image has roofs.
- Corrected alt text: "Brick cottages drawn without their roof layer, so the rooms inside show, with a red map pin above each house". A suggested caption: "The camera's mask leaves out the roof layer and draws the pin layer."

## Demo links

- Parents and keepWorld, `objects/`: REJECT as a duplicate. The code is right (the demo has no `code` field, so its link is `objects/`), and the sketch calls `setParent(..., { keepWorld: true })`. But the "Parents" section already links to this demo, and stats.json lists it among the page's example links.
- Layers, `layers/`: KEEP. The code exists, and the demo puts the roofs and pins on their own layers with the `layers` option and changes the camera's mask with `setLayers`.
- Pointer events, `picking/`: KEEP. The code exists, and the sketch calls `on('pointerenter')`, `on('pointerleave')` and `on('click')` on each piece (lines 125 to 127).
- setLevelBias on a hero object, `forest/`: KEEP. The code exists. examples/forest/woods.ts gives the hero fir `setLevelBias(0.25)`, and the B key switches it between 0.25 and 1. The link text should name the hero fir and the B key, because most of the demo is about levels of detail in general.

## Concepts said to have no demo

- setOccluder: CONFIRMED. No demo or comparison calls `setOccluder` or sets the `occluder` option.
- setDrawRange on one mesh: NOT CONFIRMED. The impostors demo (`impostors/`) calls `setDrawRange` on single meshes: `scene.createMesh({ mesh, material: wood }).setDrawRange(...)` makes one merged mesh per grid cell for the middle band (examples/impostors/sketch.ts line 81). The forest demo also gives its understory batch a draw range (examples/forest/planting.ts line 85), but that is an instance batch, not one mesh.
- Parent loops: CONFIRMED. No demo makes a parent loop. A loop is an error case, so a demo of it would not help.
