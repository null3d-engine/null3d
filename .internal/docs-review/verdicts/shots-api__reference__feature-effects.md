# Shot and demo-link verdicts: api/reference/feature-effects

Shots proposed: none. Demo links proposed: none.

## Concepts said to have no demo

- FeatureEffect: confirmed, no demo. No file under examples/ names it.
- post.addFeatureEffect: confirmed, no demo. No file under examples/ calls it.

What I checked:
- The only callers outside the engine are a test page (tests/pages/sketches/feature-effect-sketch.ts) and its image test (tests/image/feature-effect.spec.ts). Test pages are not demos, so the website contract gives them no link.
- The aurora demo uses a feature description, but of the draw kind at the background frame, through the sky-layer hook. It does not use the full-screen adapter, so it does not show this API.
- The lens-kit example add-on uses the plain custom effect call (post.addEffect), not the feature adapter.
