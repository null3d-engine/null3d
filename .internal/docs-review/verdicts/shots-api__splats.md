# Shot and demo-link verdicts: api/splats

All reference pictures named below exist in the webgpu, compat and webgl2 tiers, and all are 320 x 180.

## Shots

### splats-demo: KEEP
- Source is right. `tests/image/references/chrome-real-gpu/webgpu/demo-splats.png` exists and shows the priory scan from the demo's first view.
- It helps: the intro describes splats in words only, and this shows a real scan.
- Caveat: the reference is only 320 x 180. It will look small as a page-wide picture. A full-size capture of the demo's held frame would read better, but the reference is a valid source.

### splats-budget: KEEP, source corrected
- The proposed steps are wrong. The image test page (`tests/pages/sketches/splats-sketch.ts`) draws 36,000 splats by default. The Low preset's budget is 100,000 on WebGPU and 50,000 on WebGL2, so Low and Ultra both draw the whole cloud. The two pictures would be the same.
- The test page caps the count with its `budget` switch (`splats.setBudget`), not with the preset. A reference pair already exists:
  - `tests/image/references/chrome-real-gpu/webgpu/splats.png`: the whole cloud, 36,000 splats.
  - `tests/image/references/chrome-real-gpu/webgpu/splats-budget.png`: the same cloud capped at 9,000.
- The difference is visible: the capped cloud draws fewer, larger splats that still cover the knot. This shows the "fewer, larger splats rather than a sparse one" point.
- Place it beside the `setBudget(count)` sentence, not the preset table. New alt text: "A test cloud of 36,000 splats beside the same cloud capped at 9,000 splats".

### splats-gltf: DROP
- The source is wrong too: no script is needed, because `tests/image/references/chrome-real-gpu/webgpu/splats-gltf.png` already exists.
- But the picture does not help. It shows a wavy band of splats behind a bar. Nothing in it shows that the model came from glTF, or the per-part sort that the section explains. The first shot already shows what splats look like.

### splats-stats-overlay: DROP
- The steps are not quite possible as written. A script cannot call `settle()` from outside the demo. The demo's overlay starts collapsed to the frame rate, so a script must also click its button to open it.
- The picture does not help this page. The text already says what the row reads (`gpu not measured`). A picture of a text panel adds little here, and it fits the stats overlay's own page better.

## Demo links

### Streaming and the budget -> splats/: KEEP
- The splats demo has no `code` value in `examples/demos.ts`, so `splats/` (its name) is the right code. No comparison covers splats.
- The sketch streams 1.7 million splats from a stream index of 84 chunk files, nearest first, within the preset's budget. That is the concept.

## Concepts said to have no demo

### chunkSplats and encodeSpz: CONFIRMED
- No demo or comparison calls them. The splats demo reads a stream that was built before.
- The stream is built by `tools/samples/splats/bolton-priory.ts`, which calls them, but that is a tool, not a demo. It cannot be a demo link under the website contract.

### softness: CONFIRMED
- No demo sets `softness`. The splats demo uses the default, but its drone flies above the scan and never meets the splats, so no soft edge shows.
- The image test page sets `softness: 0.3`, and `tests/image/references/chrome-real-gpu/webgpu/splats.png` shows the knot fading where it meets the ground, and the bar hiding splats behind it. That reference would suit "What it draws" as a new shot.
