# Shots and demo links: concepts/shadows

All images named below are under `tests/image/references/chrome-real-gpu/`. The shadow test images (shadows, shadows-cascades-N, shadows-filter-5, spot-shadows, point-shadows, contact-shadows, contact-shadows-off) exist only in the `webgpu` folder, because their tests draw the same picture on every tier.

## Shots

### cascades-debug-view: REJECT
The `'shadows'` debug view does not color the cascades. It draws each surface's light as a gray: black in full shadow, white in full light (see the `view` comment in `packages/engine/src/debug/debug.ts`). `webgpu/debug-view-shadows.png` is a black and white picture of a small test scene. No debug view colors cascades, so the picture cannot show where the cascades split. Do not use it under "Where the cascades split".

### cascade-count: KEEP, with a crop
The files exist: `webgpu/shadows-cascades-1.png`, `-2.png`, `-4.png` (480 x 270). They are existing reference images, so the source is "reference", not "scripted". The full frames differ in only about 1,170 of 129,600 pixels, so at page width the three frames look the same. Crop every frame to the same box, x 80 to 320 and y 70 to 260 (the sphere and the near boxes). In that crop, the one-cascade shadow of the sphere is clearly coarser and stepped, and two and four cascades are sharp.

### filter-3-and-5: REJECT
`webgpu/shadows.png` uses the 3 x 3 filter and `webgpu/shadows-filter-5.png` the 5 x 5 filter. Only 23 pixels differ by more than a small amount. A 3x enlarged crop of the sphere's shadow still shows almost no difference. A reader would see two equal pictures. The shadows test sketch has no switch for a smaller map, which would make the difference show, so no existing test or demo gives a useful picture.

### contact-shadows: KEEP, with a corrected source
The proposal pairs the stone garden demo's default view with the `contact-shadows-off` test image. These are two different scenes: the demo is a dark stone garden (320 x 180), and the test is pebbles, a tyre, a pole and a crate on sand. A side-by-side pair of different scenes does not show what contact shadows add. Also, the demo's view is too small and dark to show the contact lines.
Use the test pair instead: `webgpu/contact-shadows.png` and `webgpu/contact-shadows-off.png` (same scene, same camera). Crop both to x 110 to 400, y 110 to 200 (the pebbles and the crate's base) and enlarge 2x. The dark lines under the pebbles then show clearly on one side and are missing on the other. The alt text fits this pair.

### hero-shadow: KEEP
`webgpu/demo-hero-shadow.png` exists (640 x 360) and shows the car's sharp shadow beside the stone blocks' cascade shadows. The demo draws its default frame with the hero shadow on. Option: the demo turns the hero shadow off in the second half of every 3-second cycle, and its sun and camera stay still without input, so a second capture at about 4 seconds would give an on/off pair of the same view.

### spot-point-shadows: KEEP, as a reference shot
Both files exist and show clear shadows: `webgpu/spot-shadows.png` (two spot lights, sharp shadows of boxes, a sphere and a pole) and `webgpu/point-shadows.png` (one point light, shadows on the ground and a wall on every side). They are existing reference images, so the source is "reference", not "scripted".

### cascade-camera-debug: REJECT
Three problems:
1. The `'shadows'` debug view with `debug.shadowCamera` draws no cascade boxes. It draws the light and shadow grays from the still camera, with the cascades placed from the other camera.
2. The point of `debug.shadowCamera` is to watch edges crawl while a camera moves. A still picture shows no movement.
3. The stone garden demo has no second camera and no switch that sets `debug.shadowCamera`, so the steps cannot run without new code.

## Demo links

- Contact shadows, `contact-shadows/`: KEEP. The code exists in demos.ts. The demo is about contact shadows and turns them off and on every 3 seconds.
- Hero shadow, `hero-shadow/`: KEEP. The code exists. The demo turns the car's hero shadow off and on every 3 seconds.
- Spot light shadows, `spot-cookies/`: KEEP. The code exists. The rose-window spot light has `castShadows: true`, and in the default view the spheres and plinths cut dark shadows into the projected window. The demo's subject is cookies, so the link text should say that it shows a spot light whose picture is shadowed by the objects in its beam.
- Levels of detail in shadow passes, `forest/`: KEEP. The code exists. The sun casts shadows, the trees cast them, and the sketch says the shadow passes draw a coarser level than the camera. The L key draws every tree at full detail, so a reader can compare the frame stats.

## Concepts said to have no demo

- Point light shadows: confirmed. Several demos have a point light with `castShadows: true` (math, particles, weighted-transparency, look-at), but in none of their default views is a point light's shadow clear enough to show the concept. The `point-shadows` test image is the best picture.
- Flat casters: confirmed. No demo shows slab self-shadowing or its fix.
- followMovingCasters and far cascade intervals: confirmed. The terrain demo has a `?follow=off` address switch, but its effect is fewer shadow passes and a short trail, which no still default view shows. The creek showcase sets the far cascade interval only for a measurement probe.
- Cascade blending: confirmed. No demo shows it. The `shadows-seam` test image shows a seam with no line, which a reader cannot tell from an unblended frame without a pair.
