# D-273: Vertex morphing for generated shapes

Status: decided by the helper of M3-L4, for the owner's review. Built: the terrain morphs each
block toward its parent's surface, and a tree's leaf cards morph toward the next level. Task:
M3-L4.

Summary: Both add-ons write a four-number vertex record and read it in their own custom material's
vertex offset. The terrain stores the parent grid's height, the block's size and the block's height
box, and reproduces the selection's exact distance, so a block has its parent's surface at the
switch. The vegetation add-on stores each leaf vertex's place at the next level and that level's
error, so the cards the next level drops shrink and the kept ones grow before the switch. The record
fills the vertex slot that morph targets use, so the engine gains one public input and no vertex
location. Skirts stay, because the quadtree lets neighbours differ by more than one level.

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
| A block's vertex bytes without the record | 11,296: positions, normals and one texture coordinate | 32 bytes a vertex |
| A block's vertex record | 5,648 bytes a block, 50% more vertex bytes for the ground | 16 bytes a vertex, four floats |
| A leaf vertex's target record | 16 bytes: the target position and the level's error | four floats |
| The built-in vegetation set's arrays | 26,899,530 bytes, 5,995,680 of them target records | `generateVariantSet`, 374,730 leaf vertices |
| A block's switch in a picture | morph off moves 0.026% of the frame, morph on 0.000%, on WebGPU and compatibility mode; 0.035% against 0.000% on WebGL2 | `tests/image/terrain-morph.spec.ts` on the Mac's GPU, three GPU paths |
| A leaf-card level's switch in a picture | morph off moves 0.634% of the frame, morph on 0.036%: the morph removes 94% of the change | `tests/image/leaf-switch.spec.ts` on the Mac's GPU |
| The leaf morph on the other paths | 0.321% to 0.023% on compatibility mode, 0.528% to 0.030% on WebGL2 | the same test |
| The block morph's frame cost | no difference that this method resolves: WebGPU 2.99 against 3.30 ms of GPU time, compatibility 2.68 against 2.36, WebGL2 4.17 against 4.45, with both signs across three runs; the same build's frame read 2.7 to 4.3 ms from one run to the next, and the frame interval stayed at the display's 16.67 ms | the cost page in a quiet window, below |
| The record's bytes in a frame of the terrain demo | Low: about 145,000 triangles over every pass are about 253 block draws, 89,000 vertices and 1.43 MB of record a frame, 43 MB a second at 30 frames. Medium: about 476,000 triangles are about 826 block draws, 292,000 vertices and 4.67 MB a frame, 140 MB a second | arithmetic from the S25 pairs' triangles, `chunk.ts`'s 576 triangles and 353 vertices a block, and 16 bytes a vertex |
| The leaf and bark material's frame | Galaxy S25: 27.20 ms of GPU time at Low on WebGPU, 469.70 at Medium, 604.44 at High and 565.97 at Ultra, with 27.13 and 512.62 at Low and Medium on compatibility mode; its display ran at 30 Hz, so the Low frames keep its rate and the rest do not. Galaxy S24, whose WebGL2 has no GPU timer: 66.64 ms at Low and 66.66 at Medium, twice the display's 33.3 ms refresh. MacBook Pro M3 Max at 120 Hz: 5.44, 11.40, 16.71 and 17.10 ms on WebGPU from Low to Ultra, with 7.21 and 15.20 on compatibility mode, and 18.00 and 30.14 ms on WebGL2 at Low and Medium, whose interval reaches 16.82 ms there | the `vegetation-wind` plan, runs `20261030-091921-vegetation-wind`, `20261030-092652-vegetation-wind` and `20261030-094633-vegetation-wind`, with the page from `feat/m3-v7-leaf-bark` at `9a2cd433c` and `559089789`, below |
| The block morph on the demo, the camera held | Galaxy S25: 9.90 ms of GPU time a frame at Low with the morph on against 10.03 with it off, 407 draw calls each; 19.01 against 18.97 at Medium, 2,067 each; the display ran at 30 Hz, so both sides held its 33.3 ms interval. Galaxy S24, whose WebGL2 has no GPU timer: both sides held the display's 33.3 ms at Low and Medium, with the same 176 and 632 draw calls and the same triangles | the `terrain` plan's morph pair, runs `20261030-093626-terrain-morph` and `20261030-093913-terrain-morph`, below |
| The shadow redraw of the still terrain at High | Galaxy S25, WebGPU: the morph on and off draw 2,583 calls a frame in the same 14.55 ms of GPU time, with all three cascades drawing in every frame; keeping the far cascades to their turns drops 513 calls, one cascade's casters, to 2,070. Each cascade's pass costs 0.2 to 0.39 ms, under the frame's 12.5 ms ambient occlusion pass. The follow-off page's whole-frame GPU time reads 21.79 ms and its pass names shift, so the timer's pass capture changed there and the draw calls are the comparable figure | the `terrain-shadow` plan, run `20261030-103911-terrain-shadow`, below |

How the data was produced: the byte counts are arithmetic from the add-on's arrays. Both switch
figures come from the split pages, which hold the camera still and move the level switch across it,
so the only change between two frames is the hand-over: the terrain's by its allowed error, the
leaves' by the level threshold. The corner distance first measured 0.469% against 0.495%, worse with
the morph on, because it over-morphs the block at its own split; that run is what showed the record
slot must carry the block's height box. The frame figures come from
`QUIET_OK=1 zsh heavy.sh env NULL3D_TERRAIN_MORPH_COST=1 NULL3D_PORT=6182 NULL3D_PRODUCTION_PAGES=skip
bun run test:browser -- terrain-morph-cost.spec.ts --workers=1` on this Mac's GPU, the third of
three such runs. The page measures both sides on the same blocks, the same triangles and the same
draws, and swaps the sides each round so a drift in the machine does not favour one. The offset's
own work is a few vertex instructions, and the runs cannot separate it from the machine's noise: two
of the three put the morph side lower and one higher. What is fixed is the vertex data, 16 bytes a
vertex more, and the same draws and triangles.

The demo figures come from the `terrain` plan's morph pair, which draws the demo from a camera held
at one point of its orbit. The pages spell the held view, the morph and the follow switch on the
sketch's address, as the split page spells its error, and the demo calls `terrain.setMorph(false)`
for the off side. A moving camera gives each side a different block selection: the first pair on the
S25 drew 22% more triangles with the morph off only because its measure began at another point of
the orbit. Both sides carry the record's 16 bytes a vertex, so the pairs measure the offset's own
work. The record's byte rate is arithmetic, not a measurement: it comes from the overlay's
triangles, a block's 576 triangles and 353 vertices. On the S25 the overlay's triangle and
object estimates differ by up to 8% between the sides while the draw calls and GPU times agree:
WebGPU returns those counts from its culling sample, not from the timed frames. The leaf figures
come from the `vegetation-wind` plan on `feat/m3-v7-leaf-bark` at `9a2cd433c`, whose page reports the
frame's GPU time, per-pass breakdown, interval and CPU time; `559089789` adds the interval and the
engine's display rate, which the S24 needs in place of a GPU time.

## Look

The terrain split page frames one hill whose block changes level between 34 and 37 pixels of
allowed error from a still camera. With the morph off, the block's own surface gives way to the
coarser surface at once. With the morph on, the block's vertices move to the parent grid's heights
over the last part of the approach, and the two frames match: the hill does not move at all. The
leaf switch page holds the camera still and moves the level threshold either side of the switch,
with the dither off: the cards that the next level drops shrink to their middles and the kept ones
grow, so the crown's silhouette holds across the switch.

The terrain image reference draws the ground at a camera where some blocks are partly morphed: it
moved by 0.215 to 0.292 per cent of its pixels, and both sets were redrawn. The `demo-terrain`
picture did not move, because its camera leaves every block outside its band. The vegetation
pictures stay as they are, because a plant drawn at its base level draws no coarser level and writes
no target.

## Decision

1. The terrain morph lives in `@null3d/terrain`, in a custom vertex offset in `terrain.wgsl`. When a
   block is built or reused, the add-on writes a four-number record at each vertex: the parent
   grid's height there, the block's size in meters, and the lowest and highest height of the
   block's ground. The material carries the selection's scale and the grid's face count. The offset
   moves each vertex toward the parent height by a factor that runs from 0 at the block's own split
   distance to 1 at its parent's split distance. The parent height follows the parent grid's
   triangulation, so a block at the end of its band has the parent block's surface.

2. The distance is the one the selection measures: the 3D distance from the eye to the nearest point
   of the block's footprint and its height box. The shader rebuilds it from `camera.position`,
   `object.position`, the block's size and the record's low and high heights. A distance to the
   block's corner instead was measured and rejected: it over-morphs a block at its own split, where
   its children replace it, and the switch still shows. D-152's reason for rejecting the morph no
   longer holds: one material and one pipeline serve every block.

3. Skirts stay. The selection does not restrict neighbours, so two blocks that meet can differ by
   more than one level. A morph that ends on a block's own parent cannot match a coarser neighbour.
   Removing the skirt needs a neighbour-restricted selection, which moves every switch, or a target
   for each edge in every frame. Neither is worth its cost now.

4. The leaf-card morph lives in `@null3d/vegetation`. `cardLevel` keeps every second card from one
   order, so the generator knows which cards the next level drops and how far each kept card grows.
   For each leaf vertex it writes the position that the vertex takes at the next coarser level, then
   that level's error. The card material's vertex offset moves the vertex toward that position over
   the last 8% of the switch distance, which is the band that a level fade covers. The switch
   distance is the level's error times the copy's world scale times the engine's factor: the render
   height times the projection's `P[1][1]`, over twice the threshold, as `levels.rs` computes it.
   The shader reads the render height and the projection from the frame, the threshold and the
   crown's radius from the material, and the plant's world position from the object. The distance is
   to the nearest point of the plant's bounding sphere about its origin, as the engine measures it,
   so the add-on gives the object or batch the same radius. A plant's leaves alone morph.

5. The engine gains one public input: a four-number vertex record that `VertexInput` reads as
   `vertexRecord`. It fills the vertex slot that a morphed mesh uses for its morph data, so a mesh takes
   one meaning or the other, never both, and no vertex location is added. WebGPU's 16 attribute
   locations hold: the record is the last vertex attribute, before the instance attributes and the
   motion pass's last-frame rows. The record grows from two to four floats, so a morphed mesh pays
   8 more bytes a vertex. `geometry.fromArrays` gains `targets`, and a material whose WGSL reads
   `input.vertexRecord` gets the `CUSTOM_TARGET` def and the attribute. A material that reads none pays
   nothing.

6. File meshes keep `setLevels` and the dither. The simplifier makes each level on its own and
   records no mapping. The tool's leaf-card step has a mapping for a part of separate cards, but no
   file needs the morph yet.

7. The engine's own threshold is private. The frame-budget governor multiplies the level threshold
   when frames run long, and the core applies the raised value while a material holds the one it was
   given. Under that pressure the engine switches before the mix ends, so a leaf card can pop; a page
   that lets the governor step calls `material.set({ lodThreshold })` with the raised value. Hold
   mode, which the pictures and the cost runs use, takes no such step, so the measured mixing is the
   material's own. The terrain does not have this gap: its morph reads the selection's scale from the
   add-on, which the add-on computes from the error it was given.

## Ruled out

- A distance to the block's corner, or to its center, for the terrain. It is not the distance the
  selection measures, so the block over-morphs at its own split and the switch still shows. Measured
  on the split page.
- The second texture coordinates for the terrain's parent height and size. They cost 8 bytes a
  vertex, 2,824 bytes a block, and cannot carry the block's height box, which the exact distance
  needs, so a design that added them would still need more data. The four-number record costs 16
  bytes a vertex, 5,648 bytes a block, and carries everything. The terrain therefore adds one array
  and not two, and the 2,824 bytes a block that a second coordinate set would have taken are not
  spent.
- An engine morph for whole levels. D-91 found no change wider than a pixel at 502 of 518 measured
  switches ([D-211](D-211-lod-fade-and-distance-bands.md)). A morph would add vertex data, shader
  builds and work to every mesh, and hide nothing.
- A morph for the asset tool's simplified meshes. Each level is made independently, so no vertex on
  one level names a vertex on the next.
- Live simplification. It costs CPU time and an upload every frame.
- Removing the skirt in this task.
- A material for each block, and a uniform write for each block in each frame. The record and the
  built-in positions remove both.
- A second WGSL file's surface, drawn for the morph, on a trunk or a flower. A material's shader
  declares the record for every mesh that draws with it, so the card-tree leaves have their own
  material, and the plain material draws the bark, the fronds and the flowers.
- A shared library module for the plant surface. A custom material's `#import` reaches only the
  engine's `null3d::` modules, a package cannot add one, and the compiler refuses a shader built by
  joining two files; the guide says so and prescribes the copy with a test that reads both files.
  The card material therefore holds the surface copy, `packages/vegetation/src/atlas.test.ts` fails
  when the two surfaces differ, and the two materials differ by the vertex offset alone. A
  vegetation module inside the engine's library would put an add-on's surface into the engine, which
  the design rule against it forbids.

## What a machine run would settle

- The split pages are measured on the Mac's three GPU paths; a SwiftShader run and a filmstrip
  across the switch at High and Low would still show the look at the other end of the range.
- The leaf vertex count and bytes per preset, from the generator's stats.

## Consequences

- The judged GPU check passed against the branch's own base: `028abe3f8..25e0bd6bd`, s4 medium
  2.76 to 2.54 ms (-7.4 per cent, noise 0.3), s6 medium 3.90 to 3.88 (+0.2, noise 3.4), s4 high
  3.45 to 3.55 (+3.2, noise 0.6) and s6 high 5.80 to 5.63 (-1.4, noise 2.0), every page "same". A
  page fails only above 25 per cent, above 0.3 ms and above twice its noise, so the 0.3 ms floor is
  what holds two rows that are many times their noise at "same": the four changes are 0.22, 0.02,
  0.10 and 0.17 ms.
- Code: `packages/terrain/src/chunk.ts`, `terrain.ts`, `material.ts` and `terrain.wgsl` gain the
  parent heights, the height box, the record and the offset. `packages/vegetation/src/levels.ts`,
  `generate.ts`, `builder.ts`, `leaves.ts`, `atlas.ts` and the new `plant-cards.wgsl` gain the
  target records, the card material and the mix; `plant.wgsl` itself is unchanged, and a test holds
  the two surfaces equal. The engine's vertex record, its array staging, the shader compiler's def
  and `VertexInput` gain the input.
- The terrain's casters count as moving casters, so a shadow view that a caster touches draws again
  in every frame, with the morph on or off: three cascades draw a frame at High, each at 0.2 to
  0.39 ms on the S25, under the frame's ambient occlusion pass.
- Docs: `docs/api/terrain.md` states the morph and its option. `docs/api/vegetation.md` states the
  leaf-card morph and the material's settings. `docs/concepts/lod.md` states which shapes morph and
  which switch. `docs/shaders/surface-functions.md`, `docs/shaders/builtins.md` and
  `docs/api/geometry.md` state the record and its cost.
- Skills: the develop skill's terrain recipe and API quick reference state the terrain morph and
  the `targets` array. The porting skill needs no change: a ported scene has no generated terrain
  or generated plant to morph.
- Tests: the terrain split page and the leaf switch page on all three GPU paths, and the `terrain`
  reference in both sets, which the morph moved.
- A custom material that reads the record gains a shader def and a vertex attribute. A material that
  reads none pays nothing, as D-138's defs do.
