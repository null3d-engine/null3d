# Main's over-budget sizes, 14 October 2026

Status: working note. Date: 2026-10-14.

This note records the numbers behind a decision that is not made here: whether to
shrink the shader files or to raise two budgets. Only the owner raises a budget.

## What was checked

A fresh worktree at `main` (`cfd44ef44`), with `bun install`, then plain
`bun run build`. The build exits 1. The budget checks are absolute, so the base
commit does not matter:

- `tools/lib/size-report.ts`, `budgetProblems`.
- `crates/null3d-shaders/shaders.toml`, the `[first_use.*]` tables.
- `crates/null3d-shaders/src/typescript.rs`, `first_use_files` and `DeviceModule`.

## The start budget, 145 KB after Brotli

Five failures, all WebGL2. Every WebGPU mode passes.

| Mode | Brotli | Share |
| --- | ---: | ---: |
| pipelined, WebGL2 | 162,305 B | 109.3% |
| low latency, WebGL2 | 159,271 B | 107.3% |
| drawing on the main thread, WebGL2 | 158,870 B | 107.0% |
| sketch on the main thread, WebGL2 | 155,837 B | 105.0% |
| single-threaded, WebGL2 | 150,701 B | 101.5% |

The non-shader parts of every mode total about 116 to 119 KB. The rest is one
start shader module, the largest of its mode. The WebGL2 modules are 40.5 to
42.2 KB after Brotli (`js/shaders-glsl*.js`), against 25.8 to 27.4 KB for the
WebGPU ones (`js/shaders-wgsl*.js`). So the WebGL2 start carries about 15 KB more
shader text than the WebGPU start, and that gap is the whole overrun. The start
overrun is not caused by the first-use files.

## The first-use shader budget, 32 KB after Brotli

392 of the 657 first-use shader files are over, from 33,748 to 43,029 bytes. All
392 are GLSL. No WGSL first-use file is over; the largest is about 21 KB. The
largest are the files of several features, such as
`shaders-area-lights-and-morph-and-skinning-and-transmission-glsl-draw-index-tone-map-half`
at 43,029 B, but 72 of the 392 are single-feature files, such as
`shaders-coverage-glsl*`.

The gzip and uncompressed columns pass everywhere. The gzip maximum of a
first-use file is 171.9 KB against 320 KB, and the uncompressed maximum is
1,005.1 KB against 1,536 KB.

## The cause

The shader build groups each by-device build into a module per feature set,
target and device bits (`first_use_files`). The GLSL text is about three to four
times the size of the WGSL text, because naga writes each stage's full text.
`[first_use.*]` grew with area lights, transmission, weighted blending, row
values, level-of-detail fade, coverage and hash, and each is a permutation on
the mesh templates. The limit of 32 KB was set in D-56, when the largest file was
about 20 KB. The files have grown past it since. The scheme is not broken by
construction; the data grew.
