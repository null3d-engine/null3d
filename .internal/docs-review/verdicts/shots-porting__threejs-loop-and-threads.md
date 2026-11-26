# Verdicts: porting/threejs-loop-and-threads (shots and demo links)

## Shots

### threads-in-devtools: KEEP (manual)
- A manual shot is right here: the picture is of the browser's own Performance panel.
- It helps: the page's main claim is "the main thread stays free, the workers do the frame". One recording shows that at a glance.
- The source is sound. The engine names its workers `null3d-sketch`, `null3d-render` and `null3d-job-<n>` (packages/engine/src/page/engine.ts), so DevTools labels each track. The instances demo writes 100,000 column heights in the sketch every frame, so the sketch track is busy.
- Steps to add: serve the demo with the cross-origin isolation headers (the Vite plugin sets them). Without them the sketch runs on the main thread and the picture shows the opposite. Record 2 to 3 seconds after the scene has loaded, and crop to the main, sketch, render and job tracks.

## Demo links

| Concept | Code | Verdict | Reason |
| --- | --- | --- | --- |
| Per-object classes become batch arrays | instances/ | KEEP | One dynamic batch; `onUpdate` writes each row's height straight into `positions` and calls `setActiveCount`. No per-row state arrays like `vel`, but it shows the pattern. |
| Keyboard and gamepad input in the sketch | input/ | KEEP | An action map binds keys and gamepad sticks; the sketch reads `input.value` and `input.wasPressed`. No `code` field, so the `input/` fallback is right. |
| Pointer lock and fly controls | walk-and-fly/ | KEEP | `createFirstPersonControls` and `createFlyControls` in the sketch, `pointerLock: true`. The `requestPointerLock` click handler lives in the shared demo page (examples/lib/run.ts), not in the demo folder. |
| CSS3DRenderer labels | css3d-labels/ | KEEP | `ui.trackLabel` with the `world` and `billboard` transforms, which is the CSS3D case. `engine.labels.bind` is in examples/lib/run.ts. |
| Positional audio placed by the sketch | sound/ | KEEP | `createSound(ctx, { listener: camera })`, positional shots and a brook group placed by the sketch. |
| HTML labels and pointer events | picking/ | KEEP, but add vegetation-wind/ for this section | Picking sends label text only when the selection changes and uses `ui.trackLabel`, which fits two bullets. It shows only the sketch-to-page way. vegetation-wind/ shows both ways: the page's sliders post values, `page.onMessage` applies them, and the sketch posts the panel again only on change. |

## Concepts said to have no demo

- sketchThread 'main': CONFIRMED no demo. Only image tests use it (tests/image/engine.spec.ts and others).
- GUI panel on the page sending values: NOT confirmed. vegetation-wind/ has a page panel with strength and bearing sliders and a Hold button. Its values reach the sketch as messages (vegetation-wind/hud.ts, sketch.ts). It is not lil-gui, but it is the same pattern. Link it under "Libraries in a port" or "Messages between the page and the sketch".
- IndexedDB cache in the sketch: CONFIRMED no demo. No example uses IndexedDB.
