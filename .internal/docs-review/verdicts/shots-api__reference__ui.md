# Shot and demo-link verdicts: api/reference/ui

## Shots

### world-labels: reject as proposed, keep the idea with a scripted source

- The reference image `tests/image/references/chrome-real-gpu/webgpu/demo-css3d-labels.png` exists, but it does not show the concept. It is the canvas only, at 320 x 180 pixels. It shows the dark monoliths and their colored strips, and no HTML cards and no title.
- The cause: the image test runs the demo's sketch on its own (the manifest entry is `sketch: examples/css3d-labels/sketch.ts`). No demo page runs, so nothing binds HTML elements to the labels. The cards come from the demo page's label reader in `examples/lib/run.ts`, which calls `engine.labels.bind`.
- The alt text ("each with an HTML card that turns with it") would describe something the picture does not have.
- Corrected source (scripted): in a development build, open `examples/index.html?demo=css3d-labels&hold=3.5` at 1280 x 720. The `hold` switch freezes the frame at the demo's hold time and hides the page's readout panel. Wait for the held frame, then take a screenshot of the demo's stage (the `main` element), not the canvas alone, so the HTML label layer is in the picture. Check that the cards and the "CSS3D" title show before saving to `docs/images/api/reference/ui/world-labels.webp`.
- The picture does help this page: it shows the difference between `'world'` (cards that lean with their monoliths) and `'billboard'` (the title that stays square to the view). Keep it under `## LabelTransform`.

## Demo links

### picking/ for trackLabel and labels.bind: keep

- `picking` is in `examples/demos.ts` with `code: 'picking/'`.
- Its sketch calls `ui.trackLabel(object, name, { offset: [0, 0.9, 0] })` with the default `'screen'` transform, so it shows screen labels and the `offset` option.
- Caveat: `engine.labels.bind` is not in the `picking/` folder. The shared demo runner (`examples/lib/run.ts`) does the bind for every demo. A reader who opens the link sees only the sketch side. The link text should say it shows `trackLabel`, or the page should also point at the runner's label reader.

### css3d-labels/ for world and billboard labels: keep

- `css3d-labels` is in `examples/demos.ts` with no `code` value, so `css3d-labels/` is the right code under the website contract. The folder exists.
- Its sketch tracks nine cards with `transform: 'world'` and an offset, and a title with `transform: 'billboard'`. That is exactly the concept.

## Concepts said to have no demo

### rotation on a billboard label: confirmed, no demo

- No sketch under `examples/` passes `rotation` to `ui.trackLabel`. `css3d-labels` uses `'billboard'` without `rotation`.
- Only a test page uses it (`tests/pages/sketches/labels-3d-sketch.ts`), which is not a demo and cannot be linked under the website contract.
