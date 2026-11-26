# Shot and demo-link verdicts: api/impostors

## Shots

### impostors-forest-three-ways: keep
The reference exists: tests/image/references/chrome-real-gpu/webgpu/demo-impostors.png (also compat and webgl2). It is 320 by 180 and backlit by a low sun. The three bands cannot be told apart in it, so the alt text must not say that near trees show as meshes and far trees as cards. Use: "A pine forest on rolling hills at golden hour, backlit by a low sun". Caption: "The Impostors demo: meshes near, merged cells in the middle, cards far out."

### impostors-cards-off: reject
The demo's camera flies on sketch time, so a frame after the key press does not match the reference pose. The far trees are dark shapes against the sun at this size, so the two frames would look the same. A better picture for "Make a card read as its mesh" is the existing reference tests/image/references/chrome-real-gpu/webgpu/impostor-turn.png: three turned pines, each beside its own card, under one light.

### impostor-atlas-pair: keep, steps corrected
The steps name the wrong function, and they miss two details. Corrected steps:
1. In a Bun script, call impostorAtlases() from examples/impostors/forest.ts. It calls bakeImpostorAtlas with a 4 by 4 grid at 64 texels a cell, so each atlas is 256 by 256.
2. Turn the rows upright with uprightImage from packages/cli/src/assets/impostor.js. The bake's rows start at the atlas's bottom.
3. Lay the color atlas over a plain gray. For the surface atlas, set alpha to 255 (alpha holds coverage, so the image would be mostly clear otherwise).
4. Scale both up 2 times with nearest sampling. Draw the 4 by 4 cell lines. Put the two side by side.
5. Encode with encodePng from packages/cli/src/png.js. Convert to docs/images/api/impostors/impostor-atlas-pair.webp.

### impostor-handover: keep, source is "reference"
This is not a scripted shot. The reference exists: tests/image/references/chrome-real-gpu/webgpu/impostor-handover.png. It shows three turned pines at the switch distance, with full crowns. Without a caption it is only three trees. Caption: "Three pines in the hand-over band. Each draws as its mesh and its card at once, and no sky shows through the crowns."

### impostor-shadow: keep, source is "reference"
The reference exists: tests/image/references/chrome-real-gpu/webgpu/impostor-shadow.png. It shows crown-shaped shadows from a batch that only the light draws. The source file is tests/pages/sketches/impostor-shadow-sketch.ts, not the manifest.

## Demo links

- impostors/ at the opening paragraph: keep. The code exists in examples/demos.ts, and the sketch draws all three bands and the L switch. Make the page's existing mention of examples/impostors this link.
- forest/ under the hand-over section: reject. Its far cards are crossed quads with a hand-painted picture and the standard material. They draw only on the Low preset. The demo does not use the impostors package or handOverToCards. The page warns against hand-painted cards.
- showcase/island/ under "Make a card read as its mesh" (added): keep. The section and "Bake several views, not one side" cite the island's trees. The island draws its far plants with createImpostors, from atlases that its build bakes, with castShadows and receiveShadows on.

## Concepts said to have no demo

- loadImpostorAtlas with a command-line bake: confirmed. No demo calls it. The island loads its build's atlases with its own loader.
- Card shadows from a caster-only batch: confirmed for the caster-only form. showcase/island/ shows cards that cast and receive shadows, but from the visible batch.
- encodeImpostorSurface: confirmed. Only the impostors test page calls it.
