# Shot and demo-link verdicts: concepts/lighting

All demo reference images below exist on every tier (webgpu, compat, webgl2) at 320 x 180. They are small; the website will show them small or soft.

## Shots

### area-lights — keep
- Source right: tests/image/references/chrome-real-gpu/webgpu/demo-area-lights.png exists. The frame shows the lit shop windows (rectangle lights), the pink and cyan neon sign and a green tube, and their shapes stretched in the wet street.
- Helps the paragraph on rectangle and tube lights ("a shiny surface shows its shape").
- Alt is fine. Smoother wording: "Shop windows and a neon sign lit as area lights, their shapes stretched across a wet street."

### light-shafts — keep
- Source right: demo-light-shafts.png exists. Held at 2 s: rays of a low sun between the pine trunks, and dark lanes of trunk shadow in the haze. The lanterns are not lit in this frame; the alt does not claim them.

### environment — keep
- Source right: demo-environment.png exists. Held at 1 s, the demo shows its first light, the Venice sunset HDR: plastic spheres above, metal spheres below, over a polished floor.
- Side issue on the page: "Related pages" says the demo uses "an HDR file's light, an EXR file's light and the built-in room". The sketch cycles the sunset HDR, the studio EXR and the generated sky (assets.skyEnvironment), not the room. Fix the link text in docs/concepts/lighting.md.

### reflection-probes — keep
- Source right: demo-reflection-probes.png exists. The warm room in front, the cool room through the doorway, and the floor reflecting each room's lights where they stand. The gold ring is visible.
- The demo's B key toggles box projection. Say so in the link text, since the page explains box projection.

### atmosphere — keep, change the alt
- Source right: demo-atmosphere.png exists. Held at 2 s, the sketch's clock gives about 17:38: a dim valley at sunset with rose clouds. At 320 x 180 the haze on the ridges is faint, so "ridges hazed by distance" overclaims.
- Alt: "A valley at sunset under the physical sky, with rose clouds and ridges fading into the evening air."
- Optional second picture for the aerial perspective paragraph: tests/image/references/chrome-real-gpu/webgpu/physical-sky-afternoon.png beside physical-sky-no-haze.png (same scene; the far pillars turn blue only with the air's haze).

### time-of-day-presets — reject as written; corrected steps below
- The demo has no switch that sets the hour. Its hour comes from the sketch time through its own clock (a 40 s day that starts near 15:09 and slows at dawn and dusk). "Set the hour" cannot be done.
- Corrected steps: in a development build of the examples page, open ?demo=time-of-day with ?hold= at these sketch times, which the sketch's clock maps to the preset hours: 39.81 (15:00), 4.72 (17:36), 8.61 (18:24), 15.68 (23:00). Capture the default camera (no input, so the camera does not move) and join the four frames.
- Note: the demo turns the sun's path (heading) and adds its own fill light, so the frames show the demo's look at the preset hours, not timeOfDay's raw output.
- No-script alternative: the existing references tests/image/references/chrome-real-gpu/webgpu/time-of-day-afternoon.png, -golden-hour.png, -blue-hour.png and -night.png (480 x 270) show the exact presets on mirror-to-rough spheres. Less attractive, but exact and already maintained.

### volumetric-presets — reject; use existing references instead
- Medium, High and Ultra draw nearly the same picture. The page itself says the cells' edges never show, even on Medium's grid, and the image tests hold Medium's fog to within 0.5 per cent of one image on every tier (fog-volume-medium). Three near-identical frames would not show what fogSlices changes. ?preset= also changes shadows and much else, so any difference would not be the fog's alone.
- The useful contrast is Low (no slices, sun glow only) against a preset with slices. Existing references show exactly that: tests/image/references/chrome-real-gpu/webgpu/fog-volume-off.png (fog with its sun glow alone) and fog-volume-sun.png (the same fog lit volumetrically: rays between pillars, shadow lanes). 480 x 270.
- Alt: "Pillars in a low sun: fog with its sun glow alone, and the same fog lit volumetrically."

## Demo links

| Code | Verdict | Reason |
| --- | --- | --- |
| environment/ | keep | Demo "environment" has no code, so name/ is right. Shows environment light on rough to smooth spheres. Already in Related pages; fix that entry's "built-in room". |
| time-of-day/ | keep | Name/ is right. The sketch calls timeOfDay as the hour moves. Already in Related pages. |
| area-lights/ | keep | Code exists. Rectangle windows and tube-light neon. |
| math/ | keep, weak | 300 dynamic point lights (range 2) plus a shadowed lamp: real many-light clustering. The sketch is about vec3 and quat, so the link text must say what to look at ("300 drones, each with its own point light"). |
| compare/night-town/ | keep | Code exists in comparisons.ts. Each block adds 12 lights, and the count slider raises the light count. Best fit for this section. |
| showcase/island/ | keep | The sketch mixes AMBIENT_DAY (0.8, warm) and AMBIENT_NIGHT (0.06, cool) by the share of lit lamps, exactly as the page says. |
| light-shafts/ | keep | Volumetric fog with sun rays and lantern cones at dusk. |
| reflection-probes/ | keep | Two rooms, two probes, B toggles box projection. |
| atmosphere/ | keep | Physical sky over a day, aerial perspective on ridges, moon and stars at night. |

## Concepts said to have no demo

- Lights in real units with ev100: confirmed. No demo uses intensityUnit, 'lux', 'lumen' or ev100. The test image real-units.png exists but is a dim test scene, not a good picture.
- The light probe grid: confirmed. No demo calls setLightProbeGrid or bakeProbes. The test image tests/image/references/chrome-real-gpu/webgpu/probe-grid.png (red and green walls bouncing color onto a floor and spheres) would make a good picture for that section.
- Haze sheets where the land ends: confirmed. examples/lib/haze.ts (createHaze) builds such sheets, but no demo imports it.
- Ambient and hemisphere lights alone: confirmed. Many demos use them beside other lights; none uses them alone. showcase/island/ already covers the hemisphere light that follows the hour.
