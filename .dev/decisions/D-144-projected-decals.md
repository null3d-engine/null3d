# D-144: Projected decals

Status: decided by the helper of M2-EX27 on 11 October 2026. The owner approved the decals demo's look on 12 October 2026, from shots of the reworked street. Date: 2026-10-11. Task: M2-EX27.

Summary: A decal is a box mesh with a decal material: `materials.decal` takes the standard material's values and maps, and the box projects them onto every opaque surface inside it. Decals draw in a pass of their own, right after the camera's opaque pass, with a build of the standard material's own shader that finds the surface under each pixel from the scene's depth. The main pass gains no texture binding, and a page without decals pays nothing.

## Question

The showcase scenes need scorch marks, mud, puddles, road paint, moss and cracks on any surface ([D-132](D-132-showcase-look-and-features-2026-10-11.md), and the owner's ruling D-142 of 11 October 2026). three.js offers `DecalGeometry`, which cuts a copy of the target mesh's triangles on the CPU. How does null3D put a material onto the surfaces inside a box, on all three GPU paths, without slowing the scenes that have no decals?

## Rule

- The intent of three.js's `DecalGeometry` ([D-52](D-52-intent-parity.md)): an image with a box's position, orientation and size lands on the surfaces inside the box, with the target's lighting.
- Each decal has albedo, normal and roughness or ORM maps, and is lit by every light of the scene, with shadows, as the surface under it is.
- Many decals draw in few draws, and overlapping decals keep their order.
- Decals can skip objects by their layers, such as characters.
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader.
- Zero cost while no object is a decal: no pass, no bind group change and no shader download (design principle 8).
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- The WebGPU main pass reads 15 of its 16 sampled textures, and parallax materials take the last one. A decal may add none.

## Options

### Where decals change the surface

| Option | Who does it | Verdict |
| --- | --- | --- |
| A: clustered decals: the lit shader loops over the decals of its cluster and changes the surface before it lights it | Godot Forward+, Doom (2016) | Rejected. It needs a decal texture in the main pass, which has no free binding on WebGPU, and a change to the light clustering on both paths |
| B: a decal buffer: a pass before the opaque pass writes the decals' albedo, normal and roughness into screen textures, which the main pass reads | Unreal's DBuffer, Unity URP's DBuffer | Rejected. It needs the depth prepass and a screen texture in the main pass, which has no free binding |
| C: projected geometry: a copy of the target's triangles inside the box, as three.js's `DecalGeometry` cuts it | three.js, Babylon.js | Rejected as the default. It needs the target's triangles on the CPU, which the engine frees after upload, and a mesh for each decal and target |
| D: boxes in a pass of their own after the opaque pass, which read the scene's depth and shade the surface under each pixel themselves, then blend over it | Unity URP's screen space decals | Chosen |

Option D reads the scene's depth and finds the surface that each pixel of the box shows. It lights that surface with the decal's material, through the standard material's own surface and lighting code, and blends the result over the scene's color by the decal's alpha. So a decal's normal map, roughness and emissive light respond to every light and shadow. The cost is one more lighting step for each pixel that a decal covers.

What D gives up against A and B: a decal cannot change only the normal or the roughness of the surface below and keep its color, since it does not know that color. A puddle is a smooth, dark film over the ground, and a crack is a dark line with its own normals, so each is a decal of its own color. Below a decal, the normal comes from the depth of the neighboring pixels, so a curved low-poly mesh shows its faces there.

### How a decal finds its surface

- Each decal draws the back faces of its box, with no depth test, so it draws while the camera is inside the box too.
- Each pixel reads the scene's depth at its place and at its four neighbors. It finds the surface along the view ray through the box's face. On each axis, the neighbor whose depth lies closer belongs to the same surface. Those two neighbors give the surface's normal, and the change of the texture coordinates across the pixel, so mip levels do not jump at the edges of objects.
- A pixel whose surface lies outside the box draws nothing.
- The box's x and y axes give the texture coordinates, as three.js's `DecalGeometry` gives them, and the frame of the normal map. Its z axis is the decal's direction.
- The decal fades where the surface turns away from its direction, from 60 to 80 degrees by default, and near both ends of the box along z.

### Batching and order

Decals leave the opaque buckets as blended objects do, into a sorted layout of their own. The job workers cull them each frame. They sort by render order alone, so decals of one render order keep the order of the scene's slots and never swap as the camera moves. Neighbors in that order that share a material's maps draw in one instanced draw. A batch of boxes with one decal material draws in one draw, and its row colors tint and fade each decal.

### Layers

Per-decal layer masks would need to know which object each pixel shows. The forward renderer keeps no such texture, and a new one would take a main-pass binding. So one setting gives the layers that decals mark. An object on another layer draws again after the decal pass, over its own pixels, so a character standing in a puddle shows no mud.

## Data

To be measured on the Mac's GPU: GPU and CPU time per frame with and without decals, per preset, on S1 with the `decals` switch; the allocation check; the size check; the GPU check.

## Decision

Option D, built from the standard material's own shader and the sorted machinery of the transparent pass.

## Consequences

- Code: `materials.rs` (the `DECAL` feature and its values), `frame.rs` (the decal key and the decal layers), `pipelines.rs`, `sorted.rs` (the decal layout and the redraw layout), `frame_graph.rs` (the `Decals` and `DecalRedraw` passes), both builders, and the shaders `lit.wgsl` and `lib/mesh.wgsl` with the `decal` and `decal_maps` entries of the shader manifest, in the first-use set `decals`.
- Bindings: the decal templates bind the frame's group, the material's maps where they sample them, then the scene's depth: group 1 or 2 on WebGPU, and group 4 on WebGL2, whose slots start at 47. On WebGL2 the decal builds take one of the four spare texture units of each stage for the depth, as the builds that let light through take one for the copy.
- Docs: `api/materials` (Decals), the mapping entry for `DecalGeometry`.
- Skills: the develop skill's task table and quick reference, the port skill's notes.
- Tests: the render crate's `decals` tests, the image tests `decals`, the first-use download test and `--decals` in `bench:allocation`.
