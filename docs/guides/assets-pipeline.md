---
id: guides/assets-pipeline
title: "The asset pipeline (the `assets` command)"
status: experimental
since: "0.2"
summary: "optimize, env, convert; LODs; texture compression; budget reports."
---

# The asset pipeline (the `assets` command)

> Ships in null3D 0.2. The command is experimental, so it can still change between versions. `assets optimize` is built. Not built yet: `assets env`, `assets convert`, `assets pack-orm` and `assets normal-from-bump`, and blocker meshes and prebuilt BVHs in the files. The engine does not yet read meshopt compression or draw levels of detail, so `--compression meshopt` writes files it cannot load. Coding agents must not use these parts.

```mermaid
flowchart LR
    source["Your glTF models:<br/>.glb or .gltf files,<br/>PNG and JPEG textures"] --> optimize["bunx @null3d/cli<br/>assets optimize"]
    optimize --> glb["One .glb per model:<br/>meshes in 8-bit and<br/>16-bit integers"]
    optimize --> ktx2["textures/*.ktx2:<br/>ETC1S and UASTC,<br/>every mip level"]
    optimize --> report["A budget report"]
    glb --> load["assets.loadGltf"]
    ktx2 --> load
```

The `assets optimize` command makes glTF models smaller and faster to load and draw. It stores each mesh's vertices as small integers, in the order that the GPU reads them fastest. It encodes each texture as a KTX2 file, which the GPU keeps compressed. Your files download less, take less GPU memory and upload in fewer frames. The command runs on your computer before you publish, from npm, with nothing else to install. The same files give the same output bytes on every computer.

## Optimize a model

Give the command a model, or a folder of models, and a folder for the output:

```sh
bunx @null3d/cli assets optimize models/ public/models/
```

```text
BoomBox.glb: 10.1 MB to 2.2 MB (the model 107.0 KB), in 9.6 s
  draws 1 object of 1 part in 1 mesh: 6,036 triangles, 3,575 stored vertices
  size 0.0198 x 0.0195 x 0.0202
  4 textures: 2 of 2048x2048 etc1s srgb, 1 of 2048x2048 etc1s linear, 1 of 2048x2048 uastc linear
  texture memory: 13.3 MB with ETC2 and ASTC, 21.3 MB with BC7 only, 85.3 MB uncompressed
```

That is Khronos's BoomBox sample model, whose four PNG textures of 2048 x 2048 made most of its 10.1 MB.

Each `.glb` and `.gltf` file in the input folder and its subfolders becomes one `.glb` file in the output folder, at the same place. The textures of every model go into one `textures` folder in the output folder. Each texture file takes its name from its contents. So models that share a texture share its file, and a host can let browsers keep the files for good. Then load a model as any other:

```ts
// sketch.ts
const ship = await assets.loadGltf('/models/ship.glb');
scene.instantiate(ship);
```

| Option | Effect | Without it |
| --- | --- | --- |
| `--lod` | Adds levels of detail to each mesh of 256 triangles or more | No levels |
| `--max-texture-size <pixels>` | The largest side of a texture: a power of two up to 2048 | 2048 |
| `--texture-quality <size\|high>` | `high` encodes color and data maps in UASTC, several times larger than ETC1S, with less loss | `size` |
| `--compression <none\|meshopt>` | `meshopt` compresses the file's buffers with `EXT_meshopt_compression`. The engine does not read it yet | `none` |
| `--jobs <count>` | The worker threads that encode textures | One per CPU core |
| `--report <file.json>` | Also writes the budget report as a JSON file | No file |

## What it does to meshes

| Data | In the output | Why |
| --- | --- | --- |
| Triangle order | Reordered for the GPU's vertex cache, and vertices in the order that triangles use them | The GPU shades fewer vertices and reads memory in order |
| Positions | 16-bit integers in 16,384 steps across each mesh, with `KHR_mesh_quantization` | Half the size of floats. A mesh 100 m long gets steps of 6 mm |
| Normals and tangents | 8-bit integers | A quarter of the size. Directions stay within about 1 degree |
| Texture coordinates | 16-bit integers when every value lies from 0 to 1, else floats | Values past 1 would need a texture transform per material |
| Vertex colors, joint weights | 8-bit integers | Weights still add up to one |
| Indices | 16 bits when a mesh has at most 65,535 vertices | Half the size |

The integers need a transform that turns them back into positions. The command puts it in the mesh's node when nothing else moves with the node. A node with children, a light, a camera or an animation keeps its transform. Its mesh then moves to a new child node of the same name. Each instance of an instancing node takes the transform too, and so do the bind matrices of a skin.

Models with Draco compression load too. The command writes their meshes without Draco.

## Textures

The command encodes each PNG and JPEG texture of a model as a KTX2 file of Basis Universal data, with every mip level. KTX2 images that the model already had move to files of their own, unchanged. The engine turns each file into the compressed format that the device supports, as [Textures](../api/textures.md) lists.

| Texture | Format | Color space |
| --- | --- | --- |
| Base color and emissive maps | ETC1S, or UASTC with `--texture-quality high` | sRGB |
| Normal maps | UASTC always, since ETC1S blurs their detail | Linear |
| Metal-rough, occlusion and other maps | ETC1S, or UASTC with `--texture-quality high` | Linear |

Each side of a texture becomes its nearest power of two, and then both halve together until the longer side fits `--max-texture-size`. A 1000 x 600 image becomes 1024 x 512. Every level of a mip chain then halves exactly.

Textures are at most 2048 x 2048. The encoder is a 32-bit WebAssembly build, which refuses 4096 x 4096 images.

In 40 sets of photographed materials at 1024 x 1024, each ETC1S color map took about 110 KB to download. Each UASTC normal map took about 670 KB. On the GPU, ETC1S takes an eighth of the memory of RGBA8 where the device has ETC2, and UASTC takes a quarter.

## Levels of detail

`--lod` adds three levels to each mesh of 256 triangles or more, with about a half, a quarter and an eighth of its triangles. Each level shares the mesh's vertices, so only its indices add to the file. The levels go into the file with `MSFT_lod`, with the screen coverage at which each level's error falls under one pixel of a 1080-pixel screen. A level that would save little is left out.

The engine does not draw levels of detail yet, and draws the full mesh. three.js's `GLTFLoader` also ignores `MSFT_lod`.

## The budget report

| Line | What it says |
| --- | --- |
| First line | The model's files before and after, the `.glb` file alone, and the time the command took |
| `draws` | The objects that the scene draws, with each instance of an instancing node, the parts and meshes they draw, the triangles at full detail, and the vertices the file stores |
| `size` | The scene's size in its own units, from the meshes' bounds |
| Textures | Each group of textures that share a size, a format and a color space |
| `texture memory` | The textures' GPU memory with every mip level: where the GPU takes ETC2 and ASTC, as phones, tablets and Macs do; where it takes only BC7, as most Windows PCs do; and with no compressed format |

`--report` writes the same figures as JSON, with each texture's source size, output size and encode time.

## In a Vite project

The null3D Vite plugin runs the same steps on a model that a module imports with `?optimized`. The import gives the address of the optimized model:

```ts
// sketch.ts
import shipUrl from './models/ship.glb?optimized';

const ship = await assets.loadGltf(shipUrl);
```

The plugin uses the tool of `@null3d/cli`, so add the command-line tool to your project first:

```sh
bun add -d @null3d/cli
```

The first import of a model encodes it. The plugin keeps the result in `node_modules/.cache/null3d-assets`, keyed by the model's files, the tool's version and the options. Later starts and builds take it from there, until one of those changes. A production build writes the files into its assets folder. The plugin's `assets` option takes the command's options:

```ts
// vite.config.ts
import null3d from '@null3d/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [null3d({ assets: { lod: true, maxTextureSize: 1024 } })],
});
```

For TypeScript, add `@null3d/vite-plugin/client` to the `types` of your `tsconfig.json`, so `?optimized` imports have the type `string`.

## Encode time

Each texture encodes on its own worker thread, so a set of textures uses every CPU core. On a MacBook Pro with 18 cores, those 40 sets, 144 textures in all, took 18 to 26 seconds. A texture of 2048 x 2048 takes several seconds on its core. The command prints each model's time.
