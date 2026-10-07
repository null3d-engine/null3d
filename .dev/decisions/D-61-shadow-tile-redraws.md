# D-61: Which spot and point shadow tiles draw again, and how many per frame

Status: decided. Date: 2026-10-05. Task: M2-R9. The cap's frame times on the iPad and the Automate phones are pending.

Summary: A moved caster marks only the tiles whose views its sphere touches: 1.3 to 2.3 of a point light's 6 faces for casters of 0.25 to 1 m. Tiles whose views miss the camera's wait. At most 12 tiles draw again per frame, whole lights, longest waiting first; tiles that hold no depth of their light yet draw at once. A burst on Ultra's 24 tiles takes two frames.

## Question

A moved caster marked all six faces of every point light within its reach, and every marked tile drew in the same frame. Which tiles must a change mark, and how many may draw again in one frame?

## Rule

- A tile draws again only when a receiver on screen could read a changed depth in it. A test may mark more tiles than needed, never fewer.
- A frame draws no more tiles again than a fixed cap. The cap must let a whole point light (six tiles) draw in one frame, so no light starves. A tile that holds no depth of its light yet is outside the cap, so a light never shows another light's depth.
- With the cap, a burst on the largest preset (24 tiles) takes at most two frames.

## Data

The table below counts the faces of a point light's cube that a moving caster marks. It takes 100,000 casters in random directions, 1 to 5 m from the light. Each moves 0.1 m in a random direction. The test is `TileShape::touches`, with tiles of 1,024 texels.

| Caster radius | Mean faces marked | Before | Tile passes saved |
| --- | --- | --- | --- |
| 0.25 m | 1.28 | 6 | 79% |
| 0.5 m | 1.56 | 6 | 74% |
| 1 m | 2.28 | 6 | 62% |

Tile passes in the Rust tests (`crates/null3d-render/tests/shadow_tiles.rs`), before and after:

| Case | Before | After |
| --- | --- | --- |
| A box moves straight below a point light | 6 | 1 |
| A ball moves across the edge of two faces | 6 | 2 |
| A point light 5 m behind the camera, first frame | 6 | 1; the other 5 draw when the camera turns to them |
| Four point lights (24 tiles) after a structure change | 24 in one frame | 12, then 12 |

What one tile pass stores, before its casters: a 1,024 x 1,024 tile of 32-bit depth is 4 MiB. Point light shadows run on High (16 tiles) and Ultra (24 tiles) only. A burst on Ultra stored 96 MiB of depth in one frame; with the cap it stores at most 48 MiB per frame.

Godot caps its shadow passes at 512 per frame (`MAX_UPDATE_SHADOWS`) and draws the lights over the cap in the next frame. That number counts the passes of an atlas with many lights and quadrants. So it does not carry over to a budget of at most 24 tiles.

How the data was produced: a throwaway Rust test over `TileShape::touches` with a fixed random seed, and the tile tests above on the mock backend. Both ran on 5 October 2026.

## Decision

- A caster marks a tile only when its sphere, before or after the change, touches the inside of the tile's four side planes. The planes include the filter's margin. The sphere must also lie within the light's range and layers. A sphere against planes is conservative: it can mark a face that the sphere only nears at a corner, and never misses one.
- A tile whose view, cut at the light's range, lies outside one plane of the camera's frustum waits, dirty, until it meets the view.
- The cap is 12 tiles drawn again per frame, `MAX_REDRAWS`: two point lights' cubes. Fresh tiles count first and are never held back. Whole lights take what is left: those whose tiles waited longest first, then the largest on screen. So a point light's faces stay in step, and every light draws within a few frames. High's 16 tiles and Ultra's 24 take two frames at most. Low and Medium have 4 and 8 tiles and never reach the cap.
- 6 was the other candidate: one cube per frame. It would lag a second point light in most bursts on High, where a moving caster near two lights marks about 3 to 5 faces. 24 is no cap at all.

## Consequences

- `crates/null3d-render/src/shadow_tiles.rs` holds the face test, the view test and the cap. `ShadowTiles::waiting` reports the tiles that wait under the cap.
- The shadows of the lights that wait lag their casters by a frame. This happens only in frames where more than 12 tiles must draw again.
- The same change keeps each caster's layers and a hash of its pose, and the atlas keeps its layers while a light casts ([implementation notes](../implementation-notes.md#shadows)).
- [Shadows](../../docs/concepts/shadows.md#when-a-tile-draws) describes the behavior for users.
- Revisit the cap with the frame times of a burst on the iPad and the Automate phones.
