# concepts-2-substance-16

## Finding as given

- page: concepts/materials
- anchor: Front matter summary ("pipeline warm-up"); ## Why a new combination can make a frame late, line 121
- category: missing-content
- severity: medium
- claim: The page tells the reader to use every combination in the first frames, but it names no warm-up tool, such as createEngine's preload option, and it does not link the loading screens guide. The summary says "permutations", but the body says "variants".
- evidence: docs/concepts/materials.md:6, 121, 123-128; docs/concepts/shadows.md:425 (preload: ['cutout']); docs/guides/loading-screens.md.
- proposedEdit: Add: "Pass the shader features you will need to createEngine({ preload }), and keep a loading screen until engine.firstFrame resolves. [Loading screens and warm-up](../guides/loading-screens.md) shows how." Add the guide to Related pages. Use "variants" in the summary.

Verdict: partly

## Evidence

Holds:
- materials.md:6: the summary promises "permutations; pipeline warm-up". The body uses "variant" everywhere (lines 18, 50, 55-63, 83, 117, 121) and never says "permutation".
- materials.md:121: the only warm-up advice is "use its combinations in the first frames". The page never names `scene.warmUp()`, `preload` or `engine.firstFrame`. Related pages (123-128) do not link the loading screens guide. Sibling concept pages do link it (architecture.md:83, culling.md:94, lighting.md:359, quality-presets.md:338).

Does not hold:
- The proposed edit names the wrong main tool. `preload` only downloads the shader files of features that load on first use (loading-screens.md:198-215; first-use-shaders.md:34-41). It does not build the pipelines that the section is about. The tool that builds pipelines is `scene.warmUp()` (loading-screens.md:182-194). Even the preload paragraph says to use `scene.warmUp()` to build the pipelines before the loading screen goes (loading-screens.md:215).
- "Keep a loading screen until engine.firstFrame resolves" only covers the first frame. The section is about objects that appear later in play. For those the guide's answer is: create them hidden, `await scene.warmUp()`, then show them (loading-screens.md:182-190).

Also found while checking (supports a rewrite of line 121):
- materials.md:121 says a new combination "can make that frame late". loading-screens.md:136-141 and architecture.md:83 say that after the first frame the engine does not wait: an object whose pipeline is still building draws nothing until the build ends. A frame is late only on WebGL2 without `KHR_parallel_shader_compile` (Firefox, some Android Chrome; loading-screens.md:139). So the page's main claim overstates the cost on most paths, and its heading repeats it.

## Corrected claim

The page's summary says "permutations" and "pipeline warm-up", but the body says "variants" and names no warm-up tool. Line 121 tells the reader to "use its combinations in the first frames" without naming `scene.warmUp()`, and the page does not link the loading screens guide. `preload` is a secondary tool here: it only fetches the shader files of material features that load on first use (`'transmission'`, `'coat_sheen'`, `'translucency'`, `'cutout'`).

## Corrected edit

Replace the paragraph at line 121 with:

"A pipeline builds the first time the scene needs a combination of shader variant, state and vertex format that it did not need before. The GPU driver can take many milliseconds for that, on a phone above all. The first frame waits until all of its pipelines are built. After that, the engine does not wait: an object whose pipeline is still building draws nothing until the build ends. On WebGL2 without parallel shader compiles, as in Firefox, the first draw waits for its compile, so that frame is late. Create every material in the setup and `await scene.warmUp()` before play starts. For objects that appear later, create them hidden, await `scene.warmUp()`, then show them. Some material features, such as transmission and clear coat, download their shaders on first use. List them in `createEngine`'s `preload` option so nothing downloads during play. [Loading screens and warm-up](../guides/loading-screens.md#pipelines-and-warm-up) shows how."

Retitle the heading to "## Why a new combination can make an object appear late" (or similar), so it does not repeat the overstated claim.

Add to Related pages: "- [Loading screens and warm-up](../guides/loading-screens.md): build pipelines before play, and load feature shaders up front."

Change the summary to: "Built-in materials; shader variants; pipeline warm-up; why a new combination of shader features costs a build."
