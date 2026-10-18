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

Measured on the Mac's GPU (Apple M5 Max), on the production build. The scene is S1 with the `decals`
switch: the ground alone (`decals=off`), and the ground with 256 decals that turn each frame. Three
runs of 10 seconds at each preset, on WebGPU and WebGL2, held 120 frames per second.

- The decals add about 0.01 ms per frame to the busiest thread. They add one draw call: 3 to 4 on
  WebGPU, and 5 to 6 on WebGL2.
- On WebGPU the decal pass costs about 0.6 to 0.9 ms of GPU time per frame for 256 decals. At low it
  runs from 3.22 to 3.79 ms, and at ultra from 3.07 to 4.00. Medium runs 3.06 to 4.00, and high
  3.08 to 3.93. It costs less on WebGL2: 4.55 to 4.57, 4.42 to 4.54, 4.23 to 4.54, and 4.27 to 4.52.
- Allocation. `bench:allocation --decals` passes on both paths. The sketch worker allocated 227.6
  bytes per frame on WebGPU and 222.2 on WebGL2. The render worker allocated 612.8 and 162.5.
- Download size. The two WebAssembly files grew about 2.4% after Brotli, to 402,309 and 401,905
  bytes. The feature adds 24 first-use shader files, one for each GPU path, tone-map build and bits.
  They run from 15,195 to 17,430 bytes after Brotli each. A page downloads one when it first uses a
  decal. The combos tables of the page and of the sketch worker grew with the new key.
- The decals do not change S4's or S6's GPU time:

  ```text
  GPU-Checked: 47cd03060..685cf4d85 not judged: s4 medium 3.98 to 4.00 ms (+1.0%); s6 medium 4.69 to 4.69 ms (+1.2%); s4 high 4.41 to 4.50 ms (+0.6%); s6 high 4.86 to 4.84 ms (-1.0%); the benchmark pages changed between the commits
  ```

## Decision

Option D, built from the standard material's own shader and the sorted machinery of the transparent pass.

## Consequences

- Code: `materials.rs` (the `DECAL` feature and its values), `frame.rs` (the decal key and the decal layers), `pipelines.rs`, `sorted.rs` (the decal layout and the redraw layout), `frame_graph.rs` (the `Decals` and `DecalRedraw` passes), both builders, and the shaders `lit.wgsl` and `lib/mesh.wgsl` with the `decal` and `decal_maps` entries of the shader manifest, in the first-use set `decals`.
- Bindings: the decal templates bind the frame's group, the material's maps where they sample them, then the scene's depth: group 1 or 2 on WebGPU, and group 4 on WebGL2, whose slots start at 47. On WebGL2 the decal builds take one of the four spare texture units of each stage for the depth, as the builds that let light through take one for the copy.
- Docs: `api/materials` (Decals), the mapping entry for `DecalGeometry`.
- Skills: the develop skill's task table and quick reference, the port skill's notes.
- Tests: the render crate's `decals` tests, the image tests `decals`, the first-use download test and `--decals` in `bench:allocation`.

## Addendum, 2026-10-15: the decals' own frame group on WebGPU

The light probe grid (D-146) added a 3D texture to the frame group. WebGPU counts each pipeline's sampled textures per shader stage over every entry of its groups' layouts, whether or not the shader reads them. A decal with maps then needed 17 in its fragment stage: 8 from the frame group, 8 maps and the scene's depth. WebGPU's default limit is 16, so textured decals drew nothing on WebGPU. WebGL2 drew them, as its programs take a texture unit only for a texture that they read.

Two fixes were open. One asks for a higher `maxSampledTexturesPerShaderStage` where the adapter offers it. Hard rule 6 then needs a fallback for devices that offer only 16, and phones often do, so the fallback has to exist anyway. The other gives the decal templates a frame group without the textures that no decal build reads: the probe grid's and the copy of the opaque color. That keeps every device within the default limits with one code path, so it was chosen.

- On WebGPU the decal templates bind `layout::DECAL_FRAME` at group 0: the frame group's entries without bindings 10 and 15. A decal with maps reads 15 sampled textures, and 1 stays free.
- The WebGPU builder makes the group only while the decal pass runs, from the camera's frame group's inputs, and again whenever it makes the camera's frame group again. A page without decals makes neither the group nor its layout.
- WebGL2 is unchanged: the decal pass binds the frame group.
- A unit test (`gpu/webgpu/pipelines.test.ts`) sums each build's resources per stage over its layouts, for every template, against WebGPU's default limits. A new binding that passes a limit fails it. The render crate's `decals` tests check the group's entries and that the decal pass binds it.

## Addendum, 2026-10-16: a box with a flat side marks nothing

The vertex stage inverts the box's axes by their cofactors. Its comment says that a flat box has no inverse and marks nothing, and nothing enforced that. A box with a zero size on one axis gives a zero determinant, so the three axis vectors it carries out are all zero. Every dot product with them is zero. The fragment stage read that as a point at the box's middle, so `inside` held. The aim it normalized was the zero vector, which makes a NaN. `facing`, `angle_fade` and `decal_fade` followed. A NaN is not below zero, so the box drew rather than discarded.

An animated size that passes through zero, or a size typed as 0 on the depth axis, reaches this. The fragment stage now tests the box's axis for zero. A flat box takes a fixed aim, so no NaN is made, and `inside` is false, so it discards. The decal image tests place boxes with a size on each axis, and the demos give every decal a depth, so no reference changes.
