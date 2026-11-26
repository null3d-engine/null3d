# porting-shaders-substance-05

## Finding as given

- page: shaders/wgsl-rules
- anchor: line 11 "It draws no other shader of your own."
- category: contradiction
- severity: high
- claim: The engine also draws custom effects, custom tone curves, sky layers, full-screen passes and compute passes from the user's WGSL. The sentence tells readers these rules cover only materials, or that the other forms do not exist.
- evidence: docs/errors/E1215.md:13 (effects, tone curves, sky layers); docs/porting/threejs-postprocessing.md:93,189; docs/api/reference/render.md:59,175 (compute passes)
- proposedEdit: 'The engine draws WGSL of your own in custom materials (surface functions and full shaders), custom effects and tone curves, sky layers, and the passes of render.addPass. Every one follows the rules on this page.'

Verdict: survives

## Evidence

- docs/shaders/wgsl-rules.md:11 says the engine draws custom materials with surface functions and full shaders, and "draws no other shader of your own". Nothing else on the page (headings at lines 17-122) names effects, tone curves, sky layers or passes, so nothing corrects it.
- docs/errors/E1215.md:13 lists post.addEffect() (fn effect), post.set({ toneMapping }) (fn toneCurve) and scene.setSkyLayer() (fn skyLayer) as places that take the user's WGSL.
- docs/porting/threejs-postprocessing.md:93 ("A custom effect is WGSL that declares fn effect ...") and :189 (render.addPass({ kind: 'fullscreen', wgsl, ... })).
- docs/api/reference/render.md:175: addPass runs full-screen WGSL and compute shaders written by the user; render.md:55-61 lists compute pass options (dispatch, buffers, fallback).
- Source: packages/engine/src/scene/feature-effects.ts and packages/engine/src/shared/core.ts define addEffect and setSkyLayer; compute passes appear in packages/engine/src/gpu/webgpu/pipelines.test.ts and backend.test.ts.
- wgsl-rules.md:15 already says the build checks the WGSL the Vite plugin compiles from the user's code, which covers all these forms. So line 11 contradicts the page's own scope as well as the other pages.

The sentence is false and tells a reader porting a ShaderPass or writing a compute pass that this page does not apply to them. High severity holds.

## Note on the edit

The proposed edit is correct and follows the writing rules. One small refinement: a compute pass with instance buffers runs on WebGPU alone, so the WebGL2 section does not apply to it, while its fragment fallback does. "Every one follows the rules on this page" stays true in the sense that the build checks each one; no change is needed. The same blockquote also opens with "Roadmap step 0.1", an internal process word, but that is a separate issue.
