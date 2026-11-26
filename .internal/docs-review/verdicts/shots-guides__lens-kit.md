# Shot and demo-link verdicts: guides/lens-kit

All reference pictures under tests/image/references/chrome-real-gpu/ are 320 x 180 pixels. At that size the fine lens marks (grain, small fringes, the streak, the sharpening) are hard or impossible to see. This drives most of the corrections below.

## Shots

### post-effects-alley — keep, with corrections
- The reference file exists: tests/image/references/chrome-real-gpu/webgpu/demo-post-effects.png. It is the demo's default view (held at 4 s, so the warm grade is on).
- Problem 1: at 320 x 180 the kit's marks do not show. The demo sets fringes of 2 px, grain 0.05 and a streak, and none of them can be seen in the reference. The alt text says the picture shows fringes, a streak and grain, which is not true of this file.
- Problem 2: most of what the picture shows is bloom, screen-space reflections, the outline and depth of field, which the kit does not draw.
- Correction: capture the same view larger through the image test page:
  tests/pages/image.html?sketch=/examples/post-effects/sketch.ts&hold=4&gpu=webgpu&size=1280x720
  Use the full frame, or add a crop near the pink ring and the blue tube where the streak and fringes show.
  Alt: "A neon alley at night. The lens kit adds the vignette, a light sharpening, faint color fringes toward the edges, a sideways streak on the neon and film grain."

### lens-marks — keep, with corrections
- The four looks exist in the test sketch (aberration, streak, grain, speed) and the image tests lens-aberration, lens-streak, lens-grain and lens-speed-blur draw them at hold 0 on webgpu and webgl2. References exist for all four on webgpu.
- The steps are right in spirit but not runnable as written. The look goes inside the sketch address, and the page needs a size:
  tests/pages/image.html?sketch=/tests/pages/sketches/lens-kit-sketch.ts%3Flook%3Dstreak&hold=0&gpu=webgpu&size=1280x720 (and the same with aberration, grain and speed).
- At 320 x 180 the streak and the grain are nearly invisible (the tests use a tight threshold for this reason). Capture larger. Crop tight on the three bright bars at the top for the streak, and zoom a small patch for the grain.
- Add a fifth crop of the plain wall (the same address with no look in the sketch address) so the reader can compare.
- Alt: the fringes at 8 px cover the whole frame except the middle, so write "red and blue fringes that grow toward the edges" rather than "at the corners".

### lens-core-parts — drop
- References exist (lens-grade, lens-vignette, lens-sharpen, on every tier), and the steps are close to right (same address form as above).
- Why drop: these are the engine's own grading, vignette and sharpening. The page only says the kit writes them; their looks belong on the post-processing and color grading pages.
- The proposed place, "Use it with the engine's own settings", is about which call owns the settings. A picture of looks does not help there.
- The test grade is very strong (the whole wall turns blue). A reader could take it for what the kit's grade does.
- The sharpening does not show at the test's size, and does not show without a plain frame beside it.
- If the author still wants it: put it under the first paragraph of "How the parts draw", capture at 1280 x 720, add the plain wall, and caption the grade as a strong test grade.

## Demo links

### post-effects/ — keep
- The code exists in examples/demos.ts. The sketch calls createLensKit with vignette, sharpening, fringes, a streak from bloom level 3 and grain. It also changes the grade with lens.set every 3 seconds, so it shows set as well.
- The page already links it under "Related pages". The new link near "Use it" is fine. Say that the demo shows all marks except the speed blur.

### showcase/skyway/ — add
- Concept: the speed blur in a scene, and lens.set called every frame.
- The code exists in examples/demos.ts. The sketch makes the kit with sharpen 0.35, bloomLevel 2, aberration 0.8 and streak 0.45, which match the page's "Use it" example. Each frame it sets speedBlur from the camera's travel.
- Place it after the speed blur paragraph in "How the parts draw". Note that a held frame has no speed blur; it shows while the car flies.
- The demo also takes ?lens=off, which turns the marks off. That gives a before-and-after pair if the author wants one more picture.

## Concepts said to have no demo

- The speed blur in a scene: NOT confirmed. The skyway showcase (showcase/skyway/) drives the speed blur from the camera's speed.
- lens.effect being null on a device with no HDR target: confirmed. No demo or test page reads lens.effect, and no lens kit image test runs without HDR.
- Changing bloomLevel with set: confirmed. No demo changes bloomLevel. Changing other parts with set is shown: post-effects/ changes the grade and showcase/skyway/ changes the speed blur.

## Not for this page
- The comparisons (compare/battle/, compare/factory/, compare/night-town/) have a "lens" effect, but it is a separate shader in examples/lib/lens, not the kit. Do not link them from this page.
