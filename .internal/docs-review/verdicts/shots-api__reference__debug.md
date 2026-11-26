# Shot and demo-link verdicts: api/reference/debug

## Shot `stats-overlay-open`: drop from this page

- Wrong page. The reference page lists every export as generated tables from the doc comments. No reference page has an image, and the generator (tools/gen-docs.ts, tools/lib/docs.ts) has no way to put one in. The image would land inside the table cell of the `stats` member of `Debug`. The overlay picture belongs on the concept page api/debug, in the section "Stats overlay and frame figures", which describes the header, the card and its four tabs.
- The steps are partly wrong, even for the concept page:
  - `?stats=on` does nothing new. The examples page already shows the overlay, collapsed, on every demo (examples/lib/run.ts passes `stats: { collapsed: true }`). The switch parser (packages/engine/src/page/switches.ts) maps `on` to "show" with no start state.
  - `?stats=open` opens the card at start, so no click is needed.
  - The overlay is a page element over the canvas (packages/engine/src/debug/stats-panel.ts), not drawn in the canvas. A canvas capture does not hold it. Capture the page area of the canvas.
- Corrected source, for api/debug: scripted. Run the examples dev server, open `?demo=instances&stats=open`, wait about one second for the first figure window, then screenshot the page area of the demo canvas, with its top-right corner.
- Also: the skyway showcase demo (code `showcase/skyway/`) calls `debug.stats({ collapsed: true })` in its sketch. It can serve as a code link for `debug.stats` on the concept page.

## Demo links

None proposed.

## Concepts said to have no demo

- debug.line, box, axes, grid, frustum: confirmed. No demo sketch calls them. The image test page tests/pages/sketches/debug-sketch.ts draws all of them, and its reference image tests/image/references/chrome-real-gpu/webgpu/debug.png shows them. That test page is not a demo, so it cannot be a demo link, but the image can be a reference shot on the concept page.
- debug.view: confirmed. No demo calls it. References exist for five views: tests/image/references/chrome-real-gpu/webgpu/debug-view-{normals,depth,overdraw,wireframe,shadows}.png. The `?view=` switch works on any demo in a development build.
- frameStats: confirmed. No demo or comparison calls it.
- StatsPanel: confirmed as a code link. The comparisons (codes `compare/battle/`, `compare/factory/`, `compare/night-town/`) show a StatsPanel on screen for the three.js side, but the code that makes it is in examples/lib/stats-three.ts, outside each comparison folder. A link to a comparison folder would not show the class.
