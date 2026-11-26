# Shot and demo-link verdicts: api/animation (slice api-1)

General note: every demo reference image is 320 x 180 pixels (the skeleton test image is 400 x 225), on all three tiers. On a docs page these are thumbnails. If the website shows them wide, recapture the same views larger.

## Shots

### character-blend: keep, but move it and fix the alt text
- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-character.png (also compat and webgl2).
- One still frame cannot show a 1D blend. It shows a knight walking, nothing more. Put it under "## Models from glTF files", where the page already links the character demo, not under "## 1D blends".
- The alt text does not match the picture. The model is the cartoon KayKit Knight. The round shield shows clearly, and the sword does not. Proposed alt: "A cartoon knight with a round shield walks across a cobbled courtyard."

### look-at-ring: keep
- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-look-at.png.
- It shows the ring of knights and the close-up of one face in the corner. This is the best picture for "### Looking at a point".
- Add the close-up to the alt text: "Seven knights in a ring turn their heads toward a wisp of light; a corner view shows one knight's turned face."

### animated-values: drop
- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-property-animation.png.
- The picture does not help. It shows seven yellow plinths, all the same color (they share one material), and two blue lights. A still frame shows no movement, and nothing in it tells a reader about animated values.
- The alt text "in mid-change of color" claims more than the picture shows.
- The demo link for this section does the job. A short clip (GIF or video) would show it, but that is a different kind of asset.

### morph-tulips: keep
- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-morph-flowers.png.
- It shows the tulip bed with heads in different states, which is what the morph weights do. At 320 pixels the open and closed heads are hard to tell apart, so a larger capture would help.
- The alt text is fine.

### skeleton-lines: keep, but change the source to reference and fix the description
- The source is wrong. This view does not need a script. A reference image exists: tests/image/references/chrome-real-gpu/webgpu/gltf-skeleton.png (also compat and webgl2), made from tests/pages/sketches/gltf-skeleton-sketch.ts at its manifest hold time.
- The description is wrong. Only the Fox's lines are blue at the joint and green at the parent. The sketch draws the arm in one color, yellow, to show the color argument. The picture matches the sketch.
- Proposed alt: "Lines from blue to green trace the joints of a running fox; one yellow line traces a waving arm."
- The picture helps. It shows both the default colors and the single-color option that the section describes.

## Demo links

### Layers and joint masks -> character: keep
- The demo has no code field in examples/demos.ts, so the link is https://github.com/null3d-engine/null3d/tree/main/examples/character.
- The sketch calls setLayerMask on layer 1 with the spine joint and plays the sword swing on that layer. It also uses playBlend and setBlend, so the same demo fits "## 1D blends".
- The page already links this demo once, under "## Models from glTF files". A second link at the section that it shows best is fine.

### Joint overrides and look-at -> look-at: keep
- The demo exists in examples/demos.ts. Its sketch calls animator.lookAt with a joint chain, then moves the target each frame.

### Property animation and KHR_animation_pointer -> property-animation: keep, but narrow the concept
- The demo exists. Its sketch calls scene.animateProperty on a light's intensity, a camera's field of view, material values and positions.
- It loads no glTF file, so it does not show KHR_animation_pointer. The sketch only mentions that extension in a comment. Name the concept "Property animation in code", and do not tie the link to "### Files with KHR_animation_pointer".

### Morph targets -> morph-flowers: keep
- The demo exists. Its sketch sets one morph weight on each tulip head with setMorphWeight.

## Concepts said to have no demo

- Inertial transitions: confirmed. No demo or comparison plays with the inertial transition.
- Additive clips: confirmed. The one match, in the battle comparison's scene file, is an additive blend for a material, not an additive clip.
- Events: not confirmed. The character demo calls onEvent with 'finished' and stops the sword swing when it ends. Link the character demo under "## Events".
- Crowds and setUpdateInterval: partly. No demo calls setUpdateInterval or reads farAnimationInterval. The battle comparison (code compare/battle/) does show a crowd: hundreds of animated soldiers and mechs, each a copy with its own animator and start time, batched by the engine. Link https://github.com/null3d-engine/null3d/tree/main/examples/compare/battle under "## Crowds" for the crowd alone.
- Limits of skinning: confirmed. No demo shows these limits.
