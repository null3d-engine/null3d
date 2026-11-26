# Shot and demo-link verdicts: api/three-compat

## Shots

### outline-plain-and-glow: keep, change the source to "reference"
- The picture helps. It puts the core's crisp outline beside the add-on's soft outline with glow, and that is the main point of "The outline".
- The source is wrong. No script is needed, because both pictures exist as reference images:
  - tests/image/references/chrome-real-gpu/webgpu/outline-plain.png (thin white line around the visible part of the sphere and the red box)
  - tests/image/references/chrome-real-gpu/webgpu/outline-compat-glow.png (soft orange edge and glow around the same meshes, the hidden part of the sphere included)
- Both come from one test sketch (tests/pages/sketches/outline-sketch.ts, with the switches outline=plain and compat=glow), so the scene and camera match. Place the two side by side.
- The glow picture uses the colors '#ffaa00' and '#3070ff', not the page's example colors. The caption must not say it shows the page's code.

### tone-curves: keep, change the source to "reference"
- The picture helps. The same tiles under Reinhard, Cineon and ACES show how each curve treats bright colors, and the page has the table of those three curves.
- The source is wrong. All three views exist as reference images at an exposure of 1:
  - tests/image/references/chrome-real-gpu/webgpu/tone-reinhard.png
  - tests/image/references/chrome-real-gpu/webgpu/tone-cineon.png
  - tests/image/references/chrome-real-gpu/webgpu/tone-aces.png
- They come from the bright tiles sketch (tests/pages/sketches/bright-sketch.ts, switches tone=reinhard, tone=cineon, tone=aces, stops=0). Place them side by side, labeled.

## Demo links
None were proposed.

## Concepts without a demo
- Reinhard and Cineon tone curves: confirmed. No demo in examples/demos.ts and no comparison in examples/compare/comparisons.ts imports the add-on or uses those curves. Only the image tests and a bench page use them.
- The soft outline pass: confirmed. Only the outline test sketch calls the add-on's outline. The post-effects, picking and gizmos demos mark outlined meshes, but they use the core's crisp line, not the soft pass.
