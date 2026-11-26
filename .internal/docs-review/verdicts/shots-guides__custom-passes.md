# Verdicts: screenshots and demo links for guides/custom-passes

Note for every reference shot: the reference images are 320 x 180 pixels. They are small for a docs page.

## Shots

### render-to-texture: keep
- Source is right. tests/image/references/chrome-real-gpu/webgpu/demo-security-camera.png exists and shows the monitor with the camera's grainy view.
- Fix the alt text. The monitor does not show "the room". It shows the yard behind the wall, where a robot patrols.
- Suggested alt: "A monitor on a wall shows a night camera's grainy view of the yard behind it."

### post-effects: keep
- Source is right. tests/image/references/chrome-real-gpu/webgpu/demo-post-effects.png exists and shows the neon alley.
- The demo has a real custom effect: the lens kit (examples/addons/lens-kit/index.ts) calls post.addEffect for the fringes, streak, grain and vignette. Most of the rest (bloom, reflections, outline, grade) is built-in.
- Suggested alt: "Crates in a neon alley, with color fringes, a light streak and grain from a custom effect."

### reflection-pass: reject, replace
- The file exists, but the picture does not show a reflection well. The crystal spiral fills the frame. The slate floor's reflection is faint at this size.
- Use the reflection test instead: tests/image/references/chrome-real-gpu/webgpu/reflection-water.png (reflection test sketch with ?water). Red and green boxes and a blue ball mirror clearly in rippled water. It also matches the water recipe in the same section.
- Suggested alt: "Boxes and a ball mirror in rippled water through a reflection pass."

### outline-glow: keep, change source to reference
- A reference already exists. The steps are not needed.
- Source: tests/image/references/chrome-real-gpu/webgpu/fullscreen-glow.png (full-screen test sketch with ?glow).
- That test runs the page's recipe: outline width 0, a half-size full-screen pass over the outline mask, and an effect that adds the glow.
- Suggested alt: "A sphere and a box with a soft warm glow around them."

## Demo links

- security-camera/: keep. A scene pass draws a camera's view, and a monitor material shows it.
- post-effects/: keep. The lens kit adds a real custom effect. The effect code is in examples/addons/lens-kit/, not in the demo's folder, so the link text should say that.
- shader-inputs/: keep. examples/shader-inputs/pool.ts adds a reflection pass and reads it in a custom floor material. The pool code is short and close to the page's code.
- water/: keep. The page sends readers to the water add-on, and this demo uses it.
- compare/battle/: reject. The custom effect is one line in a large comparison sketch. The effect code lives in examples/lib/lens.ts. post-effects/ already shows the same lens effect more clearly.

## Concepts said to have no demo

- custom tone curves: a demo exists. The Creek showcase (showcase/creek/) sets a custom tone curve in examples/showcase/creek/look.ts with post.set({ toneMapping }).
- full-screen passes: confirmed, no demo. No example calls a full-screen pass. A test reference exists: tests/image/references/chrome-real-gpu/webgpu/fullscreen-passes.png shows a posterized minimap and a texture painted from nothing. It suits the "Full-screen passes" section.
- compute passes: a demo exists. The Ocean demo (ocean/) runs compute passes through @null3d/water; its summary says so. The sketch does not call render.addPass itself.
- pass cadence: confirmed, no demo shows it. The water add-on calls setPassEvery inside its own code, but no demo sets a cadence and none of them shows it on screen.
