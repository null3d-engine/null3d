# Shot and demo-link verdicts: concepts/render-layers

## Shots

### layers-cottages: keep, fix the alt text
- The source is right. tests/image/references/chrome-real-gpu/webgpu/demo-layers.png exists (also under compat/ and webgl2/), and it is the cottage street demo's default view.
- The alt text is wrong. The demo holds at 5 seconds of sketch time. The sketch changes the camera mask every 2 seconds through three masks, so at 5 seconds the camera draws the third mask: the street and the pins, with no roofs. The picture shows open rooms with furniture and a red pin above each house. It shows no roofs.
- Corrected alt: "The cottage street with the roof layer left out, so the rooms show, and a red map pin above each house".
- Suggested caption: the camera's mask leaves out the roof layer, so the roofs are not drawn.
- Note: the reference is 320 x 180 pixels. It is small for a page picture, but it reads clearly.

### layers-two-masks: keep, make the steps exact
- The steps are too vague. The demo has no switch for its mask. The mask follows sketch time only, so the shot must use hold mode with a fixed time in the page address.
- Mask by time: 0 to 2 s = street and roofs; 2 to 4 s = street, roofs and pins; 4 to 6 s = street and pins (the default view). Avoid the exact edges at 2 and 4 seconds.
- Corrected steps: open the layers demo with ?hold=1 and capture (street with roofs, no pins); open it with ?hold=3 and capture (same street with roofs and pins). Put the two pictures side by side.
- The picture helps under "Setting layers": it shows camera.setLayers change what one camera draws, with no other change to the scene.

## Demo links

### Camera layer masks -> layers/: keep
- The code exists in examples/demos.ts (name 'layers', sketch ./layers/sketch.ts).
- The sketch shows the concept directly: walls and furniture on layer 0, roofs on layer 1 as single meshes, pins on layer 2 as an instance batch, and a camera that calls setLayers to change its mask every 2 seconds. This matches the section, which sets layers on meshes and on a batch.
- The page already links the same demo under "Related pages". A link in the section is still useful, but the two link texts should agree.

## Concepts said to have no demo

### Layers and shadows (an object off the light's layers): confirmed, with one note
- No demo sets layers on a light. A search of examples/ for lights created with a layers option finds none.
- Note: the layers demo has this case without meaning to. Its roofs are on the roof layer and set to cast shadows, but the sun keeps the default mask, layer 0 only. By the rule on this page the roofs cast no sun shadow. The demo does not point this out, and the roofs hide the rooms from the camera, so a reader would not see the effect. It is not a demo of the concept. It may be worth a separate check: either the demo should give the sun the roof layer, or it should say why it does not.
