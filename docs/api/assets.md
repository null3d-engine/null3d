---
id: api/assets
title: Assets
status: experimental
since: "0.1"
summary: "loadGltf, registerGltfExtension, loadTexture, loadImageBitmap, loadLut, lutFromData, loadEnvironment, builtinEnvironment, skyEnvironment, loadCubemap, loadLightProbeGrid, loadLightMap, lightProbeGridFile, loadJson, loadBinary, preload, onProgress."
---

# Assets

> Roadmap step 0.1, first released in null3D 0.1.0. Step 0.2 adds glTF models, color grading tables and environments. The API is experimental, so it can still change between versions.

The `assets` object of the sketch context downloads files and decodes them. Every call returns a promise, and its download and decode run outside the sketch's frames, so a frame never waits for them. The browser decodes images off the main thread.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ assets, page }) => {
  assets.onProgress((loaded, total) => page.post('loading', Math.min(1, loaded / Math.max(total, loaded))));
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
| `registerGltfExtension(handler)` | A function that unregisters the handler. The loader draws the primitives of the extension through it: [Extensions that add-ons read](#extensions-that-add-ons-read) |
| `loadTexture(url, options)` | A texture from a PNG, JPEG, WebP or AVIF file, or a KTX2 file of ETC1S, UASTC or UASTC HDR data, in the compressed format that the device supports. [Textures](textures.md) lists its options. |
| `loadImageBitmap(url, options)` | A decoded `ImageBitmap`, flipped for textures by default, as `loadTexture` decodes it |
| `loadLut(url)` | A color grading table from a `.cube` or a `.3dl` file, for `post.set({ lut })`. [Color grading tables](#color-grading-tables) says what it reads |
| `lutFromData({ size, data })` | A color grading table made from numbers in code, with no file. [Tables from numbers](#tables-from-numbers) says what it takes |
| `loadEnvironment(url)` | An `Environment` for `scene.setEnvironment`, from a file of `bunx @null3d/cli assets env` or from an HDR file: Radiance (`.hdr`) or OpenEXR (`.exr`). [Environments](#environments) says what it reads |
| `builtinEnvironment('room')` | The built-in room, the scene of three.js's `RoomEnvironment`, as an `Environment` |
| `skyEnvironment()` | The light of the scene's sky, as an `Environment` that follows the sky background |
| `loadCubemap(urls)` | A `Cubemap` of six images, a sky box for `scene.setBackground`. [Cube maps](#cube-maps) says what it reads |
| `loadLightProbeGrid(url)` | A probe grid baked outside the engine, as the options that `scene.setLightProbeGrid` takes. [Baked light](#baked-light) says what it reads |
| `loadLightMap(url)` | A light map baked outside the engine, as a texture for a material's `lightMap` and the light's direction at each texel |
| `lightProbeGridFile(grid)` | The bytes of the baked light file of a grid that `bakeProbes` made |
| `loadJson(url)` | The file parsed as JSON |
| `loadBinary(url)` | The file's bytes, as an `ArrayBuffer` |
| `preload(urls)` | Nothing: it downloads the files ahead of their loads |
| `onProgress(handler)` | A function that removes the handler |

## glTF models

`loadGltf` loads a glTF 2.0 model. It reads a `.glb` file, or a `.gltf` file with the buffers and images it names. It returns a `Prefab`, a template of the file's objects. The prefab makes each mesh, material and texture of the file once, and every copy of the model shares them. Then [`scene.instantiate`](scene.md#models-and-copies) creates a copy of its objects, or `scene.createInstances` draws many copies with instance batches. The [glTF model demo](https://github.com/null3d-engine/null3d/tree/main/examples/gltf-model) loads one and lights it with the built-in room.

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

A model that the tool wrote with `--stages` holds its coarsest level. Each finer level downloads from a file of its own. `loadGltf` returns once the coarse level is ready. The copies that you make then refine as the finer levels arrive. The loader holds back a level that the camera never draws, and fetches it once the camera comes close enough to show it. So a page downloads the levels that its camera shows, and no others. `maxLevels` sets the most levels to load, the file's own counted first. Set 1 to draw the coarse level alone and download no stage. [Levels of detail](../concepts/lod.md#levels-from-the-asset-tool) explains the files.

A worker parses the file outside the sketch's frames, and decodes the images that the file holds there. The first `loadGltf` call downloads the loader and its worker, about 15 KB after Brotli, so a page without glTF files downloads neither. The files that a `.gltf` file names download through `assets`, so `preload` and `onProgress` cover them too. The engine copies the vertex data into its own memory, and keeps no other copy of it.

The `assets` API itself loads with its first call too, so a page that loads no file downloads none of it. Every call answers once that code has arrived. Two calls answer with a function of their own, `onProgress` and `registerGltfExtension`, so they answer at once and register the handler when it arrives.

The prefab turns each part of the file into the engine's own:

| In the file | In the engine |
| --- | --- |
| A node | A `Group`, or a `Mesh` for a node with a mesh of one material. A node with lights or a mesh of several materials becomes a group with one object for each |
| A mesh | One mesh for each material, with its vertex arrays in the types that the file holds them in, `KHR_mesh_quantization` types included. Points and lines are left out; development builds warn about them |
| A material | `materials.standard`, or `materials.unlit` with `KHR_materials_unlit`. `KHR_materials_emissive_strength` sets `emissiveIntensity`. `KHR_materials_specular` sets `specularIntensity`, `specularColor` and their maps, and `KHR_materials_ior` sets `ior`, as three.js's `GLTFLoader` sets them on a `MeshPhysicalMaterial`. An `ior` of 0 becomes 1000, as in three.js. `KHR_materials_transmission` sets `transmission`, and `KHR_materials_volume` sets `thickness`, `attenuationColor` and `attenuationDistance` ([Transmission](materials.md#transmission)). Their transmission and thickness textures load into `transmissionMap` and `thicknessMap`; a masked material keeps its transmission, so its cut-out decides which pixels draw and the light from behind fills the rest. A material that also gives specular textures keeps those, which the transmission textures would displace; a layered material keeps each transmission texture unless a layer map fills the same slot, and the loader notes the one that stays out. `KHR_materials_diffuse_transmission` sets `diffuseTransmission`, `diffuseTransmissionColor` and their maps ([Light through thin surfaces](materials.md#light-through-thin-surfaces)), with the volume's values too. Such a material leaves out its specular maps, and transmission wins over it. `KHR_materials_clearcoat` sets `clearcoat`, `clearcoatRoughness`, `clearcoatNormalScale` and their maps, and `KHR_materials_sheen` sets `sheenColor`, `sheenRoughness` and their maps ([Clear coat and sheen](materials.md#clear-coat-and-sheen)). `KHR_materials_iridescence` sets `iridescence`, `iridescenceIor`, `iridescenceThicknessRange` and their maps, and `KHR_materials_anisotropy` sets `anisotropy`, `anisotropyRotation` and its map ([Iridescence and anisotropy](materials.md#iridescence-and-anisotropy)). A layered material goes without its specular textures and its diffuse transmission, and a coat roughness or sheen roughness texture that is not the texture of its pair is not drawn. The coat's and the sheen's textures keep their places ahead of the iridescence's and the anisotropy's, whose textures are then noted. The draft `KHR_materials_volume_scatter` sets `subsurfaceRadius` and `subsurfaceColor` ([Light under the surface](materials.md#light-under-the-surface)): each channel spreads `attenuationDistance` times its `multiscatterColor`, as the Khronos sample renderer finds it. A volume without an attenuation distance spreads no light, and `scatterAnisotropy` is not drawn |
| A texture | A texture with the file's sampler and texture coordinates. `KHR_texture_basisu` textures load through the KTX2 transcoder |
| `EXT_texture_webp`, `EXT_texture_avif` | The texture's WebP or AVIF image, which the browser decodes in the loader's worker. A texture with a KTX2 image takes that first, then WebP, then AVIF. The texture's own image is a fallback for other loaders, and the engine does not download or decode it |
| `KHR_texture_transform` | Each map's own transform, in the material's `mapUvTransforms`: its offset, repeat and rotation. A map that the file gives no transform reads the texture coordinates as the mesh gives them |
| `KHR_lights_punctual` | Directional, point and spot lights, in the units of glTF and three.js |
| `KHR_node_visibility` | A node that the file hides draws nothing until a clip shows it |
| `NEEDLE_lightmaps`, `NEEDLE_components` | The light map that a node's Needle `MeshRenderer` names, on the material that draws the node: its radiance, read at the second texture coordinates, and the scale and offset that place it. The texture keeps its RGBM texels, which the material decodes as [Needle's viewer](../guides/baked-light-data.md#needle-light-maps) does. A skybox or reflection entry of the extension is left out |
| `KHR_animation_pointer` | Property tracks of a clip, which move a light's intensity, color or range, a material's values, the offset and scale of a base color or emissive texture's transform, and a node's visibility. A pointer the engine does not read leaves its value as the file has it, and development builds warn: [Property animation](animation.md#property-animation) |
| `EXT_mesh_gpu_instancing` | An instance batch for each copy, in `instance.batches` |
| A skin | Joints of the model's skeleton, which every copy's [animator](animation.md#models-from-gltf-files) poses. Joints are not objects. A skinned mesh goes in the copy's group |
| An animation | A clip that a copy's animator plays, with linear, step and cubic spline keys. The job workers resample it while `loadGltf` waits |
| A morph target | A morph target of the mesh, with the file's default weights. Clips that animate the weights play through the animator: [Morph targets](animation.md#morph-targets) |
| `KHR_meshopt_compression`, `EXT_meshopt_compression` | The decoded vertex and index data, as the uncompressed file holds it. The first file with meshopt data downloads the decoder, about 6 KB after Brotli. A fallback buffer never downloads |
| `KHR_draco_mesh_compression` | The decoded vertices and triangles. Normals and tangents become 8-bit integers, and texture coordinates between 0 and 1 become 16-bit integers. The first file with Draco data downloads Draco's decoder, about 60 KB after Brotli. Development builds warn about each such file and name the command that converts it to meshopt |

Materials follow three.js's `GLTFLoader`. A mesh with vertex colors turns them on, and a mesh without normals shades flat. A mesh without tangents turns the normal map's green channel over. Blended materials write no depth. The engine finds the lights near each surface by their ranges. So a point or spot light without a range ends where its light falls below 0.001 lux.

| Member | Gives |
| --- | --- |
| `prefab.find(name)` | The first node with the name: its `position`, `rotation`, `scale`, `mesh`, `material` and `occluder`. `occluder` is true when the asset tool gave the mesh a blocker. Pass it to `createMesh` to keep that choice |
| `prefab.bounds` | `min`, `max`, `center` and `radius` of the whole model, around the origin of its copies |
| `prefab.materials` | The file's materials, in the file's order. `set` changes them in every copy |
| `prefab.textures` | The textures that the materials sample |
| `prefab.clips` | The names of the model's clips, which a copy's animator plays |
| `prefab.url` | The address the model came from |
| `prefab.destroy()` | Frees the model: [Freeing a model](#freeing-a-model) |

### Freeing a model

`prefab.destroy()` frees a model that the scene no longer needs. It frees every mesh, material and texture that the load made, and the model's skeleton and clips. First destroy the copies that `scene.instantiate` made and the batches of `scene.createInstances`. They can go in the same frame, just before the model:

```ts
for (const copy of levelCopies) copy.destroy();
level.destroy();
const next = await assets.loadGltf('/levels/two.glb');
```

The next model takes the memory that the old one gave back, so a game that loads and drops levels keeps the same memory. While an object or batch still uses one of the model's meshes or materials, or plays its clips, `destroy` throws [E1111](../errors/E1111.md) and keeps the model. That covers objects of your own that you made with a mesh or material from `prefab.find`. Your own materials that map one of the model's textures draw with their colors alone after it. Calls that pass a destroyed model throw [E1101](../errors/E1101.md).

A load that fails frees everything that it made before the failure.

## Extensions that add-ons read

An add-on can read a glTF extension that the engine leaves out. It registers a handler before it loads a model. The loader then hands each primitive that carries one of the handler's extensions to the handler. The handler returns the meshes and materials that draw the primitive, and they join the model.

```ts
// A handler draws a marker at each primitive that carries the example extension.
const remove = assets.registerGltfExtension({
  extensions: ['EXT_example_marker'],
  load(data, makers) {
    const mesh = makers.geometry.box();
    const material = makers.materials.unlit({ color: [1, 0.6, 0] });
    return { mesh, material };
  },
});
remove(); // the handler reads no more files
```

`registerGltfExtension(handler)` returns a function that unregisters the handler. Two handlers cannot read one extension. The call throws [E1213](../errors/E1213.md) for that case, for a handler that names no extension, and for a handler without a `load` function.

An add-on registers its own handler as its module loads, with the engine's `registerGltfExtension`,
which serves every sketch of the thread. A page that imports the add-on then loads the add-on's
files with no other call, and a file that requires the extension names the package to import instead
of failing with E1417. `@null3d/splats` reads `KHR_gaussian_splatting` this way. A handler that a
sketch registers with `assets.registerGltfExtension` for the same extension reads its files in the
add-on's place.

The loader calls `load` once for each primitive that carries one of the handler's extensions. It gets `data`, which describes the primitive, and `context`, which holds the engine's makers:

| Member | Gives |
| --- | --- |
| `data.extension` | The extension's name |
| `data.json` | The extension's JSON, as the file gives it |
| `data.node` | The node's `name`, `position`, `rotation` and `scale` |
| `data.primitive.attributes` | Every attribute as a `Float32Array`, by its glTF name. The loader reads names that the engine does not know, such as `KHR_gaussian_splatting:ROTATION` |
| `data.primitive.count` | The number of elements in each attribute |
| `data.primitive.indices` | The primitive's indices, or undefined |
| `data.primitive.mode` | glTF's mode: 0 for points, 4 for triangles |
| `data.primitive.material` | The material that the file gives the primitive, or undefined |
| `context.geometry` | The engine's `geometry`, for the meshes that the handler returns |
| `context.materials` | The engine's `materials`, for the materials that the handler returns |

`load` returns one part, a list of parts, or nothing, which draws nothing. A part is `{ mesh, material }`. The loader places the parts at the primitive's node, so copies of the model draw them, and `prefab.destroy()` frees them. A primitive that a handler claims draws only what the handler returns. The other primitives of the same mesh draw as usual. `load` may return a promise.

A file that requires an extension which an add-on reads loads with that add-on's handler. Without it, the load fails with [E1417](../errors/E1417.md), and the message names the package to import. For example, the message for `KHR_gaussian_splatting` names `@null3d/splats`. A file that only uses such an extension, and does not require it, draws without that extension's data when no handler reads it.

## Color grading tables

`loadLut` reads the two forms that three.js's `LUTCubeLoader` and `LUT3dlLoader` read, with tables of 2 to 256 texels a side. The table becomes a 3D texture of 4 bytes per texel: 144 KB for a table of 33, and 1.1 MB for one of 65.

- A `.cube` file gives `LUT_3D_SIZE`, and the table's values from 0 to 1, red changing fastest. Its `TITLE` becomes the table's `title`. Its domain comes from `DOMAIN_MIN` and `DOMAIN_MAX`, or from DaVinci Resolve's `LUT_3D_INPUT_RANGE`, and becomes `domainMin` and `domainMax`. A table in 1D (`LUT_1D_SIZE`) fails with E1412.
- A `.3dl` file gives whole numbers, blue changing fastest, after an optional line of its input grid, such as `0 64 128 ... 1023`. The grid's points may differ from even steps by one, as rounding leaves them, which three.js's loader refuses. The values' bit depth comes from a Lustre `Mesh` line, or else from the largest value.
- Values outside 0 to 1 are clamped, as the canvas would clamp them.
- The first table loads the readers, a file of about 2 KB. The thread that runs the sketch reads the file between frames: a table of 33 takes about 10 ms on a desktop.

`lut.destroy()` frees the table's GPU memory. Give `post.set` a table that lives.

### Tables from numbers

`lutFromData` makes a table from numbers that your code computes, as three.js's `LUTPass` takes a `Data3DTexture` that code fills. It takes the numbers in the order of a `.cube` file's lines, so a file and its numbers make the same table:

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ assets, post }) => {
  // A warm grade: more red and less blue, 17 texels a side.
  const size = 17;
  const data = new Float32Array(size ** 3 * 3);
  let at = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        data[at++] = (r / (size - 1)) * 1.05;
        data[at++] = g / (size - 1);
        data[at++] = (b / (size - 1)) * 0.9;
      }
  post.set({ lut: await assets.lutFromData({ size, data }) });
  return {};
});
```

| Field | Values | Default |
| --- | --- | --- |
| `size` | The texels along each side, a whole number from 2 to 256. | Required |
| `data` | A `Float32Array`, a `Float64Array` or an array of numbers. It holds three numbers per texel, red, green and blue, or four, whose fourth the table skips. Red changes fastest, then green, then blue. The texel at red r, green g and blue b stands for the color (r, g, b) / (size - 1) of the domain. | Required |
| `domainMin`, `domainMax` | The colors that the first and the last texel along each axis stand for, as a `.cube` file's `DOMAIN_MIN` and `DOMAIN_MAX`. | `[0, 0, 0]` and `[1, 1, 1]` |
| `title` | A name, which becomes the table's `title`. | None |

- The values are display colors from 0 to 1. Values outside that range are clamped, as in a file. Divide 8-bit values by 255 first.
- The table becomes the same 3D texture of 4 bytes per texel that `loadLut` makes.
- The first table loads the code that makes it, the same file of about 2 KB that `loadLut` loads. The call's promise resolves once the texels are in engine memory, as `loadLut`'s does.
- Input that makes no table throws [E1208](../errors/E1208.md), and the message names the fault. That is a size outside 2 to 256, or data without three or four numbers per texel. It is also a number that is not finite, or a domain whose maximum is not above its minimum.

## Environments

`loadEnvironment` reads two kinds of file:

- The KTX2 file that `bunx @null3d/cli assets env` writes, the fast path. It holds a cube map in `rgb9e5ufloat` or `rgba16float`, with one mip level for each step of roughness. It also holds the nine coefficients of its diffuse light.
- An HDR file of an equirectangular panorama, as three.js's `HDRLoader` and `EXRLoader` read it: a Radiance file (`.hdr`) or an OpenEXR file (`.exr`). The engine filters it on the GPU at load, with the asset tool's steps, as three.js's `PMREMGenerator.fromEquirectangular` does.

`builtinEnvironment('room')` makes the room that three.js's `RoomEnvironment` builds. `skyEnvironment()` makes the light of the sky that [`scene.setBackground({ sky })`](scene.md#environments-cube-maps-and-the-sky) draws, as three.js's `PMREMGenerator.fromScene` does with its `Sky`. The GPU draws each of them and filters it, so no file downloads. Give any of them to [`scene.setEnvironment`](scene.md#the-environment).

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, assets }) => {
  const [room, sunset, studio] = await Promise.all([
    assets.builtinEnvironment('room'),
    assets.loadEnvironment('/env/sunset.ktx2'),
    assets.loadEnvironment('/hdri/studio_2k.hdr'),
  ]);
  scene.setEnvironment(sunset, { intensity: 1.2 });
  return {};
});
```

- An `Environment` has its cube map's `size`, the width of the largest faces, its `levels`, its `format` and its GPU `bytes`.
- The first environment file loads the file reader, under 1 KB after Brotli. The first built-in room or sky's environment loads the code and the shaders that make it on the GPU, about 12 KB after Brotli. [Lighting and environment](../concepts/lighting.md#cost) gives the GPU's time.
- A KTX2 file's cube map uploads in the frames after the load, and the scene draws without it until it is on the GPU.
- A worker reads an HDR file, outside the sketch's frames. The first one loads the reader and its worker, about 6.5 KB after Brotli. It also loads the code and shaders that make the room, which filter the file. They start at the call for an address that ends in `.hdr` or `.exr`, so they load during the download. The call resolves once the file is read and those shaders are ready. The GPU then filters the whole map in the next frame, before that frame draws. So no frame draws the scene without its light. Load HDR files while the scene loads.
- An HDR map has faces of 256 texels, as the asset tool's default. An image wider than 2,048 texels becomes the averages of squares of its texels first. An unclipped sun, or other light beyond 65,408, keeps its share of the rough levels and the diffuse light. Only the sharpest level stops at 65,408, as in the tool's files.
- The OpenEXR reader reads single-part files of scanlines with R, G and B channels, as half floats, floats or whole numbers. It reads every compression but DWAA and DWAB: none, RLE, ZIPS, ZIP, PIZ, PXR24, B44 and B44A. Tiled, deep and multi-part files fail with E1412, as do Radiance files stored from the bottom row up.
- `builtinEnvironment` resolves once the code and the shaders that make the room are ready. The GPU then makes the whole map in the next frame, before that frame draws. So the first frame with the room already has its light. That frame takes longer by the map's GPU time: about 20 ms on a MacBook Pro, and 50 to 110 ms on recent phones. Ask for the room while the scene loads. During play, the call makes one long frame.
- `skyEnvironment` loads the same code and shaders as the room, and resolves once they are ready. The next frame makes the whole map, in about 10 ms on a MacBook Pro. Until the scene's first sky background, the map shows the sky's defaults.
- The sky's map follows the sky. After a change that shows, the map refreshes in 20 stages, one a frame. A sun that turns less than half a degree leaves the map as it is, and so does a color value that drifts by less than 2%. Slowly drifting clouds wait too, and their changes add up. One last refresh captures the sky exactly once it stops changing. The scene draws with the old map until the last stage. Each stage takes about 1 ms of GPU time on a MacBook Pro. The map leaves out the sun's disc, whose light the scene's directional light gives. [Lighting and environment](../concepts/lighting.md#sky-and-backgrounds) gives the detail.
- `environment.destroy()` frees the cube map's GPU memory. The scene then draws without it.
- Other KTX2 files, such as `loadTexture`'s, fail with E1412. So do supercompressed files.
- The tool's file needs no reading or filtering at load, so prefer it for maps that ship with a game. HDR files suit maps that change, such as files that users upload. The tool's file is not always the smaller download. After Brotli, Venice Sunset's 2K Radiance file takes 3.8 MB and its map 1.4 MB. A 1K OpenEXR file and its map take about 1.3 MB each.

[Lighting and environment](../concepts/lighting.md#environment-maps) says how an environment lights the scene.

## Cube maps

`loadCubemap` loads six images into a cube map, as three.js's `CubeTextureLoader` does. Give their addresses in three.js's order: the faces toward +X, -X, +Y, -Y, +Z and -Z. Each face is square, every face has the same size, and a face takes at most 2,048 pixels a side. Give the cube map to [`scene.setBackground`](scene.md#environments-cube-maps-and-the-sky).

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, assets }) => {
  const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((face) => `/sky/${face}.jpg`);
  scene.setBackground(await assets.loadCubemap(faces), { rotation: [0, Math.PI, 0] });
  return {};
});
```

- The images decode off the sketch's frames, as `loadTexture`'s do, with their first row at the top of each face. Each face keeps the sRGB colors of its image.
- The faces upload in the frames after the load. The view shows the background color until they are on the GPU.
- A `Cubemap` has its faces' `size` and its GPU `bytes`. `cubemap.destroy()` frees its GPU memory, and the view then shows the background color.
- A cube map does not light the scene, and it does not blur. For both, load an environment from an HDR or EXR image with `loadEnvironment`.
- Faces that are not square, or not of one size, fail with E1412. So does an image that does not decode. A list that does not hold six addresses fails with E1208.

## Baked light

`loadLightProbeGrid` reads a probe grid that a tool outside the engine baked. It gives the texture and the three placement values that [`scene.setLightProbeGrid`](scene.md#the-light-probe-grid) takes. `loadLightMap` reads a light map. It gives a texture for a material's `lightMap`, and the light's direction at each texel. `lightProbeGridFile` writes the file of a grid that `bakeProbes` made. The engine's own bake and a bake elsewhere therefore give one format.

Both readers take the same JSON format, which [Baked light data](../guides/baked-light-data.md) describes with a complete file of each kind. Its base64 payloads hold the texels, so a bake tool in any language can write it.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, assets, materials }) => {
  scene.setLightProbeGrid(await assets.loadLightProbeGrid('/light/probe-grid.json'));
  const map = await assets.loadLightMap('/light/light-map.json');
  materials.standard({ lightMap: map.texture });
  return {};
});
```

The first load of either kind loads the reader, about 2 KB after Brotli. A file that the engine cannot read rejects with [E1434](../errors/E1434.md), and the message names the fault.

## Addresses

A relative address resolves against the page's address, in every thread mode, as it would in a page's own script. So `assets.loadTexture('tex/bricks.png')` on `https://example.com/game/` loads `https://example.com/game/tex/bricks.png`. An address from `new URL('./bricks.png', import.meta.url)` resolves against the sketch module instead, and Vite then ships the file with the build.

## Loading screens

`preload` downloads files ahead of the loads that use them, all at once, and resolves when every file has arrived. The next load of each address takes its file from memory, so it downloads nothing. The files wait in memory until then.

`onProgress` calls its handler as a download's bytes arrive and when one finishes or fails, with two counts: the bytes downloaded so far and the bytes expected so far, which are the lengths of the responses that gave one and 0 while none has. A response with no length still counts its bytes into the first count, so a page draws `Math.min(1, loaded / Math.max(total, loaded))`. A download that fails counts as finished too, so a loading bar reaches its end: it counts the bytes its response announced, or one byte when it announced none. Each call names the address whose bytes moved.

```ts
assets.onProgress((loaded, total, url) => page.post('loading', { loaded, total, url }));
await assets.preload(['/tex/a.png', '/tex/b.png', '/tex/c.png']);
// The handler gets each file's bytes as they arrive: (40_000, 120_000) while a.png downloads, then
// (120_000, 120_000) as the last of the three arrives.
```

[Loading screens and warm-up](../guides/loading-screens.md) shows a whole loading screen.

## Caching

Loads of one address at the same time share one download. Files that `preload` downloaded wait in memory until a load takes them. The HTTP cache keeps everything else, as it does for a page's own requests, so three.js's `THREE.Cache` has no counterpart.

A game that plays with no network caches its files and the engine's in its own service worker, as [Hosting](../getting-started/hosting.md#offline-play) shows.

## Errors

Each call rejects with an engine error that says how to fix the problem:

| Code | When |
| --- | --- |
| [E1411](../errors/E1411.md) | The file did not download: the server answered with an error, such as 404, or the network failed |
| [E1412](../errors/E1412.md) | The file downloaded, but the browser could not decode the image, the file was not a KTX2 file that the engine loads, the file was not valid JSON, it held no color grading table that the engine reads, or it was not an environment map of `bunx @null3d/cli assets env`. A KTX2 file also fails before it transcodes when it passes a limit, such as a side larger than `textures.maxSize` |
| [E1416](../errors/E1416.md) | `loadGltf` got a file that is not a glTF 2.0 model it can read: broken JSON, an offset or a count past the data, a missing buffer or image, or a loop of nodes. Or its Draco data does not decode to what its accessors say. Or the file passes a limit on what one file may decode to, as [Assets and prefabs](../concepts/assets.md#limits-on-each-file) lists |
| [E1109](../errors/E1109.md) | `loadGltf` made a mesh too large for engine memory |
| [E1417](../errors/E1417.md) | `loadGltf` got a file that requires an extension the engine does not read |
| [E1434](../errors/E1434.md) | `loadLightProbeGrid` or `loadLightMap` got a file that is not a baked light file that the engine reads: a wrong version, a count that does not match its payload, or text that stopped early |
| [E1406](../errors/E1406.md) | The files of the KTX2 transcoder, the glTF loader or its decoders, the table makers, the environment map reader or the baked light reader did not download, when the first such file, table or grid loads |
| [E1213](../errors/E1213.md) | `builtinEnvironment` got a name that no built-in environment has |
| [E1413](../errors/E1413.md) | A file from another origin, whose server did not allow the page to read it |
| [E1208](../errors/E1208.md) | A texture option that the engine does not know, or one that a KTX2 file cannot take. Also numbers that `lutFromData` cannot make a table from |

`preload` rejects with the error of the first file that fails. The files that arrived stay in memory, and a later load of the failed file tries again.

## Models that users upload

A model file can name any address for its buffers and images, and the page downloads them with its cookies. A file from a user could name an address of your own API. So a page that loads such models should check each address with the `rewriteUrl` option of `loadGltf`. It gets each address that the file names, resolved, and returns the address to download, or null to refuse the file with E1416.

```ts
// sketch.ts: models from users may name only files beside them
const allowed = new URL('/uploads/', location.href);
const model = await assets.loadGltf(upload, {
  rewriteUrl: (address) => (address.href.startsWith(allowed.href) ? address : null),
});
```

Every loader also checks each file's limits before it allocates, as [Assets and prefabs](../concepts/assets.md#limits-on-each-file) lists. So a broken or hostile file fails with its code, and does not fill the tab's memory.

## Files from other origins

The browser reads a file from another origin, such as a CDN, only when its server allows the page's origin with an `Access-Control-Allow-Origin` header. The engine downloads with `fetch`, so the file needs that header on every page, threaded or not. [Hosting](../getting-started/hosting.md) covers the headers.

## API reference

[The API reference](reference/assets.md) lists every export of this page with its type and description. The engine's doc comments make it.
