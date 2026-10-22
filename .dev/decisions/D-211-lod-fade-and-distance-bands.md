# D-211: A level fades only where its switch shows, and sources draw in distance bands

Status: decided by the owner on 19 October 2026, in D-137's addendum, and built on 22 October 2026. The rule below turns that addendum into code.

Summary: A level's own hand-over fades only where its switch would show. A level with a measured error, which the asset tool writes, switches at once and takes no fade bucket. A level given by a distance, by a screen coverage or by a hand-set error fades, whatever the `lodFade` quality setting, because its switch pops. A level can now be measured by a distance or by a share of the screen's height beside its error. Each of those measures switches at the same distance on every screen height, where the old conversion to an error moved it with the render height. A mesh, an instance batch or one of its rows can draw in a distance band, from a start distance to an end distance, with the same dither at each edge. `lodFade` now controls only those distance bands, which a preset may cut for a tile GPU's cost.

## Question

D-137's addendum of 19 October 2026 asked for three changes:

- The fade of a level goes where it shows. The asset tool's measured errors change the picture by under a pixel at 502 of 518 switches, so their bands cost a double draw and a discard for nothing. Hand-made levels, such as Creek's leaf-card trees, change the picture far more, and they popped on Low, which turned every band off.
- An object draws at the distance its bounds allow, and no farther, with a fade at each edge. The plan calls this `maxDistance` beside a start distance, and it is M3-A6.
- A level can be picked by a distance or by `MSFT_screencoverage` beside its error. The old code turned both into an error for a screen 1,080 pixels high, so a 2,160-pixel screen switched them at twice the distance.

## Rule

- A level's fade is a property of the level. The frame builders make a fade bucket only for a level that fades, and a switch fades only when the level and the one before it both have one.
- A level with a measured error switches at once. The asset tool's `NULL3D_lod_error` is a measured error, and the glTF reader switches those levels at once. A level given by `distance`, by `coverage` or by a hand-set `error` fades.
- A level's switch is one of three measures: `error` in the mesh's units, `distance` in meters at scale 1, or `coverage` as a share of the render's height. A distance and a coverage do not read the render height.
- A source draws inside a distance band, `[start, end]`, both edges open by default. The band's fade lies inside the range and covers 8% of the edge's distance, the same band that a level switch uses. A row's own range overrides its batch's.
- `lodFade` gates the distance bands alone. It no longer gates a level's own fade, so a hand-set level fades on Low too.

## Data

- The fade buckets cost a copy per source per level per view, 64 bytes each, which M3-L2 then sizes to what draws.
- D-91 found no change wider than a pixel's edge at 502 of 518 asset-tool switches.
- The check at the time of writing: `cargo test -p null3d-core levels` passes, and the image tests `lod`, `lod-fade`, `lod-hide`, `lod-range` and `lod-range-batch` draw the same image on every GPU tier that draws them.

## Alternatives rejected

- Keeping `lodFade` as the master switch for every band: it cut the fades of hand-set levels on Low, where they popped, which is the fault the addendum names.
- Keeping the conversion of a distance or a coverage to an error: it moves those switches with the render height and the render scale, so a model's levels do not stay where its author put them.
- A second band value for distance edges: one 8% band serves both, and two values would need a second uniform word and a second test surface for no measured gain.
- Fading a distance band through a blend or a separate pass: the level dither already exists on both paths, draws each pixel once, and needs no sorting.
