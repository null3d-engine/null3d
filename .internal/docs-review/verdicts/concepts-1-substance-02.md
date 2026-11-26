# concepts-1-substance-02

Finding as given:

- page: concepts/backends
- anchor: ## Color and anti-aliasing on each tier, line 60 "One exception: when the start-up preset check lowers the preset, the demo draws"
- category: contradiction
- severity: high
- claim: The page says the anti-aliasing mode stays fixed apart from one exception, the preset check. There is a second: in compatibility mode with MSAA, the first effect that needs HDR color moves the engine to FXAA for the rest of its run. Line 82 of the same page says so. The sentence also says 'the demo draws', but this is an engine rule.
- evidence: docs/concepts/post-processing.md:406; backends.md:82; color-management.md:69; quality-presets.md:204 also names only the preset check.
- proposedEdit: 'The mode stays fixed while the engine runs, because the scene's targets and pipelines depend on it. Two cases move it. When the start-up preset check lowers the preset, the engine draws with the lower preset's mode. In compatibility mode with MSAA, the first effect that needs HDR color moves the engine to FXAA ([The post-processing chain](post-processing.md#effects-on-devices-without-hdr-color)). A sketch's own preset change never moves it.' Make the same change in quality-presets.md:204.

Verdict: survives

Evidence:

- backends.md:60 says "The mode stays fixed while the engine runs ... One exception: when the start-up preset check lowers the preset, the demo draws with the lower preset's mode."
- backends.md:82, in the same section, says "Bloom moves compatibility mode to HDR color with FXAA when a sketch turns it on". So the page contradicts itself.
- post-processing.md:406 says the first HDR-needing feature "moves the engine to HDR color with FXAA, for the rest of its life".
- The code confirms it: packages/engine/src/sketch/runner.ts:1716-1744 (followBloom). On a device that started on the 8-bit path only for MSAA, the first of bloom, depth of field, a custom effect, a custom tone curve, a reflection pass, volumetric fog with slices, or page/sketch-set subsurface blur taps calls glue.setCanvasOutput(device.effectsSceneColor, device.effectsAntialias). That moves the anti-aliasing mode while the engine runs.
- quality-presets.md:204 says "The start-up preset check is the one case that moves it". That is the same false claim.
- "the demo draws" is wrong. This is engine behavior for every sketch, not one demo.
- The link target post-processing.md#effects-on-devices-without-hdr-color exists (heading at post-processing.md:402). The proposed edit breaks no writing rule.

Notes: severity could be medium, not high, because line 82 of the same section gives the second case. But "One exception" is a false statement, and quality-presets.md has no such correction. The proposed edit stands as written.
