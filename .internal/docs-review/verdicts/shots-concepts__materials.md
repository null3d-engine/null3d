# Shot and demo-link verdicts: concepts/materials

## Shots

### alpha-modes-side-by-side: keep, with corrections
- The picture helps. The hash test image shows the dotted pattern clearly, and the mask image shows hard cut edges. A reader sees the difference at once.
- The source type is wrong. No steps run. The four images already exist as reference images, so the source is "reference" (a row of existing references), not "scripted".
- The alt text is wrong. The test scene has ring-shaped cards cut by vertex alpha in front of a blue wall. It has no leaves.
- At full size, the mask and alpha-to-coverage images look the same. The edge smoothing is under one pixel. The no-MSAA image also looks like the mask image. Use mask and hash at full size. Show coverage only as a zoomed crop of one card edge beside the same crop from mask, or leave it out.
- Corrected source: tests/image/references/chrome-real-gpu/webgpu/alpha-mask.png and webgpu/alpha-hash.png. Optional zoomed crops from webgpu/alpha-coverage.png and webgpu/alpha-mask.png.
- Corrected alt: "Ring-shaped cards cut out by alpha: hard edges with mask, a dotted pattern with hash".

### weighted-transparency: keep
- tests/image/references/chrome-real-gpu/webgpu/demo-weighted-transparency.png exists and shows the glass pavilion. Its panes overlap and blend. The demo's default view uses the weighted blending.
- The reference is only 320 by 180 pixels. The website may want a larger capture of the same view.

### pipeline-compile-stall: drop
- No demo adds a material during play. "Any demo that adds a material during play" names nothing that a person can run.
- On WebGPU, the engine builds most pipelines in the background (the backend's prepare step uses the async pipeline call). The draws that use a new pipeline draw nothing until it is built. So the Performance panel often shows no long frame. The object appears a few frames late instead. The picture would not show what the caption says.
- A flame chart depends on the GPU and the driver. Nothing in it tells the reader that the long task is a pipeline compile.

## Demo links

| Concept | Code | Verdict |
| --- | --- | --- |
| Clear coat and sheen variants | coat-and-sheen/ | Keep. The car paint, glass and cobbles use clearcoat. The velvet and rubber use sheen. |
| Iridescence and anisotropy variants | iridescence-and-anisotropy/ | Keep. The beetle shell and bubbles use iridescence. The plinth uses anisotropy with a map. |
| diffuseTransmission | translucency/ | Keep. Leaves, petals and the lantern use diffuseTransmission. |
| subsurfaceRadius and the skin pass | subsurface/ | Keep. Wax, jade and soap use subsurfaceRadius. The demo says the effect shows only on the High and Ultra presets. The link text should say so too. |
| Weighted blending | weighted-transparency/ | Keep. Panes and smoke use blending 'weighted'. The S key swaps to normal blending, so the demo also shows the sort limits on this page. |
| Custom material WGSL and uniforms | shader-inputs/ | Keep. The stones' WGSL declares a uniform, and set() changes it with no new material. 900 crystals share one custom material. |
| Decal material | decals/ | Keep. Every mark is materials.decal. |
| Values changed every frame at no cost | property-animation/ | Keep. The plinths share one material whose color and emissive change each frame. It uses animateProperty, not set(). The link text should say that. |

All codes exist in examples/demos.ts. property-animation has no code field, so "property-animation/" is right.

## Concepts said to have no demo

- shadow catcher material: confirmed. No demo uses materials.shadowCatcher. The image test reference webgpu/shadow-catcher.png shows it and could be a shot.
- hash alpha mode: confirmed. No demo uses alphaMode 'hash'. The image test webgpu/alpha-hash.png shows it.
- flat shading: confirmed as a featured concept. Some demos use it in passing (terrain/ stones, walk-and-fly plain blocks, the contact-shadows garden), but none is about it.
- colorWrite: false: NOT confirmed. The depth-only demo (code "depth-only/") is about it. A plane with colorWrite false holds back the hall behind it, so the page shows through. Its reference is webgpu/demo-depth-only.png. Link it from the colorWrite row of the options table.
- pipeline compile stall: confirmed. No demo shows it.
