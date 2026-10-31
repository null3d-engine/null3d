# D-227: Network use and third-party notices

Status: decided by the helper of M3-R18, for the owner's review. Built: the two docs pages, the
network guard, the notices guard and the notices files of the packages that ship another project's
code. The notices now name the four ported shader techniques that the audit found missing:
KinoBokeh and Unity's post-processing stack v1 behind the depth-of-field gather, and AMD FidelityFX
FSR 1 RCAS and Snapdragon GSR 1 behind the final pass, with AMD's SSSR march under the same AMD
text. The Vite plugin ships every engine shader's text, so its notices name these too, and three.js
and Filament. Task: M3-R18.

Summary: The engine, its loader and its add-ons contact no server of their own. A unit test records
every `fetch` call site and every absolute address in every folder that a package ships. A new call
fails until the record and the docs say what it downloads. Every package that ships another
project's code has a notices file, and the notices name every upstream whose code the package's
shipped text carries. A second guard pairs the notices page with the packages, and a third fails
when shipped code or a decision record claims a port that the notices do not name.

## Question

What does null3D send over the network, and can a reader check the answer? Which third-party parts
does each package ship, and which license does each part carry?

## Rule

- A shipped source file may call `fetch` only where the record in `tools/lib/network-use.ts` names
  it, with the call count and the reason. Any other call, and any extra call in a recorded file,
  fails `bun run test`. A `fetch` reached through the global object, such as `globalThis.fetch`,
  `window.fetch` and `self.fetch`, counts. A method that another object names `fetch` does not, so
  a local interface that offers one keeps its recorded count.
- No shipped file may use `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`,
  `RTCPeerConnection`, `sendBeacon` or `importScripts`.
- Shipped code may name an absolute address, `https://`, `ws://` or `wss://`, only for the recorded
  hosts. Each is an example in a message, a link, the SVG namespace, a name that never resolves, or
  a loopback server.
- A package whose code comes from another project ships a `THIRD-PARTY-NOTICES.txt` with the
  license texts that the licenses ask a copy to carry.
- A package's notices name every upstream whose code its shipped text carries. The guard reads the
  source trees that each package ships, including the engine's shader library for the Vite plugin,
  and fails when one names a known upstream that the notices leave out. A decided record that calls
  a known upstream a port must find its name in the engine's notices too.
- The notices page has one row for every package, with its upstream, its version where one applies,
  and its license. A package with no upstream says that it ships only its own code.

## Data

The audit reads every folder that a package manifest ships, `vendor` and `templates` included, the
source that a build turns into `lib`, and `examples/addons`. The build's generated shader modules
are not read, since the shader library that the build writes them from is. The audit finds nine
`fetch` call sites, all in the engine and in the Vite plugin, and the vendored glue's own download
path.

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

The guard records the vendored glue's own download path with its counts. The vendor check fails
when an importing file stops handing a decoder `instantiateWasm` or `wasmBinary`, because then the
vendored download could run.

The notices cover Basis Universal with Zstandard, meshoptimizer and Draco. They name the three.js
table and EXR decoders, the LTC tables and the core's Rust crates. They cover three.js geometry and
earcut, and the Basis encoder and ufbx. They also cover these parts:

- The Vite plugin ships `dist/shader-compiler.wasm`, built from naga, naga_oil, serde, toml and
  their crates.
- The command-line tool ships `dist/assets.wasm`, built from `exr` and `lebe` (BSD 3-Clause) and
  the compression crates, beside the vendored Basis and ufbx code. Its asset module ports three.js's
  environment readers and its built-in room, so it carries three.js's MIT text, under version
  0.186.1.
- The engine's three.js section names the specular table, the EXR decoders, the math, the tone
  curves and the HDR reader. It also names the ported GTAO, Poisson denoise and wide-line shaders
  in `crates/null3d-shaders/wgsl`. The engine's shader library follows Filament's specular
  anti-aliasing kernel, its anisotropic highlight and the two constants of AgX's punchy look. So
  the notices name Filament's Apache License 2.0, with its copyright line.
- The engine's depth of field ports KinoBokeh and follows the composite of Unity's post-processing
  stack v1, so its notices carry both MIT texts. Nothing comes from the stack's second version: its
  licence binds code to Unity-dependent projects, so code ported from it could not ship here at all,
  whatever a notices file says. Its final pass translates AMD FidelityFX FSR 1's
  RCAS and ports Qualcomm Snapdragon GSR 1's upscale, and its screen-space reflections follow AMD
  FidelityFX SSSR's march, so the notices carry AMD's MIT text and Qualcomm's BSD 3-Clause text.
  The Vite plugin's compiler embeds every engine shader, so the plugin's notices name the same
  upstreams, beside three.js and Filament.
- The controls package ports three.js's controls. Its source says that the camera math follows
  three.js's OrbitControls and MapControls step for step. The fly, first-person, drag and transform
  controls follow three.js's controls of those names. The sequence and the numbers match, not only
  the API names. That covers the spherical update, the damping share, the azimuth wrap, the polar
  clamp, the zoom base, the pan scale and the turn angle. The package ships three.js's MIT text.
- `@null3d/splats` ships only its own code. Its SPZ reader follows Niantic's published format and
  copies none of Niantic's code, so the package needs no notices file.

## Decision

The statement lives in `docs/getting-started/network-use.md`, and the license list in
`docs/getting-started/third-party-notices.md`. The guard is `tools/lib/network-use.test.ts`, which
runs in the tools group of `bun run test`.

The notices have their own guard, `tools/lib/notices.ts` with its tests. It pairs the page with the
packages. Each package has one row. A ported package ships its `THIRD-PARTY-NOTICES.txt`, its
`files` list carries the file, and it exports `./package.json` for the plugin to resolve. The pack
check's required files name the notice too. The Vite plugin finds a package's notices through that
export, so each one reaches `null3d-third-party-notices.txt` in a production build. Every example
add-on is named too.

The same guard reads the source trees that each package ships and fails when one names a known
upstream that the package's notices leave out. It folds comment markers and whitespace before it
matches, so a claim that wraps across two comment lines still counts. For the engine it reads the
shader library, the render core, the core and the asset module; for the Vite plugin it reads its own
source and the shader library that its compiler embeds. A decision record that calls a known
upstream a port must find the name in the engine's notices. A test file, a method from a paper and
an upstream that no package ships are outside the check.

Evidence: the 22 network tests and the 15 notices tests pass. A `fetch` added to
`packages/terrain/src/index.ts` fails one test, the repository check, which reports the call and
its host. Renaming `instantiateWasm` in `gltf-draco.ts` fails the vendor check. Removing the wind
row from the page fails the notices check. With the KinoBokeh section taken out of the engine's
notices, the repository check fails and names `packages/engine` and KinoBokeh; a fixture test plants
the same claim in a shader and in a decision record and watches each fail, then passes once the
notice names it.

## Consequences

- A new network call in shipped code fails the unit run, and its message names the record and the
  docs page to update.
- Every package that ships another project's code has a notices file, among them
  `@null3d/engine`, `@null3d/cli`, `@null3d/vite-plugin`, `@null3d/controls` and
  `@null3d/geometry`. The other add-ons ship only their own code. The engine's and the Vite
  plugin's notices name every ported shader upstream, and a new claim of one fails the unit run
  until its notice follows.
- The guards change no engine code path, so they change no network behavior.
