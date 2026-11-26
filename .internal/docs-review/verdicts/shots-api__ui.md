# Shot and demo-link verdicts: api/ui

## Shots

### picking-labels: reject as proposed, keep as a scripted shot
The picture idea is good: it shows what a screen label is. The source is wrong.
The reference image `tests/image/references/chrome-real-gpu/webgpu/demo-picking.png` has no labels in it.
The image test page (`tests/pages/image.ts`) saves `engine.captureFrame()`, which holds the canvas only.
HTML labels are page elements over the canvas, so no reference image of any tier shows them.
I opened the file: it shows the six pieces, the wall display and a selected red box, and no text tags.

Corrected source (scripted): serve the demo gallery and open
`examples/index.html?demo=picking&hold=2`. The gallery passes `?hold` on to the engine, and
`startDemo` binds the labels' layer in hold mode too (`examples/lib/run.ts`, label reader).
Wait for the held frame, then take a browser screenshot of the demo's stage element (canvas plus
labels' layer), not a frame capture. Save as `docs/images/api/ui/picking-labels.webp`.

### css3d-labels: reject as proposed, keep as a scripted shot
Same fault. `demo-css3d-labels.png` shows the monoliths and their glowing strips only. The
cards and the "CSS3D" title are HTML elements, so the canvas capture leaves them out. The coloured
bars in the picture are the emissive strip meshes, not the cards. A reader would look for cards
that are not there.

Corrected source (scripted): open `examples/index.html?demo=css3d-labels&hold=3.5` on the gallery,
wait for the held frame, and screenshot the demo's stage element. Save as
`docs/images/api/ui/css3d-labels.webp`. Place it under "Labels as planes of the scene".

### label-element-devtools: reject
"Manual" is the right source kind for a developer-tools picture, but the picture adds little.
The text already names every property. A screenshot of the Elements panel goes stale with each
browser version, cannot be searched or copied, and reads badly in dark mode.
It also cannot show what the alt text and "shows" field promise at the same time: while a label
is on screen the engine clears `visibility` to an empty value, so only a hidden label shows
`visibility: hidden`, and a hidden label's transform is not updated.
Better: a collapsible block under "Elements on the page" with the inline style the engine writes
(from `packages/engine/src/page/label-loop.ts`):

    <details>
    <summary>Technical details: the style the engine writes on a screen label</summary>

    On bind: `position: absolute; left: 0; top: 0; visibility: hidden`.
    Each frame it moves: `transform: translate3d(<x>px, <y>px, 0) translate(-50%, -50%)`.
    While shown, `visibility` is cleared; while hidden, it is `hidden`.

    </details>

## Demo links

- Screen labels, `picking/`: keep. The code exists in `examples/demos.ts` (code `picking/`), and
  the sketch tracks a label on each of the six pieces (`ui.trackLabel(object, name, { offset })`).
  The link is already in "Related pages"; no change is needed.
- Labels as planes, `css3d-labels/`: keep. The demo has no `code` field, so `css3d-labels/` is the
  right form. The sketch uses both `'world'` (nine cards) and `'billboard'` (the title). The link is
  already in "Related pages"; no change is needed.

## Concepts said to have no demo

- The cases that hide a label: partly disproved. The `sound/` demo (Positional sound) calls
  `ui.untrackLabel` on each strike's distance label a few seconds after its thunder is heard, so
  the label hides because the sketch no longer tracks it. That is one of the four listed cases.
  No demo shows the other three on purpose (object hidden with `setVisible(false)`, camera layers,
  outside the near or far plane). The sound demo is about sound, so a link fits only beside the
  `untrackLabel` bullet, if at all.
