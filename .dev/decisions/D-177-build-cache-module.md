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
- [Branches and parallel work](../pull-requests.md#builds) describes the one root, and
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

## Addendum, 15 October 2026: one Rust build folder per checkout

The shared cargo target is withdrawn. Each checkout builds Rust into its own `target` folder again,
and sccache shares the compiled dependency crates instead. The owner approved this on 15 October 2026.

Cargo names a workspace crate's build files by the crate and its workspace-relative path, and judges
them fresh by comparing file times with the build's record. Two worktrees hold the same crates at the
same relative paths, so in one shared folder they share one record. A worktree whose files are older
than another worktree's last build of the same crate therefore links that build. This was seen twice:
on 14 October a branch got a stale shader compiler and failed its size budgets, and on 15 October a
branch compiled against another branch's `null3d-gpu` constants. Earlier the same day a merged branch
got a core without its own feature.

The keyed caches made it worse. Their keys hash the checkout's own files, which is correct, but the
contents came from whatever Cargo linked. So a wrong core, shader compiler or module set was stored
under the right key and served to every later checkout with those sources. A per-checkout folder
removes the cause: Cargo then compares a checkout's files only with that checkout's own builds, and
an entry's key and its contents come from the same files. The keys need no change, and a test checks
that they hold no checkout path (`tools/build-wasm.test.ts`, "the cache keys").

The decision:

1. `tools/build-wasm.ts` builds into `<checkout>/target` by default. `NULL3D_CARGO_TARGET` still names
   another folder; `local` names the checkout's own. The native shader build uses Cargo's default,
   the workspace's `target`.
2. The build wraps the compiler in sccache when `sccache` is on the `PATH` and `RUSTC_WRAPPER` is not
   set, with its cache in the `sccache` folder under the root. sccache keys each compile by the
   contents of its sources, its flags and its dependencies, so sharing it across checkouts cannot
   hand one checkout another's crates. It caches the dependency crates and the standard library that
   the threads variant rebuilds. It does not cache the workspace's own crates in an incremental
   build, proc-macro crates or build scripts, which compile once per checkout.
3. sccache is optional. CI and a machine without it build exactly as before.
4. The caches that the shared folder fed were purged once on 15 October 2026: the built WebAssembly
   files, the shader modules, the per-entry shader cache, the GPU check's baseline builds and the
   shared folder itself.
5. The size check's lock moves into the checkout with everything else: `target/build.lock`. It was
   `~/.cache/null3d/build.lock`, one file for the whole machine. A landing in one checkout then waited
   for a landing in another for the length of a base build. Two size checks in one checkout still
   serialise, because they share that checkout's base tree and staging folders.

The sccache server runs each compile itself, at the priority that it started with. The coordinator's
load limiter starts it at background priority, so the CPU lane's compiles never run beside a timing
run in the foreground.

## Addendum, 15 October 2026: one lock, one root, and a limit on every cache

The code review of 13 to 15 October found four faults in these caches: a lock that two processes could
hold at once (M-31), keys that left out an input the build itself writes (H-14), keys taken before the
build read its inputs (H-15), and no limit on how much disk a cache keeps (H-16). Two more were the
same mechanics copied twice (BT-22). The fixes:

1. `acquireLock` creates the lock as a folder that holds the holder's process id. `mkdir` either
   creates it or fails, so exactly one process takes it, where the old write with `wx` could leave an
   empty file that a second process then read as "nobody holds this". A lock whose holder has stopped,
   or that names no process and is older than a minute, is broken by renaming it aside first: of two
   processes that find the same stale lock, exactly one renames it, so neither removes a lock that
   another took meanwhile. The holder names itself while a build waits.
2. `pruneCache` removes the least recently used entries of a cache while it holds more than
   `CACHE_LIMIT_BYTES` (24 GiB), skipping an entry used within the last two hours, because a build of
   another checkout may still be reading it. A cache touch marks an entry as used. The module cache and
   the per-entry cache prune after a build; the artifact cache prunes after a store. The GPU check's
   baseline cache keeps its own rule: it keeps six large builds by commit, which the check names.
3. `cacheRoot` reads `NULL3D_BUILD_CACHE`, else `null3d` under `XDG_CACHE_HOME`, else `~/.cache/null3d`,
   and every cache under the root takes its folder from there, including the sample cache. The GPU
   check's baseline cache and the sample cache no longer name their own root.
4. Every cargo run goes through `cargoEnv(checkout)`, which names that checkout's `target` folder, so a
   stale `CARGO_TARGET_DIR` in a shell or a job can no longer point two checkouts at one folder.
5. Every key includes a hash of the build's own code, `tools/build-wasm.ts` and
   `tools/lib/core-sources.ts`: the first sets the flags and the staging and the second rewrites each
   built module's glue, so an edit to either changes what an entry holds while the Rust sources stay
   the same.
6. A build hashes its inputs again before it stores anything. When a source changed while it ran, the
   artifact cache stores nothing, and the shader build refuses to record the set and asks for another
   run: an entry must hold exactly what its key names, for every checkout that matches the key.
7. A module set in the shared cache carries a record of each file's hash, and a set that misses a file,
   holds an extra one or holds one with other bytes than the record is a miss. A restore copies each
   module in place and treats a copy failure as a miss, so a half-written 850 MB set is never handed
   to a checkout as a built set.

## Addendum, 15 October 2026: one file per entry key, and a shared text table

The per-entry shader cache wrote one file per entry name, and every build of that entry wrote the
whole file (M-32). Two versions of one entry therefore overwrote each other, so a branch that
returned to an earlier version of a shader compiled it again, and one entry grew to 1.5 GB: the
largest entry holds 15,552 builds, whose 281,280 strings are only 7,297 distinct because the same
library text runs through all of them.

The build now writes each entry into a file named for the entry and its key, so the versions never
overwrite each other and the older ones are pruned instead. A text of 40 characters or more is
stored once per entry and referenced by the builds that use it, which cut the stored bytes of the
same entries from about 1.8 GB per set to about 240 MB in one measurement on 15 October 2026. The
folder is pruned to 24 GiB after each use, oldest first, sparing a file written within the last two
hours because a build may be reading it. The format version is now 2, so an entry from the older
format is never read with a new meaning.
## Addendum, 17 October 2026: the caches share the cargo run and the baseline's write too

The last two copies of the caches' mechanics are gone (BT-22). `tools/lib/build-cache.ts` now owns the
cargo invocation as well, in `runCargo`. It sets the checkout's own build folder and sccache through
`cargoEnv`, and takes the folder of a call that builds elsewhere. It passes on the call's environment
and stdio. The build's WebAssembly steps and the shader module build run every cargo call through it.

The GPU check's baseline cache now fills its folder through the module's atomic folder write, as the
other caches do. It renames no folder itself. Its own rules stay: it keeps six builds by commit, and
it prunes by use. The Vite plugin's cache still keeps its own copy of the rules, as the Decision
above says.

## Addendum, 23 October 2026: the key covers the sources, and a shipped core now names its own staleness

The WebAssembly cache's key covers every file that decides the core. Those are the workspace's
`Cargo.toml`, `Cargo.lock` and `rust-toolchain.toml`, and every file under the core crate and its
path dependencies (`null3d-wasm`, `null3d-core`, `null3d-gpu` and `null3d-render`), which was 150
files at the tip. The key also covers each variant's Rust flags, cargo arguments and wasm-opt
features. It covers the target, the release profile and the versions of Rust, wasm-bindgen and
wasm-opt. The build script's own hash is part of it too. A hit checks every recorded file hash
before it serves the entry. So the cache cannot hand a build a core from other sources, and the
stale core of 23 October 2026 did not come from it.

The unchecked input was `packages/engine/dist`. A checkout whose core was built before a Rust change
kept it, and every page build copied it as it was. A development build compares the core's stamp
with the served sources and raises E1402. A production build drops that check, so the pair ran until
the GPU refused a command, with E1305.

`refuseStaleCore` in `tools/lib/core-sources.ts` now compares each core's stamp with the checkout's.
It stops the build with the message that names `bun run build`. The page builds of the benchmarks,
the startup build and the browser tests call it. So do the pack step, the CDN build and the examples
build. A project that installs the engine package holds no core crate, so the check leaves
it alone. The release's publish job builds the core from the tag before it packs, and it now refuses
a stale core too.
