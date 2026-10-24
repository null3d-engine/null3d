# D-201: A material override draws the main pass, not the shadow pass

Status: decided on 21 October 2026. Built in M3. Task: M3-K5.

Summary: `scene.overrideMaterial` replaces the material of every mesh and instance batch of the main pass. Sprites, points, lines, particle systems and the shadow pass keep their own materials, as three.js's does. Setting it or clearing it rebuilds the draw tables once. After that it adds no draw call per object and no pipeline per frame, because all the meshes share the override's buckets. A masked caster keeps its own material, so its shadow still cuts.

## Question

Where does a material override for a whole pass apply in null3D's frame, and how much does it cost? The frame records a camera pass, a shadow pass, an outline mask and a subsurface pass apart.

## Rule

- A port of a three.js scene must draw the same shapes with the override while it is set, keeping each mesh, place and instance row.
- The shadow pass follows three.js: `WebGLShadowMap` draws depth with each object's own depth material and never reads `scene.overrideMaterial`.
- The feature may not add a draw call per object, nor rebuild a pipeline in a frame whose materials did not change.
- A material that draws a batch's rows rather than a mesh must be refused, not drawn wrong.

## Data

The three.js renderer picks the override at draw time, in `renderObjects`: `material = overrideMaterial` when the original material's `allowOverride` is true. Its render list, sort and shadow map keep the original materials (`three.js` 0.186.1, `src/renderers/WebGLRenderer.js` and `WebGLShadowMap.js`).

The render tests of both builders show the cost:

| Measure | Own materials | With an override |
| --- | --- | --- |
| Mesh pipelines that the first frame of the change creates | The materials' pipelines | One, for every mesh and batch row |
| Pipelines that a later frame creates while the override holds | 0 | 0 |
| Draw calls | One per run of a bucket | One per run of the buckets that remain, never more |
| Draw-table rebuilds | On each structural change | One when the override changes |

How the data was produced: `cargo test -p null3d-render --test override_material`, 21 October 2026, on the Mac, for the WebGPU builder and the WebGL2 builder with and without multi-draw.

## Decision

The override is one engine material id in `SceneSettings`, read where the draw tables choose each object's material. It applies to the camera's views, scene passes, reflection passes and the subsurface view, as three.js applies it to every render of the scene. The shadow pass, the outline mask, the motion view and sprite, point, line and particle batches keep their own materials.

The substitution happens when the tables are built. An override that never changes costs one read per object in a rebuild, and nothing in the frames between rebuilds. All the meshes then share the override's buckets, so the draw calls can only fall. A sprite, point or line material is refused with E1224, because its shader reads rows of its own batch.

The engine classifies a mesh by the override's pipeline, so an override that blends draws every mesh in the transparent pass and sorts it. three.js sorts by the original material and then draws with the override. The engine's order is the one that works for its bucket tables; the difference shows only for an override whose blending differs from the scene's.

A displacement-map override grows the culling spheres of the WebGPU builder by its own margin. On the WebGL2 builder the core's world spheres keep each object's own margin. Such an override can then cull an object at the screen's edge a moment early. Every other override has a margin of 0, so it has no such effect. A later change can write the override's margin into the objects' world bounds.

## Consequences

- `scene.overrideMaterial` is a property on the scene, with `null` to clear it, beside three.js's name and type (`docs/api/scene.md`).
- `SceneSettings` holds the id; both frame builders apply it through one helper, and the texture budget, software occlusion and the skinning bounds follow it.
- The three.js mapping entry for `scene.overrideMaterial` becomes direct, and the porting skill describes the mapping.
- The objects demo gains a Look button that draws its whole stage with one material. A second image test holds that look beside the demo's own image.
- A scene without an override draws exactly as before, which the existing image references show unchanged.
