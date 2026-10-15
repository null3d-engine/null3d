# D-175: The Vite plugin caches the shaders that a project builds

Status: decided. Date: 2026-10-14. Task: the build-speed work of 14 October 2026. Extended by [D-177](D-177-build-cache-module.md): the plugin's cache stays in the project and repeats the repository's build-cache rules on its own.

Summary: A project's `vite build` and `vite dev` run the engine's shader compiler over its WGSL. That covers every `.wgsl` file, every `/* wgsl */` literal, and every custom material and effect. The plugin kept no result, so each build compiled them all again. It now keeps each compiled shader in `node_modules/.cache/null3d-shaders`. The key of an entry is the WGSL, the variant spec and the compiler's version. On a small project of eight shaders, a cold build took 2.87 s. The next build took 0.30 s, about a tenth of the time.

## Question

May the Vite plugin keep compiled shaders between builds? What must the key hold, so that no entry serves a shader that the current source or compiler would not produce?

## Rule

A build after a change to the WGSL, to a variant spec or to the compiler must compile that shader. A build with no such change must return the same module that a fresh compile gives. A cache entry must never change what the build draws. A cache that is missing, unreadable or unwritable must not fail the build.

## Data

The project is `target/shader-bench`, a page that imports two `.wgsl` files. It holds four custom materials and two post effects in tagged literals. A custom material builds into every variant of the engine's standard material, so those are the expensive compiles. Each figure is the wall time of `bunx vite build` in that folder, three runs each. The Mac's `sysctl -n vm.loadavg` reported 12.4 to 12.7 during the runs, from other helpers' builds.

| Measure | Cold cache | Warm cache | Cache off |
| --- | --- | --- | --- |
| `vite build`, run 1 | 2.826 s | 0.317 s | 2.857 s |
| `vite build`, run 2 | 3.068 s | 0.284 s | 2.802 s |
| `vite build`, run 3 | 2.874 s | 0.295 s | 2.721 s |
| Median | 2.874 s | 0.295 s | 2.802 s |

The cold run compiles the eight shaders and writes eight entries. The warm run reads them all and starts no compiler worker. Vite and Rolldown alone take about 0.24 s of the warm figure, so the cache saves about 2.6 s here. A game has more shaders, and the saving grows with them.

How the data was produced: on 14 October 2026, `rm -rf node_modules/.cache/null3d-shaders dist` then `bunx vite build`, three times, with the warm run after each cold one.

## Decision

Keep the compiled shaders in `node_modules/.cache/null3d-shaders`, as the asset tool keeps its own results in `node_modules/.cache/null3d-assets`. Key each entry by a hash of three things:

1. the WGSL source, and the path it came from, so the messages name the right file;
2. the variant spec that the compiler is given, which carries the targets and defines of each build;
3. the compiler's version: the installed engine's version with the hash of the shader compiler module, so an engine or compiler upgrade misses every entry.

Store the compiler's whole result, so a hit gives the same records that a fresh compile gives. The module that the plugin packs from them is then the same too. A result that a read cannot trust is a miss; it does not parse, or it holds no `ok` field. Write each entry whole or not at all, and ignore a write that fails.

The cache is on by default. `NULL3D_NO_CACHE=1`, or Vite's `--force`, ignores it, so a build compiles everything again. The plugin's older name, `NULL3D_NO_SHADER_CACHE=1`, still works, so the same variable that turns off the repository's shader build turns this cache off too.

## Consequences

- `packages/vite-plugin/src/shader-cache.ts` holds the cache, and `index.ts` runs every compile path through it: `.wgsl` files, tagged literals, and the skin builds of custom materials.
- After [D-177](D-177-build-cache-module.md), the module repeats the three rules that `tools/lib/build-cache.ts` keeps for the repository's caches. Its `hashOf` and one-step write mirror that module's helpers, and it accepts the same opt-out names. It keeps the project's own root and takes no lock, since a game project cannot import repository tooling and each entry is one atomic file.
- `docs/getting-started/install.md` gains a "Builds" section, and the develop skill says where the cache lives and how to ignore it.
- The escape hatch covers a cache that a reader suspects is stale, and a build that must not read a cache at all.
- [Branches and parallel work](../pull-requests.md#builds) notes the new cache beside the repository's own caches.
