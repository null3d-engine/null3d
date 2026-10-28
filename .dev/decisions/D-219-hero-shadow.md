# D-219: One object's shadow at its own scale

Status: decided and built, with the tile size a setting by the owner's ruling and the cost measured in a quiet window. Task: M3-A9.

Summary: A directional light can name one object as its hero, which adds one draw when it moves. Its shadow draws into a tightly fitted tile of the shadow atlas, which receivers in the box read before the cascades. The tile's size is a setting: 1,024, 2,048 or 4,096 texels, with a default on each quality preset. At the defaults the demo's 4.4 m car keeps at least four times the texel density of the cascade that holds 10 m, on every preset.

## Question

The cascades spread their texels over the whole view. A subject in close-up, such as a car on a showroom floor or a character on a plinth, gets shadows two or three centimeters coarse, and its own shadow edge shows steps. Contact shadows fill the gap where a small object meets the ground (D-135) but cannot sharpen a whole silhouette. Which technique gives one chosen object a much finer shadow, at no cost when a scene does not ask for it?

## Rule

- The hero's own shadow has at least four times the texel density of the cascade that holds 10 m, at each preset's default tile size, for the demo's 4.4 m car and for an object a few meters wide. A page may raise the tile size for a larger object.
- Changing the hero, or moving it, costs no more than one extra shadow pass per frame.
- A scene that names no hero pays nothing for the feature: no extra pass, texture or uniform read.
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader (D-52).
- No allocation per frame ([hard rule 1](../../AGENTS.md#hard-rules)).

## Options

| Option | Verdict |
| --- | --- |
| A: a separate shadow map texture with its own binding and sampler | Rejected. The opaque pass's fragment stage already reads 15 of the 16 textures a device allows, and a new binding needs a new layout on every lit pipeline. The tiles of the atlas already hold depth that the sun's path can read |
| B: an extra cascade fitted to the object | Rejected. It takes a cascade slot of four, and its box still spans the camera's view at that distance rather than the object |
| C: a tile of the existing spot and point shadow atlas, fitted to the object | Chosen. It reuses the atlas, its filters, its redraw rules and its culling, and the sun's shader reads it through the binding that the tiles already use |

## Design

- The hero tile takes the atlas's last layer, and the atlas grows by that layer when a light names a hero. Lights keep every tile that the preset gives them, except in an atlas already at its limit of 24 layers, where the smallest light gives one up. The tile's size, 1,024, 2,048 or 4,096 texels, decides the hero's detail; every layer of the atlas takes it ([The tile size is a setting](#the-tile-size-is-a-setting)).
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

The hero cost spec (`tests/image/hero-cost.spec.ts`) timed the hero demo's car and yard on the Mac's
own GPU. The sun's hero was off and on in turns, four rounds for each side, with each round in the
opposite order from the one before. Each round measured 2 s after a 2 s warm-up, at 1920 x 1080 and
a pixel ratio of 1. The run went beside the job queue's fresh-project test, a node process on one
core. Each page held the 1-minute load between 3.1 and 4.9, under the cost specs' limit of 8.
Every case recorded the display's 60 Hz rate and a 16.665 ms median frame interval. The figures are
the medians of each side's rounds, in ms. The pass figures come from the GPU timer, not from two
frames subtracted. The run's record is [the Mac's hero cost run](../tested-devices/macbook-pro-chrome/20261028-143438-hero-cost.md).

| GPU path | Preset | Hero tile | Case | Draws off / on | GPU off | GPU on | Change | `shadow hero` on | CPU off / on | Sketch off / on | Render off / on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | High | 1,024 | Still | 62 / 62 | 2.208 | 2.691 | +0.483 | none | 0.125 / 0.127 | 0.112 / 0.115 | 0.123 / 0.125 |
| WebGPU | High | 1,024 | Moving | 62 / 76 | 2.085 | 2.229 | +0.144 | 0.025 | 0.120 / 0.125 | 0.110 / 0.115 | 0.115 / 0.120 |
| WebGPU | High | 2,048 | Still | 62 / 62 | 2.959 | 3.480 | +0.521 | none | 0.100 / 0.105 | 0.080 / 0.093 | 0.090 / 0.095 |
| WebGPU | High | 2,048 | Moving | 62 / 76 | 2.067 | 1.980 | -0.087 | 0.052 | 0.103 / 0.112 | 0.095 / 0.095 | 0.100 / 0.105 |
| WebGPU | High | 4,096 | Still | 62 / 62 | 3.509 | 3.532 | +0.023 | none | 0.105 / 0.105 | 0.087 / 0.095 | 0.100 / 0.100 |
| WebGPU | High | 4,096 | Moving | 62 / 76 | 3.510 | 3.803 | +0.293 | 0.327 | 0.100 / 0.112 | 0.082 / 0.097 | 0.093 / 0.102 |
| WebGPU | Medium | 2,048 | Still | 44 / 44 | 2.016 | 2.006 | -0.010 | none | 0.088 / 0.088 | 0.075 / 0.080 | 0.080 / 0.078 |
| WebGPU | Medium | 2,048 | Moving | 44 / 58 | 2.049 | 2.064 | +0.015 | 0.098 | 0.090 / 0.097 | 0.077 / 0.087 | 0.080 / 0.088 |
| Compatibility | Medium | 2,048 | Still | 43 / 43 | 1.141 | 1.123 | -0.018 | none | 0.090 / 0.090 | 0.075 / 0.080 | 0.080 / 0.078 |
| Compatibility | Medium | 2,048 | Moving | 43 / 57 | 1.738 | 1.364 | -0.374 | 0.087 | 0.088 / 0.095 | 0.078 / 0.083 | 0.075 / 0.083 |
| WebGL2 | Medium | 2,048 | Still | 57 / 57 | 4.029 | 3.781 | -0.248 | none | 0.085 / 0.090 | 0.085 / 0.090 | 0.063 / 0.063 |
| WebGL2 | Medium | 2,048 | Moving | 57 / 66 | 3.256 | 2.941 | -0.315 | no split | 0.088 / 0.095 | 0.088 / 0.093 | 0.060 / 0.065 |

- A still hero adds no draw call and no pass. Its draw counts match the off side on every path. Its
  frame's GPU time changed by -0.25 to +0.52 ms, with no sign that follows the path. The off side's
  own GPU time ranged from 1.14 to 4.03 ms across the cases. The timer names no `shadow hero` part
  on a still hero, because its tile rests.
- A moving hero adds one depth-only render pass and the car's draws: 14 more on WebGPU and in
  compatibility mode, 9 on WebGL2. On the WebGPU paths the timer names that pass `shadow hero`
  ([D-272](D-272-pass-labels.md)) and gives its own figure: 0.025 to 0.327 ms across the five
  moving cases. The part is separate from each cascade's, so the figure is the tile's rather than a
  slot's.
- The tile does not replace a cascade pass: all three cascades draw on both sides. It replaces the
  cascade read in the opaque pass for the pixels inside its box, which read the tile before the
  cascades. So a moving hero can make the frame cheaper even while it adds a pass. In compatibility
  mode at Medium the frame reads 1.738 ms with the hero off and 1.364 ms with it on. The tile itself
  reads 0.087 ms. The frame falls by 0.374 ms, which the receivers' shorter shadow path also moves.
  The 0.087 ms is the tile's cost.
- Across the WebGPU cases the moving frame changed by -0.374 to +0.293 ms, inside the scene's
  spread. The figure that the pass slot could not give is the tile's own: 0.025 to 0.327 ms.
- On WebGL2 the timer covers the frame as a whole and gives no parts, so that path has no split of
  the pass. It is not a zero for the pass.
- No thread's CPU time moved by more than 0.015 ms. The busiest thread moved by 0 to +0.012 ms. The
  sketch worker moved by 0 to +0.015 ms, and the render worker by -0.002 to +0.009 ms.
- The rule holds on every path: a moving hero costs one extra shadow pass a frame, and a still
  hero costs none. The record names no millisecond limit. The largest frame GPU time, 4.029 ms on WebGL2,
  sits well inside the display's 16.665 ms frame.
- With no hero the atlas holds no hero layer, and the frame draws only its usual passes. The Rust
  test `the_hero_draws_its_own_tile` checks the layer count, the two cascade passes and the zeroed
  values.

The atlas holds the tile, and every layer of a texture array takes one size, on both GPU paths.
So a hero tile above the preset's `shadowTileSize` sets the size of every layer. The atlas takes
(light tiles + 1) x size x size x 4 bytes.

| Hero tile | 1 layer, no light tile | 9 layers, 8 light tiles | 17 layers, 16 light tiles |
| --- | --- | --- | --- |
| 1,024 | 4 MiB | 36 MiB | 68 MiB |
| 2,048 | 16 MiB | 144 MiB | 272 MiB |
| 4,096 | 64 MiB | 576 MiB | 1,088 MiB, refused |

A 4,096 hero tile with 16 light tiles needs 1,088 MiB, over the 1 GiB cap, so the frame fails with
E1501. The demo names no spot or point light that casts, so its atlas holds the hero's layer alone.

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
`setBounds` gives it. `setBounds` belongs to the object class, so a group whose parts are known to
span a box can be a hero too. A group without bounds has no sphere of its own, so naming one as a
hero draws no tile and the surfaces near it fall back to the cascades, without an error.

The demo names the car's body mesh and widens its sphere to hold the whole car, which needs no group
bounds. The test that the hero's tile is marked by a caster near it covers the group path through
the same sphere.

## The tile size is a setting

The owner decided that the hero shadow's detail is tunable. A light that names its hero gives the
tile's size in texels, 1,024, 2,048 or 4,096, in `shadow: { hero, heroTileSize }` or
`setHeroShadow(hero, size)`. The quality presets choose the defaults as `heroTileSize`: 1,024 on
Low, 2,048 on Medium and High, and 4,096 on Ultra. A page may override them. The governor may lower
the size when frames run slow. It does not yet, because a change of size makes the atlas again and a
mid-play hitch costs more than the frames it saves.

The ratio of the hero's texel density to the cascades' falls as the object grows. A tile fixed at the
atlas's layer size, which the preset's `shadowTileSize` sets at 512 on Low and Medium and 1,024 on
High and Ultra, keeps four times the detail only for a small object. At the demo's 60 m shadow
distance, such a tile at High holds 8.1 times for a 1.8 m object and 3.3 for the demo's 4.4 m car.
The ratio is the tile's texels over the object's width, so only a tile that follows the object holds
it. Each preset defaults to the size that keeps the demo's car at or above four times.

The tile draws with the atlas's filter. The finer texels sharpen the edge, and the filter keeps it
smooth. The cost of the larger tile is the memory that every atlas layer takes and the larger pass's
clear and draw. The presets carry that cost, each with the tile size that holds the ratio, and the
cost section gives the bytes and the pass.
