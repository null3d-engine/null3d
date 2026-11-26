# Shot and demo-link verdicts: concepts/backends

## Shots

### three-tiers: KEEP
- The three files exist: tests/image/references/chrome-real-gpu/{webgpu,compat,webgl2}/demo-environment.png (320 x 180 each).
- All three show the same frame of the environment demo (the sunset environment, held at 1 s). They look alike, so the picture supports "the same sketch runs on every tier".
- The source is really "reference" files joined into one image. The steps are correct as written.
- Caption note: the compatibility-mode image looks a little softer. That is expected, because compatibility mode and WebGL2 run at most the Medium preset. A caption that says so stops a reader from reading the softness as a bug.

### depth-modes: REJECT
- The depth precision test page cannot give this picture. It publishes its frame with every fighting pixel painted over as the nearer surface (withoutFighting in tests/pages/lib/depth-precision.ts). The page says so in its header comment.
- Because of that, every depth mode shares one reference image (manifest: depth-precision-${depth} uses reference 'depth-precision'). tests/image/references/chrome-real-gpu/webgl2/depth-precision.png shows clean blue tiles, with no fighting.
- The steps are also wrong. The page has no switch for camera distance. It draws a fixed 4 x 3 grid of tile pairs from 1 m to 10 km. Its near plane (0.1 m) is fixed too.
- A still image also cannot "flicker". Fighting would show as red speckles.
- What it would take: a switch on the depth precision page that publishes the raw frame. Then a capture of ?gpu=webgl2&depth=standard beside ?gpu=webgl2&depth=reversed would show red speckles in the far tiles of the first image only. That is test-page work, not a screenshot. The table under "## Depth on each tier" already gives the distances.

### devtools-capabilities: REJECT
- No steps are given, and the demo page does not put the engine on window. examples/lib/run.ts keeps `engine` in a local variable, so typing `engine.capabilities` in the console of the environment demo gives a ReferenceError.
- The page already prints the shape of engine.capabilities in a code block under "## Capability flags". A console picture would repeat that block, and would go out of date each time a field is added.

## Demo links
None were proposed.

## Concepts said to have no demo
- Tier choice: confirmed. No demo sketch chooses or reports its tier. The comparison pages show the tier in their label, but that label comes from the shared harness (examples/lib/compare.ts), not from the linked code. Every demo accepts ?gpu=, but a GitHub code link cannot show a URL switch.
- Capability flags: confirmed. No demo sketch reads engine.capabilities or ctx.engine.capabilities.
- The portable budget: confirmed. The largest instanced demo (instances, 100,000 columns) stays far below the 2,097,152 limit and does not read maxInstances.
- Devices with two GPUs: confirmed. No demo passes powerPreference.
- Device loss: confirmed. No demo forces or handles a device loss. The tests/image/gpu-loss.spec.ts test covers it, but it is not a demo.
- Minimum browsers: confirmed. No demo covers it.
