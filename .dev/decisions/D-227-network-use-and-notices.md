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
  it. The record gives the call count and the reason. It covers each form: bare, through the global
  object, through a bracket key, or as an optional call. Any other call, and any extra call in a
  recorded file, fails `bun run test`.
- No shipped file may use `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`,
  `RTCPeerConnection`, `sendBeacon`, `importScripts` or `navigator.connection`, except where the
  record names the file and its count.
- A vendored file that holds one of those forms may ship only where a shipped file imports it.
  That file must hand it the compiled module, so its own download path cannot run.
- Shipped code may name an absolute or protocol-relative address only for the recorded hosts. Each
  is an example in a message, a link, the SVG namespace, a name that never resolves, or a loopback
  server.
- A package whose code comes from another project ships a `THIRD-PARTY-NOTICES.txt` with the
  license texts that the licenses ask a copy to carry.

## Data

The audit of 23 October 2026 read every shipped source file under the folders that the manifests
then named, `packages/*/src`, `packages/*/bin` and `examples/addons`: 346 files. The build's
generated shader modules are not read, since the shader library that the build writes them from is.
That audit found nine `fetch` call sites, all in the engine and in the Vite plugin. The addenda
record the sites found after it.

| File | Calls | What it downloads |
| --- | --- | --- |
| `packages/engine/src/page/early-core.ts` | 1 | the engine core's own file, beside the engine's code |
| `packages/engine/src/page/engine.ts` | 1 | the sketch module that the page passes in |
| `packages/engine/src/scene/area-light-tables.ts` | 1 | the engine's own area light tables |
| `packages/engine/src/scene/assets.ts` | 2 | the addresses that the sketch asks for, and a file again from the cache |
| `packages/engine/src/shared/wasm.ts` | 1 | the engine's own WebAssembly, and that of an add-on's task |
| `packages/engine/src/shared/worker-start.ts` | 1 | a worker script's status, read while the engine names a startup failure |
| `packages/vite-plugin/src/engine-shaders.ts` | 2 | the engine's shader release, fetched by the build, and the interface that offers it |

At the audit of 26 October 2026 the guard read 430 shipped files and found 19 `fetch` calls.
Thirteen are in null3D code, in ten files: the seven in the table, where `page/engine.ts` now holds
2, plus `packages/splats/src/system.ts`, `packages/splats/src/stream.ts` and
`packages/cli/src/devtools.js`. Six are in the three vendored decoders, whose own download path no
shipped file reaches.

The Vite plugin makes the one request to a third party. It downloads the engine's shader release
from GitHub and checks its SHA-256 hash. When the download fails, it builds the modules from
source. `NULL3D_ENGINE_SHADERS` names a local folder and skips the download. The command-line tool
makes no request off this machine. Its servers and its debugging socket answer on the loopback
address, and `src/devtools.js` reads that address and drives the browser over it.

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

## Addendum, 25 October 2026: the controls package ports three.js

The audit found one package that carried no notices file. The controls package ports three.js's
controls. Its source says that the camera math follows three.js's OrbitControls and MapControls
step for step. The fly, first-person, drag and transform controls follow three.js's controls of
those names. The sequence and the numbers match, not only the API names. That covers the spherical
update, the damping share, the azimuth wrap, the polar clamp, the zoom base, the pan scale and the
turn angle.

The package now ships `THIRD-PARTY-NOTICES.txt` with three.js's MIT text. Its `files` list, its
`./package.json` export and its entry in the pack check's required files carry the notice. The
Vite plugin finds a package's notices through that export, so the controls' text now reaches
`null3d-third-party-notices.txt` in a production build. The notices page names the package and its
upstream.

The audit also corrected the evidence line for this task. When a call was added to a shipped file,
one test failed, the repository check. The earlier line said that the guard's thirteen tests failed,
which was wrong.

## Addendum, 26 October 2026: every package on the page, and the vendored code in the guard

The audit ran a third time, over every folder that a package manifest ships, and it read the
vendored glue. It found no new call site, so the statement holds. Four gaps closed:

- The notices page had no entry for `@null3d/vegetation` or `@null3d/wind`, the two add-ons that
  landed after the last audit. Every package now has a row with its upstream, its version where
  one applies, and its license. A package with no upstream says that it ships only its own code.
- The command-line tool's asset module ports three.js's environment readers and its built-in
  room, and its notices named no three.js. The package now carries three.js's MIT text, under
  version 0.186.1.
- The engine's shader library follows Filament's specular anti-aliasing kernel, its anisotropic
  highlight and the two constants of AgX's punchy look. Filament's Apache License 2.0 is named
  now, and the three.js section names the math, the tone curves and the HDR reader.
- The guard now reads every folder that a package manifest ships, `vendor` and `templates`
  included. It also reads the source that a build turns into `lib`. It records the vendored
  glue's own download path with its counts. The vendor check fails when an importing file stops
  handing a decoder `instantiateWasm` or `wasmBinary`, because then the vendored download could
  run.

The notices have their own guard, `tools/lib/notices.ts` with its tests. It pairs the page with
the packages. Each package has one row. A ported package ships its `THIRD-PARTY-NOTICES.txt`,
its `files` list carries the file, and it exports `./package.json` for the plugin to resolve.
Every example add-on is named too.

Evidence: the 26 network tests and the 10 notices tests pass. An added `fetch` in
`packages/terrain/src/index.ts` failed the repository check with the call and its host. Renaming
`instantiateWasm` in `gltf-draco.ts` failed the vendor check. Removing the wind row from the page
failed the notices check.

## Addendum, 26 October 2026: the reader's findings

A fresh reader refused the task after judging `origin/m3-start` at `28bb8b5fd` rather than this
branch. On this branch, `packages/cli/THIRD-PARTY-NOTICES.txt` holds three.js 0.186.1's MIT text,
and `docs/getting-started/third-party-notices.md` carries the `@null3d/cli` row that names it.
Neither is present at `28bb8b5fd`, so the reader's blocker was already closed where the work lives.

The other findings were checked against this branch. Three were real and are closed:

- The engine's three.js section named the shader ports but not the lighting terms, the split-sum
  environment light, the skinning, the atmosphere or the room. The section now names all of them.
- The figures in the Data section were the 23 October ones. Its paragraph now says so. The 26
  October figures follow the table: 430 shipped files, 19 `fetch` calls, 13 in null3D code and six
  in vendored glue. The command-line tool's loopback request is stated too.
- A call through a bracket key, an optional call and a protocol-relative address all passed the
  guard. It now counts each of them, with a test for each, and a cast form such as
  `(globalThis as any)['fetch']` too. The vendored check now reads the option as it is passed,
  rather than the word anywhere, and has a case for the command-line tool's `wasmBinary`.

Two findings were already closed on this branch. The vendor check reads the importer of every
vendored download path, and it covered the Draco wrapper, the Basis transcoder and the CLI encoder.
The notices page named vegetation and wind in the first addendum of this date.

Seen to fail: an added bracket-key `fetch` and a protocol-relative address in
`packages/terrain/src/index.ts` named both forms. A bare mention of `instantiateWasm` in place of
the option failed the vendored check. The 27 network tests and the 10 notices tests pass.
