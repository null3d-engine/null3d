# Shot and demo-link verdicts: api/lines

## Shots

### sprites-lines: keep
- The reference exists: tests/image/references/chrome-real-gpu/webgpu/demo-sprites-lines.png (also in compat/ and webgl2/). It shows the helix and the gold dashes around the pool rim, with the spark fountain in the middle.
- It is 320 x 180 pixels, so it is small on a docs page. It works as an opening picture, not as a detail picture.
- Caption must not repeat the page's error: the demo's helix is NOT lit (no `lit: true` in examples/sprites-lines/sketch.ts). The dashes are 3 CSS pixels wide, not world units. Alt text as proposed is fine.

### lines-lit-vs-unlit: keep, change the source
- "Capture both test pages" is wrong. The `lines` test page has no lit lines, so the two frames do not compare lit and unlit lines.
- The single reference tests/image/references/chrome-real-gpu/webgpu/lines-lit.png already holds both: two lit helixes (one rough, one metallic) shaded by the sun and a red point light, a lit emissive blue bar, and an unlit magenta line that keeps its flat color. Use it as a "reference" shot. No capture is needed.
- Suggested alt: "Two helixes shaded by a sun and a red light, a glowing blue bar, and a flat magenta line that the lights do not change".

### lines-widths: keep, change the source
- The proposed steps say "make a test sketch". No page can do that today, so the scripted source is not real.
- The same lines-lit.png reference already shows the contrast. The unlit magenta line is 4 CSS pixels wide and runs from near the camera far into the fog, at the same width all along. The yellow dashed line is 0.15 world units wide and runs the same way; it is wide near the camera and thin far away.
- Second choice: tests/image/references/chrome-real-gpu/webgpu/lines.png (640 x 360). Its magenta loop on the floor is in world units and narrows toward the back, but its pixel lines do not recede, so the contrast is weaker. It is a good picture for "Create a batch" (strip, segments, loop, dashes and a blended line).
- If lines-lit.png is used for "Lit lines", use lines.png here (or the other way round) so the page does not show one picture twice.

## Demo links

### World-unit lines and dashes -> sprites-lines/: keep
- `sprites-lines` has no `code` value in examples/demos.ts, so "sprites-lines/" is the right form. The folder exists.
- The sketch draws a 0.05 world-unit helix and a dashed loop with a moving dashOffset, which matches "## Dashes".
- Warning for the page text: the page's intro calls the helix "lit"; it is not. The demo also writes point colors of 2 and 2.4 and its comment says "colors above 1 glow through bloom", but the core packs point colors to 8-bit sRGB (crates/null3d-core/src/lines.rs `srgb8`), which clamps them at 1, as the page itself says. Fix the intro sentence, and fix the demo comment and colors (or make the lines lit and emissive) so a reader who copies the demo is not misled.

## Concepts said to have no demo

- Debug lines: confirmed. No demo calls debug.line or other debug drawing (only debug.stats in skyway).
- lineThreshold raycasts: confirmed. Only a test page (tests/pages/sketches/raycast-rows-sketch.ts) uses it.
- setActiveCount for a growing trail: confirmed for a growing trail. The `sound/` demo (examples/sound/storm.ts) calls setActiveCount on a line batch, but only to hide (0) and show (all points) the lightning bolt; nothing grows.

## Extra demo link found
- `sound/` (Positional sound) draws each lightning bolt as a line batch in `segments` mode: lit, black color, emissive with emissiveIntensity 9, additive blending, no depth write, no fog, static with markDirty. This is exactly the page's advice for a line brighter than 1 for bloom, and for additive lines that need no sort order. Its default view (demo-sound.png) shows a bolt. Link it under "Lit lines" or "Blending, sorting and depth".
