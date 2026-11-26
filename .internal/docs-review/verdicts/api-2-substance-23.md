# api-2-substance-23

## Finding as given

- page: api/materials
- anchor: ### Moment transparency, first bullet: 'the standard, basic and sprite materials' (line 690)
- category: unclear
- severity: low
- claim: The engine has no basic material. Its factories are standard, unlit, shader, shadowCatcher and decal. 'Basic' is the three.js name for unlit.
- evidence: docs/api/materials.md:36-42, 690; docs/data/threejs-mapping.json, which feeds docs/porting/threejs-mapping.md:151, has the same wording.
- proposedEdit: 'The setting covers standard and unlit materials, and sprite batches, whose blending is normal or weighted.' Make the same change in the mapping notes.
- generatedSource: docs/data/threejs-mapping.json (for the porting page)

Verdict: survives

## Evidence

- docs/api/materials.md:36-42: the factory table lists `standard`, `unlit`, `shader`, `shadowCatcher` and `decal`. No `basic` factory exists.
- docs/api/materials.md:690 says "the standard, basic and sprite materials". The page uses "basic" nowhere else.
- docs/data/threejs-mapping.json:1058 (the oitPass row's notes) ends "it takes the standard, basic and sprite materials". It renders at docs/porting/threejs-mapping.md:151. On that same porting page, line 141 maps MeshBasicMaterial to `materials.unlit`, so a reader who sees "basic" can take it as the three.js class.
- The public engine source (packages/engine/src) has no basic material kind. "basic" appears only in internal Rust comments: crates/null3d-gpu/src/drawlist.rs:2290 says "the basic material, from the unlit template's file", and crates/null3d-shaders/tests/build.rs:1247 says "`unlit`, the basic material". This internal name leaked into the docs.
- packages/engine/src/gpu/webgpu/pipelines.ts:167-175 has moment layer shader templates for lit, standard with maps, unlit, unlit with a map, sprite and sprite with a map. So the layer covers standard, unlit and sprites, as the proposed edit says.
- Sprites are their own API (docs/api/sprites.md). "Sprite batches" is accurate wording.

## Notes on the edit

- docs/api/materials.md is a hand-written page. Edit it in place. For the porting page, edit docs/data/threejs-mapping.json, not docs/porting/threejs-mapping.md.
- Optional: link "sprite batches" to [Sprites](sprites.md).
