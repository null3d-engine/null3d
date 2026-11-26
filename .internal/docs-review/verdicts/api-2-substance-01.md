# api-2-substance-01

## Finding as given

- page: api/objects
- anchor: ## Mesh calls, setLevelBias bullet (line 119)
- category: wrong-claim
- severity: high
- claim: The page says setLevelBias works 'as Godot's lod_bias does' and that a bias above 1 draws coarser levels. Godot's lod_bias works the other way: larger values keep more detail farther away. A reader who ports from Godot will set the bias the wrong way.
- evidence: docs/api/objects.md:119; docs/concepts/lod.md:153 repeats it; TSDoc packages/engine/src/scene/scene.ts:1815-1817. Godot GeometryInstance3D.lod_bias: 'larger values will keep the mesh in a higher level of detail at farther distances.'
- proposedEdit: Replace 'as Godot's lod_bias does' with 'the inverse of Godot's lod_bias: a Godot bias of 2 is a null3D bias of 0.5'. Make the same change in docs/concepts/lod.md:153 and in the TSDoc at scene.ts:1815.
- generatedSource: packages/engine/src/scene/scene.ts (TSDoc of setLevelBias, for docs/api/reference/objects.md)

Verdict: survives

## Evidence

- docs/api/objects.md:119 says "as Godot's `lod_bias` does. A bias above 1 draws coarser levels". The page says what the finding claims.
- The engine direction is as the page states: a bias above 1 gives coarser levels. The TSDoc at packages/engine/src/scene/scene.ts:1815-1821 says so, and the render test crates/null3d-render/tests/levels.rs:340-365 sets a bias of 2 and checks that the switch comes nearer.
- Godot 4 GeometryInstance3D.lod_bias goes the other way: 0 forces the lowest detail, 1 is the default, larger values keep more detail farther away. So "as Godot's lod_bias does" names the opposite direction. The page states its own direction in the next sentence, but a reader who ports a Godot value (for example 2, for a hero) gets the reverse result. That is a real, misleading claim, so high severity holds.
- Godot divides the LOD distance by its bias; null3D multiplies the pixel threshold. In pixel-error terms the two are reciprocal, so "a Godot bias of 2 is about a null3D bias of 0.5" holds for the level switch. Godot's bias does not move a hide distance, and null3D's does, so "about" is the safe word.
- The finding misses more copies of the same wrong comparison:
  - packages/engine/src/scene/level-rule.ts:48 (TSDoc of the `bias` field), which renders into docs/api/reference/geometry.md:421.
  - docs/data/threejs-mapping.json:1531 (LOD row notes), which renders into docs/porting/threejs-mapping.md:209 and the skill copies skills/null3d-port-threejs/references/threejs-mapping.json:1531 and api-mapping.md:220 (regenerated, not edited by hand).
- Small source note: docs/api/objects.md is a hand-written page; edit it directly. The TSDoc at scene.ts feeds docs/api/reference/objects.md:38, which carries the same text.

## Corrected edit

In every place below, replace "as Godot's `lod_bias` does" (or "as Godot's `lod_bias`") with "the inverse of Godot's `lod_bias`: a Godot bias of 2 is about a null3D bias of 0.5". Keep the sentence that follows, which states the null3D direction.

- docs/api/objects.md:119
- docs/concepts/lod.md:153
- packages/engine/src/scene/scene.ts:1815-1816 (TSDoc of setLevelBias, for docs/api/reference/objects.md)
- packages/engine/src/scene/level-rule.ts:48 (TSDoc of `bias`, for docs/api/reference/geometry.md)
- docs/data/threejs-mapping.json:1531 (for docs/porting/threejs-mapping.md and the port skill's copies)
