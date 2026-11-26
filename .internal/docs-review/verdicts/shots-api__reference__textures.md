# Shot and demo-link verdicts: api/reference/textures

This page is generated. Its text comes from the doc comments in packages/engine/src/scene/textures.ts (wrap type at line 68, fromPass at 540, fromCanvas at 586, fromVideo at 641). Any picture or demo link for it goes into those comments. No reference page has a demo link yet, so check that the generator keeps a Markdown image or link from a doc comment. If it does not, put the picture on the Textures guide (docs/api/textures.md, by the wrap row of the options table near line 61) instead.

## Shot: texture-wrap — KEEP, source corrected

- The picture helps. Wrap modes are visual, and three squares side by side explain them faster than the one sentence under `TextureWrap`.
- The proposed source is wrong. No test page draws "one quad per wrap mode" with coordinates from -1 to 2. One page would have to be written.
- An existing image test already draws this view: the `textures` test (tests/image/manifest.ts, sketch tests/pages/sketches/textures-sketch.ts). Its bottom row starts with three squares of one picture, with texture coordinates from -0.5 to 1.5, in the order repeat, clamp, mirror. It holds at time 0.
- Reference: tests/image/references/chrome-real-gpu/webgpu/textures.png (copies under compat/ and webgl2/). The frame is only 480 x 270, so each square is about 60 pixels wide. That is too small for the website.
- Better source: render the same sketch larger through the image test page, then crop the three left squares of the bottom row:
  tests/pages/image.html?sketch=/tests/pages/sketches/textures-sketch.ts&hold=0&size=1440x810&gpu=webgpu
  The page takes ?sketch=, ?hold= and ?size= (tests/pages/image.ts).
- The alt text is wrong on two points. The texture is a four-color quadrant picture, not a checker, and the order is repeat, clamp, mirror. New alt: "Three squares of one four-color picture drawn past its edges, with repeat, clamp and mirror wrap from left to right".

## Demo link: textures.fromCanvas → canvas-screen/ — KEEP

- The code exists in examples/demos.ts (name canvas-screen, code canvas-screen/).
- The demo really shows the concept. Its wall screens and console panel are OffscreenCanvas textures, each with its own refresh rate, and each uploads only the rectangle that changed.
- The fromCanvas call and the refresh call sit in the example screens add-on (examples/addons/screens/index.ts, lines 173 to 222), not in the demo's own folder. The demo's screens.ts sets refreshHz and calls the add-on. A reader who looks for the call in canvas-screen/ will not find it, so the link text should say that the screens add-on makes the texture.
- Placement under `CanvasTextureOptions` fits, because the demo sets refreshHz per panel. It fits the refresh row of `Texture` and `CanvasRect` as well.

## Demo link: textures.fromPass → security-camera/ — KEEP

- The code exists in examples/demos.ts (name security-camera, code security-camera/, title "Render to texture").
- The sketch calls textures.fromPass on the camera's scene pass (examples/security-camera/sketch.ts line 100) and shows it on the monitor. That is exactly this call.
- Place it on the fromPass row of `Textures`.

## Concepts said to have no demo

- textures.fromVideo: CONFIRMED, no demo. No example calls fromVideo or registerVideo. Only a test page uses it (tests/pages/video-texture.html), and test pages are not demos.
- Compressed formats: CONFIRMED, no demo shows it. The island showcase (showcase/island/) loads glTF models whose textures are KTX2, so it runs compressed textures. But the KTX2 data hides inside model files from another repository, and nothing in its code or its view shows a compressed format. The only clear view is the ktx2 image test, which is not a demo.
