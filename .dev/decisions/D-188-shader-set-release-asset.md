# D-188: The shader set ships as a release asset, not in the package

Status: decided. Date: 2026-10-17. Task: none.

Summary: The engine package no longer ships the built shader modules, 684 MiB in 1,353 files. Each release publishes them as one Brotli-compressed tar beside the skill zip files, and the package carries the asset's name, address and SHA-256. A deterministic tar writer makes the same tree give the same bytes twice. The plugin downloads the asset, or builds the set locally when the download cannot be had.

## Question

How does a release deliver the built shader set without the npm package's size limit and its 116 MiB install? How does the package name the exact bytes that it trusts?

## Rule

- The asset must be one file per release, with a fixed name and a SHA-256 that the package records.
- The same tree must give the same bytes on every machine.
- The package must still type check a project without the asset.
- The release must not build the asset twice, because two builds can differ.

## Data

| Measure | Value |
| --- | --- |
| The built modules | 684 MiB in 1,353 files: 1,343 JavaScript and 10 TypeScript |
| The archive at Brotli quality 11 | About 37 MiB expected; the tool writes it in about a quarter of an hour |
| The longest module name | 107 bytes |
| A ustar name field | 100 bytes |

The archive's compressed size is about 37 MiB, from the owner's estimate. A sample of 21.4 MiB took 23.8 seconds. That is 0.90 MiB/s, so the whole set takes about a quarter of an hour.

The longest module name is `shaders-area-lights-and-coat-sheen-and-morph-and-skinning-and-transmission-glsl-draw-index-tone-map-half.js`, at 107 bytes. The names have no slash. A ustar header can hold a long name only in two fields. It splits the name at a slash into the name and prefix fields. A flat name cannot be split, so `tar --format=ustar` refuses the set. The tool writes a GNU long-name entry, which GNU tar, bsdtar and the common tar libraries read.

## Decision

`tools/shader-artifact.ts` writes the asset and the record. The asset is `<tag>-shaders.tar.br`. The tar holds the shader modules at the root, sorted by name. The owner and group are zero, the modification time is the epoch, and the mode is the file's own. The stream is Brotli-compressed at quality 11 with a 22-bit window. A small tar writer in the tool keeps these values fixed. The bytes then do not depend on the machine's tar or on the file times.

The record is `packages/engine/lib/shader-artifact.json`, with the tag, the file name, the release address and the SHA-256, each on one line in that order. The release job writes the archive, measures its hash and passes the hash to the npm job as a job output. The npm job writes the record from that hash and never rebuilds the archive, so the bytes and the hash cannot disagree.

All public packages share one version, and one Release per version carries the asset for all of them. There is no per-package Release. The asset sits on the same Release as the skill zip files, in the `null3d-engine/null3d` repository.

The engine package's `files` list removes the built shader JavaScript: `shaders*.js`, `shader-features.js` and `shader-paragraphs-*.js`. The declarations stay, so a project's type check passes. The engine's generated constants modules, `core.js` and `gpu.js`, stay in the package. They are code of the engine, not shader modules, and the local build of the shader set cannot make them.

## Consequences

- `tools/lib/packages.ts` requires a declaration for each generated TypeScript module instead of a JavaScript file, and refuses a tarball that holds a built shader module.
- The pack keeps `lib/shader-artifact.json` across the compile step, which rebuilds `lib/`.
- The release job's time limit rises to 90 minutes, because the compression alone takes about a quarter of an hour.
- The engine's source and the shader build do not change.
- The project needs the null3D Vite plugin to resolve the engine's generated imports, because the package no longer carries the shader modules. A project without the plugin cannot draw.
