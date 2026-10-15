# D-177: One module owns the build caches' mechanics

Status: decided. Date: 2026-10-14. Task: the build-speed work of 14 October 2026.

Summary: The build gained four caches in one day: the shared cargo target, the shader modules, the
per-entry shader build and the built WebAssembly files and tool modules. Each found its own root,
hashed its own keys, wrote its own files atomically and named its own escape hatch, so four copies of
one mechanism had to be kept in step. The three caches under `tools/` now share one module,
`tools/lib/build-cache.ts`, with one root and one set of mechanics, and one escape hatch.

## Question

Should each build cache keep its own root, keying, atomic write and escape hatch, or should the
caches under `tools/` share one module for all of those?

## Rule

A build cache is safe to clear at any time: every entry is a pure function of its inputs, so a
missing entry costs only the build time. A cache is used only when every input matches; otherwise it
misses and the build runs. One module owns the root, the hashing, the atomic writes, the lock and the
escape hatch, and each cache keeps its own key and layout.

## Decision

The three caches that only the repository's tools read share `tools/lib/build-cache.ts`:

1. One root, `NULL3D_BUILD_CACHE`, defaulting to `~/.cache/null3d`, with a named folder per cache:
   `cargo-target`, `shader-modules`, `shader-cache`, `wasm-artifacts`. One variable moves or clears
   them all, and clearing the root is always safe.
2. One `hashOf` and one `hashFiles`. One atomic file write, one atomic folder write, and one copy
   into a folder. One lock, which a shader build, a whole `bun run build` and a size check's base
   build all take.
3. One escape hatch, `NULL3D_NO_CACHE=1`. The older per-cache variables still work as aliases:
   `NULL3D_NO_BUILD_CACHE` and `NULL3D_NO_SHADER_CACHE`.
4. The older per-cache root variables still name one cache's own folder: `NULL3D_CARGO_TARGET`,
   `NULL3D_SHADER_CACHE` and `NULL3D_WASM_ARTIFACTS`. The canonical variable is `NULL3D_BUILD_CACHE`.

The Vite plugin's shader cache is not a `tools/` cache. It serves a game project, lives in that
project's `node_modules/.cache`, and loads no repository tooling, so it stays where it is and follows
the same three rules on its own: an atomic write, a miss when any input changes, and one documented
opt-out. The plugin's cache is documented for game developers in
[Install](../../docs/getting-started/install.md); the repository's own caches belong in `.dev`.

## Consequences

- `tools/lib/build-cache.ts` holds the mechanics, and `tools/lib/build-cache.test.ts` checks the
  keying, the atomic write and the lock. The shader module and artifact cache tests are unchanged.
- [Pull requests and parallel work](../pull-requests.md#builds) describes the one root, and
  [Benchmarks](../benchmarks.md#build-caches) holds the measured figures.
- The caches stay outside git, as [D-105](D-105-generated-files-out-of-git.md) requires. Nothing
  generated is committed.

## Addendum, 14 October 2026: ordinary builds no longer take the build lock

The first version took one machine-wide lock for every build on the machine, because a build staged
its core and tool modules into the shared cargo target and a size check builds the base commit with
that commit's own script. That serialised the whole team: four helpers were seen waiting on one lock,
one of them for 94 seconds, and a wait printed nothing, so a queued build looked hung.

Two changes remove the need for it. A staging folder is now named for the build's process, so no two
builds ever share one, in one checkout or in several, and Cargo already locks the target folder that
builds share. Only a size check takes the lock now, because its base build runs an older script that
may still stage into the shared folder. The owner approved the change on 14 October 2026 after the
waiting cost was measured.

The lock also names its holder while a build waits (`waiting for the lock at <path>, held by pid N`),
which is what made the 94-second wait visible rather than mysterious.

## Addendum: a partial module set is a miss (15 October 2026)

The shader modules cache handed a fresh checkout a set that missed `shaders-wgsl-combos-half.ts` and
`shaders-glsl-combos-half.ts`, and `bun tools/shaders.ts` still said "up to date". The build writes one
combos table for each target and each value of the half-precision bit, and `shaders.ts` loads both, but
the module-name test matched only the unsuffixed `shaders-<target>-combos.ts`. The save, the restore and
the "up to date" hash therefore all ignored the suffixed tables, and a set without them looked complete.

Two changes make a stale or partial entry a miss. The name test matches every combos table, suffixed or
not. And a completeness check requires every module that `shaders.ts` loads, from its imports and the
device module names its tables hold, so a set that misses one is never fresh, is never restored and is
never stored. A build that writes an incomplete set throws instead of recording it as up to date.
