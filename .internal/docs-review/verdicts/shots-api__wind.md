# Verdicts: api/wind shots and demo links

## Shots

### vegetation-wind: KEEP, fix the alt text
- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-vegetation-wind.png (also in compat and webgl2). It is the demo's default view: a grove of oaks, birches and firs at the edge of a grassy meadow under a blue dusk sky.
- It is the best picture for the intro: every plant in it reads the field.
- The alt text claims things the still picture does not show. Ferns are not visible at this size, and a still frame cannot show bending. Use: "A grove of oaks, birches and firs at the edge of a grassy meadow, all swaying in one wind field".
- The reference is only 320 x 180. That is small for a page picture. If the site needs a larger one, capture the demo live (`?demo=vegetation-wind&stats=off`) at 1280 x 720 after about 2 s.

### forest-sway: DROP
- The file exists (webgpu/demo-forest.png), but the picture does not help this section. It is a dark 320 x 180 frame of thousands of tiny conifers under a dusk sky. No sway can be seen, no bark material can be seen, and one tree cannot be told from the next.
- The alt text is wrong for the picture: rolling hills and broadleaf trees cannot be seen.
- The demo is about levels of detail, not wind. The intro picture already shows plants that read the field. Keep the forest demo as a link only (see below).

### wind-stats-row: DROP
- The page already quotes the exact overlay line as text in "Presets and the governor". A cropped picture of one text line repeats it, is harder to read than text, and its GPU time changes from machine to machine. Its alt text could only repeat the same line.
- The steps are also incomplete. The demo page shows the stats overlay collapsed to the frame rate. The capture must open it first: open `?demo=vegetation-wind&preset=medium` live (not held: a held frame never shows the overlay), click the overlay's header to open its card, wait a few seconds for the GPU times, then capture. The card also holds the grass add-on's row, so a crop must pick the wind row.

## Demo links

### vegetation-wind/ (Plants in the field): KEEP
- The code exists in examples/demos.ts. The sketch makes one field (`createWind`), steps it each frame and gives it to every plant's material, with sliders for strength and bearing and a Hold button.
- Note: the WGSL that copies the field's two blocks is in the shared plant material, examples/lib/sway.ts, which the sketch imports. The link lands on the sketch, not on that file. Word the link so readers know to follow the import (for example "its plants share one swaying material from the examples' library").

### forest/ (Trees that sway): KEEP, move it
- The code exists. The sketch makes the field (`box: 256`) and gives the trees the same shared sway material.
- Put the link in "Trees and plants sway" (the paragraph after the WGSL section), where the page already names `examples/forest` as plain text. Replace that path with the link. Under the WGSL heading it only repeats the first link.

### light-shafts/ (Wind beside lit fog): DROP
- The code exists and the pines do sway (examples/light-shafts/wood.ts), but through the same shared material as the two demos above. The demo is about volumetric fog. It shows nothing new about the wind, and a third link to the same material is noise.

### NEW: showcase/creek/ (Gusts that the page sends): ADD
- The creek showcase calls `wind.gust` from its update every several seconds at the camera's place (examples/showcase/creek/sketch.ts), so the trees, grass and water ripples move in swells. That is the call the page's first code sample shows. It also calls `wind.sample` to set the wind sound's level from the air at the camera (examples/showcase/creek/sound.ts). Suggested place: after the table of calls, beside the `gust` and `sample` rows.

## Concepts said to have no demo

### push and wakes: CONFIRMED, no demo
- No sketch in examples/ calls `wind.push`. The wind add-on's own test page (packages/wind/page/sketch.ts) shows a body pushing through cards and leaving a wake, with references wind-cards.png and wind-page.png, but it is not a demo in demos.ts, so the link contract cannot point to it.

### read for a page's own motion: CONFIRMED, no demo
- No sketch calls `wind.read`. The nearest is the creek showcase, which uses `wind.sample` (the CPU copy of the air) to drive its wind sound, not motion and not the worker read.
