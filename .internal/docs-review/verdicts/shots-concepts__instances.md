# Verdicts: concepts/instances (screenshots and demo links)

## Shots

### instances (reference) - KEEP
- Source is right: tests/image/references/chrome-real-gpu/webgpu/demo-instances.png exists. The manifest makes `demo-instances` from the demo list (default view, hold 2 s).
- The picture shows the column field at golden hour, the lamp and the wave, so it helps the opening paragraphs.
- Fix the alt text. The picture also shows the hover cars as lights in the sky. Suggested alt: "A field of about 100,000 columns in one instance batch at golden hour, with hover cars streaming above it."
- The reference is only 320 x 180 pixels. It is usable, but small for a page picture.

### per-row-colors (scripted) - KEEP, CHANGE SOURCE
- The scripted steps cannot run as written. The image test page loads a sketch file by its path. The page's code block is not a file, and no tool runs a docs code block as a sketch.
- A reference already shows this concept: tests/image/references/chrome-real-gpu/webgpu/row-colors.png (manifest entry `row-colors`, sketch tests/pages/sketches/row-colors-sketch.ts, 480 x 270).
- It shows five lines of eight rows, each row in its own color: lit boxes, unlit spheres, boxes with a striped map, masked boxes and blended boxes. A gray box without colors ends each line. This also shows two claims of the section: the color multiplies the material's color, and the material's own color shows on rows without colors.
- Suggested alt: "Five instance batches of eight rows each, every row in its own color, beside one gray row of the same material without colors."

## Demo links

- instances/ (Create a batch) - KEEP. The code exists. The setup writes every row's place in a loop, and onUpdate writes heights and scales each frame. The page already links this demo in "Related pages". Move that link up rather than add a second link to the same demo.
- math/ (The row arrays) - KEEP. The demo has no code value, so math/ is right. Each frame it writes quaternions from the quat helpers into the rotation arrays of four dynamic batches, with scratch quaternions made once. This matches the quaternion example.
- splats/ (Rows that arrive in chunks) - KEEP, with a note. The demo's own code only calls the splats add-on. The chunk writer calls (createChunkRows, reserve, pack) are in packages/splats/src/system.ts. The link text must say that the add-on uses the chunk writer, so a reader does not search the demo for it.
- sprites-lines/ (Related pages) - KEEP. A sprite batch of 2,000 sparks; each frame the sketch writes positions, sizes and colors into its rows.
- galaxy/ (Related pages) - KEEP. A points batch of 120,000 stars with their own colors, and setActiveCount follows the quality preset.

## Concepts said to have no demo

- Pools and setActiveCount - NOT CONFIRMED. instances/ sets the active count from the quality preset, and orders rows from the middle out so the first rows fill the middle. galaxy/ and weighted-transparency/ also call setActiveCount. No demo shows the fire-and-remove pool of the page's example.
- Static batches and markDirty - NOT CONFIRMED. terrain/ writes boulders into a static batch and calls markDirty() once. shader-inputs/ does the same for its crystal spiral.
- Automatic batching - NOT CONFIRMED. The factory comparison (compare/factory/) builds each robot arm from separate createMesh objects, and its scene graph route says null3D draws parts that share a mesh and a material together.
- Per-row values - NOT CONFIRMED. instances/ draws its hover cars with the traffic-lanes add-on: its batches use values: true, and examples/addons/traffic-lanes/vehicle.wgsl reads object.values to move each car in the vertex shader. compare/night-town/ also uses values. For the subsection on a row's place, shader-inputs/ reads input.instance and object.id.
