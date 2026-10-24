# D-243: One documented file format for baked probe grids and light maps

Status: decided by the helper of M3-E5 on 24 October 2026, for the owner's review. Built: the
reader, the writer, the two loading calls, the tests and the guide, as the consequences list.
Date: 2026-10-24. Task: M3-E5.

Summary: A baked light file is JSON with the marker `null3d.baked-light`, a version and a kind. A
probe grid carries the four values of `LightProbeGridData`. A grid that the engine bakes therefore
writes the same format as a grid that another tool bakes. A light map carries its radiance as
base64 texels, and a directional light map also carries the light's direction at each texel. The
loader refuses a wrong version, a wrong element count and a cut-short file with E1434, and its
message names the fault.

## Question

D-173's hook H6 asks for one documented format for baked probes and light maps. D-146 records that
the grid's format for a grid baked elsewhere becomes stable and documented. What does a file hold,
in what container, how is it validated, and how does the engine's own bake write it?

## Rule

- A file is JSON. Its members are:
  - `format`: the string `null3d.baked-light`.
  - `version`: the whole number 1. A reader refuses any other version and names the one it reads.
  - `kind`: `probe-grid` or `light-map`.
- A `probe-grid` file holds `origin`, `spacing` and `counts`, each three numbers. It also holds
  `coefficients`: base64 of little-endian 32-bit floats. The probes run x fastest, then y, then z.
  Within a probe the order is L0, then L1 along y, z and x. These are exactly the four values of
  `LightProbeGridData`.
- A `light-map` file holds `width`, `height`, `encoding`, `radiance` and an optional `direction`.
  - `encoding` is `rgb8`, three bytes per texel in sRGB, or `rgba16float`, eight bytes per texel
    as little-endian half floats in linear light.
  - `radiance` is base64 of the texels, rows along v from the first texel at u = 0, v = 0.
  - `direction` is base64 of three signed bytes per texel, each axis divided by 127. A plain
    light map leaves it out; a directional light map takes twice the memory of its radiance in
    `rgb8`.
- The reader checks each count against the file's own size and each limit against the engine's
  texture limits. A fault names itself. It may name the marker, the version, the kind, the spacing,
  the counts, a size or an encoding. It may also name a count of floats or bytes, a payload that is
  not base64, or text that stops before its JSON is complete.
- The reader ignores members that it does not know, so a later version adds a member without
  breaking a reader that predates it.
- `assets.loadLightProbeGrid` gives the options that `scene.setLightProbeGrid` takes, with the
  grid's texture already made. `assets.loadLightMap` gives the radiance as a texture and the
  direction as bytes. Both throw E1434 for a file that the engine cannot read.
- `assets.lightProbeGridFile` writes the file of a grid that `bakeProbes` made, so the engine's
  own bake and a bake elsewhere give one format. The writer and both readers load on first use.

## Why JSON

- A person who bakes light data in any language can write it with a JSON encoder and a base64
  encoder. A binary container needs a tool before the first file exists.
- The guide shows a complete file of each kind. Eight probes are 96 floats, and a 2 x 2 light map
  is 12 bytes, so both examples fit on a page. A reader can check its own baker against them.
- The faults that matter have plain names in a text file. A wrong version, a count that does not
  match and a file that stops early each print a sentence that a person can act on.
- Base64 keeps one value per element. A JSON number array for a 2048 x 2048 light map would hold
  millions of separator characters. Parsing it would hold a second copy of the numbers as
  JavaScript values.

## Options rejected

- **A binary container with a JSON header.** Compact for a large light map, and a length word
  catches a cut-short file at once. But a person cannot read the metadata without a tool, and the
  guide cannot show a complete example. The first baker that another team writes also needs the
  container's rules twice, once for the header and once for the payload. The engine reads its
  large files (glTF, KTX2) in binary because other tools already write those formats. This format
  has no such tool.
- **PNG or KTX2 images inside a light map file.** The browser decodes them, and they compress
  well. But a PNG loses light above 1. An 8-bit texture cannot hold a bright window without a
  scale that the file would have to carry. A KTX2 file also needs the asset tool before a bake
  elsewhere can write one. A later version can add such a payload as its own encoding.
- **A separate file for the direction.** A light map and its direction describe one bake, and two
  files can drift apart. One file keeps them together and lets the reader check that both cover
  the same texels.
- **Members for `intensity` and `environmentWeight`.** Those are settings of the scene that reads
  the grid, not of the bake. A file that carried them would set the same grid brighter or dimmer
  for every page that loads it.

## M3-F1

M3-F1 adds a validity mask and a sky-visibility term to each probe. Nothing reads a baked light
file before 0.3.0 ships. F1 therefore adds those members to version 1 in the same release, with the
same validation rules. The reader ignores unknown members, so the fields of this version keep their
meaning when F1 lands. A file that omits the new members reads as a file without them.

## Consequences

- New code: `packages/engine/src/scene/baked-light.ts`, the reader, the writer and the base64
  codec, which loads on first use.
- `assets` gains `loadLightProbeGrid`, `loadLightMap` and `lightProbeGridFile`, and
  `LightMapData` joins the engine's public types.
- A new error code, E1434, names every fault of the format.
- The fixtures `tests/pages/assets/light/probe-grid.json` and `light-map.json` are the examples
  that the guide shows, and the writer must reproduce the grid fixture byte for byte.
- The engine's own bake writes the format through `LightProbeGridData`, so a change to the grid's
  values changes the file and the guide together.
