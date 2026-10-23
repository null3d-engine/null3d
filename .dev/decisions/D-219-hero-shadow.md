# D-219: One object's shadow at its own scale

Status: decided. Date: 2026-10-23. Task: M3-A9. The cost figures below come from the branch's `GPU-Checked:` line, taken on the Mac's own GPU once the feature was complete.

Summary: A directional light can name one object as its hero. That object's shadow draws into the last tile of the existing shadow atlas, in a box fitted tightly to its bounding sphere along the light, and receivers inside that box read the tile before the cascades. At the default sizes the hero's texels are about eight times smaller than the first cascade's for a car-sized object, and the feature costs one extra tile draw in the frames where the object moves.

## Question

The cascades spread their texels over the whole view. A subject in close-up, such as a car on a showroom floor or a character on a plinth, gets shadows two or three centimeters coarse, and its own shadow edge shows steps. Contact shadows fill the gap where a small object meets the ground (D-135) but cannot sharpen a whole silhouette. Which technique gives one chosen object a much finer shadow, at no cost when a scene does not ask for it?

## Rule

- The hero's own shadow has at least four times the texel density of the first cascade at 10 m, for an object a few meters wide.
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

- The hero tile takes the atlas's last layer, and the atlas grows by that layer when a light names a hero. Lights keep every tile that the preset gives them, except in an atlas already at its limit of 24 layers, where the smallest light gives one up.
- The box is square across the light around the object's world bounding sphere, reaching one radius past it toward the light and sixteen past it away from the light, where its shadow lands. The across-light extent sets the texel size; the along-light extent only sets the depth range, which is 32-bit float, as the atlas is.
- A receiver transforms itself into the box's clip space. Inside it, and within its depth range, it reads the hero's layer with the atlas filter; outside, it reads the cascades. A caster that shadows a point inside the box must lie inside the box's across-light extent too, so the tile holds every caster that its receivers need.
- The tile draws when the light turns, when nothing drew yet, when the hero's box moves or changes, and when a caster that touches the box moves. Otherwise it keeps its depth, as a light's tile does (D-61). The redraw cap counts lights' tiles; the hero adds at most one tile a frame.
- The hero's bias is the light's own, capped by the hero's texel, so the shadow sits close to its caster rather than a cascade's texel away.

## Data

Texel sizes in meters at the default sizes, for an object whose bounding sphere has a radius of 0.9 m:

| | Texels on a side | Texel |
| --- | --- | --- |
| First cascade, 3 cascades over 200 m, 65% lean | 2,048 | 0.0137 |
| Hero tile | 1,024 | 0.0018 |

That is 7.8 times the first cascade's density at 10 m, and a 4.5 m object still reaches 4 times. The Rust test `the_hero_s_tile_holds_four_times_the_first_cascade_s_texels_at_ten_metres` checks the ratio.

Cost, from `bench:gpu-check` on the Mac's GPU (S4 and S6, medium and high), with the hero demo's scene:

<!-- Filled from the branch's GPU-Checked line. -->

The demo's scene adds one tile pass while the car stands still only in the frames where it moves or the light turns; a still frame draws the tile not at all.

## Consequences

- `crates/null3d-render/src/shadows.rs` holds `HeroBox` and `HeroShadow`; `shadow_tiles.rs` plans the hero's tile and its uniform block; `crates/null3d-shaders/wgsl/lib/shadows.wgsl` reads it in `sun_hero` before `sun_shadow`'s cascades.
- The directional light takes `shadow: { hero: object }` and `setHeroShadow(object | null)`. The core keeps the hero as a handle, so a destroyed object leaves the light without one, with no dangling row.
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
