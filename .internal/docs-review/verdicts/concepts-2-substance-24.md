# concepts-2-substance-24

Finding as given:

```json
{
 "page": "concepts/quality-preset-tables",
 "anchor": "Row \"Screen-space bounce light (bounceRays)\", line 71: \"4 rays each way\"",
 "category": "wrong-claim",
 "severity": "low",
 "claim": "\"each way\" is copied from the skin blur row. The setting is the number of rays that each texel casts.",
 "evidence": "packages/engine/src/quality/preset-docs.ts:106-108; packages/engine/src/quality/presets.ts:240, 658.",
 "proposedEdit": "In preset-docs.ts:108 print `${value} rays per texel`.",
 "generatedSource": "packages/engine/src/quality/preset-docs.ts",
 "id": "concepts-2-substance-24",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: survives

Evidence:
- docs/concepts/quality-preset-tables.md:71 prints "off (WebGL2: 4 rays each way) | 4 rays each way | 8 rays each way".
- packages/engine/src/quality/preset-docs.ts:105-108: the bounceRays printer returns `${value} rays each way`, the same wording as the subsurfaceSamples printer just above it (lines 96-99, "taps each way").
- packages/engine/src/quality/presets.ts:240-242: "The rays that each texel of screen-space bounce light casts over its hemisphere". presets.ts:657-662 (TSDoc): "The rays that each texel of screen-space bounce light casts".
- crates/null3d-render/src/bounce.rs:90 ("The samples that each texel gathers") and crates/null3d-shaders/wgsl/bounce.wgsl:192-206: one loop of `samples` rays per texel over the hemisphere. There is no split into two directions or two passes, so "each way" has no meaning for this setting.
- Nothing else on the page explains the phrase. A reader could think the count doubles, or that the pass is a separable blur like the skin blur.

Corrected edit: none needed. In preset-docs.ts change the bounceRays printer to `${value} rays per texel`, then regenerate the page. Severity low is fair.
