# Shot and demo-link verdicts: api/feature-instances

## Shots

### compute-instances: keep, change the source
- The picture helps. It proves the page's main claim: the GPU writes the rows and the count, and the engine draws exactly that many.
- The source is wrong. A reference image already exists, so this is not a scripted shot: tests/image/references/chrome-real-gpu/webgpu/feature-instances-compute.png (also in compat; not in webgl2, because the manifest limits this page to webgpu and compat).
- The alt text is wrong. The shader draws a disc with a rim inside each quad, so the picture shows round discs, not quads. It shows six rows of seven (42) discs.
- Proposed alt: "Six rows of seven discs that a compute pass placed and counted."
- The image is 320 x 180. It is small, but the subject is simple and still reads.

### instances-shadow: keep, change the source
- The picture helps. It shows that shadows follow the count that the GPU writes (42 discs and their shadows), not the larger count the page sets.
- The source is wrong. A reference image exists: tests/image/references/chrome-real-gpu/webgpu/feature-instances-shadow.png (also compat; not webgl2).
- The alt text should say discs. Proposed alt: "Standing discs, counted on the GPU, cast shadows on the ground."
- Place it after the paragraph that says every shadow view draws the GPU's count (end of "## The count and the instances without compute"), or beside the matching bullet in "## Limits". The caption should say the page fills 64 rows but counts 42, and only 42 cast shadows.

### grass-grove: keep
- The reference image exists: tests/image/references/chrome-real-gpu/webgpu/demo-vegetation-wind.png. Grass covers the lower half of the frame.
- The source is right. On WebGPU the grass add-on (packages/grass/src/grass.ts) calls addComputeInstances and fills it from a compute pass. The demo does not turn compute off.
- Use only the webgpu (or compat) image. On WebGL2 the grass add-on draws a plain instance batch, not this API.
- The alt is ambiguous: the trees are not drawn by a compute pass. Proposed alt: "A grove in a meadow. A compute pass places and counts the grass."
- The intro must name the grass add-on, because the demo's own code calls createGrass, not addComputeInstances.

## Demo links

### vegetation-wind/ (Compute instances in use): keep
- The code exists in examples/demos.ts.
- The demo shows the concept only through the grass add-on. The link text must say so, for example: "The grass add-on draws its blades this way; see it in the Plants in wind demo."
- Other demos also use the grass add-on (contact-shadows, showcase island), but this one is the clearest.

## Concepts said to have no demo

- The WebGL2 path with setInstances: confirmed. No demo calls setInstances. The grass add-on takes a different path on WebGL2 (a plain instance batch). The test page feature-instances does call setInstances, and its WebGL2 reference image exists (tests/image/references/chrome-real-gpu/webgl2/feature-instances.png), but it is a test page, not a demo.
- Conversion to camera-relative rows: confirmed. It is internal and has no visible result. Every user of addComputeInstances runs it, but no demo shows it.
