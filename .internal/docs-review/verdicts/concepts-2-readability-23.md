# Verdict: concepts-2-readability-23

## The finding as given

- page: concepts/materials
- anchor: "## Why a new combination can make a frame late (line 119)"
- category: example-placement
- severity: medium
- claim: The section that explains the cost of the option table comes at the end of the page, far from the table (48-69). It says 'use its combinations in the first frames' with no code and no link to the warm-up guide, but the front matter summary promises 'pipeline warm-up'.
- evidence: Line 121. docs/guides/loading-screens.md has '## Pipelines and warm-up' (line 118).
- proposedEdit: Move the section to right after 'Fixed options choose the pipeline'. Add a short example that creates every variant in setup. Add: '[Loading screens and warm-up](../guides/loading-screens.md#pipelines-and-warm-up) shows how to build them before play.'

Verdict: partly

## Evidence

What holds:
- docs/concepts/materials.md:6 promises "pipeline warm-up". The page has no link to the warm-up guide and never names `scene.warmUp()`. Line 121 gives only the vague advice "use its combinations in the first frames".
- The problem is worse than the finding says. Line 121 says an object with a new combination "can make that frame late". The other pages say this is mostly not true. docs/api/scene.md:579 says: after the first frame, "an object whose pipeline is still building draws nothing until it is built". docs/guides/loading-screens.md:194 says the same: without a warm-up, "each new object appears when its pipeline is built, which can be a few frames after the others". A frame waits for a compile only on WebGL2 without the parallel compile extension, for example Firefox and Chrome on some Android phones (loading-screens.md, the list under "Pipelines and warm-up"). So the section title and its main claim mislead. The documented fix is `scene.warmUp()` with hidden objects (loading-screens.md:180-194). Using combinations "in the first frames" is not that fix.

What does not hold:
- The move is a matter of taste. The section covers custom materials too: line 117 says each new WGSL costs its own pipeline compiles. So the end of the page, after "Custom materials share shaders", is a fair place for it. Line 23, near the top, already says that a new combination costs a compile.
- The proposed example repeats code that the page already has. Lines 71-75 already create two variants in setup. Creating materials alone also builds nothing: `scene.warmUp()` builds the pipelines of the objects in the scene, hidden ones included (loading-screens.md:194). It does not build pipelines for materials that no object uses. An example of "every variant in setup" would teach the same wrong idea that line 121 teaches now.

## Corrected claim

The last section (line 119-121) does not link the warm-up guide or name `scene.warmUp()`, though the front matter promises pipeline warm-up. Its claim that a new combination makes a frame late is also wrong for most paths. After the first frame, an object whose pipeline is still building draws nothing until the pipeline is built. Only WebGL2 without parallel compile makes the frame wait. The section's place on the page is fine.

## Corrected edit

Keep the section where it is. Rename it "## Why a new combination can appear late" and replace its paragraph with:

A pipeline compiles the first time the scene draws a combination of shader variant, state and vertex format that it has not drawn before. The GPU driver can take many milliseconds for that, on a phone above all. The first frame waits for its pipelines. After that, an object with a new combination draws nothing until its pipeline is built, so it can appear a few frames late. On WebGL2 without parallel compiles, the frame waits for the compile instead. To show new objects complete, create them hidden, `await scene.warmUp()`, then show them. [Loading screens and warm-up](../guides/loading-screens.md#a-later-loading-stage) shows the pattern, and [Pipelines and warm-up](../guides/loading-screens.md#pipelines-and-warm-up) gives the build times.

Do not add a new example that only creates materials. If an example is wanted, use the hidden-objects pattern from loading-screens.md:184-191, or rely on the link.
