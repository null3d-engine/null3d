# D-111: How the asset tool converts other formats and makes material maps

Status: decided. Date: 2026-10-08. Task: M2-B3.

Summary: `assets convert` reads FBX and OBJ files with ufbx v0.23.1. The repository builds it to standalone WebAssembly (313 KB) with the pinned Emscripten SDK, and keeps it in `packages/cli/vendor/ufbx`. STL and PLY files read in the tool's own JavaScript, and glTF and Draco files through glTF-Transform. `pack-orm` writes UASTC, and `normal-from-bump` reads its `--scale` as three.js reads `bumpScale`.

## Question

The engine loads glTF only. Which reader takes each other format, and how does the tool ship it? How do FBX and MTL materials become glTF materials? And what do `pack-orm` and `normal-from-bump` write?

## Rule

The rules of [D-18](D-18-asset-tool.md) hold. Users install nothing native, and every machine writes the same bytes. The tool's choices do not slow the files it writes. Conversions follow the source's intent, as the program that made the file shows it, not three.js's loader where the two differ ([D-52](D-52-intent-parity.md)).

## The options

### The FBX reader

| Option | Licence and install | Verdict |
| --- | --- | --- |
| ufbx, built to WebAssembly | MIT or Unlicense, one C file. Blender 5.0 and Godot 4.3 import FBX with it | Chosen by the owner on 3 October 2026, from the research of that day |
| FBX2glTF | Unmaintained. Its binaries hold Autodesk's FBX SDK, under Autodesk's licence | No |
| Blender without a window | A GPL program of about 1 GB | No. The docs name it for Collada, 3DM and USDZ |
| Autodesk's FBX SDK | Cannot ship in an npm package | No |

### How ufbx ships

| Option | Why not, or why |
| --- | --- |
| A ufbx package from npm | The two that exist on 8 October 2026 (`@forgeax/engine-fbx`, `lecodes-assets`) are a few weeks old, from single authors, and each wraps ufbx in its own output format. The tool would ship code that nobody here has read |
| The Rust crate `ufbx` in `null3d-assets-wasm` | The crate compiles the C file with the cc crate, so it still needs a C compiler that targets WebAssembly, which the Mac and CI lack. It adds Rust bindings over the same code |
| Build ufbx and the tool's own C code with Emscripten, and keep the built file in git | Chosen. The repository already builds the Basis transcoder this way, with the same pinned SDK, 4.0.15. CI lacks Emscripten, so the built file stays in git, as [D-105](D-105-generated-files-out-of-git.md) allows for the Basis files |

The tool's C code (`packages/cli/native/fbx.c`) asks ufbx for the scene in glTF's terms and writes it as JSON with one block of binary arrays. So ufbx does the work that it does best: triangulating polygons, welding vertices, normals from smoothing groups, skin weights, and baking clips. The JavaScript side (`fbx.js`) builds the glTF document. The module imports one function, which reports memory growth, and needs no JavaScript glue.

### Why the built reader stays in git

The reader ships as `packages/cli/vendor/ufbx/ufbx.wasm`, kept in git under [D-105](D-105-generated-files-out-of-git.md)'s rule for files that a fresh clone cannot build:

- No build on npm can be trusted, as the table above says.
- A fresh clone, CI and most contributors' machines have no compiler that turns C into WebAssembly. Apple's clang has no WebAssembly target. Building on install would add the SDK, 1.8 GB on disk on the Mac, to every `bun install`.

Anyone can rebuild it and check that it matches:

```sh
bun tools/build-ufbx.ts
```

The command downloads the pinned sources and SDK, checks their SHA-256, builds, and prints the module's SHA-256. The unit test `convert.test.ts` pins the same SHA-256, so a changed source without a rebuild, or a rebuild that differs, fails.

| Input | Pinned at |
| --- | --- |
| ufbx | v0.23.1, commit `26a482ae66871d7de36eb722aa060bce95bce274`, archive SHA-256 `21edd1021dfb430e37aa6214c9b3bbaa5634b1859cbbef7231e738af4f19c956` |
| Emscripten SDK | 4.0.15, archive SHA-256 `35be7626493e3bd22860ee2177147f9bca3b6ff871edeab27c5b061a9ed9d23d`, the same as the Basis transcoder's |
| The tool's own code | `packages/cli/native/fbx.c` |
| Compiler flags | `emcc -O2 -DNDEBUG -DUFBX_NO_STDIO -DUFBX_NO_SUBDIVISION -DUFBX_NO_TESSELLATION -DUFBX_NO_GEOMETRY_CACHE -DUFBX_NO_SKINNING_EVALUATION`, linked with `-sSTANDALONE_WASM=1 --no-entry -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sMALLOC=emmalloc`, as `tools/build-ufbx.ts` lists them |

ufbx's licence, MIT or the Unlicense, is in `packages/cli/vendor/ufbx/LICENSE` and in the package's `THIRD-PARTY-NOTICES.txt`.

### OBJ files

ufbx reads OBJ and MTL files too. The tool uses it for OBJ rather than a parser of its own, so OBJ and FBX share the material rules below. OBJ smoothing groups then give smooth normals where the file has none. The command finds the MTL files that `mtllib` names, and hands their bytes to ufbx.

### STL and PLY files

Both formats are simple, so the tool reads them in plain JavaScript (`stl.js`, `ply.js`). It reads binary and text STL, with Materialise's face colors, and text and binary PLY in either byte order. STL corners at the same place join into one vertex. The facet normals stay out, so glTF readers shade the faces flat, as the facets say. Colors in bytes are sRGB in both formats, and glTF stores linear colors, so the tool converts them. three.js's `PLYLoader` converts them too; its `STLLoader` does not.

## Data

| Measure | Value |
| --- | --- |
| The reader's WebAssembly module | 313 KB, standalone, one import |
| Its build with `bun tools/build-ufbx.ts` | About 5 s of CPU after the SDK is installed. Two builds wrote the same bytes |
| The test column from Blender's FBX exporter: 34 triangles, 2 bones, 1 morph target, 1 clip of 25 frames, an embedded 32 x 32 PNG | 51.5 KB to 11.4 KB, in under 0.1 s |
| The same column from Blender's OBJ exporter | 1.9 KB, its MTL file and its PNG to 3.9 KB |

How the data was produced: `bun tools/build-ufbx.ts`, twice, comparing the SHA-256 it prints; `node packages/cli/bin/null3d.js assets convert` on the files that `tests/lib/convert-sources.py` makes with Blender 5.2.

## Decision

### Space, scale and clips

ufbx converts each file to glTF's space before the tool reads it: right-handed, Y up, in meters (`space_conversion` set to modify the geometry). Geometric transforms and FBX's non-standard scale inheritance move to helper nodes, which glTF can hold. Mirrored files flip on X. Each FBX take becomes a glTF clip. ufbx bakes curves that glTF cannot hold, such as Bézier and step keys, at up to 30 keys a second. It drops keys that a straight line between their neighbors gives. A blend shape channel's weights become the mesh's morph weights on every node that shows it. glTF keeps all of a mesh's weights in one track, so each channel takes the times of all, between its own keys by straight lines.

Skins take ufbx's inverse bind matrices, so a skinned mesh draws in its bind pose wherever its node sits. A vertex that no bone moves follows the mesh's node, through a joint of its own.

### Materials

| Source | glTF | Why |
| --- | --- | --- |
| A color with a texture | The texture, with a white factor | In the programs that write FBX and MTL files, a texture replaces the color. ufbx keeps the color's default, often 0.8 gray, which glTF would multiply in |
| Separate roughness, glossiness, metalness and occlusion textures | One packed texture, as `pack-orm` packs it, at the largest map's size. Glossiness inverts | glTF reads roughness and metalness from one texture |
| A Phong exponent (FBX Phong, MTL's `Ns`), with no physically based values | Roughness `(2 / (n + 2))^(1/4)` | The Beckmann slope that matches the Phong highlight is `sqrt(2 / (n + 2))`, and glTF's roughness is that slope's square root. three.js draws such files with `MeshPhongMaterial` and that exponent, so the highlight's size stays. Blender's OBJ importer reads `Ns` against Blender's own export (`1 - sqrt(Ns / 1000)`), and ufbx assumes a scale of 0 to 100: for `Ns 40`, they give 0.8 and 0.37 against 0.47 here |
| A bump map, or a gray image in a normal map's place | A normal map from its heights, at the file's bump factor | Blender's OBJ exporter writes normal maps as `map_Bump`, and older files put height maps there. A normal map leans blue; a height map is gray. The engine reads normal maps only |
| Opacity, and an opacity texture that is the base color's own | Base color alpha, blended | glTF has no separate opacity texture. Another opacity texture gets a note |
| Emissive color times its factor | Emission, with `KHR_materials_emissive_strength` above 1 | |

Textures go into the file as PNG and JPEG images. TGA images, which FBX files often name, become PNG. Other images get a note and stay out. Texture coordinates flip in V, as FBX and OBJ put an image's bottom row at V = 0. A texture's scale and offset become `KHR_texture_transform`; a rotation gets a note.

Cameras and lights stay out in this version, with a note.

### Draco and compression

A Draco or meshopt input gets meshopt compression by default: the meshes reorder for the vertex cache, quantize as `assets optimize` quantizes them, and compress with `EXT_meshopt_compression`. Draco had quantized them already, so the output loses nothing more of note. Other inputs keep their floats unless `--compression meshopt` says otherwise, since `convert` changes the format only and `assets optimize` does the rest. The Draco decoder is the tool's own `draco3d` package, which `assets optimize` already used; the engine's decoder (M2-A6) is separate.

### pack-orm

The channels follow glTF: occlusion in red, roughness in green, metalness in blue. Each source map reads from its red channel. A missing occlusion or roughness map is white, so the material's own factor applies. A missing metalness map is black, for no metal. A `.ktx2` output is UASTC with every mip level, as the change of 4 October to M2-B3 asks: UASTC keeps the three channels apart, which ETC1S blurs together. A `.png` output is for models that `assets optimize` encodes later.

### normal-from-bump

The slope at each texel is half the difference of its two neighbors' heights, times `--scale`. three.js's bump mapping takes the height difference between neighboring screen pixels, times `bumpScale`. So the two agree where one texel covers one pixel of the screen. three.js's bumps grow stronger as a texel shrinks on screen, which no texture can follow. The map tiles by default, since most bump maps do. A 16-bit PNG keeps its depth.

## How three.js handles it

three.js loads each format in the browser with its own loader: `FBXLoader`, `OBJLoader` with `MTLLoader`, `STLLoader` and `PLYLoader`. They give Phong or standard materials, and leave the conversion work to each page load. null3D converts once, before publishing, and loads glTF only.

## Consequences

- `packages/cli/src/assets/`: `convert.js` with the readers `fbx.js`, `stl.js`, `ply.js` and the shared `convert-document.js`; `pack-orm.js`, `normal-from-bump.js` and `maps.js`; `image-files.js` for TGA files and 16-bit height maps.
- `packages/cli/native/fbx.c` and `tools/build-ufbx.ts` make `packages/cli/vendor/ufbx/ufbx.wasm`, with ufbx's licence beside it and in `packages/cli/THIRD-PARTY-NOTICES.txt`. `tools/lib/emsdk.ts` installs the SDK for this build and the Basis transcoder's.
- Blender makes the FBX and OBJ test files only, with `tests/lib/convert-sources.py`; the tool never runs it. The test files are in `tests/pages/assets/models/sources/`, and their outputs in `tests/pages/assets/models/converted/`. `convert.test.ts` checks that the tool writes the same bytes and that the engine's loader reads each output. It also pins the reader's SHA-256. The image test `converted-models` draws the outputs.
- Docs: [the asset pipeline](../../docs/guides/assets-pipeline.md#convert-other-formats) and [the command page](../../docs/cli/null3d.md#assets). The mapping entry of three.js's other loaders points to the command.
- Open: cameras and lights, and FBX files with external textures in formats other than PNG, JPEG and TGA.
