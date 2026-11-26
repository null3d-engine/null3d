# Verdicts: errors/E1224 (shots and demo links)

## Shots

### objects-default: keep
- The reference exists: tests/image/references/chrome-real-gpu/webgpu/demo-objects.png (also under compat and webgl2).
- It shows six crates in six finishes on the turntable stage, so it matches the alt text.
- As the left half of a pair, it helps a reader see what a valid override changes. Source is right.

### override-one-material: keep, but change the source to "reference"
- The scripted steps are not needed. A reference of this exact view already exists:
  tests/image/references/chrome-real-gpu/webgpu/demo-objects-one-material.png (also under compat and webgl2).
- The manifest entry "demo-objects-one-material" loads examples/objects/sketch.ts?look=one with the same 2.5 s hold, so the pose and time match the left image.
- The steps would work (the demo has a "look" choice with "Materials" and "One material"), but a held reference is exact and needs no capture.
- Small alt fix: the override covers every mesh of the main pass, the stage floor too, not only the crates.
  Suggested alt: "The same turntable stage with the floor and every crate drawn in one plaster material."

## Demo links

### objects/ for "scene.overrideMaterial with a mesh material": keep
- The objects demo has no code value in examples/demos.ts, so "objects/" is the right form.
- The sketch sets scene.overrideMaterial to one materials.standard() material when the Look choice is "One material", and back to null for "Materials". That is the fix this page describes.

## Concepts said to have no demo

### Refusing a sprite, line or particle material as the override: confirmed
- No demo or comparison sets a sprite, point or line material as the override, and nothing under examples/ raises this error. The only other override use is a test page (tests/pages/sketches/override-material-sketch.ts), which also uses a mesh material.
