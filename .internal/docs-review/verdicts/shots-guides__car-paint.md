# Shot and demo-link verdicts: guides/car-paint

## Shots

### car-paint-showroom: REJECT (swap the source)
- The reference file exists: tests/image/references/chrome-real-gpu/webgpu/demo-showroom.png.
- It does not help this page. The car is small at the right edge, dark and blurred by motion. No flake, seam or coat detail can be seen. A reader learns nothing about the paint from it.
- The alt text overstates the picture: it says "under softbox lights", but most of the frame is a dark studio with the tablet.
- Better source: tests/image/references/chrome-real-gpu/webgpu/demo-coat-and-sheen.png. It shows the candy red car large and centred, with the clear coat's reflections and the door line. The demo builds its car with this paint (examples/coat-and-sheen/car.ts calls the paint's create function).
- Alt for the swap: "A candy red car with a glossy clear coat on a turning plinth, in a rainy showroom."
- Note: every reference is 320 x 180. The website may want a larger capture of the same held frame (hold mode at 1 second).

### car-paint-flakes-close: REJECT (steps cannot run; a better reference exists)
- The steps say "set a close camera pose". The demo has no switch for a camera pose. The only address switches are the engine's own (hold, gpu, preset, view for debug views and so on). The camera helper in examples/lib/interact.ts moves only on a user gesture, and it states that in hold mode nothing moves the camera. So the steps cannot be scripted as written.
- The alt text puts the carbon weave on the door. In the demo the weave is on the trim, and the body paint has no weave (examples/coat-and-sheen/car.ts: the body paint has flakes and seams, the trim paint has only the weave).
- Existing references show each part close and clean, from the paint's own test page (tests/pages/sketches/car-paint-sketch.ts):
  - tests/image/references/chrome-real-gpu/webgpu/car-paint.png: a red body, glinting flakes near the highlight, and a dark panel seam.
  - tests/image/references/chrome-real-gpu/webgpu/car-paint-weave.png: the same body with the carbon weave, tows shining along their length.
  - tests/image/references/chrome-real-gpu/webgpu/car-paint-no-flakes.png: the same body without flakes, for a side-by-side with car-paint.png.
- Proposed replacement: two shots under "How the parts draw", sourced as references.
  - car-paint-flakes-seam, from car-paint.png. Alt: "A red rounded body with sparkling flakes near the highlight and a dark seam across it."
  - car-paint-weave, from car-paint-weave.png. Alt: "The same body with a carbon weave whose tows shine along their length."

## Demo links

### showroom/ (Related pages): KEEP
- The code exists in examples/demos.ts.
- examples/showroom/car.ts makes the body with this paint (flakes and seams) and the carbon trim with the weave. It also has spot and point lights, so the flakes glint (the page says area lights draw no glints, and the studio also uses area lights).
- The page already links it, at .../examples/showroom without the trailing slash. Both forms reach the same folder.

### coat-and-sheen/ (How the parts draw): KEEP
- The code exists in examples/demos.ts.
- Its sketch and car.ts say it in so many words: candy red paint with glinting flakes and door seams, and carbon fibre trim whose tows shine along their length, all from this paint. It shows all three parts.

## Concepts said to have no demo
- None were listed. Nothing to add.
