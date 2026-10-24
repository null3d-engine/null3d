# D-227: Network use and third-party notices

Status: decided by the helper of M3-R18 on 23 October 2026, for the owner's review, with an
addendum from the audit on 24 October 2026. Built: the two docs pages, the guard test and the
three notices files. Date: 2026-10-23. Task: M3-R18.

Summary: The engine, its loader and its add-ons contact no server of their own. A unit test records
every `fetch` call site and every absolute address in shipped code. A new call fails until the
record and the docs say what it downloads. The notices of every package that ships another
project's code now name that project and its license.

## Question

What does null3D send over the network, and can a reader check the answer? Which third-party parts
does each package ship, and which license does each part carry?

## Rule

- A shipped source file may call `fetch` only where the record in `tools/lib/network-use.ts` names
  it, with the call count and the reason. Any other call, and any extra call in a recorded file,
  fails `bun run test`.
- No shipped file may use `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`,
  `RTCPeerConnection` or `sendBeacon`.
- Shipped code may name an absolute address only for the recorded hosts. Each is an example in a
  message, a link, the SVG namespace, a name that never resolves, or a loopback server.
- A package whose code comes from another project ships a `THIRD-PARTY-NOTICES.txt` with the
  license texts that the licenses ask a copy to carry.

## Data

The audit read every shipped source file under `packages/*/src`, `packages/*/bin` and
`examples/addons`: 346 files. The build's generated shader modules are not read, since the shader
library that the build writes them from is. The audit found nine `fetch` call sites, all in the
engine and in the Vite plugin.

| File | Calls | What it downloads |
| --- | --- | --- |
| `packages/engine/src/page/early-core.ts` | 1 | the engine core's own file, beside the engine's code |
| `packages/engine/src/page/engine.ts` | 1 | the sketch module that the page passes in |
| `packages/engine/src/scene/area-light-tables.ts` | 1 | the engine's own area light tables |
| `packages/engine/src/scene/assets.ts` | 2 | the addresses that the sketch asks for, and a file again from the cache |
| `packages/engine/src/shared/wasm.ts` | 1 | the engine's own WebAssembly, and that of an add-on's task |
| `packages/engine/src/shared/worker-start.ts` | 1 | a worker script's status, read while the engine names a startup failure |
| `packages/vite-plugin/src/engine-shaders.ts` | 2 | the engine's shader release, fetched by the build, and the interface that offers it |

The Vite plugin makes the one request to a third party. It downloads the engine's shader release
from GitHub and checks its SHA-256 hash. When the download fails, it builds the modules from
source. `NULL3D_ENGINE_SHADERS` names a local folder and skips the download. The command-line tool
makes no request; its servers answer on the loopback address.

The notices covered these parts before: Basis Universal with Zstandard, meshoptimizer and Draco.
They also named the three.js table and EXR decoders, the LTC tables and the core's Rust crates.
They covered three.js geometry and earcut, and the Basis encoder and ufbx. Three gaps were found
and closed:

- The Vite plugin ships `dist/shader-compiler.wasm`, built from naga, naga_oil, serde, toml and
  their crates, and had no notices file.
- The command-line tool ships `dist/assets.wasm`, built from `exr` and `lebe` (BSD 3-Clause) and
  the compression crates, and its notices named only the vendored Basis and ufbx code.
- The engine's three.js section named the specular table and the EXR decoders. It did not name the
  ported GTAO, Poisson denoise and wide-line shaders in `crates/null3d-shaders/wgsl`.

## Decision

The statement lives in `docs/getting-started/network-use.md`, and the license list in
`docs/getting-started/third-party-notices.md`. The guard is
`tools/lib/network-use.test.ts`, which runs in the tools group of `bun run test`. The three notices
gaps are closed in the same branch.

## Consequences

- A new network call in shipped code fails the unit run, and its message names the record and the
  docs page to update.
- The notices of `@null3d/engine`, `@null3d/cli` and `@null3d/vite-plugin` list their upstreams.
  `@null3d/geometry` already did. The other add-ons ship only their own code.
- No engine code path changes, so the network behavior is the same as before this branch.

## Addendum, 24 October 2026: two guard gaps and an add-on that the page left out

The audit ran again over the same folders. It found no new call site, so the statement still
holds. Two gaps in the guard and one in the page were closed:

- The guard now counts `fetch` reached through the global object, such as `globalThis.fetch`,
  `window.fetch` and `self.fetch`. A method that another object names `fetch` still does not
  count, so a local interface that offers one keeps its recorded count.
- The guard refuses `importScripts`, and it checks the host of a `ws://` or `wss://` address as
  well as an `https://` one.
- The third-party notices page now names `@null3d/splats` among the add-ons that ship only their
  own code. Its SPZ reader follows Niantic's published format and copies none of Niantic's code,
  so the package needs no notices file.

The guard fails on an added call in any shipped file. A call added to `packages/terrain/src/index.ts`
made the repository check report both the call and its host, and the file was then restored.
