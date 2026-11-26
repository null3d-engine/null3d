# concepts-1-substance-03

## Finding as given

- page: concepts/architecture
- anchor: Thread table line 42 "hide what occluders hide"; One frame step 8, line 72 "test them against the occluders"; line 106 "cull, test the occluders"
- category: wrong-claim
- severity: medium
- claim: Three sentences say that the WebGL2 job workers test objects against occluders, as if this happens in every frame. Software occlusion culling is off on every preset, and runs only when the page asks for it.
- evidence: docs/concepts/culling.md:159 ('Every quality preset leaves software occlusion culling off.'); culling.md:164 (softwareOcclusion: true).
- proposedEdit: At each of the three places, add 'when software occlusion culling is on'. Line 72: 'On the WebGL2 path, they also cull the objects of the cells in view, and test them against marked blockers when [software occlusion culling](culling.md#software-occlusion-culling-on-webgl2) is on.'

Verdict: survives

## Evidence

- docs/concepts/architecture.md:42, :72 and :106 state the occluder test without a condition. The page has no other sentence that says the test is optional or off by default.
- packages/engine/src/quality/presets.ts:358-366: the softwareOcclusion setting has `presets: [false, false, false, false]`, with the comment "Off on every preset".
- packages/engine/src/page/engine.ts:309 and :1997: only the `softwareOcclusion` option or the `?occlusion` switch turns it on.
- crates/null3d-render/src/cpu_culled/mod.rs:3459-3461: the flag sets the occluder pass on or off, so with the default the test does not run.
- docs/concepts/culling.md:159 and :164 agree. The anchor `#software-occlusion-culling-on-webgl2` exists (culling.md:119).
- The frustum cull on WebGL2 does run every frame; only the occluder part needs the condition. The proposed edit keeps "cull" unconditional, which is correct.

## Notes on the edit

The edit is right. Use the link once (step 8, line 72); lines 42 and 106 can say "when software occlusion culling is on" without a second link. "Marked blockers" matches the culling page's word for objects with `occluder: true`.
