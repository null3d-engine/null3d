---
id: getting-started/third-party-notices
title: Third-party notices
status: experimental
since: "0.2"
summary: "The third-party code in each null3D package, its license, and the notices file that a build writes beside the page."
---

# Third-party notices

> Roadmap step 0.2, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

Some null3D packages ship code from other projects, as the original file or as a port of it. Each license asks a copy to carry its notice, so every such package ships a `THIRD-PARTY-NOTICES.txt` file with the full text.

## The engine

`@null3d/engine` ships these parts:

| Part | License | Where |
| --- | --- | --- |
| Basis Universal, the KTX2 transcoder | Apache License 2.0 | `vendor/basis` |
| Zstandard, inside the transcoder | BSD 3-Clause | `vendor/basis` |
| meshoptimizer, the meshopt decoder | MIT | `vendor/meshopt` |
| Draco, the glTF decoder | Apache License 2.0 | `vendor/draco` |
| three.js: the specular table, the ambient occlusion and wide line shaders, and the EXR decoders | MIT | the core, the shader library, `panorama-worker.js` |
| TinyEXR and OpenEXR, whose code the EXR decoders follow | BSD 3-Clause | `panorama-worker.js` |
| Linearly transformed cosines, the area light tables | BSD 3-Clause | `vendor/ltc` |
| The Rust crates of the core: the standard library, wasm-bindgen, bumpalo, cfg-if, once_cell and dlmalloc | MIT or Apache License 2.0 | `dist/wasm` |

## The add-ons

`@null3d/geometry` ships these parts:

| Part | License | Where |
| --- | --- | --- |
| three.js geometry, curves, paths and shapes | MIT | `lib/index.js` |
| earcut, the polygon triangulation | ISC | `lib/index.js` |

`@null3d/controls`, `@null3d/impostors`, `@null3d/particles`, `@null3d/splats` and `@null3d/terrain` ship only their own code.

## The tools

The command-line tool and the Vite plugin put no code in a page. Their packages still ship WebAssembly modules.

`@null3d/cli` ships these parts:

| Part | License |
| --- | --- |
| Basis Universal, the KTX2 encoder | Apache License 2.0 |
| Zstandard, inside the encoder | BSD 3-Clause |
| ufbx, the FBX and OBJ reader | MIT |
| The crates that read OpenEXR files, `exr` and `lebe` | BSD 3-Clause |
| The other crates of the asset module, such as `half`, `miniz_oxide` and `zune-inflate` | MIT or Apache License 2.0 |

`@null3d/vite-plugin` ships these parts:

| Part | License |
| --- | --- |
| naga and naga_oil, the WGSL parser, validator and translator | MIT or Apache License 2.0 |
| serde, serde_json and toml, the module's JSON and TOML interfaces | MIT or Apache License 2.0 |
| The other crates of the shader compiler, such as indexmap, hashbrown, regex and codespan-reporting | MIT, Apache License 2.0 or Zlib, as each crate states |

## Where the notices are

Each package's `THIRD-PARTY-NOTICES.txt` holds the full text. The engine's copy is also at `node_modules/@null3d/engine/THIRD-PARTY-NOTICES.txt` after an install.

A production build with the Vite plugin writes every package's notices into `null3d-third-party-notices.txt` beside the page. Keep that file with the build when you publish it, or show its text in your game's credits. The tools' notices stay out of that file, because a page ships none of their code.
