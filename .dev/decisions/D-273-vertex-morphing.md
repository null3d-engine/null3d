# D-273: Vertex morphing for generated shapes

Status: proposed, for the owner's ruling. Not built: the terrain morph and the leaf-card morph.
Built: the terrain draws each block with a skirt, and a plant's levels switch with no morph. Task:
M3-L4.

Summary: The terrain add-on morphs each block toward its parent's heights through a custom vertex
offset. The parent height and the block size travel in the second texture coordinates, so one
material and one pipeline serve every block. The vegetation add-on morphs leaf-card levels by storing
each leaf vertex's target position at the next level. The engine gains one public vertex input for
that record and no morph of its own. Skirts stay, because the quadtree lets neighbors differ by
more than one level.

## Question

Should the engine, an add-on or user land morph between whole levels rather than switch them at a
band? Which kinds of shape should morph, in which layer, and what is out of scope?

## Rule

- The better look wins (hard rule 40). A switch that shows must not pop.
- Speed comes first. The morph adds no draw and no per-frame allocation.
- Each feature lives in one place. The add-ons that make the shapes own their morphs, and the engine
  core gains no morph for file meshes.
- A level with a measured error switches at once. D-211's rule stays, because those switches do not
  show.
- A public hook ships with the add-on that needs it (parity rule 12).

## Data

| Measure | Value | Source |
| --- | --- | --- |
| Terrain at High | 208 blocks and 133,120 triangles over 1,200 m | D-152 |
| Vertices of one block | 353: a 17 by 17 grid and a 64-vertex skirt | `chunk.ts`, a grid of 16 faces |
| A block's vertex bytes now | 11,296: positions, normals and one texture coordinate | 32 bytes a vertex |
| The second texture coordinates | 2,824 bytes a block, 587,392 bytes over 208 blocks | 2 floats, 8 bytes a vertex |
| The second set's share | 25% more vertex bytes for the ground | the two rows above |
| The morph's per-frame allocation | none | the heights are written when a block is built or reused |
| A leaf-card level's growth | the square root of the step, so 1.41 for every second card | `cardLevel` |
| A leaf vertex's target record | 16 bytes: the target position and the level's error | the proposed input, four floats |
| A block's switch in a picture | not measured | the image test below |
| A leaf-card level's switch in a picture | not measured | the image test below |
| The terrain casters' cost | not measured | D-127 makes a caster with a vertex offset a moving caster |

How the data was produced: arithmetic from the add-on's code and from D-152's selection figures. The
byte counts are the arrays that the add-on writes, not a measurement. No run was made.

## Look

The terrain image reference, `terrain`, shows a 1,200 m ground from a high camera, with grass, rock
and snow. No seam or skirt sliver shows at 320 by 180 pixels. The demo reference, `demo-terrain`,
shows the same ground in a valley at dusk. No seam shows there either. Neither picture is a pair
around a switch. The demo's camera circles and crosses splits, so a filmstrip would show the pop.

No picture compares a plant level with and without a morph. The leaf-card switch has not been captured.

## Decision

1. The terrain morph lives in `@null3d/terrain`, in a custom vertex offset in `terrain.wgsl`. When a
   block is built or reused, the add-on writes the parent grid's height at each vertex into the
   second texture coordinates (`uvs1.x`). It writes the block's size into `uvs1.y`. The material
   carries the selection's scale and the grid's face count as uniforms. The offset moves each vertex
   toward the parent height. The factor runs from 0 at the block's own split distance to 1 at its
   parent's split distance. The parent height follows the parent grid's triangulation, so a block at
   the end of its band has the parent block's surface.
2. D-152's reason for rejecting the morph no longer holds. It rejected the morph because each block
   would need its own material or its own uniform write. A material per block would cost a pipeline
   state change per block. The second texture coordinates now carry the per-vertex parent
   height and the per-block size. The distance comes from `camera.position` and `object.position`,
   which cost nothing. The scale is one uniform for every block. One material and one pipeline serve
   every block, as they do now.
3. Skirts stay. The selection does not restrict neighbors, so two blocks that meet can differ by
   more than one level. A morph that ends on a block's own parent cannot match a coarser neighbor.
   Removing the skirt needs a neighbor-restricted selection, which moves every switch, or a target
   for each edge in every frame. Neither is worth its cost now.
4. The leaf-card morph lives in `@null3d/vegetation`. `cardLevel` keeps every second card from one order.
   So the generator knows which cards the next level drops, and how far each kept card grows. For each
   leaf vertex it writes the position that the vertex takes at the next coarser level, and the
   level's error. The leaf material's vertex offset mixes the vertex toward that position over the
   same 8% band that a level fade uses. The add-on passes the engine's factor, which is the render height
   times the projection's `P[1][1]`, over twice the threshold. The switch distance is the level's
   error times the copy's world scale and that factor, as `levels.rs` computes it. The shader measures
   the distance to the crown's bounding sphere, as the engine does. So the morph ends where the
   engine switches.
5. The engine gains one public input: a four-number vertex record that `VertexInput` reads as the
   target position and the level's error. It ships with the vegetation add-on, and the terrain does
   not use it. That input is the only engine change.
6. File meshes keep `setLevels` and the dither. The simplifier makes each level on its own and
   records no mapping. The tool's leaf-card step has a mapping for a part of separate cards, but no file
   needs the morph yet.

## Ruled out

- An engine morph for whole levels. D-91 found no change wider than a pixel at 502 of 518 measured
  switches ([D-211](D-211-lod-fade-and-distance-bands.md)). A morph would add vertex data, shader
  builds and work to every mesh, and hide nothing.
- A morph for the asset tool's simplified meshes. Each level is made independently, so no vertex on
  one level names a vertex on the next.
- Live simplification. It costs CPU time and an upload every frame.
- Removing the skirt in this task.
- A material for each block. The second texture coordinates and one shared scale remove the need.
- A uniform write for each block in each frame. The built-in positions give the distance.

## What a machine run would settle

- A test page steps the camera across a known split. It captures the frames just before and just
  after the split, with the morph on and off, at High and Low. The Mac and SwiftShader run it first,
  then the iPad and an S24-class phone. The pixel difference across the split, and a filmstrip, settle
  the pop. The same page with the skirt on and off shows the seam.
- A GPU-time and allocation run of `examples/terrain` settles the vertex cost. The same run on both
  GPU paths settles the moving casters' cost. `bench:gpu-check` times the benchmark scenes, and none
  draws terrain.
- Whether the per-vertex factor leaves a jump at the split. If it does, a factor for the whole block
  needs the block's height box in the vertex data, which costs a second four-number record.
- The leaf vertex count and the bytes that the target record adds, per preset, from the generator's
  stats.
- A picture of a crown at the leaf-card switch, with the morph on and off, settles the look. A GPU-time
  run of the leaf material on the Mac and an S24-class phone settles the cost.

## Consequences

- Code: `packages/terrain/src/chunk.ts`, `terrain.ts`, `material.ts` and `terrain.wgsl` gain the
  parent heights, the second coordinates and the offset. `packages/vegetation/src/levels.ts`,
  `generate.ts`, `builder.ts` and `plant.wgsl` gain the target positions and the mix. The engine's
  vertex format and the shader compiler gain the four-number record and its def.
- The terrain's casters become moving casters, so a shadow view that a caster touches draws again.
  The cost is unmeasured, and the run above names it.
- Docs: `docs/api/terrain.md` states the morph. `docs/concepts/lod.md` states which shapes morph and
  which switch. `docs/shaders/builtins.md` and the vertex format table gain the record.
  `docs/api/vegetation.md` states the leaf-card morph.
- Skills: the develop skill's terrain and vegetation notes, and the porting skill where a port has a
  card tree.
- Tests: the terrain image test at a split on all three GPU paths. A leaf-card-switch picture with the
  morph on and off. The reference sets that both move. The terrain test's camera is held still today,
  so the split test is a new page.
- A custom material that reads the new record gains a shader def and a vertex attribute. A material
  that reads none pays nothing, as D-138's defs do.
