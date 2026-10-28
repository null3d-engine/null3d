# D-274: The far vegetation impostors

Status: proposed, for the owner's ruling. Built: the cards' three-view blend and their relight from
stored normals (`3a75764e5`), the two atlases and `encodeImpostorSurface`. Not built: the per-copy
turn, the far-tree bake, the hand-over band and the impostor shadow method. Task: M3-L4.

Summary: A far tree draws as a card from two octahedral atlases: color, and a linear surface of
normal, depth and coverage. The card blends the three cells nearest the direction and lights from the
stored normal. This record keeps that layout and stores the normal in the object's local frame, so a
turned copy lights correctly. The impostors add-on owns the card, and the vegetation add-on owns the
bake and the hand-over.

## Question

What should the far-vegetation impostors be, and does the engine's impostor support or the vegetation
add-on own them? What do the three-view blend and the relight still need?

## Rule

- The card must match the mesh it replaces at the hand-over. That is the look bar, and it decides
  between options that differ in the picture (hard rule 40).
- The card's blend costs texture reads for every far tree's pixels. The blend stays only because the
  owner ruled it in and the look needs it.
- Each feature lives in one place. The card, its atlases and its blend are the impostors add-on. The
  bake of a plant, its turn and its hand-over are the vegetation add-on.
- Both GPU paths draw the same card.
- The far band draws past the shadow's reach, as the demo's cards do.

## Data

| Measure | Value | Source |
| --- | --- | --- |
| The card's texture reads | 6 a fragment: the color and surface atlases at each of three cells | `cards.wgsl` |
| The card's normal decodes | 3, one for each cell | `cards.wgsl` |
| The test atlas | 4 by 4 cells of 32 texels, 128 by 128 texels each, two textures | `impostors-sketch.ts` |
| The demo atlas | 4 by 4 cells of 70 texels, 280 by 280 texels each | `forest.ts` |
| The demo atlas's bytes | 313,600 bytes a texture in RGBA8, 627,200 for the two | the size above, four bytes a texel |
| The preset atlases that the far-tree task names | 5 by 5 at about 1.6 MB, up to 12 by 12 at about 9 MB | the far-tree task's estimate, not a measurement |
| The card against the mesh at the switch | not measured | the image test below |
| The blend's cost against one view | not measured | the timing run below |
| The bake's time and memory | not measured | the far-tree task records both per preset and device |
| A turned copy's light | not measured | no turn is read today |

How the data was produced: read from the add-on's code and from the demo. The atlas bytes are
arithmetic. No run was made.

## Look

The image reference `impostors` shows 21 cards over a plane, with three merged panels in front. Each
cell's color follows the direction its view was drawn from. The cards therefore show a smooth ramp
from one side of the grid to the other. Neighboring cards differ continuously, which is what the
three-cell blend gives. A single-view card would show the ramp as bands. The test does not show the
old hop, because the atlas has no flat cell colors.

The demo reference `demo-impostors` shows a pine forest at sunset, with the far band drawn as cards.
The far trees read as trees, and no seam between the middle band and the cards shows at 320 by 180
pixels. The picture is a still, so it cannot show a hop, a shimmer or a change of light.

No picture puts a card beside the mesh it replaces at the switch distance. No picture turns a copy
against its atlas.

## Decision

1. The layout is two textures on one octahedral grid. D-151's add-on form and its grid stand. Its
   open item, the three-view blend, is built. The card now draws with the package's own material in
   place of the sprite batch that picked one frame. The color atlas is sRGB, and its alpha holds
   the coverage. The surface atlas is linear. Red and green hold the normal's octahedral code. Blue
   holds the point's depth from the view's front to its back. Alpha holds the coverage. Mip levels
   stay off. A mip level mixes the cells beside it, and the cards draw past the range where a cell's
   detail matters.
2. The surface atlas stores the normal in the object's local frame. The card faces the camera, so the
   object's frame is the view's frame, and `camera.view` takes a local normal to the world exactly.
   The shader turns the blended normal by the copy's turn and then lights it. A normal stored in the
   view's frame belongs to the cell's view, not the card's. Converting it with the camera's basis is
   therefore an approximation. The error is up to half a cell's angle, and a turned copy needs the
   whole turn. The bake converts the rendered normal to the object's frame before it calls
   `encodeImpostorSurface`.
3. The three-view blend stays. The shader weights the three cells of the square that holds the
   direction. The two triangles of that square agree on their shared edge. The color is therefore
   continuous across a cell boundary. A single view would hop, and the blend removes the hop. The
   sprite path that picked one frame is no longer the card's path.
4. `createImpostors` takes a turn for each card, through the batch's row values. The shader turns the
   direction before it picks the cells, and it turns the stored normal by the same value. This is the
   far-tree task's per-copy turn, with the light kept in step.
5. Ownership: the impostors add-on owns the card, the two atlases, the blend, the normal's frame, the
   depth's meaning and the turn. The vegetation add-on owns the bake of each variant at first use and
   the hand-over band. The plant's `impostorSource` names the level, the bounds, the pivot and the
   tint. Vegetation takes the impostors add-on as a peer at the exact version when the hand-over
   lands. D-241 already makes vegetation reuse the impostor foundation.
6. The depth stays in the surface atlas. The far-tree task reads it for the receiver offset of its
   shadow method. This record does not read it for parallax. A parallax shift would move texels across
   cell edges, and no picture shows a parallax fault at the distances the cards draw.
7. The cards take no shadows. They draw past the shadow's reach, where the mesh they replace draws
   nothing either. A card inside the reach is the far-tree task's cast-only caster, which faces the
   light and leaves the far cascades cached.

## Ruled out

- One texture for both atlases. The color needs sRGB and the surface needs linear, and the surface
  needs four channels. Packing them loses a color space or a channel.
- Mip levels on either atlas. A mip level mixes adjacent cells.
- A view-frame normal. It belongs to a cell's view, so it is off by up to half a cell's angle, and it
  cannot follow a copy's turn.
- A single view for each card. It hops, and the owner ruled the blend in.
- A separate card material in the vegetation add-on. It would copy the octahedral encoder and the
  blend.
- Parallax from the stored depth in this task.
- Cards that receive the sun's shadows. Their world position is the card's plane, not the tree's
  surface, so the shadow lookup would read the wrong place. The stored depth is what a correct
  lookup needs, and the far-tree task's shadow method owns that work.

## What a machine run would settle

- An image test draws one tree as a mesh and as a card at the same camera. It draws them at the
  switch distance and at the far end of the band, on all three GPU paths and each preset. The color
  difference and a side-by-side settle the match. The far-tree task's Done-when names this picture
  for Creek's far slopes.
- A test with a card and its mesh turned by the same angle, and a sun that moves across the sky. The
  light on the two settles the turn and the normal's frame.
- A test page switch that draws one view in place of the three, timed on the Mac, an iPad and an
  S24-class phone. The card's cost per pixel settles the blend's price.
- The bake's time and memory at each preset on the same three devices, which the far-tree task's
  Done-when already names.
- A filmstrip of a moving camera through the hand-over, and of the sun's sweep. A still cannot show a
  hop, a shimmer or the light changing.

## Consequences

- Code: `packages/impostors/src/surface.ts` states the normal's frame.
  `packages/impostors/src/cards.wgsl` reads the turn, turns the direction and turns the normal.
  `packages/impostors/src/batch.ts` creates the batch with row values and takes the turns.
- Docs: `docs/api/impostors.md` states the local frame, the turn and the depth's use.
  `docs/concepts/lod.md` states that the card is lit by the scene's sun. The three.js mapping gains
  nothing, because three.js has no impostor counterpart.
- Skills: the develop skill's impostor and vegetation notes.
- Tests: the image test of the test atlas gains a turned card. The hand-over picture is the
  far-tree task's.
- The far-tree task builds the bake, the turn's API and the shadow method. This record's card work is
  built, and the two tasks do not split the same work twice.
