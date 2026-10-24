# D-219: One object's shadow at its own scale

Status: decided. Date: 2026-10-23. Task: M3-A9. The cost figures below come from the hero cost spec on the Mac's own GPU, run once the feature was complete.

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

## Cost

The hero cost spec (`tests/image/hero-cost.spec.ts`) times the hero demo's car and yard with the sun's hero off and on, in turns, four times each. Each round measures the sides in the opposite order from the round before. The spec runs only with `NULL3D_HERO_COST` set, as the other cost specs do. It ran on the Mac (Apple M5 Max, Chrome 155) on 24 October 2026. The viewport was 1920 x 1080, the pixel ratio 1, and the loads 13.6 to 26.3. Other jobs ran beside it, so the load changed between cases. The two sides of each round ran back to back. The figures are the medians of the GPU time per frame, in ms. The still case leaves the tile to rest after its first draw. The moving case moves the car across the pad, so the tile draws in every frame.

| GPU path | Preset | Still, off | Still, on | Moving, off | Moving, on |
| --- | --- | --- | --- | --- | --- |
| WebGPU | Medium | 1.297 | 1.267 (-0.030) | 1.263 | 1.275 (+0.012) |
| WebGPU | High | 2.199 | 2.209 (+0.010) | 2.198 | 2.257 (+0.059) |
| Compatibility mode | Medium | 1.164 | 1.164 (0.000) | 1.171 | 1.173 (+0.002) |
| WebGL2 | Medium | 3.360 | 3.087 (-0.273) | 3.387 | 3.107 (-0.280) |

- A still hero adds no pass. The frame draws the same parts and the same draw calls with the hero off and on. On WebGPU and in compatibility mode its GPU time stays within the timer's steps; on WebGL2 it falls, as the fourth bullet says.
- A moving hero adds one depth-only render pass a frame, which draws the car into the tile. The draw calls go from 44 to 58 at Medium and 62 to 76 at High on WebGPU. On WebGL2 they go from 57 to 66.
- The extra pass took 0.028 ms at Medium and 0.037 ms at High on WebGPU and in compatibility mode. The frame's GPU time rose by 0.012 ms at Medium and 0.059 ms at High, around the pass's own time.
- On WebGL2 the hero lowers the frame's GPU time by about 0.27 ms, both still and moving. A receiver in the box reads the atlas tile through the comparison sampler, and that read costs less than the cascades' per-texel reads.
- The CPU time changed by no more than 0.01 ms.
- With no hero the atlas holds no layer, and the frame draws the passes it drew before. The Rust test `the_hero_draws_its_own_tile` checks the layer count, the two cascade passes and the zeroed values.
- The tile takes the preset's tile size, 512 texels at Medium and 1,024 at High. It adds one layer beyond the preset's tiles, 1 MiB or 4 MiB. The atlas then takes at most 9 MiB at Medium and 68 MiB at High, against the preset table's 8 MiB and 64 MiB.

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
