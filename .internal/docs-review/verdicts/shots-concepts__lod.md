# Shot and demo-link verdicts: concepts/lod

Paths below are relative to the generated copy of the repository.

## Shots

### forest: keep, with a new alt text
- The source is right. `tests/image/references/chrome-real-gpu/webgpu/demo-forest.png` exists. It is the demo's default view, held at 2 seconds. Copies also exist for the compat and webgl2 tiers.
- The picture is small (320 × 180) and dark. It shows a dense forest under a dusk sky. You cannot see any level of detail in it, because levels are made to be invisible. It helps only when it stands next to the levels-view shot of the same view ("what you see" beside "what the engine picks").
- The alt text claims something the picture does not show ("each tree at its own level of detail"). Use: "A dense mixed forest at golden hour, under a cloudy sky."

### levels-view: keep, with exact steps and a new alt text
- The steps can work. The demo page passes its address switches on to the sketch. A development build reads `?hold=` and `?view=` (examples/index.ts; `levels` is in packages/engine/src/debug/view-names.ts). Exact steps: development build, WebGPU, open the demos page at `?demo=forest&hold=2&view=levels`, and capture the held frame. On WebGL2, also add `compile=wait`, as the image tests do for this view.
- The alt text is wrong. The forest's trees and bushes have four levels each (examples/lib/trees.ts, `partLevels` builds levels 0 to 3). So the view draws blue, green, yellow and orange, as tests/image/references/chrome-real-gpu/webgpu/lod-levels.png and lod-levels-hide.png show. Cyan is the sixth lower level and gray comes after it, so neither appears. Use: "The forest in the levels view: near trees in blue, farther ones in green, yellow and orange."
- The understory stops drawing at 300 m (examples/forest/planting.ts). Bushes past that distance may show as checked magenta markers under the trees. Check the capture before you write that into the caption.
- Fallback if the scripted capture fails: tests/image/references/chrome-real-gpu/webgpu/lod-levels-fade.png. It shows the color per level and the dithered fade band on simple spheres.

### bias-compare: drop as proposed, use two test pictures instead
- The steps cannot work. After hold mode draws the held frame, it runs no more frames (docs/guides/testing.md, "the engine draws nothing more"). Pressing B after the capture changes nothing. The sketch has no address switch for the bias. Its only control is the B key (examples/forest/sketch.ts).
- A live capture would also be weak. The hero fir stands about 40 m from the opening camera among thousands of firs of the same kind (woods.ts `addHero`, position [30, ·, 150]). At that distance a bias of 0.25 against 1 changes very little that the eye can see. A crop could not show which tree is the hero.
- Corrected source (reference): put tests/image/references/chrome-real-gpu/webgpu/lod.png beside tests/image/references/chrome-real-gpu/webgpu/lod-bias.png. In both pictures each sphere draws its level in a color. With a bias of 2, every copy stands at half the distance and still draws the same level. This shows "a bias moves the switch distance" directly. Alt: "Left: copies at bias 1. Right: at bias 2 the same levels switch in at half the distance."

### impostors: keep, with a new alt text
- The source is right. tests/image/references/chrome-real-gpu/webgpu/demo-impostors.png exists and is the demo's default view, held at 3 seconds.
- The alt text claims three visible bands. The bands do not show, because the hand-overs are made to be invisible. Use: "A pine forest on rolling hills at golden hour, with the low sun over the far ridge." The caption can say that the far trees are cards and that you cannot see where the cards start.

## Demo links

1. Levels of meshes made in code (forest/): **drop here, move it.** The code exists in examples/demos.ts. But the forest sets its levels by hand: `meshOfLevels` in examples/lib/trees.ts calls `setLevels`, and its comment says "The levels are set by hand". Levels set by hand stop the planner (see "Give a mesh its levels by hand"). A reader who opens forest/ to see the planner will not find it. Put the same link under "## Give a mesh its levels by hand", where it is correct.
2. The bias of one object (forest/): **keep.** `addHero` in examples/forest/woods.ts calls `setLevelBias(0.25)`, and the B key turns it off and on.
3. Distance bands (forest/): **keep.** examples/forest/planting.ts calls `undergrowth.setDrawRange(0, UNDERSTORY_EDGE)`. Note that impostors/ shows distance bands more clearly: its sketch.ts sets three overlapping bands by hand and with `handOverToCards`. Add impostors/ here as a second link.
4. Cards beyond the levels (impostors/): **keep.** The sketch draws LOD meshes near, merged cells in the middle and impostor cards far out, with `handOverToCards`. The page text already names `examples/impostors`. Make that text the link.
5. A level that morphs instead of fading (terrain/): **keep.** The terrain sketch uses the terrain add-on's morph. `?morph=off` turns it off (examples/terrain/sketch.ts).

## Concepts said to have no demo

- Cluster levels: **confirmed.** No demo or comparison uses `--clusters`. There are pictures from the image tests that show it: tests/image/references/chrome-real-gpu/webgpu/cluster.png (fine patches near, coarse ones far) and cluster-far.png.
- Pieces of a large level: **confirmed.** No demo shows it, and the result looks the same with or without pieces.
- Staged downloads (`--stages`, `maxLevels`): **confirmed.** No demo uses `maxLevels` or staged files.
- A material per level: **confirmed.** The demos call `setLevels` in forest, impostors and the island showcase, and none of those levels names a material.
- Shadow-map levels: **confirmed for demos.** The forest's shadows use coarser levels, but nothing in the demo makes that visible. A picture from the image tests shows it well: tests/image/references/chrome-real-gpu/webgpu/lod-shadows.png, where a smooth sphere casts the coarse level's angled shadow. That picture would fit under "## Shadows".
