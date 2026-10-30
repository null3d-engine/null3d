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
| The preset atlases | 5 by 5 at 800 KiB, 7 by 7 at 1,568 KiB, 9 by 9 at 2,592 KiB, and 12 by 12 at 4,608 KiB, both atlases in RGBA8, the same on every device | the bake page at every grid, runs `20261030-071918-impostor-bake`, `20261030-071952-impostor-bake` and `20261030-072140-impostor-bake`. The bake packs four bytes a texel, an sRGB color and three surface codes, so the far-tree task's estimate of about 1.6 MB and 9 MB counted eight bytes a texel (RGBA16F) and is twice the atlas that a preset builds |
| The card against the mesh at the switch | not measured | the image test `impostor-turn` |
| The hand-over's dithers | one: the mesh's range edge. A custom material takes no fading build, so the card switches at full coverage behind it | `fades_its_way` in `levels.rs`, and `handOverToCards` |
| The bake at each preset on the MacBook Pro M3 Max | conifer, birch and oak: Low 177, 44 and 60 ms; Medium 313, 84 and 118; High 518, 138 and 195; Ultra 924, 241 and 342. The page took 3.16 s for all twelve bakes | `impostor-bake` plan, run `20261030-071918-impostor-bake`, Chrome 156 on WebGPU |
| The bake at each preset on the iPad Pro 13 | Low 112, 39 and 41 ms; Medium 221, 54 and 77; High 303, 87 and 124; Ultra 535, 155 and 217. The page took 1.96 s | `impostor-bake` plan, run `20261030-071952-impostor-bake`, Safari 26.6.1 on WebGPU |
| The bake at each preset on the Galaxy S25 | Low 150, 36 and 50 ms; Medium 245, 66 and 94; High 411, 111 and 157; Ultra 740, 200 and 283. The page took 2.54 s | the same run, Chrome 152 on WebGPU |
| The bake at each preset on the Galaxy S24 | Low 293, 54 and 72 ms; Medium 384, 99 and 141; High 643, 164 and 234; Ultra 1,158, 297 and 426. The page took 3.97 s | `impostor-bake` plan, run `20261030-072140-impostor-bake`, Chrome 152 on WebGL2 |
| The first use of a three-species scene at Ultra | 1.51 s on the Mac, 0.91 s on the iPad Pro 13, 1.22 s on the Galaxy S25 and 1.88 s on the Galaxy S24, in one blocked main thread: one synchronous block a species, and nothing hides it | the four rows above, summed. The bake runs on the CPU, so the display rate and any GPU timer do not touch these figures |
| A turned copy's light | matches its mesh within the atlas's resolution | `impostor-turn`, `impostor-turn-sun-back` |
| The card field's GPU cost, 152 cards at 1600 x 900 on the Mac, preset High | WebGPU 1.02 ms, compatibility mode 1.02 ms, WebGL2 1.34 ms a frame | `NULL3D_IMPOSTOR_COST=1 bun run test:browser -- impostor-cost.spec.ts` through the heavy queue, from the driver's own timestamps |
| The whole frame with the cards, the same run | 1.22 to 2.51 ms of GPU time with the cards against 0.20 to 1.17 ms with them hidden; 16.67 ms interval, 0.12 to 0.16 ms CPU. The interval is the headless display's cap, so it is not a figure | the same |
| The card field on the iPad Pro 13 at Medium, 152 cards, 1032 x 1264 at 2x | WebGPU 7.38 ms, compatibility mode 9.43 ms a frame. A second run measured 6.96 and 9.24 ms. That is close to half of a 60 Hz frame's 16.67 ms. WebGL2 gives no GPU timer, and its 15.5 ms interval is the display's cap | `impostor-cost` plan, run `20261030-065625-impostor-cost` |
| The card field on the Galaxy S25 at Low, 152 cards, 360 x 621 at 3x | WebGPU 4.39 ms, compatibility mode 4.26 ms a frame. A second run measured 4.33 and 4.33 ms. The GPU timer gives the figures. The display ran at 30 Hz, so the 33.3 ms interval is its cap. WebGL2 gives no GPU timer | the same run |
| The cards on a phone and a tablet | the five tests passed on the iPad Pro 13 on WebGPU, compatibility mode and WebGL2, and on the Galaxy S24 on WebGL2; the S24 has no WebGPU or compatibility mode | the checks plan, 2026-10-29, runs `20261029-073419-checks` and `20261029-073908-checks` |
| The card field on the Galaxy S24 | this device gives no usable figure: its WebGL2 path has no GPU timer, and its display runs at 30 Hz, so the 33.3 ms interval is the display's cap and says nothing about the cards | `impostor-cost` plan, run `20261029-091347-impostor-cost` |
| The blend's cost against one view | Mac: 0.15 ms on WebGPU, 0.16 ms in compatibility mode and 0.20 ms on WebGL2. iPad at Medium: 0.00 ms on WebGPU, inside the round-to-round spread, and 0.47 ms in compatibility mode. Galaxy S25 at Low: 0.53 ms on both WebGPU paths | the same runs |
| The impostors demo's frame time, MacBook Pro M3 Max at 120 Hz | the display's rate held at every preset. GPU time per frame on WebGPU is 4.19, 5.24, 5.96 and 6.62 ms from Low to Ultra, in compatibility mode 4.39 and 4.19 ms, and on WebGL2 4.59 and 10.15 ms. D-241 has no Mac row | `impostor-frame` plan, run `20261030-063236-impostor-frame` |
| The impostors demo against D-241's forest ceilings, iPad Pro 13 at 60 Hz | holds every forest row the tablet has: Low WebGPU 15.62 against 15.6, Low compatibility 15.68 against 15.6, Low WebGL2 15.52 against 15.5, Medium WebGPU 40.43 against 54.8, Medium WebGL2 15.56 against 46.6, High WebGPU 48.67 against 67.1, and Ultra WebGPU 50.19 against 71.1. The three Low readings sit at the display's cap, at 60.0 frames a second | `impostor-frame` plan, run `20261030-070320-impostor-frame` |
| The impostors demo on the Galaxy S25 at 30 Hz | holds the display at every preset, with a frame interval of 33.32 or 33.33 ms. D-241 has an S24-class forest row only on WebGL2, where Low and Medium hold its 33.3 ms. The WebGPU GPU time is 19.73, 22.58, 24.58 and 28.05 ms from Low to Ultra, and compatibility mode 19.66 and 21.30 ms | the same run |

How the data was produced: the shader's texture reads and normal decodes are read from its code, and
the atlas sizes from the code that makes them. The bake's times and memory were measured with the
bake page on the Mac, the iPad Pro 13, the Galaxy S25 and the Galaxy S24. The card field's cost was
measured on the Mac's GPU in a quiet window, in the heavy queue,
and on the iPad and the Galaxy S25 with the cost page. The demo's frame time was measured with the
demo page at each preset that a GPU path draws, on the Mac, the iPad and the Galaxy S25. The pictures
are the image tests that this record names.

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

The references that this change redraws moved for one reason, and the earlier commit's message
described it wrongly; this paragraph corrects that description. A card's stored normal used to turn
with the camera's bearing as well as the tree's, so a card whose eye lay off the world's forward,
or whose tree was turned, lit a different side than its mesh did. The pictures that moved are those
whose cards are large on screen and see the eye off that forward: the card grid, which sets no turn
at all, moved by 1.002 to 1.012 per cent of its pixels, and the single plant by 0.207 to 0.269. The
two turned rows moved less, from 0.146 to 0.356 per cent, and the demo, which turns every tree and
draws its cards far and small, stayed under the 0.100 per cent line. The earlier message said that
the turned scenes moved and that the demo's cards were why one did not; the runs show the reverse
of its first half, and the grid it did not name is the picture that moved most.

Drawing both faces was reasoned rather than measured: a camera-facing card shows its front face,
whose shading path the change does not touch, so the picture that a camera draws cannot change. The
earlier message called that a measured comparison, and no run in the tree holds one, so this line
withdraws the claim.

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
   no progress line and no placeholder. At the Ultra grid the three species take 1.5 s on the Mac,
   0.9 s on the iPad Pro 13, 1.2 s on the Galaxy S25 and 1.9 s on the Galaxy S24. A scene that cannot
   afford the S24's stall bakes one species a frame, or holds its far band as meshes until the bake
   ends; the add-on offers no help for either.
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
   function. A development build refuses a coverage function on a material that is not masked,
   since the caster would test no cutoff and cast the whole shape. A card draws both faces: the
   shadow pass culls the front faces of single-sided
   geometry, so a flat card drawn from one side would be culled whole and cast nothing, and the
   card's own material is double-sided to leave its back face to the caster. The flag is the
   material's, so both faces draw in every pass: the main pass costs the same, because a card that
   turns toward the eye has every triangle facing it, and the one behaviour that changes is a card
   seen from behind, which now draws instead of vanishing. Nothing meets that today, but an add-on
   that turned a card toward one eye and drew it from another would. A card inside the
   reach draws as a second batch with `castShadows: true` on a layer that the sun draws and no
   camera does, so the camera pays nothing for it. The card's material declares `castsStill: true`,
   so its vertex offset turns the caster toward the light without marking the batch a moving
   caster, and a far cascade keeps its layer while the sun stands still. A scene that turns its
   cards itself, frame after frame, moves the caster while the light stands still, and the far
   cascades then keep a stale shadow: the add-on's `castsStill` option, true by default, lets that
   scene withdraw the claim. The caster reads the coverage from the direction toward the light,
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
- The image test `impostor-handover` draws a row of turned pines inside the hand-over band, where
  the mesh's dither and its card share the crown. The crown holds no pixel of the background, which
  settles that one dither moves the tree, and each card shows the turn that its tree has.
  `impostor-handover-strip.spec.ts` walks the camera through the band and compares each card with
  the crown of its mesh: the card that shows the tree's own turn sits closer to the mesh than a card
  turned 60 degrees further, and the two card pictures differ. The Rust test
  `a_custom_material_never_fades_so_a_handed_over_card_does_not_dither` holds the fact that makes
  it so.
- The Rust tests `a_still_card_in_a_far_cascade_leaves_its_layer_cached` count the far cascade's
  draws over eight frames, on the WebGPU builder and on the WebGL2 one. A card that claims to be
  still draws it exactly as often as a caster that never moves, and a card that does not claim it
  draws it in every frame. The material test `passes a card's still-caster claim to the core, and
  its withdrawal` holds that the public `castsStill` option sets the core's still-caster flag.
- The image test `impostor-plant` draws a grown birch as its level-0 mesh beside the card that
  `bakeFarTree` makes from it. The two crowns match in colour, which settles the bake, the leaf
  coverage and the per-part tints.
- The `impostor-cost` page draws a full view of 152 cards with the whole batch hidden and shown in
  turns, so the difference is the card batch's frame cost, and then draws the three-view blend
  against one view. On the Mac's GPU at High the field costs 1.02 ms on WebGPU, 1.02 ms in
  compatibility mode and 1.34 ms on WebGL2 at 1600 x 900. On the iPad Pro 13 at Medium it costs
  7.38 ms on WebGPU and 9.43 ms in compatibility mode at 1032 x 1264 with 2x pixels. That is close
  to half of a 60 Hz frame's 16.67 ms, so a scene that draws a field of cards at this size spends
  almost half its budget on them on that tablet. On the Galaxy S25 at Low it costs 4.39 ms on WebGPU
  and 4.26 ms in compatibility mode at 360 x 621 with 3x pixels. WebGL2 gives no GPU timer on any of
  the three devices, so its interval is the display's cap and not the cards' cost. The three-view
  blend costs 0.15 to 0.20 ms on the Mac and up to 0.53 ms on the phone; on the iPad's WebGPU path
  its cost is inside the round-to-round spread. The `impostor-frame` plan then times the demo that
  draws the cards at each preset a path draws. The iPad Pro 13 holds every forest ceiling that D-241
  gives it. The Galaxy S25 holds the display at every preset, and D-241 has an S24-class forest row
  only on WebGL2, where Low and Medium hold its 33.3 ms. D-241 has no Mac row. The figures are in the
  table above.
- The filmstrip `impostor-handover-strip.spec.ts` walks the camera through the hand-over and moves
  the sun around a row of turned pairs, which a still cannot show, and compares the band's turned
  cards with their meshes. Its frames go to `target/filmstrip/` for the owner.

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
  caster builds. The impostor, plant, turn and hand-over pictures are redrawn for the upright frame,
  the bake, the shadow offset and the hand-over's turned trees. The `impostor-frame` plan times the
  demo that draws the cards at each preset a GPU path draws, so the frame check repeats on each
  device. The Rust test `a_still_card_in_a_far_cascade_leaves_its_layer_cached` counts the far
  cascade's draws on both builders, the material test holds the still-caster option's core flag, and
  the strip's turned-band test runs on a computer with a GPU of its own.
- The far-tree task builds the per-variant bake, the hand-over band and the shadow method. This
  record builds the card, the blend, the normal's frame, the turn and the bake helper, and the two
  tasks do not split the same work twice. The shadow method is M3-V9's, and this record's decision 9
  states the engine capability that it builds.
