# D-219: One object's shadow at its own scale

Status: decided. Date: 2026-10-23, with an addendum of 2026-10-25. Task: M3-A9. The cost figures are owed: the runs that stood here were taken at a load above the cost specs' limit, and the timing helper takes them again.

Summary: A directional light can name one object as its hero, which adds one draw when it moves. Its shadow draws into a tightly fitted tile of the shadow atlas, which receivers in the box read before the cascades. The tile's size is a setting: 1,024, 2,048 or 4,096 texels, with a default on each quality preset. At the defaults the demo's 4.4 m car keeps at least four times the texel density of the cascade that holds 10 m. That holds on every preset (addendum of 25 October 2026).

## Question

The cascades spread their texels over the whole view. A subject in close-up, such as a car on a showroom floor or a character on a plinth, gets shadows two or three centimeters coarse, and its own shadow edge shows steps. Contact shadows fill the gap where a small object meets the ground (D-135) but cannot sharpen a whole silhouette. Which technique gives one chosen object a much finer shadow, at no cost when a scene does not ask for it?

## Rule

- The hero's own shadow has at least four times the texel density of the cascade that holds 10 m, at each preset's default tile size, for the demo's 4.4 m car and for an object a few meters wide. A page may raise the tile size for a larger object.
- Changing the hero, or moving it, costs no more than one extra shadow pass per frame.
- A scene that names no hero behaves exactly as before, with no extra pass, texture or uniform read.
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader (D-52).
- No allocation per frame ([hard rule 1](../../AGENTS.md#hard-rules)).

## Options

| Option | Verdict |
| --- | --- |
| A: a separate shadow map texture with its own binding and sampler | Rejected. The opaque pass's fragment stage already reads 15 of the 16 textures a device allows, and a new binding needs a new layout on every lit pipeline. The tiles of the atlas already hold depth that the sun's path can read |
| B: an extra cascade fitted to the object | Rejected. It takes a cascade slot of four, and its box still spans the camera's view at that distance rather than the object |
| C: a tile of the existing spot and point shadow atlas, fitted to the object | Chosen. It reuses the atlas, its filters, its redraw rules and its culling, and the sun's shader reads it through the binding that the tiles already use |

## Design

- The hero tile takes the atlas's last layer, and the atlas grows by that layer when a light names a hero. Lights keep every tile that the preset gives them, except in an atlas already at its limit of 24 layers, where the smallest light gives one up. The tile's size, 1,024, 2,048 or 4,096 texels, decides the hero's detail; every layer of the atlas takes it (addendum of 25 October 2026).
- The box is square across the light around the object's world bounding sphere, reaching one radius past it toward the light and sixteen past it away from the light, where its shadow lands. The across-light extent sets the texel size; the along-light extent only sets the depth range, which is 32-bit float, as the atlas is.
- A receiver transforms itself into the box's clip space. Inside it, and within its depth range, it reads the hero's layer with the atlas filter; outside, it reads the cascades. A caster that shadows a point inside the box must lie inside the box's across-light extent too, so the tile holds every caster that its receivers need.
- The tile draws when the light turns, when nothing drew yet, when the hero's box moves or changes, and when a caster that touches the box moves. Otherwise it keeps its depth, as a light's tile does (D-61). The redraw cap counts lights' tiles; the hero adds at most one tile a frame.
- The hero's bias is the light's own, capped by the hero's texel, so the shadow sits close to its caster rather than a cascade's texel away.

## Data

Texel sizes in meters for the demo's camera (a 42 degree lens, 16:9), its sun's 60 m shadow distance, and the car's bounding sphere, 4.4 m across. The comparison is the cascade that holds 10 m, which is the cascade a receiver there reads; with a short shadow distance the first cascade ends before 10 m, so the near cascade at 10 m is the second one.

| Preset | Cascades | Map | Hero tile | Cascade at 10 m | Hero texel | Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| Low | 2 | 1,024 | 1,024 | 19.0 mm | 4.3 mm | 4.4 |
| Medium | 3 | 2,048 | 2,048 | 14.3 mm | 2.1 mm | 6.6 |
| High | 3 | 2,048 | 2,048 | 14.3 mm | 2.1 mm | 6.6 |
| Ultra | 4 | 4,096 | 4,096 | 4.6 mm | 1.1 mm | 4.3 |

The ratio is the tile's texels over the object's width, so it falls as the object grows at a fixed tile size. That is why the size is a setting: the Rust test `the_hero_s_tile_holds_four_times_the_cascades_texels_at_ten_metres_on_every_preset` checks each preset's default for the demo car, and `a_bigger_hero_object_needs_a_bigger_tile_for_the_same_detail` checks that a sphere twice the size holds the ratio at a tile twice the size.

## Cost

The figures that stood here were withdrawn on 25 October 2026. They came from runs at loads of
13.6 to 26.3 on the Mac, against the cost specs' limit of 8, so other jobs moved each figure and
none is a measurement. The timing helper takes them again in a quiet window, so this record states
what is owed rather than a figure.

The run must measure the hero demo's car and yard on the Mac's own GPU, with the cost spec's
protocol: the hero off and on in turns, four rounds, each round in the opposite order from the one
before, and the medians of the GPU time per frame, of the frame interval and of the CPU time of
each thread. It must take, at each preset's default tile size (1,024, 2,048 and 4,096):

- The still case and the moving case, against the same scene with no hero, on WebGPU, in
  compatibility mode and on WebGL2.
- The draw calls and the passes, and the GPU time of the hero's own pass.
- The atlas's size and layer count, with no light tile, with 8 and with 16.

What the shape of the figures already shows:

- A still hero adds no pass. The tile rests after its first draw, so the frame draws the passes
  and the draw calls that it drew with no hero. A receiver inside the box reads the tile with the
  atlas filter, as it reads a light's tile.
- A moving hero adds one depth-only render pass a frame, which draws the car into the tile and
  clears it. The pass clears and draws the tile's whole area, so its cost grows with the square of
  the tile size.
- With no hero the atlas holds no layer, and the frame draws the passes it drew before. The Rust
  test `the_hero_draws_its_own_tile` checks the layer count, the two cascade passes and the zeroed
  values.
- The atlas holds the tile, and every layer of a texture array takes one size, on both GPU paths.
  So a hero tile above the preset's `shadowTileSize` sets the size of every layer. The atlas takes
  (light tiles + 1) x size x size x 4 bytes.

| Preset | Hero tile | Light tiles at most | Every layer | Atlas at most | The demo's atlas, one layer |
| --- | --- | --- | --- | --- | --- |
| Low | 1,024 | 4 | 1,024 | 20 MiB | 4 MiB |
| Medium | 2,048 | 8 | 2,048 | 144 MiB | 16 MiB |
| High | 2,048 | 16 | 2,048 | 272 MiB | 16 MiB |
| Ultra | 4,096 | 23 | 4,096 | 1,536 MiB | 64 MiB |

The "at most" column counts every light tile that `shadowTiles` allows, which no scene needs. The
frame draws only the tiles that the visible spot and point lights fill, so the honest figures are
lower. The demo names no spot or point light that casts, so its atlas is the hero's layer alone:
4 MiB on Low, 16 MiB on Medium and High, and 64 MiB on Ultra. A hero scene with four light tiles,
the usual handful of lamps that cast, takes 20 MiB on Low, 80 MiB on Medium, 80 MiB on High and
320 MiB on Ultra. The 1.5 GiB headline needs 23 spot or point tiles on Ultra, which is the
pathological case, not the typical one. The atlas keeps one of its 24 layers for the hero, so a
scene with a hero gives up one light tile.

The renderer refuses an atlas above 1 GiB. Past that size a phone is likely to lose its GPU context,
so the engine turns the ask into an error first. It fails the frame with E1501 before the GPU is
asked, and the message gives the megabytes the atlas would take and the two settings that fix it: a
smaller `heroTileSize` or fewer `shadowTiles`. The canvas keeps the last whole frame. A device that
still runs out of room for it reports E1304 on WebGPU, and the drawing goes on.

## Consequences

- `crates/null3d-render/src/shadows.rs` holds `HeroBox` and `HeroShadow`; `shadow_tiles.rs` plans the hero's tile and its uniform block; `crates/null3d-shaders/wgsl/lib/shadows.wgsl` reads it in `sun_hero` before `sun_shadow`'s cascades.
- The directional light takes `shadow: { hero: object, heroTileSize }` and `setHeroShadow(object | null, tileSize?)`. The core keeps the hero as a handle, so a destroyed object leaves the light without one, with no dangling row.
- [Shadows](../../docs/concepts/shadows.md#a-hero-shadow) describes the feature for users, and the demo is `examples/hero-shadow`.
- The reach below the object is sixteen radii (`HERO_REACH`), about what a low sun stretches an object's shadow over. A ground far below the object, or a very low sun, cuts the shadow at the box's far face and leaves the cascades beyond it. Revisit the constant with the first scene that needs a longer one.

## Which objects can be heroes

The box fits the object's world bounding sphere. A mesh carries one from its vertices, or the one that
`setBounds` gives it. A group has none of its own, so naming one as a hero draws no tile and the
surfaces near it fall back to the cascades, without an error.

Every object now carries a sphere when `setBounds` gives it one: the call moved from meshes to the
object class, so a group whose parts are known to span a box can be a hero too. The demo still names
the car's body mesh and widens its sphere to hold the whole car, which needs no group bounds, and the
test that the hero's tile is marked by a caster near it covers the group path through the same
sphere.

## Addendum 25 October 2026: the tile size is a setting

The owner ruled on 25 October 2026 that the hero shadow's detail becomes tunable, relayed by the CI
session. A light that names its hero gives the tile's size in texels, 1,024, 2,048 or 4,096, in
`shadow: { hero, heroTileSize }` or `setHeroShadow(hero, size)`. The quality presets choose the
defaults as `heroTileSize`: 1,024 on Low, 2,048 on Medium and High, and 4,096 on Ultra. A page may
override them, and the governor may lower the size when frames run slow; it does not yet, because a
change of size makes the atlas again and a mid-play hitch costs more than the frames it saves.

The fault was the fixed size. The tile was the atlas's layer size, which the preset's
`shadowTileSize` fixed at 512 on Low and Medium and 1,024 on High and Ultra. The ratio of the hero's
texel density to the cascades' falls as the object grows, so a fixed tile kept four times the detail
only for a small object. At the demo's 60 m shadow distance, a 1.8 m object at High held 8.1 times,
while the demo's 4.4 m car held 3.3. The ratio is the tile's texels over the object's width, so only
a tile that follows the object holds it. The tile size is now its own setting. Each preset defaults
to the size that keeps the demo's car at or above four times.

The tile draws with the atlas's filter, as it did before. The finer texels sharpen the edge, and
the filter keeps it smooth. The cost of the larger tile is the memory that every atlas layer takes
and the larger pass's clear and draw. The presets carry that cost, each with the tile size that
holds the ratio, and the cost section gives the bytes and the pass.
