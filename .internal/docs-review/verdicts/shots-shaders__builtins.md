# Verdicts: shaders/builtins (screenshots and demo links)

## Shots

### builtins: keep, with a corrected source and alt text
- The source is wrong. It says "scripted", but the image already exists as a reference:
  tests/image/references/chrome-real-gpu/webgpu/custom-builtins.png (480 x 270, also in compat/ and webgl2/).
  The test sketch is tests/pages/sketches/custom-builtins-sketch.ts, held at 1.5 s (tests/image/manifest.ts).
- The picture is not the output of the page's opening example. The test shader takes a hue from
  object.position, a checker from input.worldPosition, and fades by worldPosition - camera.position.
  The page example fades by relativePosition and has no hue or checker. It also has a screen band
  (frame.resolution) and a waving strip (vertex offset by frame.time).
- The alt text claims movement. A still image cannot show that the stripes move.
- Fix: do not say it shows the opening example. Caption it as one material that reads frame, camera
  and object values. Alt text: "Five spheres share one material. Each takes its own hue from its
  position and has stripes and a world-space checker. A far plane of the same material is darker."

### object-values: keep
- The reference tests/image/references/chrome-real-gpu/webgpu/demo-shader-inputs.png exists and shows the
  default view: crystals teal at the middle to amber at the rim (color by input.instance), and the
  middle stone with lit amber bands (object.id equals the picked uniform).
- The alt text matches the image. The image is small (320 x 180), so the website may want a larger capture.

## Demo links

- shader-inputs/ for instance, object.worldMatrix, object.id: keep. The code exists in examples/demos.ts.
  The sketch reads input.instance, object.worldMatrix and object.id, and uses the same picked-uniform
  pattern as the page's example.
- far-from-origin/ for "Positions relative to the camera": keep. The demo has no code field, so
  "far-from-origin/" is right. It shows the engine drawing relative to the camera at 1,000 km. It uses
  no custom shader, so it does not show relativePosition against worldPosition. Word the link as the
  engine-side effect.
- Addition: rain/ beside the full-shader sentence in the opening section. The rain demo (no code field,
  so "rain/") is a full shader that imports camera, fill_builtins and frame from null3d::builtins and
  reads frame.time, camera.view and camera.viewProjection.

## Concepts without a demo

- frame.lastFrame in the motion pass: confirmed. No demo reads it. Only a test sketch does
  (tests/pages/sketches/compute-vertex-offset-sketch.ts).
- The cost of each input: confirmed. It is a build-time cost and no demo shows it.
