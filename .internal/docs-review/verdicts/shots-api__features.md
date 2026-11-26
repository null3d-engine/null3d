# Verdicts: screenshots and demo links for api/features

## Shots

### stats-steps-tab: keep, with corrected steps
The Stats section describes the add-on row only in words, so a picture of a real row helps. The source is real:
- The water add-on (packages/water/src/water.ts) registers its feature through a feature host with the page, a GPU scope (its reflection pass), a reflection-cadence setting, a budget and a memory figure. Its row therefore shows a GPU time and the second line that the page describes.
- `?stats=open` is a real switch (packages/engine/src/page/switches.ts). The examples build turns URL switches on (examples/vite.build.config.ts) and passes the page's address values to the demo.
- The Steps tab is drawn in packages/engine/src/debug/overlay-look.ts, not stats-panel.ts. List overlay-look.ts and stats-text.ts as the source files.
Corrected steps: open the examples page as `?demo=water&stats=open` in Chrome on a WebGPU GPU with timestamp queries (WebGL2 shows no GPU figure, so the row would read "gpu not measured"). Wait about five seconds for the timed frames. Click the Steps tab. Capture the card with the `water` row and the `GPU steps` list.

### aurora-sky-layer: drop on this page
- The reference file exists (tests/image/references/chrome-real-gpu/webgpu/demo-aurora.png), but it shows only green curtains. There is no violet in it, so the proposed alt text is wrong. A correct alt: "Green aurora curtains over dark ridges, mirrored in a frozen lake at night."
- The picture shows what a sky layer draws. It does not show anything about a feature description, which is this page's subject. The Adapters section lists five adapters, each with a link to its own page; one picture for one of them adds little here.
- Better home: api/scene, section "Sky layers", where scene.setSkyLayer is described. Keep the demo link here instead.

## Demo links

### Sky layer adapter, code "aurora": keep, correct the code to "aurora/"
The aurora demo has no code field in examples/demos.ts, so the link code is "aurora/". The demo shows the concept well: its sketch calls the aurora example add-on (examples/addons/aurora/index.ts), which defines a feature at the background point, kind draw, providing the sky slot, with the three views, and places it through scene.setSkyLayer. The same demo also covers lighting slots and the view mask, so the link can sit under "## Adapters" and be mentioned from "## Lighting slots".

### Feature hosts with settings and budgets, code "water/": keep
"water/" is the demo's code. The water add-on that the demo runs uses a feature host, a setting with the "double" governor (reflection cadence), a budget, a GPU scope and a memory figure: the exact pieces that the section and the Stats section describe. Note that the host code is in packages/water/src/water.ts, not in the demo folder itself.

### Feature host for a draw add-on, code "splats": keep, correct the code to "splats/"
The splats demo has no code field, so the link code is "splats/". The splats add-on (packages/splats/src/feature.ts and system.ts) registers a draw feature with a preset-row setting under the "scale" governor and a budget, through a feature host with its own namespace. This matches the section's own code sample (a splat budget) closely. Its real frame point is resolve, not transparent as the page's sample says; the sample stays valid as an illustration.

## Concepts said to have no demo

- published outputs: a demo shows it. "ocean/" runs the water add-on's ocean, whose compute passes publish outputs with a black neutral default, and its material reads them with textures.fromPass (packages/water/src/ocean.ts). The demo summary says so.
- lighting slots: a demo shows it. "aurora/": the aurora add-on provides the sky slot.
- namespaces: confirmed, no demo shows it. The water, splats, wind and sound add-ons declare namespaces in their package code, but nothing in a demo folder or on screen shows one.
- order bands: confirmed, no demo shows it. The grass add-on (used by "vegetation-wind/") puts its fill pass in the before band, but that is inside the package and nothing on screen shows the order.
