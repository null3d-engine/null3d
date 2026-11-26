# Shot and demo-link verdicts: guides/custom-shaders

## Shots

### custom-shader-inputs: KEEP
The reference image exists at tests/image/references/chrome-real-gpu/webgpu/demo-shader-inputs.png (also in the compat and webgl2 folders). It shows the default view of the Custom shader inputs demo: a spiral of crystals colored by row, and three stones with bands. The demo's sketch makes both looks with `materials.shader` and surface functions, so it fits "Custom materials". The alt text is right but leaves out the banded stones. A better alt: "Crystals in one batch colored by their row, and stones with bands, both drawn by custom materials."

### shader-error-overlay: DROP
The source is wrong. A "manual" shot is only for the browser's own developer tools. Vite's error overlay is part of the page, not developer tools. A scripted shot is not possible either: no demo or test page has a switch that breaks a tagged literal, so the steps would need a project with a broken file. The picture also adds little. The page already prints the exact error text in a code block, and that text is what a reader needs.

### Suggested extra shot: custom-full-shader (reference)
The image test for full shaders has a reference at tests/image/references/chrome-real-gpu/webgpu/custom-full-shader.png (also compat and webgl2). It shows the same hologram that the page's "Full shaders" example writes: rim glow and scan lines on spheres and batch instances, a lit standard sphere for contrast, and a quad colored by vertex colors. It would show the reader, under "Full shaders", that a full shader ignores the scene's lights. Alt: "Hologram spheres from a full shader beside a lit standard sphere."

## Demo links

### shader-inputs/ for "custom materials": KEEP
The code exists in examples/demos.ts. The sketch has two custom materials with surface functions, one with `struct Uniforms` and `set()`.

### compare/battle/ for "build sizes of custom materials": KEEP
The code exists in examples/compare/comparisons.ts. The page's own example names "the battle comparison's sketch" and its 5 custom materials, and examples/compare/battle/sketch.ts has exactly 5 `materials.shader` calls. The link lets the reader check the numbers against real code.

## Concepts said to have no demo

- full shaders: confirmed, no demo. No sketch under examples/ declares an `InstanceIn` vertex input. The image test page above shows one, but it is not a demo, so it cannot take a demo link.
- whole shaders: confirmed, no demo. The rain demo (rain/) has a `@vertex` entry point, but it is a draw shader from a vertex count, not a whole shader. Note: rain/ is a good link for the draw-shader item in "What the plugin compiles".
- hot reload: confirmed, no demo. It is a dev-server behavior; no demo shows it.
- typed uniforms: partly shown. shader-inputs/ declares `struct Uniforms { picked: u32 }` and calls `carved.set({ picked: ... })`, which the type check covers. It does not show a type error, so a link is optional.
