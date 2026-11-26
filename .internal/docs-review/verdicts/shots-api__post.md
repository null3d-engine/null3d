# Shot and demo-link verdicts: api/post

References below sit under `tests/image/references/chrome-real-gpu/webgpu/` unless noted. The
proposals call the tone, bloom, AO, SSR and outline views "test pages". They are image tests (sketch
tests in `tests/image/manifest.ts`), and each one already has a reference image. So those shots
need no capture: their source is "reference", and the shot only joins existing files.

## Shots

| Shot | Keep | Verdict |
| --- | --- | --- |
| tone-curves | yes | Good picture: one color chart under four curves shows the differences plainly. Source fix: reference files `tone-agx-punchy.png`, `tone-agx.png`, `tone-neutral.png`, `tone-aces.png` (320 x 180 each), joined in a row. No capture needed. |
| auto-exposure | yes, with fixes | `demo-auto-exposure.png` exists, but at its hold time of 6 s the camera is deep in the hall, facing in, and the eye has adapted. The picture shows a lit hall, not "a dark hall seen from a sunny courtyard". One frame also cannot show adaptation. Fix: a scripted pair from the demo in a development build, `?demo=auto-exposure&hold=6`, once as is and once with a hold script that presses E (KeyE down and up at 0.05 s), which turns the eye off. Alt: "The same view of a stone hall with the eye's adaptation off, nearly black, and on, lit". A cheaper fallback is the test references `exposure-off.png` and `exposure-dark.png` side by side. |
| bloom-strengths | yes | Clear picture. Source fix: reference files `bloom-off.png`, `bloom-soft.png`, `bloom-strong.png` (640 x 360), joined in a row. |
| ao-on-off | yes, with fixes | References exist, but `ao-default.png` darkens so little that the pair looks the same at page size. Use `ao-off.png` and `ao-wide.png` (radius 0.8, scale 1.5), where the corner and contact darkening shows. Source: reference. |
| ssr-wet | yes | Strong pair: the wet floor mirrors the boxes, the sphere and the bar. Source fix: reference files `ssr-off.png` and `ssr-wet.png` (480 x 270). |
| camera-lens | yes, alt fix | `demo-camera-lens.png` exists. At its hold time of 3 s the focus has racked to the far king, so the black pieces at the back are sharp and the near white pawns are blurred. Alt fix: "A low view across a chess board: the far king is sharp, and the near pawns and the string lights are blurred." |
| outline | yes, alt fix | References `outline-plain.png` and `outline-hidden.png` exist. The plain line is white, not yellow. The second has an orange line and a blue line where the wall hides the ball. Alt fix: "A box and a half-hidden ball outlined in white, then in orange with a blue line over the hidden part." Source: reference. |
| grades | yes, steps fix | The demo sways its camera with time, so "hold at the default pose" is not a step the demo can take, and the three grades come at different times. Hold mode steps sketch time and waits for the grading bake, so a fixed time works. Fix: in a development build, open `?demo=post-effects&hold=T` with T = 11.17 (no grade), 12.39 (warm) and 26.87 (cool). At those three times the camera sits at nearly the same place. Join the three frames in a row. Grain differs a little between them. |
| quality-presets-post | no | It would mislead. The post-effects demo forces ambient occlusion on every preset and turns reflections on at Low, and bloom, the outline, the vignette and the sharpening draw on every preset. Four panels would differ only in depth of field and detail, so they suggest the presets do not change effects. The `presets.ts` source is a data file, not a capture source. The text and the quality-preset tables already say which effect draws on which preset. |

## Demo links

| Concept | Code | Keep | Verdict |
| --- | --- | --- | --- |
| Bloom, AO, SSR, outline, vignette, sharpening and grading | `post-effects/` | yes | The code exists, and the sketch sets all of these, plus depth of field. The link is already in Related pages. Its text is wrong: it says "color grading tables" and "makes its warm and cool tables from lift, gamma and gain". The demo uses the grading controls through the lens kit, with no table file. The text also leaves out the reflections and depth of field. Fix the existing line rather than add a second one. |
| Depth of field | `camera-lens/` | yes | The demo has no code value, so `camera-lens/` is right. The sketch racks `focusPoint` and changes the focal length in every frame. It is already in Related pages. Adding it under the section is fine. |
| Automatic exposure | `auto-exposure/` | yes | The code exists. The sketch walks from the courtyard into the hall with `autoExposure` on, and E turns it off. |
| Tone mapping | `tone-mapped/` | no | The URL is valid, but the demo shows the material option `toneMapped: false` against one curve, agx-punchy. It does not compare tone curves, and this page does not cover the material option. It would mislead a reader of this section. |
| Screen-space reflections | `wet-street/` | yes | The code exists. The sketch sets `ssr` over wet asphalt with puddles. |

## Concepts said to have no demo

| Concept | Verdict |
| --- | --- |
| Custom tone curve | Wrong: the Creek showcase (code `showcase/creek/`) sets its own WGSL tone curve with `post.set({ toneMapping: TONE_CURVE })` in `look.ts`. The curve is subtle on screen, so link it as code to read, not as a picture. |
| ev100 with lights in real units | Confirmed. No demo sets `ev100`. The image test `real-units` (sun of 100,000 lux at EV100 15) has a reference, `real-units.png`, if the page wants a picture. |
| Still-view accumulation | Confirmed. No demo shows or toggles it on purpose. Any demo with a still camera accumulates, but none makes it visible. |
