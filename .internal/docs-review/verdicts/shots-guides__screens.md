# Shot and demo-link verdicts: guides/screens

## Shots

### control-room: keep, with a corrected alt text
- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-canvas-screen.png (also in compat and webgl2). It is the canvas-screen demo's default view at 1 s.
- The picture is only 320 x 180 pixels. It shows three glowing numbers with bar gauges and light rows, and the console's wave trace. The panel titles (REACTOR, SHIELD, COOLANT) cannot be read at this size, and the metal frames are hardly visible.
- The alt text claims "reactor, shield and coolant readings". Use: "A dark wall with three glowing screens that show numbers and bar gauges, and a small console panel with a wave trace below them."
- For a sharper picture, hold canvas-screen at 1 s at 1280 x 720 instead of the 320 x 180 reference.

### lcd-close-up: keep, with corrected steps
- The proposed steps are too vague. The demo has no camera controls and no camera switch, and no test page holds this demo at another pose.
- A timed script can move the camera: `set #camera.position=...`. The sketch never moves its camera after setup, and the camera looks straight down -Z, so moving it keeps the view square to the room.
- Aim at the console panel, not a wall panel. The console is the panel made for this view (160 x 90 texels on 1.6 x 0.9 m, so each texel is 1 cm). The shader shows the red, green and blue bars only when a texel covers about 3 or more pixels.
- Corrected timed script (shot --script on canvas-screen, 1280 x 720):
  `0 set #camera.position=0,-1.15,3.9`
  `1 shot lcd`
  At 1.3 m the view is about 1 m high, so a texel covers about 7 pixels. The bars, the dark row gaps and the dead texels all show. Crop to the panel if needed.

### boot-glitch: keep, with corrected steps
- The proposed steps are wrong. Every panel starts powered on. A click on a powered panel turns it OFF and fades it to black. A boot runs only when a click turns a panel back ON. So a click at 1 s and a shot at 1.4 s shows a dark panel, not a boot.
- The demo also boots every panel on a schedule: first at 2.5 s, then every 8 s. Hold mode runs the sketch's update, so a plain hold shows it with no click.
- Corrected source: hold canvas-screen at 2.8 s (`?hold=2.8`, or `shot --time 2.8`) at 1280 x 720 or larger, and crop one wall panel. That is 0.3 s into the boot (it lasts 0.9 s): rows torn sideways, a band rolling up, and the picture still dim. All four panels boot together, so the full frame shows the effect too.

## Demo links

- canvas-screen/ for "Screens painted on an OffscreenCanvas", under "Make a screen": keep. The code exists in examples/demos.ts. The demo makes four screens with createScreen, paints them in `draw`, and repaints only marked rectangles with `mark` and `flush`.
- picking/ for "Clicks marked on a canvas display", under "Clicks on a screen": keep. The code exists in examples/demos.ts. examples/picking/screen.ts makes a screen with createScreen and uses `onClick((point) => ...)` to paint a square where the click lands, uploading only the changed rectangles. This is the page's own click example almost line for line.

## Concepts said to have no demo

- `lcd: false`: confirmed. No demo or test passes `lcd: false`; only the add-on's own README mentions it.
- A refresh rate per screen: NOT confirmed. canvas-screen gives each screen its own rate (REACTOR 20 Hz, SHIELD 12 Hz, COOLANT 8 Hz, console 30 Hz), and each wall canvas prints its rate. The canvas-screen/ link covers it.
