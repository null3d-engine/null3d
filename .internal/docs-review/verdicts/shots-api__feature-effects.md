# Shot and demo-link verdicts: api/feature-effects

## Shots

### feature-effect-before-after — keep, with a corrected source

The picture helps. The page is about a full-screen pass, and a pair of frames, sharp and blurred by distance, shows what such a pass does better than the code alone.

The source is wrong in one point: the proposal says it "needs a new test page". A test page already exists. `tests/pages/sketches/feature-effect-sketch.ts` declares the same depth of field with `defineFeature` and places it with `post.addFeatureEffect`. It draws six posts at different distances, focused on the third one. It has a switch, `?dof=off`, that draws the same scene without the feature. The image test `tests/image/feature-effect.spec.ts` already compares those two frames on WebGPU and WebGL2. No reference picture exists for it (the test compares two frames of one run), so the shot stays scripted.

Corrected steps:
1. Open `tests/pages/image.html?gpu=webgpu&hold=0&preset=medium&size=960x540&sketch=/tests/pages/sketches/feature-effect-sketch.ts` and capture the held frame ("with the feature").
2. Open the same address with the sketch switch: `sketch=/tests/pages/sketches/feature-effect-sketch.ts%3Fdof%3Doff` and capture it ("without the feature").
3. Place the two frames side by side under "## A depth of field".

Use `?dof=off` for the "off" frame, not the Low preset. Low also makes the feature not ready (its tap count is 0), but Low changes other settings too, so the two frames would differ in more than the blur. If the page wants to show readiness, say in the caption that the "off" frame is what a not-ready feature draws.

The sketch's scene is not the page's example (the example has no scene, and its focus and uniforms differ). The caption should say the frames come from a scene of posts at different distances, focused on the third post.

## Demo links

None proposed. None can be added: no demo in `examples/demos.ts` and no comparison in `examples/compare/comparisons.ts` calls `post.addFeatureEffect`.

## Concepts said to have no demo

- `post.addFeatureEffect`: confirmed. Only test sketches call it. The aurora demo uses a feature description of kind `'draw'` through the sky-layer hook, not a full-screen effect.
- The description fields: confirmed. No demo defines a full-screen feature description.
- Readiness and values: confirmed. Only the test sketch shows `ready`, `refresh` and `setUniform` on a feature effect.
- The place in the chain of custom effects: confirmed. The post-effects demo uses the engine's own effects and adds no custom one. Some comparisons (battle, night-town, factory) call `post.addEffect`, but none places a feature effect by band and order, so they do not show this concept.
