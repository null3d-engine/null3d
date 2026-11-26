# Verdicts: screenshots and demo links for api/reference/geometry

The page is generated. Each link must go into the doc comment of the export it sits under:
- `Geometry`, `MeshArrays`, `MeshGeometry`, `MeshLevel`, `MorphTargets`: packages/engine/src/scene/resources.ts
- `Shape`, `Path`, `CurvePath`: packages/geometry/src/path.ts
- level rule functions: packages/engine/src/scene/level-rule.ts

## Shots

None were proposed. None are needed: this is an API reference page, and the concept page it links to is the better home for pictures.

## Demo links

| Concept | Code | Keep | Why |
| --- | --- | --- | --- |
| generators | generators/ | yes | The demo "Geometry generators" exists. Its sketch calls box, sphere, torus, cylinder, cone, capsule, plane, circle and ring: every generator in the `Geometry` table. |
| fromArrays | mesh-arrays/ | yes | The demo "Meshes from arrays" exists. Its sketch builds an island and a crystal with geometry.fromArrays, with vertex colors and computed normals, which are `MeshArrays` fields. |
| shapes and curves | extra-shapes/ | yes | The demo "Extra shapes" exists. Its sketch draws a star and a heart as `Shape` objects with moveTo, lineTo and bezierCurveTo, and fills them with `extrude` and `shape`. It also uses lathe, tube with a CatmullRomCurve3, torusKnot and the polyhedra. |
| updateVertices | vertex-updates/ | yes | The demo "Vertex updates" exists. Its sketch calls updateVertices on the water's positions and normals each frame. |
| levels of detail | forest/ | yes | The demo "Levels of detail" exists, and its L key turns levels on and off. One caveat: the setLevels call that builds `MeshLevel` entries (error only) sits in the shared helper examples/lib/trees.ts, which the forest imports, not in the forest folder. The impostors/ demo calls setLevels in its own folder (impostors/pine.ts), but forest is the clearer demo of the concept. |
| morph targets | morph-flowers/ | yes | The demo "Morph targets" exists. Its sketch builds a MorphTargets object with positions, normals, colors and names, and calls setMorphWeight per tulip. |

## Concepts said to have no demo

| Concept | Confirmed | Notes |
| --- | --- | --- |
| level rule functions (levelAt and others) | yes | Only the creek showcase imports levelAt and levelDistances (showcase/creek/valley.ts), and only in a triangle-count helper that its unit test calls. Nothing on screen shows them, so no demo link fits. |
| CurvePath | yes | No demo uses CurvePath directly. extra-shapes/ uses it only as the base class of Shape. |
| Path | no | extra-shapes/ shows Path's drawing commands: its star and heart call moveTo, lineTo and bezierCurveTo, which Shape takes from Path. Link extra-shapes/ under `Path` too, or say in the `Shape` link that it shows the path commands. |
