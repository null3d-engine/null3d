# concepts-2-substance-03

## Finding as given

- Page: concepts/quality-presets, api/reference/quality
- Anchor: "### GPU occlusion culling, line 239: \"It runs beside the depth prepass\""
- Category: contradiction. Severity: high.
- Claim: The concept page says occlusion culling runs beside the depth prepass. The generated reference says gpuOcclusion is always false when the depth prepass is on. The renderer runs both. A reader who believes the reference may turn off ambient occlusion, bounce light or contact shadows to keep occlusion culling, and gains nothing.
- Evidence: docs/concepts/quality-presets.md:239; docs/api/reference/quality.md:188 from packages/engine/src/quality/presets.ts:838-839; crates/null3d-render/src/frame_graph.rs:1724-1728; docs/concepts/render-graph.md:74.
- Proposed edit: In the TSDoc at presets.ts:838-839, replace "It is always false on WebGL2, and when the depth prepass is on." with "It is always false on WebGL2. With the depth prepass on, the prepass draws the objects that the late culling kept."
- Generated source: packages/engine/src/quality/presets.ts

Verdict: survives

## Evidence

- docs/concepts/quality-presets.md:239 says "It runs beside the depth prepass, which ambient occlusion and screen-space bounce light turn on."
- docs/api/reference/quality.md:188 (from packages/engine/src/quality/presets.ts:831-841) ends "It is always false on WebGL2, and when the depth prepass is on." The two pages contradict each other.
- The code agrees with the concept page:
  - packages/engine/src/page/engine.ts:2663-2666 sets the setting from the tier and device kind only. WebGL2 gives false; nothing reads the depth prepass.
  - packages/engine/src/quality/chooser.ts:62-68 (gpuOcclusionChoice) looks only at the device kind and the page option.
  - crates/null3d-wasm/src/lib.rs:739 gates the renderer flag only on direct draws. crates/null3d-render/src/gpu_driven/mod.rs:1174-1179 turns it off only for direct draws.
  - crates/null3d-render/src/frame_graph.rs:1708-1710: "It takes effect on WebGPU, with or without the depth prepass." Lines 1724-1725: "With the depth prepass, the prepass draws the objects that the second phase kept, after it."
  - crates/null3d-render/tests/gpu_occlusion.rs:364 and :712 test both together, including ambient occlusion turning the prepass on and off while culling stays in two phases.
- docs/concepts/render-graph.md:74 also agrees with the concept page.
- So `quality.settings.gpuOcclusion` can be true while the prepass is on. The reference misstates both the behavior and the value a reader sees.

## The finding misses a second stale statement

The same wrong claim is in the `createEngine` option. packages/engine/src/page/engine.ts:281-282 ends "WebGL2 and the depth prepass draw without it." It renders at docs/api/reference/engine.md:191. A fix to presets.ts alone leaves this contradiction in place.

## Corrected edit (extends the proposed one)

- packages/engine/src/quality/presets.ts:838-839: replace "It is always false on WebGL2, and when the depth prepass is on." with "It is always false on WebGL2. It also runs with the depth prepass on: the prepass then draws only the objects that the culling kept."
- packages/engine/src/page/engine.ts:281-282: replace "WebGL2 and the depth prepass draw without it." with "WebGL2 draws without it. It also runs with the depth prepass on."
