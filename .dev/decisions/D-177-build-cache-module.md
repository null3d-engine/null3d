# D-177: One module owns the build caches' mechanics

Status: decided and built, with the owner's approval of the size check's lock and of one Rust build
folder per checkout. Task: the build-speed work.

Summary: The caches under `tools/` share one module, `tools/lib/build-cache.ts`, with one root, one
set of mechanics and one escape hatch. Each checkout builds Rust into its own `target` folder, and
sccache shares the compiled dependency crates. An entry is used only when every input and every
recorded file hash matches, and each cache prunes to 24 GiB.

## Question

Should each build cache keep its own root, keying, atomic write and escape hatch, or should the
caches under `tools/` share one module for all of those?

## Rule

A build cache is safe to clear at any time: every entry is a pure function of its inputs, so a
missing entry costs only the build time. A cache is used only when every input matches; otherwise it
misses and the build runs. One module owns the root, the hashing, the atomic writes, the lock and the
escape hatch, and each cache keeps its own key and layout.

## Decision

The caches that only the repository's tools read share `tools/lib/build-cache.ts`:

1. One root. `cacheRoot` reads `NULL3D_BUILD_CACHE`, else `null3d` under `XDG_CACHE_HOME`, else
   `~/.cache/null3d`. Every cache under the root takes its named folder from there:
   `shader-modules`, `shader-cache`, `wasm-artifacts`, `sccache`, the sample cache and the GPU
   check's baseline cache. One variable moves or clears them all, and clearing the root is always
   safe.
2. One `hashOf` and one `hashFiles`. One atomic file write, one atomic folder write, and one copy
   into a folder. One lock, `acquireLock`, which a size check takes. One cargo run, `runCargo`.
   One pruning rule, `pruneCache`.
3. One escape hatch, `NULL3D_NO_CACHE=1`. The per-cache variables `NULL3D_NO_BUILD_CACHE` and
   `NULL3D_NO_SHADER_CACHE` work as aliases.
4. Per-cache root variables name one cache's own folder: `NULL3D_SHADER_CACHE` and
   `NULL3D_WASM_ARTIFACTS`. `NULL3D_CARGO_TARGET` names another Rust build folder, and `local` names
   the checkout's own. The canonical variable is `NULL3D_BUILD_CACHE`.

The Vite plugin's shader cache is not a `tools/` cache. It serves a game project, lives in that
project's `node_modules/.cache`, and loads no repository tooling, so it stays where it is and follows
the same three rules on its own: an atomic write, a miss when any input changes, and one documented
opt-out. The plugin's cache is documented for game developers in
[Install](../../docs/getting-started/install.md); the repository's own caches belong in `.dev`.

## One Rust build folder per checkout

Each checkout builds Rust into its own `target` folder, and sccache shares the compiled dependency
crates.

Cargo names a workspace crate's build files by the crate and its workspace-relative path, and judges
them fresh by comparing file times with the build's record. Two worktrees hold the same crates at the
same relative paths, so in one shared folder they share one record. A worktree whose files are older
than another worktree's last build of the same crate therefore links that build. A branch can then
get a stale shader compiler and fail its size budgets, or compile against another branch's
`null3d-gpu` constants, or get a core without its own feature.

The keyed caches make that worse. Their keys hash the checkout's own files, which is correct, but
the contents come from whatever Cargo linked. So a wrong core, shader compiler or module set would
be stored under the right key and served to every later checkout with those sources. A per-checkout
folder removes the cause: Cargo then compares a checkout's files only with that checkout's own
builds, and an entry's key and its contents come from the same files. A test checks that the keys
hold no checkout path (`tools/build-wasm.test.ts`, "the cache keys").

1. `tools/build-wasm.ts` builds into `<checkout>/target` by default. The native shader build uses
   Cargo's default, the workspace's `target`.
2. Every cargo run goes through `runCargo`, which sets the checkout's own build folder and sccache
   through `cargoEnv(checkout)`, and takes the folder of a call that builds elsewhere. It passes on
   the call's environment and stdio. A stale `CARGO_TARGET_DIR` in a shell or a job therefore cannot
   point two checkouts at one folder. The build's WebAssembly steps and the shader module build run
   every cargo call through it.
3. The build wraps the compiler in sccache when `sccache` is on the `PATH` and `RUSTC_WRAPPER` is not
   set, with its cache in the `sccache` folder under the root. sccache keys each compile by the
   contents of its sources, its flags and its dependencies, so sharing it across checkouts cannot
   hand one checkout another's crates. It caches the dependency crates and the standard library that
   the threads variant rebuilds. It does not cache the workspace's own crates in an incremental
   build, proc-macro crates or build scripts, which compile once per checkout.
4. sccache is optional. CI and a machine without it build with plain cargo.

The sccache server runs each compile itself, at the priority that it started with. The coordinator's
load limiter starts it at background priority, so the CPU lane's compiles never run beside a timing
run in the foreground.

## The lock

A staging folder is named for the build's process, so no two builds share one, in one checkout or in
several. Cargo locks the target folder that builds share. So an ordinary build takes no lock. Only a
size check takes it, because its base build runs the base commit's own script, which may stage into
a shared folder.

The lock lives in the checkout, at `target/build.lock`. Two size checks in one checkout serialize,
because they share that checkout's base tree and staging folders. A landing in one checkout never
waits for a landing in another.

`acquireLock` creates the lock as a folder that holds the holder's process id. `mkdir` either
creates it or fails, so exactly one process takes it (M-31). A lock whose holder has stopped, or that
names no process and is older than a minute, is broken by renaming it aside first. Of two processes
that find the same stale lock, exactly one renames it, so neither removes a lock that another took
meanwhile. The lock names its holder while a build waits (`waiting for the lock at <path>, held by
pid N`), so a queued build never looks hung.

## Keys and entries

- Every key includes a hash of the build's own code, `tools/build-wasm.ts` and
  `tools/lib/core-sources.ts` (H-14). The first sets the flags and the staging, and the second
  rewrites each built module's glue, so an edit to either changes what an entry holds while the Rust
  sources stay the same.
- A build hashes its inputs again before it stores anything (H-15). When a source changed while it
  ran, the artifact cache stores nothing, and the shader build refuses to record the set and asks
  for another run: an entry must hold exactly what its key names, for every checkout that matches the
  key.
- The WebAssembly cache's key covers every file that decides the core. Those are the workspace's
  `Cargo.toml`, `Cargo.lock` and `rust-toolchain.toml`, and every file under the core crate and its
  path dependencies (`null3d-wasm`, `null3d-core`, `null3d-gpu` and `null3d-render`), about 150
  files. The key also covers each variant's Rust flags, cargo arguments and wasm-opt features, the
  target, the release profile, the versions of Rust, wasm-bindgen and wasm-opt, and the build
  script's own hash. A hit checks every recorded file hash before it serves the entry. So the cache
  cannot hand a build a core from other sources.
- A module set in the shared cache carries a record of each file's hash. A set that misses a file,
  holds an extra one or holds one with other bytes than the record is a miss. A restore copies each
  module in place and treats a copy failure as a miss, so a half-written 850 MB set is never handed
  to a checkout as a built set.
- The build writes one combos table for each target and each value of the half-precision bit, such
  as `shaders-wgsl-combos-half.ts`, and `shaders.ts` loads both. The module-name test matches every
  combos table, suffixed or not. A completeness check requires every module that `shaders.ts` loads,
  from its imports and the device module names its tables hold. So a set that misses one is never
  fresh, is never restored and is never stored, and `bun tools/shaders.ts` never calls it "up to
  date". A build that writes an incomplete set throws instead of recording it as up to date.

## Pruning

`pruneCache` removes the least recently used entries of a cache while it holds more than
`CACHE_LIMIT_BYTES` (24 GiB), skipping an entry used within the last two hours, because a build of
another checkout may still be reading it (H-16). A cache touch marks an entry as used. The module
cache and the per-entry cache prune after a build; the artifact cache prunes after a store.

The GPU check's baseline cache keeps its own rule: it keeps six large builds by commit, which the
check names, and it prunes by use. It fills its folder through the module's atomic folder write, as
the other caches do, and renames no folder itself.

## The per-entry shader cache

The build writes each entry into a file named for the entry and its key (M-32), so two versions of
one entry never overwrite each other, and a branch that returns to an earlier version of a shader
finds it. The older versions are pruned.

The builds of one entry share most of their text. The largest entry holds 15,552 builds, whose
281,280 strings are only 7,297 distinct, because the same library text runs through all of them. So
a file holds each WGSL and GLSL source of its entry once, and each build names its sources by their
number in that list. A read gives every build that names a source the same text in memory, since the
shader output types hold their sources as shared texts. That takes the shader build's peak on CI's
data from 14.1 GB to 7.3 GB ([D-235](D-235-shader-entry-parts.md#the-joins-memory)).
The format version is 3, so an entry from an older format is never read with a new meaning.

## A stale core in the package folder

`packages/engine/dist` is not a cache input. A checkout whose core was built before a Rust change
keeps it, and every page build copies it as it is. A development build compares the core's stamp
with the served sources and raises E1402. A production build drops that check, so a stale pair runs
until the GPU refuses a command, with E1305.

`refuseStaleCore` in `tools/lib/core-sources.ts` compares each core's stamp with the checkout's. It
stops the build with the message that names `bun run build`. The page builds of the benchmarks, the
startup build and the browser tests call it. So do the pack step, the CDN build and the examples
build. A project that installs the engine package holds no core crate, so the check leaves it alone.
The release's publish job builds the core from the tag before it packs, and it refuses a stale core
too.

## Options rejected

- **One cargo target shared by every checkout.** Cargo judges freshness by file times against one
  record per crate path, so worktrees link each other's builds, and the keyed caches store the wrong
  bytes under the right key.
- **One machine-wide lock for every build.** It serializes the whole team. Four builds can wait on
  one lock, one of them for 94 seconds, and a wait that prints nothing looks hung.
- **A lock written as a file with `wx`.** It can leave an empty file that a second process then reads
  as "nobody holds this".
- **One file per entry name in the per-entry shader cache, rewritten whole by every build.** Two
  versions of one entry overwrite each other, a return to an earlier version compiles again, and one
  entry grows to 1.5 GB.

## Consequences

- `tools/lib/build-cache.ts` holds the mechanics, and `tools/lib/build-cache.test.ts` checks the
  keying, the atomic write and the lock.
- [Branches and parallel work](../pull-requests.md#builds) describes the one root, and
  [Benchmarks](../benchmarks.md#build-caches) holds the measured figures.
- The caches stay outside git, as [D-105](D-105-generated-files-out-of-git.md) requires. Nothing
  generated is committed.
