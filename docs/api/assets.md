---
id: api/assets
title: Assets
status: experimental
since: "0.1"
summary: "loadGltf, loadTexture, loadImageBitmap, loadLut, loadJson, loadBinary, preload, onProgress; environments."
---

# Assets

> Ships in null3D 0.1, with glTF models and color grading tables from 0.2. The API is experimental, so it can still change between versions. Environments are not built yet: `loadEnvironment`, `builtinEnvironment` and `loadCubemap`. WebGPU draws the poses of skinned meshes. WebGL2 draws them in their rest pose, and meshes that joints move at the copy's origin. Morph targets load but do not draw. glTF files with meshopt or Draco compression do not load yet. Coding agents must not use these parts.

The `assets` object of the sketch context downloads files and decodes them. Every call returns a promise, and its download and decode run outside the sketch's frames, so a frame never waits for them. The browser decodes images off the main thread.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ assets, page }) => {
  assets.onProgress((loaded, total) => page.post('loading', loaded / total));
  await assets.preload(['/tex/bricks.png', '/tex/bricks-normal.png', '/levels/one.json']);

  const bricks = await assets.loadTexture('/tex/bricks.png', { wrap: 'repeat' });
  const normals = await assets.loadTexture('/tex/bricks-normal.png', { colorSpace: 'linear', wrap: 'repeat' });
  const level = await assets.loadJson<{ enemies: number }>('/levels/one.json');
});
```

## The calls

| Call | Gives |
| --- | --- |
| `loadGltf(url)` | A `Prefab`: a glTF model, whose objects `scene.instantiate` copies |
| `loadTexture(url, options)` | A texture from a PNG, JPEG or WebP file, an AVIF file where the browser decodes AVIF, or a KTX2 file of ETC1S or UASTC data, in the compressed format that the device supports. [Textures](textures.md) lists its options. |
| `loadImageBitmap(url, options)` | A decoded `ImageBitmap`, flipped for textures by default, as `loadTexture` decodes it |
| `loadLut(url)` | A color grading table from a `.cube` or a `.3dl` file, for `post.set({ lut })`. [Color grading tables](#color-grading-tables) says what it reads |
| `loadJson(url)` | The file parsed as JSON |
| `loadBinary(url)` | The file's bytes, as an `ArrayBuffer` |
| `preload(urls)` | Nothing: it downloads the files ahead of their loads |
| `onProgress(handler)` | A function that removes the handler |

## glTF models

`loadGltf` loads a glTF 2.0 model. It reads a `.glb` file, or a `.gltf` file with the buffers and images it names. It returns a `Prefab`, a template of the file's objects. The prefab makes each mesh, material and texture of the file once, and every copy of the model shares them. Then [`scene.instantiate`](scene.md#models-and-copies) creates a copy of its objects, or `scene.createInstances` draws many copies with instance batches.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, assets }) => {
  const lamp = await assets.loadGltf('/models/lamp.glb');
  scene.instantiate(lamp, { position: [0, 0, -2], castShadows: true });
  const { center, radius } = lamp.bounds; // frame the model with its bounds
  scene.setActiveCamera(scene.createPerspectiveCamera({ position: [center[0], center[1], center[2] + radius * 3], target: center }));
  return {};
});
```

A worker parses the file outside the sketch's frames, and decodes the images that the file holds there. The first `loadGltf` call downloads the loader and its worker, about 15 KB after Brotli, so a page without glTF files downloads neither. The files that a `.gltf` file names download through `assets`, so `preload` and `onProgress` cover them too. The engine copies the vertex data into its own memory, and keeps no other copy of it.

The prefab turns each part of the file into the engine's own:

| In the file | In the engine |
| --- | --- |
| A node | A `Group`, or a `Mesh` for a node with a mesh of one material. A node with lights or a mesh of several materials becomes a group with one object for each |
| A mesh | One mesh for each material, with its vertex arrays in the types that the file holds them in, `KHR_mesh_quantization` types included. Points and lines are left out; development builds warn about them |
| A material | `materials.standard`, or `materials.unlit` with `KHR_materials_unlit`. `KHR_materials_emissive_strength` sets `emissiveIntensity` |
| A texture | A texture with the file's sampler and texture coordinates. `KHR_texture_basisu` textures load through the KTX2 transcoder |
| `KHR_texture_transform` | The material's `uvTransform`: the base color map's transform, or the first map's |
| `KHR_lights_punctual` | Directional, point and spot lights, in the units of glTF and three.js |
| `EXT_mesh_gpu_instancing` | An instance batch for each copy, in `instance.batches` |
| A skin | Joints of the model's skeleton, which every copy's [animator](animation.md#models-from-gltf-files) poses. Joints are not objects. A skinned mesh goes in the copy's group |
| An animation | A clip that a copy's animator plays, with linear, step and cubic spline keys. The job workers resample it while `loadGltf` waits |
| A morph target | Kept with its mesh for a later version to draw. The mesh draws in its shape at rest |

Materials follow three.js's `GLTFLoader`. A mesh with vertex colors turns them on, and a mesh without normals shades flat. A mesh without tangents turns the normal map's green channel over. Blended materials write no depth. The engine finds the lights near each surface by their ranges. So a point or spot light without a range ends where its light falls below 0.001 lux.

| Member | Gives |
| --- | --- |
| `prefab.find(name)` | The first node with the name: its `position`, `rotation`, `scale`, `mesh` and `material` |
| `prefab.bounds` | `min`, `max`, `center` and `radius` of the whole model, around the origin of its copies |
| `prefab.materials` | The file's materials, in the file's order. `set` changes them in every copy |
| `prefab.textures` | The textures that the materials sample |
| `prefab.clips` | The names of the model's clips, which a copy's animator plays |
| `prefab.url` | The address the model came from |

## Color grading tables

`loadLut` reads the two forms that three.js's `LUTCubeLoader` and `LUT3dlLoader` read, with tables of 2 to 256 texels a side. The table becomes a 3D texture of 4 bytes per texel: 144 KB for a table of 33, and 1.1 MB for one of 65.

- A `.cube` file gives `LUT_3D_SIZE`, and the table's values from 0 to 1, red changing fastest. Its `TITLE` becomes the table's `title`. Its domain comes from `DOMAIN_MIN` and `DOMAIN_MAX`, or from DaVinci Resolve's `LUT_3D_INPUT_RANGE`, and becomes `domainMin` and `domainMax`. A table in 1D (`LUT_1D_SIZE`) fails with E1412.
- A `.3dl` file gives whole numbers, blue changing fastest, after an optional line of its input grid, such as `0 64 128 ... 1023`. The grid's points may differ from even steps by one, as rounding leaves them, which three.js's loader refuses. The values' bit depth comes from a Lustre `Mesh` line, or else from the largest value.
- Values outside 0 to 1 are clamped, as the canvas would clamp them.
- The first table loads the readers, a file of about 2 KB. The thread that runs the sketch reads the file between frames: a table of 33 takes about 10 ms on a desktop.

`lut.destroy()` frees the table's GPU memory. Give `post.set` a table that lives.

## Addresses

A relative address resolves against the page's address, in every thread mode, as it would in a page's own script. So `assets.loadTexture('tex/bricks.png')` on `https://example.com/game/` loads `https://example.com/game/tex/bricks.png`. An address from `new URL('./bricks.png', import.meta.url)` resolves against the sketch module instead, and Vite then ships the file with the build.

## Loading screens

`preload` downloads files ahead of the loads that use them, all at once, and resolves when every file has arrived. The next load of each address takes its file from memory, so it downloads nothing. The files wait in memory until then.

`onProgress` calls its handler each time a download finishes, with two counts: the files downloaded so far and the files asked for so far. A download that fails counts as finished too, so a loading bar still reaches its end. The counts cover every download of the `assets` calls, not only those of `preload`. A load that takes a preloaded file counts no further.

```ts
assets.onProgress((loaded, total, url) => page.post('loading', { loaded, total, url }));
await assets.preload(['/tex/a.png', '/tex/b.png', '/tex/c.png']);
// The handler got (1, 3), (2, 3) and (3, 3), in the order the files arrived.
```

[Loading screens and warm-up](../guides/loading-screens.md) shows a whole loading screen.

## Caching

Loads of one address at the same time share one download. Files that `preload` downloaded wait in memory until a load takes them. The HTTP cache keeps everything else, as it does for a page's own requests, so three.js's `THREE.Cache` has no counterpart.

## Errors

Each call rejects with an engine error that says how to fix the problem:

| Code | When |
| --- | --- |
| [E1411](../errors/E1411.md) | The file did not download: the server answered with an error, such as 404, or the network failed |
| [E1412](../errors/E1412.md) | The file downloaded, but the browser could not decode the image, the file was not a KTX2 file that the engine loads, the file was not valid JSON, or it held no color grading table that the engine reads |
| [E1416](../errors/E1416.md) | `loadGltf` got a file that is not a glTF 2.0 model it can read: broken JSON, an offset or a count past the data, a missing buffer or image, or a loop of nodes |
| [E1417](../errors/E1417.md) | `loadGltf` got a file that requires an extension the engine does not read, such as Draco compression |
| [E1406](../errors/E1406.md) | The files of the KTX2 transcoder, the glTF loader or the table readers did not download, when the first such file loads |
| [E1413](../errors/E1413.md) | A file from another origin, whose server did not allow the page to read it |
| [E1208](../errors/E1208.md) | A texture option that the engine does not know, or one that a KTX2 file cannot take |

`preload` rejects with the error of the first file that fails. The files that arrived stay in memory, and a later load of the failed file tries again.

## Files from other origins

The browser reads a file from another origin, such as a CDN, only when its server allows the page's origin with an `Access-Control-Allow-Origin` header. The engine downloads with `fetch`, so the file needs that header on every page, threaded or not. [Hosting](../getting-started/hosting.md) covers the headers.

## API reference

<!-- null3d:api:start -->

### `Assets`

Class `Assets`.

Loads files, and textures from image files. Every call runs outside the sketch's frames, so a frame never waits for a download or a decode. A sketch finds it as `ctx.assets`. Addresses resolve against the page's address.

| Member | Description |
| --- | --- |
| `loadTexture(url: string \| URL, options: LoadTextureOptions = {}): Promise<Texture>` | Downloads an image file or a KTX2 file, decodes it off the sketch's frames, and makes a texture from it. The browser decodes PNG, JPEG and WebP files, and AVIF files where it supports them. A KTX2 file of ETC1S or UASTC data becomes the compressed format that the device supports, with the file's mip levels, and the first KTX2 file loads the transcoder. Throws E1411 when the file does not download, E1413 when a server of another origin does not allow the page to read it, E1412 when the file does not decode, E1406 when the transcoder does not load, and E1208 for options the engine does not know. |
| `loadGltf(url: string \| URL): Promise<Prefab>` | Downloads a glTF 2.0 model, a `.glb` file or a `.gltf` file with the files it names, and makes a prefab of it: its meshes, materials, textures, lights and nodes, made once, which `scene.instantiate` copies. A worker parses the file off the sketch's frames, and the first call downloads the loader and its worker. The loads count for `onProgress`, the files the model names too, and they take files that `preload` downloaded. Throws E1411 when a file does not download, E1413 when a server of another origin does not allow the page to read it, E1416 for a file that is not a glTF model the engine reads, E1417 for a file that requires an extension the engine does not read, E1412 when an image does not decode, and E1406 when the loader does not download. |
| `loadImageBitmap(url: string \| URL, options: LoadImageOptions = {}): Promise<ImageBitmap>` | Downloads an image file and decodes it into an `ImageBitmap`, off the sketch's frames. By default it decodes as `loadTexture` does, so `textures.fromImageBitmap` makes the same texture. Throws E1411, E1412 or E1413 as `loadTexture` does. |
| `loadLut(url: string \| URL): Promise<Lut>` | Downloads a color grading table in a `.cube` or a `.3dl` file and makes a `Lut` from it, for `post.set({ lut })`. It reads the forms that three.js's `LUTCubeLoader` and `LUT3dlLoader` read, with tables of 2 to 256 texels a side. A `.cube` file's domain and title come along; a `.3dl` file's values are whole numbers of the depth that its largest value or its `Mesh` line gives. The first table loads the readers. Throws E1411 or E1413 as `loadTexture` does, E1412 when the file holds no table that the engine reads, and E1406 when the readers do not load. |
| `loadJson<T = unknown>(url: string \| URL): Promise<T>` | Downloads a JSON file and parses it. Throws E1411 or E1413 as `loadTexture` does, and E1412 when the file is not valid JSON. |
| `loadBinary(url: string \| URL): Promise<ArrayBuffer>` | Downloads a file as bytes. Throws E1411 or E1413 as `loadTexture` does. |
| `preload(urls: readonly (string \| URL)[]): Promise<void>` | Downloads files ahead of their loads, all at once, and resolves when every one has arrived. The next load of each address takes its file from memory. Pair it with `onProgress` for a loading screen. Throws the error of the first file that fails, as `loadBinary` does. |
| `onProgress(handler: ProgressHandler): () => void` | Calls `handler` each time a download finishes or fails, with the files downloaded so far and the files asked for so far. Loads that take a file that `preload` downloaded count no further. Returns a function that removes the handler. |

### `LoadImageOptions`

Interface `LoadImageOptions`.

The options of `assets.loadImageBitmap`, which decode an image as `loadTexture` would.

| Member | Description |
| --- | --- |
| `colorSpace?: TextureColorSpace` | `srgb` keeps the browser's color management, which converts images with a color profile to sRGB. `linear` turns it off, so data such as normal maps keeps its values. The default is `srgb`. |
| `flipY?: boolean` | True to put the image's top row last, as textures read it. The default is true. |
| `premultipliedAlpha?: boolean` | True to multiply each color by its alpha. The default is false. |

### `LoadTextureOptions`

Interface `LoadTextureOptions`, which extends `TextureOptions`.

The options of `assets.loadTexture`: how the image decodes, and the texture's options. A KTX2 file takes its color space from the file unless `colorSpace` gives one, and its mip levels from the file unless `mipmaps` is false.

| Member | Description |
| --- | --- |
| `flipY?: boolean` | True to put the image's top row at v = 1, the top of a plane, as three.js's `TextureLoader` does. The default is true. glTF textures use false. A KTX2 file keeps the rows as it holds them, its first row at v = 0, as three.js's `KTX2Loader` does: encode it flipped, as `basisu -y_flip` does, for a plane. It takes no `flipY: true`. |
| `premultipliedAlpha?: boolean` | True to store each color multiplied by its alpha, as three.js's `premultiplyAlpha` does. The default is false. A KTX2 file takes no `premultipliedAlpha: true`. |

### `Lut`

Class `Lut`.

A color grading table, which `assets.loadLut` loads from a file. It is a 3D texture that maps each color of the picture to its graded color. Give it to `post.set({ lut })`, which applies it to every pixel after the tone mapping, as three.js's `LUTPass` does.

| Member | Description |
| --- | --- |
| `readonly size: number` | The texels along each side of the table, such as 33 or 65. |
| `readonly title: string \| undefined` | The title that a `.cube` file names, or undefined. |
| `readonly domainMin: LutDomain` | The color that the first texel along each axis stands for: 0 in most files. |
| `readonly domainMax: LutDomain` | The color that the last texel along each axis stands for: 1 in most files. |
| `readonly bytes: number` | The GPU bytes of the table: four for each texel. |
| `destroy(): void` | Frees the table's GPU memory. If `post.set` named the table last, the picture shows without grading from then on. Passing the table to `post.set` afterwards, or destroying it again, throws E1101. |

### `LutDomain`

```ts
type LutDomain = readonly [number, number, number];
```

The colors that a table's first and last texels stand for along each axis: red, green and blue.

### `Prefab`

Class `Prefab`.

A model that `assets.loadGltf` loaded: a template whose meshes, materials and textures exist once, on the GPU. Every copy shares them. `scene.instantiate` creates a copy of its objects. `scene.createInstances` draws many copies with instance batches. A prefab does not change.

| Member | Description |
| --- | --- |
| `readonly url: string` | The address the model was loaded from. |
| `readonly bounds: PrefabBounds` | The bounds of the whole model, around the origin of its copies. |
| `readonly materials: readonly Material[]` | The model's materials, in the file's order. |
| `readonly textures: readonly Texture[]` | The model's textures, in the order the file names their images. |
| `readonly clips: readonly string[]` | The names of the model's clips, which a copy's animator plays. |
| `find(name: string): PrefabNode \| undefined` | The first node with `name`, in the file's order, or undefined when no node has it. The nodes of a copy have the same names, and its `find` gives them. |

### `PrefabBounds`

Interface `PrefabBounds`.

The bounds of a whole model, in the space of its copies' root: a box, and the sphere around the box's center that holds it.

| Member | Description |
| --- | --- |
| `readonly min: readonly [number, number, number]` | The box's lowest corner. |
| `readonly max: readonly [number, number, number]` | The box's highest corner. |
| `readonly center: readonly [number, number, number]` | The box's center. |
| `readonly radius: number` | The radius of the sphere around the center that holds the box. |

### `PrefabNode`

Interface `PrefabNode`.

A node of a prefab: its name, its place relative to its parent, and the mesh and material it draws, if any. `prefab.find` gives it. A mesh with several materials comes as one node per material under its node.

| Member | Description |
| --- | --- |
| `readonly name: string` | The node's name in the file. |
| `readonly position: readonly [number, number, number]` | The position relative to the node's parent. |
| `readonly rotation: readonly [number, number, number, number]` | The rotation relative to the node's parent, as a quaternion (x, y, z, w). |
| `readonly scale: readonly [number, number, number]` | The scale relative to the node's parent. |
| `readonly mesh: MeshGeometry \| undefined` | The node's mesh, which `scene.createMesh` and `scene.createInstances` take too. |
| `readonly material: Material \| undefined` | The node's material. |

### `ProgressHandler`

```ts
type ProgressHandler = (loaded: number, total: number, url: string) => void;
```

Called each time a download finishes or fails. It gets the files downloaded so far, the files asked for so far, and the address of the file that finished.

<!-- null3d:api:end -->
