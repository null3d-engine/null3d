# Verdicts: screenshots and demo links for api/grass

## Shots

### grass-grove: keep, with a better capture
The picture helps. The grove demo (vegetation-wind) calls `createGrass` with the wind field, a camera, a `where` rule around the trunks and a sway distance, so it shows this page's add-on in use. The reference file exists at `tests/image/references/chrome-real-gpu/webgpu/demo-vegetation-wind.png` and shows the grove with grass at its feet.
Problem: every demo reference is a 320 x 180 thumbnail. That is too small for a docs picture, and at that size the blades read as green noise.
Corrected source: scripted. Open the demo test page for `examples/vegetation-wind/sketch.ts` at 1280 x 720, hold 2 s (the demo's hold). Use the reference only to check the framing.

### grass-garden: drop
The reference file exists (`webgpu/demo-contact-shadows.png`, also 320 x 180), but the grass is one small clump on a rock. The picture is about contact shadows on sand and pebbles, and the demo turns contact shadows off and on every 3 s. It does not show the grass's shadows or the sway distance, which is the section it was meant for. The grass-shadow picture covers that section well. Keep the garden as a demo link instead.

### grass-presets: keep
The steps work. The image test page takes a `preset=` switch (the manifest already runs this same sketch with `preset=low` on the software GPU), `ultra` is a valid preset, and the sketch calls `grass.fit` on a preset change, so the share applies from the first frame. Hold 1 s at 1280 x 720, as the manifest entry does.
Suggestion: add the existing High frame, `webgpu/vegetation-grass.png` (1280 x 720), as the middle of three, because the page states `count` at High and the shares relative to it.

### grass-shadow: keep, but change the source to reference
The picture is good: long blade shadows on the hill under a low sun, which fits "Near shadows and the sway distance". But it needs no script. The manifest entry `vegetation-grass-shadow` already has a full-size reference.
Corrected source: `tests/image/references/chrome-real-gpu/webgpu/vegetation-grass-shadow.png` (1280 x 720).

## Demo links

- vegetation-wind/ (Grass in the wind, intro): keep. The code exists in demos.ts, and the sketch builds grass that bends in the wind add-on's field.
- contact-shadows/ (Grass in a scene, under "Grass on the ground"): keep. The code exists. `examples/contact-shadows/garden.ts` uses `mask` to grow clumps by the rocks, and calls `grass.fit` and `grass.setSwayDistance(swayDistanceFor(preset))` on a preset change. Better place: "Near shadows and the sway distance", where the page tells the reader to make exactly that call.
- showcase/island/ (Grass at scale, under "The two GPU paths"): keep the link, change the concept. The island is not grass at scale: each park lawn holds 9,000 tufts and draws only 170 rows. What it really shows is `compute: false`: `examples/showcase/island/trees.ts` passes it and sets each batch's draw range itself. New concept: "A page that drives the rows itself (compute: false)". Place it at the paragraph on `compute: false`.

## Concepts said to have no demo

- The blade shape option: confirmed. No demo passes `blade` (they pass `blades`, the blade count). No `widthAt` in examples.
- The placement hash: confirmed. No demo imports `@null3d/grass/hash`.
- compute: false: not confirmed. The island demo (`showcase/island/`) shows it.
- No comparison in comparisons.ts uses the grass add-on. The battle comparison's grass is a custom material, not this package.
