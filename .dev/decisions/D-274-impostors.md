# D-274: The far vegetation impostors

Status: decided. The owner ruled the record stands, on the auditor's reading that its split of
responsibility is the right one. Built for this record: the cards' three-view blend and
their relight from stored normals (`3a75764e5`), the two atlases and `encodeImpostorSurface`, the
per-copy turn with the card's upright frame, and the bake helper that fills both atlases. Built by
the far-tree task beside it: the per-variant bake and the hand-over band, in the vegetation add-on.
Built with this record's shadow method: a custom material's caster tests the coverage that its WGSL
names, a masked card cuts its crown out of its shadow, and a card that receives shadows reads them
at the surface that its stored depth shows. Task: M3-L4, M3-V9.

Summary: A far tree draws as a card from two octahedral atlases: color, and a linear surface of
normal, depth and coverage. The card stands upright, turns to the eye, blends the three cells
nearest the direction and lights from the stored normal. This record keeps that layout and stores
the normal in the object's local frame, so a turned copy lights correctly. The impostors add-on owns
the card and the bake helper, and the vegetation add-on owns the bake of each variant and the
hand-over. The card's shadow is cut to its crown and holds still while the light does.

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
| The card's texture reads | 6 a fragment: the color and surface atlases at each of three cells, or 2 when one view draws | `cards.wgsl` |
| The card's normal decodes | 3, one for each cell, or 1 when one view draws | `cards.wgsl` |
| The caster's reads | 3 color texels a shadow texel, at the three cells nearest the light | `cards.wgsl` |
| The test atlas | 4 by 4 cells of 32 texels, 128 by 128 texels each, two textures | `impostors-sketch.ts` |
| The demo atlas | 4 by 4 cells of 64 texels, 256 by 256 texels each | `forest.ts` |
| The demo atlas's bytes | 262,144 bytes a texture in RGBA8, 524,288 for the two | the size above, four bytes a texel |
| The preset atlases | 5 by 5 at 800 KiB, up to 12 by 12 at 4,608 KiB, both atlases in RGBA8 | the bake page at every grid, runs `20261029-143509-impostor-bake` and `20261029-143643-impostor-bake`. This measurement replaces the far-tree task's estimate of about 1.6 MB and 9 MB, which counted eight bytes a texel (RGBA16F) for each atlas; the bake packs four, an sRGB color and three surface codes |
| The card against the mesh at the switch | not measured | the image test `impostor-turn` |
| The hand-over's dithers | one: the mesh's range edge. A custom material takes no fading build, so the card switches at full coverage behind it | `fades_its_way` in `levels.rs`, and `handOverToCards` |
| The bake's time at 25 views and 64 texels | 28 to 90 ms a plant on the Mac, the first time | `bakeFarTree` of three species, 3,667 to 5,968 triangles |
| The bake's memory at 25 views and 64 texels | 0.73 to 0.78 MiB, both atlases | the same run, the atlases' bytes |
| The bake at each preset on the Galaxy S25 | conifer, birch and oak: Low 159, 38 and 48 ms; Medium 252, 68 and 96; High 420, 113 and 162; Ultra 757, 205 and 292. 800 KiB to 4,608 KiB | `impostor-bake` plan, run `20261029-143509-impostor-bake`, Chrome 152 on WebGPU |
| The bake at each preset on the iPad Pro 13 | Low 110, 39 and 40 ms; Medium 223, 55 and 76; High 303, 87 and 123; Ultra 532, 153 and 216. 800 KiB to 4,608 KiB | the same run, Safari 26.6.1 on WebGPU |
| The bake at each preset on the Galaxy S24 | Low 454, 84 and 113 ms; Medium 602, 155 and 220; High 1,002, 253 and 362; Ultra 1,771, 449 and 642. 800 KiB to 4,608 KiB | `impostor-bake` plan, run `20261029-143643-impostor-bake`, Chrome 152 on WebGL2 |
| The first use of a three-species scene at Ultra | 900 ms on the iPad Pro 13, 1,254 ms on the Galaxy S25 and 2,862 ms on the Galaxy S24, in one blocked main thread: one synchronous block a species, and nothing hides it | the three rows above, summed. The bake runs on the CPU, so the display rate and any GPU timer do not touch these figures |
| A turned copy's light | matches its mesh within the atlas's resolution | `impostor-turn`, `impostor-turn-sun-back` |
| The card field's GPU cost, 152 cards at 1600 x 900 on the Mac | WebGPU 0.77 ms, compatibility mode 0.96 ms, WebGL2 0.55 ms a frame | `NULL3D_IMPOSTOR_COST=1 bun run test:browser -- impostor-cost.spec.ts` through the heavy queue |
| The whole frame with the cards, the same run | 1.11 to 1.92 ms of GPU time against 0.15 to 1.37 ms with them hidden; 16.67 ms interval, 0.1 ms CPU | the same |
| The cards on a phone and a tablet | the five tests passed on the iPad Pro 13 on WebGPU, compatibility mode and WebGL2, and on the Galaxy S24 on WebGL2; the phone has no WebGPU or compatibility mode | the checks plan, 2026-10-29, runs `20261029-073419-checks` and `20261029-073908-checks` |
| The card field on the iPad Pro 13, 152 cards | WebGPU 7.0 ms, compatibility mode 5.9 ms a frame at a 1032 by 1264 window with 2x pixels, nearly half of a 60 Hz frame's 16.67 ms; WebGL2 gives no GPU timer | `impostor-cost` plan, run `20261029-091142-impostor-cost` |
| The card field on the Galaxy S24 | this device gave no usable figure: its WebGL2 path has no GPU timer, and its display ran at 30 Hz, so the 33.3 ms interval is the display's cap and says nothing about the cards | `impostor-cost` plan, run `20261029-091347-impostor-cost` |
| The blend's cost against one view | not measured | the switch that draws one cell is built (`ImpostorBatch.setViews`); the run is queued |

How the data was produced: the shader's texture reads and normal decodes are read from its code, and
the atlas sizes from the code that makes them. The bake's times and memory were measured on the Mac
with a script over three species, and on the Galaxy S25, the Galaxy S24 and the iPad Pro 13 with the
bake page. The card field's cost was measured on the Mac's GPU in a quiet window, in the heavy queue,
and on the iPad, with the cost page. The pictures are the image tests that this record names.

## Look

The image reference `impostors` shows 21 cards over a plane, with three merged panels in front. Each
cell's color follows the direction its view was drawn from. The cards therefore show a smooth ramp
from one side of the grid to the other. Neighboring cards differ continuously, which is what the
three-cell blend gives. A single-view card would show the ramp as bands. The test does not show the
old hop, because the atlas has no flat cell colors.

The demo reference `demo-impostors` shows a pine forest at sunset, with the far band drawn as cards.
The far trees read as trees, and no seam between the middle band and the cards shows at 320 by 180
pixels. The picture is a still, so it cannot show a hop, a shimmer or a change of light.

No picture puts a card beside the mesh it replaces at the demo's switch distance. `impostor-turn`
puts the two side by side at one camera, and `impostor-turn-azimuth` does at a camera 65 degrees
around the row. Every card there sees the eye far from the world's forward, so a card that turned
its stored normal by the card's own frame lights a different side of its crown than its mesh does,
and the pair no longer matches.

The image reference `impostor-handover` shows a row of pines at the hand-over distance: each draws
as its mesh and as its card at one place, the mesh's pixels dither out over the card's full crown,
and no background shows through a crown. A card that faded as well would drop the pixels that its
mesh's dither drops too, and the picture would hold dots of the background.

The demo's cards stand past its sun's 120 m reach, which is decision 7's rule and the reason its
picture has no card shadow: the cards begin at 420 m. The picture test below shows the method at a
reach that covers its cards.

The image reference `impostor-shadow` shows a row of cards over a ground plane, with a second batch
of the same cards that only the sun draws. Each card's shadow holds the crown's shape, so a card
cuts its own shadow at the coverage that the bake stored. Each shadow tapers from the trunk to the
crown's tip and carries the branch tips' ragged edge, where a whole quad would cast a straight-edged
parallelogram. Every card stays lit where the sun reaches
it, because its shadow lookup reads the surface that its stored depth shows rather than its own
plane. A regression to either fault changes the picture: a solid rectangle of a shadow, or a card
that darkens itself.

## Decision

1. The layout is two textures on one octahedral grid. D-151's add-on form and its grid stand. Its
   open item, the three-view blend, is built. The card now draws with the package's own material in
   place of the sprite batch that picked one frame. The color atlas is sRGB, and its alpha holds
   the coverage. The surface atlas is linear. Red and green hold the normal's octahedral code. Blue
   holds the point's depth from the view's front to its back. Alpha holds the coverage. Mip levels
   stay off. A mip level mixes the cells beside it, and the cards draw past the range where a cell's
   detail matters.
2. The surface atlas stores the normal in the object's local frame. The card stands upright and
   turns to the eye about the world's up, so its quad's frame is the camera's frame kept level; the
   quad carries the world's up rather than the camera's, because a tree must stand as its mesh does,
   and `camera.view` alone would tilt it as the camera looked down. That display frame is not the
   frame that lights the card. The stored normal and the direction toward the eye are taken to the
   world by the tree's own turn alone, and the cell pick reads the eye in the tree's frame. The
   camera's azimuth enters neither, so a camera that moves around a tree leaves the tree's light
   where the sun puts it. Turning the normal by the card's own frame instead adds the camera's
   azimuth to the tree's turn, and a copy then lights a side that its mesh does not: the error
   grows with the camera's angle from the world's forward, and no cell resolution bounds it. The
   bake stores the mesh's own normal, which already lies in the object's frame.
3. The three-view blend stays. The shader weights the three cells of the square that holds the
   direction. The two triangles of that square agree on their shared edge. The color is therefore
   continuous across a cell boundary. A single view would hop, and the blend removes the hop. The
   sprite path that picked one frame is no longer the card's path.
4. `createImpostors` takes a turn for each card, through the batch's row values. The shader turns the
   direction before it picks the cells, and it turns the stored normal by the same value. The turn is
   this record's card work, with the light kept in step.
5. Ownership: the impostors add-on owns the card, the two atlases, the blend, the normal's frame, the
   depth's meaning, the turn, and the bake helper that fills the two atlases. The vegetation add-on
   owns the bake of each variant at first use and the hand-over band. The plant's `impostorSource`
   names the level, the bounds, the pivot and the tint. Vegetation takes the impostors add-on as a
   peer at the exact version. D-241 already makes vegetation reuse the impostor foundation.
6. The depth stays in the surface atlas. The far-tree task reads it for the receiver offset of its
   shadow method. This record does not read it for parallax. A parallax shift would move texels across
   cell edges, and no picture shows a parallax fault at the distances the cards draw.
7. The cards take no shadows unless a sketch asks. They draw past the shadow's reach, where the mesh
   they replace draws nothing either. A card inside the reach draws as the cast-only caster of
   decision 9, which faces the light and leaves the far cascades cached, and a card that receives
   shadows reads them at the surface that it shows.
8. The bake draws on the CPU, not with the engine's scene passes as the plan's design expects. The
   atlases must come out identical on WebGPU and WebGL2, because the same scene then draws the same
   card and one reference can hold both paths. A scene pass draws the scene's sun, fog and
   environment into the atlas, so each path would bake a different picture, and a bake that wants no
   light must undo them. This record stores the colour unlit and relights in the card's shader, so
   the bake needs no scene light at all. The work runs once at first use, which hard rule 42 leaves
   in TypeScript because it is not a frame loop. That first use is a stall a visitor meets: the bake
   is one synchronous block a species on the main thread, and nothing in the add-on hides it, with
   no progress line and no placeholder. At the Ultra grid the three species take 0.9 s on the iPad
   Pro 13, 1.3 s on the Galaxy S25 and 2.9 s on the Galaxy S24. A scene that cannot afford the
   S24's stall bakes one species a frame, or holds its far band as meshes until the bake ends; the
   add-on offers no help for either.
9. The card's shadow method is built, as decisions 6 and 7 leave it to the far-tree task. A card
   that casts draws as a cast-only caster, inside the reach, and faces the light. The engine
   capability that the caster needed is built: a custom material may declare
   `fn coverage(input: SurfaceInput) -> f32`, the opacity that its shadow caster tests, and its
   caster builds then keep the material's mask bit and run a fragment stage that drops each shadow
   texel the cutoff leaves out. The build's rule that no caster holds the mask bit changes with
   this: the pair is allowed, and only a material's own choice asks for it. The table of pairs that
   no build holds together falls from 56 to 55. The freed combination is a custom material's caster
   build with the mask bit, which `material.rs` makes from the lit template's caster variant for a
   material whose WGSL declares both a mask and a coverage function, on the WebGPU path and on the
   WebGL2 path, whose caster variant takes the same targets. No engine template asks for both bits:
   the shadow depth template's casters name `CASTER` and never a mask, and the cut-out templates
   test the mask and name no `CASTER` bit. So no standard material's caster gains a coverage stage,
   and a WebGPU caster asks for a fragment stage only where its material declares a coverage
   function. A card draws both faces: the shadow pass culls the front faces of single-sided
   geometry, so a flat card drawn from one side would be culled whole and cast nothing, and the
   card's own material is double-sided to leave its back face to the caster. A card inside the
   reach draws as a second batch with `castShadows: true` on a layer that the sun draws and no
   camera does, so the camera pays nothing for it. The card's material
   declares `castsStill: true`, so its vertex offset turns the caster toward the light without
   marking the batch a moving caster, and a far cascade keeps its layer while the sun stands still. The caster reads the coverage from the direction toward the light,
   from the same three cells that the card blends, so the shadow does not step as the sun turns. A
   card that receives shadows (`receiveShadows: true`) moves its sun lookup to the surface that the
   surface atlas's stored depth shows, along the view, scaled by the card's depth, so the card does
   not darken itself: the visible surface then compares with its own cast as the mesh it stands for
   would. The card leaves the contact shadows' march out, as a leaf card does, because the march
   takes its flat quad for a solid wall. The vertex offset reads the frame's camera the way the lit
   template does, so an orthographic cascade turns the card toward the light and a perspective
   camera turns it toward the eye.
10. The hand-over moves a tree with one dither, not two. `handOverToCards` ends the mesh batch's
    range at the switch distance and starts the card batch a fade band before it. The engine gives
    the mesh's last eighth of its range the `LOD_FADE` builds, whose 4 x 4 dither thins the mesh
    out, and it gives no such build to a custom material: the card material takes none, so the
    cards stand at full coverage behind the meshes while the mesh's pixels dither away. Each pixel
    that the mesh drops shows its card, and the background never shows through. The engine's dither
    phase is a hash of each copy's source, and the mesh and the card are different sources, so
    their phases differ. Were both to fade, each would drop part of the pixels that the other
    drops too, and about a quarter of the band would show the background. The helper therefore
    takes a card batch whose material does not fade, and its documentation says so.

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
- Cards that receive the sun's shadows at their own plane. Their world position is the plane, not
  the tree's surface, so the lookup reads the card's own cast: part of the card darkens, by a line
  that moves as the sun does. The stored depth is what places the lookup at the surface that the
  card shows.
- A still card that stops being a caster. A card that does not cast leaves its own ground unshaded,
  and the mesh it replaced did cast. The card casts, cut to its crown, and the engine holds its
  casters still while the light does.

## What a machine run settles

- The image test `impostor-turn` draws three trees as a mesh and as a card beside it, at one camera.
  A turned copy's card shows the same side and the same light as its mesh. `impostor-turn-sun-back`
  moves the sun behind the row, and both sources turn dark. The pieces match within the atlas's
  resolution, which the cells' texels set. `impostor-turn-azimuth` draws the same pairs with the
  camera 65 degrees around the row, where the card's light must stay on its mesh's side.
- The image test `impostor-handover` draws a row of pines inside the hand-over band, where the
  mesh's dither and its card share the crown. The crown holds no pixel of the background, which
  settles that one dither moves the tree. The Rust test
  `a_custom_material_never_fades_so_a_handed_over_card_does_not_dither` holds the fact that makes
  it so.
- The image test `impostor-plant` draws a grown birch as its level-0 mesh beside the card that
  `bakeFarTree` makes from it. The two crowns match in colour, which settles the bake, the leaf
  coverage and the per-part tints.
- The `impostor-cost` page draws a full view of 152 cards with the whole batch hidden and shown in
  turns, so the difference is the card batch's frame cost. On the Mac's GPU the field costs 0.55 to
  0.96 ms a frame, and the whole frame runs 1.11 to 1.92 ms of GPU time with the cards against 0.15
  to 1.37 ms without. The iPad Pro 13 measures 7.0 ms on WebGPU and 5.9 ms in compatibility mode.
  That is nearly half of the 16.67 ms of a 60 Hz frame, so a scene that draws a field of cards at
  this size spends almost half its budget on them on that tablet. The Galaxy S24 gave no usable
  figure: its WebGL2 path has no GPU timer, and its display ran at 30 Hz, so its 33.3 ms interval
  is the display's cap and not the cards' cost. The Galaxy S25's own cost is still owed: its WebGPU
  path has a GPU timer, and its display ran at 30 Hz in its timed runs, so a run there decides
  whether a phone gives a usable figure at all. The blend's own cost against one view is still
  owed: the switch that draws one cell is built, and the run is queued.
- A filmstrip of a moving camera through the hand-over, and of the sun's sweep. A still cannot show a
  hop, a shimmer or the light changing. The demo runs it, and no picture holds it yet.

## Consequences

- Code: `packages/impostors/src/surface.ts` states the normal's frame.
  `packages/impostors/src/cards.wgsl` stands the card upright, reads the turn, turns the direction and
  turns the normal, decodes the atlas's byte codes, tests the coverage that its caster draws, and
  moves its sun lookup to the surface that the stored depth shows. `packages/impostors/src/batch.ts`
  creates the batch with row values, takes the turns, and takes the depth that scales the stored one,
  the two shadow flags and the view count. `packages/impostors/src/bake.ts` fills the two atlases and
  returns the card's size and depth. `packages/vegetation/src/impostor.ts` bakes a plant's level and
  sets the hand-over band. The engine's `crates/null3d-shaders/src/material.rs` builds a custom
  material's caster from its `coverage` function, and `crates/null3d-render/src/frame.rs` routes a
  masked caster through it and keeps a still caster out of the moving list.
- Docs: `docs/api/impostors.md` states the local frame, the turn, the bake, the depth's use and the
  two shadow flags. `docs/api/materials.md` and `docs/shaders/surface-functions.md` state the
  `coverage` function, `Surface.shadowOffset` and `castsStill`. `docs/api/vegetation.md` states the
  far tree and the hand-over. `docs/concepts/lod.md` states that the card is lit by the scene's sun
  and casts its crown. The three.js mapping gains nothing, because three.js has no impostor
  counterpart.
- Skills: the develop skill's impostor, vegetation and shader notes.
- Two things to keep the split honest as it grows. A second add-on that wants the same distance
  hand-over moves the band into the impostors add-on then, rather than copying it. And the bake
  helper's public shape stays plant-neutral. The four `impostorSource` fields are the guard that
  keeps a caller from passing a plant's own nouns through it.
- Tests: `impostor-turn` and `impostor-turn-sun-back` draw a turned tree beside its card,
  `impostor-plant` draws a grown plant beside its card, and `impostor-shadow` draws a row of cards
  beside their cut-out shadows. A Rust test holds a coverage material's caster to its own builds and
  a still caster out of the moving list, and the material build's test holds the coverage function's
  caster builds. The impostor, plant and turn pictures are redrawn for the upright frame, the bake
  and the shadow offset.
- The far-tree task builds the per-variant bake, the hand-over band and the shadow method. This
  record builds the card, the blend, the normal's frame, the turn and the bake helper, and the two
  tasks do not split the same work twice. The shadow method is M3-V9's, and this record's decision 9
  states the engine capability that it builds.
