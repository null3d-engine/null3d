# D-176: The build caches the WebAssembly artifacts it writes

Status: decided. Date: 2026-10-14. Task: the build-speed work of 14 October 2026.

Summary: A build runs cargo, wasm-bindgen and wasm-opt for the two WebAssembly variants, and cargo
again for the shader compiler and the asset tool's formats. It ran them every time, even when
nothing had changed. It now keeps each artifact set under a key of every input, in a cache shared by
every checkout, `~/.cache/null3d/wasm-artifacts`. A no-change build copies the files in place and
skips cargo, wasm-bindgen and wasm-opt. A fresh worktree skips the link too.

## Question

May the build keep the WebAssembly files and the build tools' modules between builds? What must the
key hold, so that no entry ever serves a core built from other sources, another toolchain or another
tool binary?

## Rule

A build after a change to the core's Rust sources, to a variant's flags, to the target or the
profile, or to the Rust, wasm-bindgen or wasm-opt tool must run cargo, wasm-bindgen and wasm-opt
again. A build with no such change must give the same bytes that a fresh build gives. A cache entry
must never change what a page loads. A cache that is missing, unreadable or unwritable must not fail
a build.

## Data

On the Mac (18 cores), 14 October 2026, with the shared cargo target warm and `bun run build
--pages-only`:

| build | time |
| --- | --- |
| the first build in a worktree, with an empty cache | 114.5 s |
| no change, from the cache | 0.28 s |
| no change, forced with `--no-cache` | 83.8 s |

The first build downloads wasm-bindgen and compiles the tool modules, which the later builds do not.
The cache restored 575 files byte-identical to a full build's, by SHA-256. They are the two core
variants (the wasm, the glue and wasm-bindgen's type files), the shader compiler, the asset tool's
formats and the generated shader modules. A build with one entry file changed rebuilt that variant
alone (59.0 s) and wrote the same bytes. The other variant and the tool modules still hit the cache.

A fresh worktree at the same commit, with `bun install` done, took 236.8 s for its first build with
no cache. The same checkout built in 0.32 s from the cache, again with identical bytes. Cargo
recompiles the engine's crates for the new worktree's paths, so a fresh checkout skips more than a
no-change build does.

## Decision

Key each artifact set by every input, and store the files under `~/.cache/null3d/wasm-artifacts`,
one entry for each core variant and one for the build tools' modules:

1. the core sources' stamp, the same hash that the dev server compares with the glue (`E1402`), so a
   changed Rust source misses;
2. the variant's `RUSTFLAGS` and cargo arguments, its wasm-opt features, and whether the build keeps
   the function names, because each changes the bytes;
3. the target, `wasm32-unknown-unknown`, and the `release` profile;
4. the Rust toolchain, from `rust-toolchain.toml`;
5. the locked wasm-bindgen release with this machine's target, and the wasm-opt release from the
   `binaryen` version with this machine's platform and architecture;
6. for the build tools' modules, the input hash of each crate that they build from, which the shader
   module cache already computes.

Write a record of each stored file's SHA-256 beside it. A read trusts an entry only when every named
file matches its recorded hash, so a missing, truncated or edited entry is a miss and the build runs.
Write each entry whole into a staging folder and rename it into place, and ignore a write that fails:
the build's output is already in place.

The cache is on by default. `NULL3D_WASM_ARTIFACTS` points it at another folder, or at `local` for
`target/wasm-artifacts` inside the checkout. `NULL3D_NO_BUILD_CACHE=1`, or `--no-cache`, builds every
file again.

## Consequences

- `tools/build-wasm.ts` holds the cache and the keys, and `tools/build-wasm.test.ts` checks the keys
  and the miss paths.
- [Pull requests and parallel work](../pull-requests.md#builds) gains the new cache beside the shared
  cargo target and the shader module cache, with the measured figures.
- The escape hatch covers a cache that a reader suspects is stale, and a build that must not read a
  cache at all.
