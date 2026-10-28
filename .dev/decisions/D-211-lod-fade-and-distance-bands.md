# D-211: A level fades only where its switch shows, and sources draw in distance bands

Status: decided by the owner in D-137, and built. The rule below turns that ruling into code.

Summary: A level's own hand-over fades only where its switch would show. A level with a measured error, which the asset tool writes, switches at once and takes no fade bucket. A level given by a distance, by a screen coverage or by a hand-set error fades, whatever the `lodFade` quality setting, because its switch pops. A level can be measured by a distance or by a share of the screen's height beside its error, and each of those measures switches at the same distance on every screen height. A mesh, an instance batch or one of its rows can draw in a distance band, from a start distance to an end distance, with the same dither at each edge. `lodFade` controls only those distance bands, which a preset may cut for a tile GPU's cost.

## Question

This record makes three changes to D-137's design:

- The fade of a level goes where it shows. The asset tool's measured errors change the picture by under a pixel at 502 of 518 switches, so their bands cost a double draw and a discard for nothing. Hand-made levels, such as Creek's leaf-card trees, change the picture far more, and they pop on Low when Low turns every band off.
- An object draws at the distance its bounds allow, and no farther, with a fade at each edge. The plan calls this `maxDistance` beside a start distance, and it is M3-A6.
- A level can be picked by a distance or by `MSFT_screencoverage` beside its error. Turning both into an error for a screen 1,080 pixels high makes a 2,160-pixel screen switch them at twice the distance.

## Rule

- A level's fade is a property of the level. The frame builders make a fade bucket only for a level that fades, and a switch fades only when the level and the one before it both have one.
- A level with a measured error switches at once. The asset tool's `NULL3D_lod_error` is a measured error, and the glTF reader switches those levels at once. The reader knows the error is measured by the `MSFT_screencoverage` beside it, which the tool derives from the error. A file that gives errors alone, as the Creek trees' levels do, holds switch distances its author set by hand, so those levels fade. A level given by `distance`, by `coverage` or by a hand-set `error` fades.
- A level's switch is one of three measures: `error` in the mesh's units, `distance` in meters at scale 1, or `coverage` as a share of the render's height. A distance and a coverage do not read the render height.
- A source draws inside a distance band, `[start, end]`, both edges open by default. The band's fade lies inside the range and covers 8% of the edge's distance, the same band that a level switch uses. A row's own range overrides its batch's.
- `lodFade` gates the distance bands alone. It does not gate a level's own fade, so a hand-set level fades on Low too.

## Data

- The fade buckets cost a copy per source per level per view, 64 bytes each, which M3-L2 then sizes to what draws.
- D-91 found no change wider than a pixel's edge at 502 of 518 asset-tool switches.
- The tests: 18 tests of the level rule, 13 culling tests and 13 renderer level tests pass, Clippy reports nothing, and the typecheck passes.
- The GPU check of the change against its merge base passes. In ms at the base and with the change: S4 at Medium 3.24 and 2.92, S6 at Medium 4.53 and 3.85, S4 at High 4.41 and 4.03, and S6 at High 7.99 and 6.35. The extra texture read per source costs less than the noise.
- The hand-set levels of the image tests `lod-fade` and `lod-hide` fade, and `lod` switches at once through `{ fade: false }`, so their references hold. The `lod-range` test has references in every set, and `lod-range-batch` draws against `lod-range`'s references (`reference: 'lod-range'` in the manifest).

## Alternatives rejected

- `lodFade` as the master switch for every band: it cuts the fades of hand-set levels on Low, where they pop, which is the fault D-137 names.
- Converting a distance or a coverage to an error: it moves those switches with the render height and the render scale, so a model's levels do not stay where its author put them.
- A second band value for distance edges: one 8% band serves both, and two values would need a second uniform word and a second test surface for no measured gain.
- Fading a distance band through a blend or a separate pass: the level dither already exists on both paths, draws each pixel once, and needs no sorting.

## The GPU path hides only where a level follows

The rule's reason is that the last level holds no geometry. The CPU culling asks for that level
first (`levels.rs`, `links[home].has_next()`). The GPU shader asks the same question before it
hides a bound that covers fewer pixels than the threshold (9de6eb96d). Without that question, a mesh
without levels would lose its sub-pixel bounds on WebGPU and keep them on WebGL2. The s1-cells picture
would show the fault: 790 dots in its reference, 141 on the GPU path, and every lost one a pixel or two
across, while the bright dots of four pixels would stay.

The s1 picture group passes in both reference sets on both paths, 7 of 7 each, so the rule keeps
the s1 dots on every path.

## How a file's error is read

The Creek's trees bring their own levels from `tools/samples/blender/creek.py`, which sets each
level's switch error by hand: 0.02 m and 0.04 m, meant to switch about 25 m and 50 m away. The tool
keeps those levels and rewrites the errors in each level's quantized steps, but nothing in the file
says that its author chose them rather than measured them. The loader read every file error as
measured, so the trees' levels took `fade: false` and a crown swapped in one frame.

The data that tells the two apart is already in the file. `assets optimize` writes the screen
coverage that each measured error implies, in `MSFT_screencoverage`, beside `NULL3D_lod_error`. A
file whose levels are hand-made holds the error alone. The loader now reads an error as measured
only where the coverage comes with it, and fades an error that comes alone. The tool's own files
hold both arrays; the pinned sample content's only level extras are the Creek trees', and they hold
the errors alone.

The image test `creek-lod` holds the camera still. It sweeps the level bias across the `oak-leaves`
crown's first switch. Before the change, the frame at the crossing changed 29.8% as one block of
52,182 pixels, and no later step changed anything. With the change, the band's frames change about
1.9% each in single dither pixels, and the crown stays drawn across the band (48.9% of the frame
before it, 55.0% after). The test runs on WebGPU and WebGL2, and the run with the level of detail
off changes nothing.

`asset-scene-lod` and `asset-scene-lod-copied` draw a tool file, which holds both arrays, and keep
their references. So does `skinned-lod`, whose camera stands past its level's band.

