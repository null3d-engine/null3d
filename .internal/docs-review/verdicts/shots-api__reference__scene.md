# Verdicts: screenshots and demo links for api/reference/scene

The page is generated. Every image and link below goes into the TSDoc comment of the named export. TSDoc markdown links already pass through to this page (for example the link to the add-on feature descriptions page in scene.ts), so a relative image path from docs/api/reference/scene.md works: `../../images/api/reference/scene/<name>.webp`.

## Shots

### fog-modes: keep, with a corrected source

- The picture helps. The four reference images show the same towers and floor under each fog. The difference is easy to see: linear fog leaves the near towers clear, exponential fog hazes even the near towers, squared exponential fog sits between them, and height fog leaves more of the far row visible.
- Wrong source type. The steps put four existing reference images together. Nothing runs in a browser, so this is a "reference" shot, not a "scripted" one. The source is these four files, which all exist:
  - tests/image/references/chrome-real-gpu/webgpu/fog-linear.png
  - tests/image/references/chrome-real-gpu/webgpu/fog-exponential.png
  - tests/image/references/chrome-real-gpu/webgpu/fog-exp2.png
  - tests/image/references/chrome-real-gpu/webgpu/fog-height.png
  The manifest makes them from tests/pages/sketches/fog-sketch.ts?fog=<name>, with the settings in bench/scenes/fog.ts.
- Wrong source file to edit. The fog exports live in packages/engine/src/scene/fog.ts, not scene.ts.
- Wrong place. The fog type's heading (`FogCurve`) has three curves only. Height fog is the `heightFalloff` setting of `FogOptions`. Put the picture under `## FogOptions` (TSDoc of `FogOptions` in fog.ts). If it stays under `FogCurve`, the caption must say that the fourth panel is exponential fog with `heightFalloff`.
- Layout. Each image is 640 x 360 pixels. Four in one row make each panel too small to see the haze. Use a 2 x 2 grid with a label on each panel.
- Caption. The two far towers in the middle (one red, one blue) use materials that turn fog off, so they stay sharp in every panel. Say so in the caption, or a reader will think the fog is broken.

## Demo links

| Concept | Code | Verdict |
| --- | --- | --- |
| timeOfDay | time-of-day/ | Keep. The demo has no code value, so `time-of-day/` is the correct path. Its sketch calls `timeOfDay(hour, { heading })` for each hour and applies the sky, light, fog and exposure. Put it in the TSDoc of `timeOfDay` in scene/time-of-day.ts. |
| AtmosphereBackground | atmosphere/ | Keep. The code value is `atmosphere/`. The sketch calls `scene.setBackground({ atmosphere: ... })` over a day. Put it in the TSDoc of `AtmosphereBackground` in scene/background.ts. |
| reflection probes | reflection-probes/ | Keep the link, move it. The code value is `reflection-probes/` and the sketch calls `scene.createReflectionProbe` for each room. Put it under `## ReflectionProbe` (scene/probes.ts), not in the one large `Scene` table. |
| instance batches | instances/ | Keep the link, move it. The code value is `instances/` and the sketch calls `scene.createInstances` for 100,000 columns. Put it under `## InstanceBatch` (class in scene/scene.ts), not under `Scene`. |
| sky layer | aurora/ | Keep the link, move it. The demo has no code value, so `aurora/` is the correct path. The sketch uses the aurora add-on, which calls `scene.setSkyLayer` (examples/addons/aurora/index.ts). Put it under `## SkyLayerOptions` (scene/background.ts), not under `Scene`. Note for the link text: the call to `setSkyLayer` is in the add-on, not in the sketch. |

## Concepts said to have no demo

- addFeatureDraw: confirmed. No demo or comparison calls it. Only a test page uses it (tests/pages/sketches/feature-draw-sketch.ts), and that is not a demo.
- bakeProbes: confirmed. No demo or comparison calls it. Only test pages use it (bounce-sketch, probe-grid-sketch, probes-cost-sketch). The bounce-light demo shows screen-space bounce light, not a baked probe grid, so it must not be linked here.
