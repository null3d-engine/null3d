---
id: getting-started/third-party-notices
title: Third-party notices
status: experimental
since: "0.2"
summary: "The third-party code in each null3D package, with its version and license, and the notices file that a build writes beside the page."
---

# Third-party notices

> Roadmap step 0.2, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

Some null3D packages ship code from other projects, as the original file or as a port of it. Each license asks a copy to carry its notice, so every such package ships a `THIRD-PARTY-NOTICES.txt` file with the full text.

## Each package

| Package | Third-party code | License | Where | Notices |
| --- | --- | --- | --- | --- |
| `@null3d/engine` | Basis Universal 2.50 with Zstandard, meshoptimizer 1.3.0, Draco 1.5.7, three.js 0.186.1, TinyEXR and OpenEXR, Linearly transformed cosines, Filament, and the core's Rust crates | Apache License 2.0, BSD 3-Clause and MIT | `vendor/`, the shader modules, `panorama-worker.js`, `dist/wasm` | `THIRD-PARTY-NOTICES.txt` |
| `@null3d/cli` | Basis Universal 2.50 with Zstandard, ufbx 0.23.1, the `exr` and `lebe` crates, three.js 0.186.1, and the asset module's other crates | Apache License 2.0, BSD 3-Clause and MIT | `vendor/`, `dist/assets.wasm` | `THIRD-PARTY-NOTICES.txt` |
| `@null3d/vite-plugin` | naga and naga-types 30.0.1, naga_oil 0.23.0, serde, serde_json, toml, and the shader compiler's other crates | MIT, Apache License 2.0 and Zlib | `dist/shader-compiler.wasm` | `THIRD-PARTY-NOTICES.txt` |
| `@null3d/controls` | three.js 0.186.1, the math and the option names of its controls | MIT | `lib/index.js` | `THIRD-PARTY-NOTICES.txt` |
| `@null3d/geometry` | three.js 0.186.1, its generators, curves, paths and shapes; earcut 3.0.2 | MIT and ISC | `lib/index.js` | `THIRD-PARTY-NOTICES.txt` |
| `@null3d/three-compat` | three.js 0.186.1, its tone curves and its outline pass | MIT | `lib/index.js` | `THIRD-PARTY-NOTICES.txt` |
| `@null3d/impostors` | None, its own code | None | `lib/index.js` | None |
| `@null3d/particles` | None, its own code | None | `lib/index.js` | None |
| `@null3d/splats` | None, its own code, which reads Niantic's published SPZ format | None | `lib/index.js` | None |
| `@null3d/terrain` | None, its own code | None | `lib/index.js` | None |
| `@null3d/vegetation` | None, its own code | None | `lib/index.js` | None |
| `@null3d/water` | None, its own code | None | `lib/index.js` | None |
| `@null3d/wind` | None, its own code | None | `lib/index.js` | None |

The null3D packages themselves are offered under the MIT License or the Apache License 2.0. A production build writes the notices of every package that a page ships into `null3d-third-party-notices.txt`.

## The engine

`@null3d/engine` ships these parts:

| Part | License | Where |
| --- | --- | --- |
| Basis Universal 2.50, the KTX2 transcoder | Apache License 2.0 | `vendor/basis` |
| Zstandard, inside the transcoder | BSD 3-Clause | `vendor/basis` |
| meshoptimizer 1.3.0, the meshopt decoder | MIT | `vendor/meshopt` |
| Draco 1.5.7, the glTF decoder | Apache License 2.0 | `vendor/draco` |
| three.js 0.186.1: the specular table, the math, the tone curves, the ambient occlusion and wide line shaders, and the HDR and EXR readers | MIT | the core, the shader library, `panorama-worker.js` |
| Filament: the specular anti-aliasing kernel, the anisotropic highlight, and AgX's punchy look | Apache License 2.0 | the shader library |
| TinyEXR and OpenEXR, whose code the EXR decoders follow | BSD 3-Clause | `panorama-worker.js` |
| Linearly transformed cosines, the area light tables | BSD 3-Clause | `vendor/ltc` |
| The Rust crates of the core: the standard library, wasm-bindgen, bumpalo, cfg-if, once_cell and dlmalloc | MIT or Apache License 2.0 | `dist/wasm` |

The full texts are in the engine's `THIRD-PARTY-NOTICES.txt`.

## The tools

The command-line tool and the Vite plugin put no code in a page. Their packages still ship WebAssembly modules.

`@null3d/cli` ships these parts:

| Part | License |
| --- | --- |
| Basis Universal 2.50, the KTX2 encoder | Apache License 2.0 |
| Zstandard, inside the encoder | BSD 3-Clause |
| ufbx 0.23.1, the FBX and OBJ reader | MIT |
| The crates that read OpenEXR files, `exr` 1.74.2 and `lebe` 0.5.3 | BSD 3-Clause |
| three.js 0.186.1: the environment maps and the built-in room | MIT |
| The other crates of the asset module, such as `half`, `miniz_oxide` and `zune-inflate` | MIT or Apache License 2.0 |

`@null3d/vite-plugin` ships these parts:

| Part | License |
| --- | --- |
| naga and naga-types 30.0.1, and naga_oil 0.23.0, the WGSL parser, validator and translator | MIT or Apache License 2.0 |
| serde 1.0.229, serde_json 1.0.151 and toml 1.1.6, the module's JSON and TOML interfaces | MIT or Apache License 2.0 |
| The other crates of the shader compiler, such as indexmap, hashbrown, regex and codespan-reporting | MIT, Apache License 2.0 or Zlib, as each crate states |

## The example add-ons

`examples/addons/` holds aurora, car-paint, facades, lens-kit, screens and traffic-lanes. No package publishes them. Each builds on the engine's public API and implements its techniques in its own code, so it carries the engine's license and no third-party notice.

## Where the notices are

Each package's `THIRD-PARTY-NOTICES.txt` holds the full text. The engine's copy is also at `node_modules/@null3d/engine/THIRD-PARTY-NOTICES.txt` after an install.

A production build with the Vite plugin writes every package's notices into `null3d-third-party-notices.txt` beside the page. Keep that file with the build when you publish it, or show its text in your game's credits. The tools' notices stay out of that file, because a page ships none of their code.
