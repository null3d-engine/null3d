# Shot and demo-link verdicts: guides/ui-overlays

## Key fact that breaks all three "reference" shots

The demo reference images are canvas-only. The image test runs each demo's sketch on
tests/pages/image.html (a bare canvas) and saves `engine.captureFrame()` at 320 x 180.
That page has no labels' layer and no backdrop, so no HTML element is in the picture
(tests/image/manifest.ts, the DEMOS map; tests/pages/image.ts, line 73). The HTML labels,
cards and embedded page are made by the examples page (examples/lib/run.ts, the label
reader and createBackdrop). This page is about exactly those HTML elements.

All three demos do show their concept on the examples page. In a development build
(`bun run dev`), `?hold=<t>` draws the frame that the image test holds
(examples/index.ts, header comment), and `hold` also hides the choices bar and the HUD.

## Shots

### labels-follow: REJECT as given, re-source as scripted
- demo-picking.png (webgpu) shows the six pieces and the outlined red cube, but no labels.
  The alt text ("each with an HTML label above it") would be false. 320 x 180 is also too small.
- Corrected source (scripted): run `bun run dev`; open
  `/examples/index.html?demo=picking&hold=2` at a 1280 x 720 viewport; wait for the
  loading overlay to fade; screenshot the demo panel (canvas plus the `.labels` layer).
  The sketch tracks a label on each piece (examples/picking/sketch.ts, lines 95 and 110),
  and the page binds a tag for each.

### labels-planes: REJECT as given, re-source as scripted
- demo-css3d-labels.png shows the dark ring of monoliths with thin colored strips. The
  140 x 150 HTML cards and the title card are not in it. The alt text would be false.
- Corrected source (scripted): `bun run dev`; open
  `/examples/index.html?demo=css3d-labels&hold=3.5` at 1280 x 720; screenshot the panel.
  The sketch tracks nine 'world' cards and one 'billboard' title
  (examples/css3d-labels/sketch.ts, lines 97 to 109).

### page-under-scene: REJECT as given, re-source as scripted
- demo-depth-only.png shows grey glass panes and the blue and orange pylons on an empty
  (see-through) background. The embedded page card and the ruled page backdrop are absent,
  so the picture shows the opposite of the point: no page under the scene.
- Corrected source (scripted): `bun run dev`; open
  `/examples/index.html?demo=depth-only&hold=1` at 1280 x 720; screenshot the panel. The
  demo has `backdrop: true`, so the page puts the ruled backdrop and the labels' layer
  under a see-through canvas, and the sketch posts a `kind: 'page'` label
  (examples/depth-only/sketch.ts, lines 47 to 58).

## Demo links

- picking/ for "Labels that follow objects": KEEP. demos.ts gives `code: 'picking/'`, and the
  sketch tracks an HTML label on each piece.
- css3d-labels/ for "Labels that are planes of the scene": KEEP. The demo has no `code`, so
  `css3d-labels/` is right, and the folder exists. The page links it only under Related
  pages today; the link belongs in the section.
- depth-only/ for "A page under the scene": DROP as a new proposal. That section already
  ends with the depth-only demo link (examples/depth-only). Nothing to add.

## Concepts said to have no demo

- A lil-gui settings panel: CONFIRMED. No example imports lil-gui. Near match only: the
  weighted-transparency demo posts a controls panel model (`page.post('hud', ...)`), and a
  pick on that page panel comes back as a `blend` message. It shows the pattern, not lil-gui.
- HUD messages between page and sketch: NOT CONFIRMED. weighted-transparency/ shows both
  directions on change only: the sketch posts the panel and the label text when the blend
  changes, and the page sends `blend` back on a pick (examples/weighted-transparency/sketch.ts,
  lines 82 to 99). gizmos/ also shows a page button that sends `mode` to the sketch. Do not
  use replay/: its page sends the view every tick, which this page tells readers not to do.
- Health bars over units: CONFIRMED. No demo draws health bars. picking/ shows the label
  mechanism, but no value that changes by message.
