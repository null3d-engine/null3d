---
id: api/reference/assets
title: "Assets: API reference"
status: generated
since: "0.1"
summary: "Every export of the Assets API, from the engine's doc comments."
---

# Assets: API reference

> [Assets](../assets.md) explains these exports. The engine's doc comments make this page.

## `Assets`

Class `Assets`.

Loads files, and textures from image files. Every call runs outside the sketch's frames, so a frame never waits for a download or a decode. A sketch finds it as `ctx.assets`. Addresses resolve against the page's address.

| Member | Description |
| --- | --- |
| `loadTexture(url: string \| URL, options: LoadTextureOptions = {}): Promise<Texture>` | Downloads an image file or a KTX2 file, decodes it off the sketch's frames, and makes a texture from it. The browser decodes PNG, JPEG, WebP and AVIF files. A KTX2 file of ETC1S or UASTC data becomes the compressed format that the device supports, with the file's mip levels, and UASTC HDR data becomes BC6H or shared-exponent floats. The first KTX2 file loads the transcoder. The engine keeps the transcoded texels in the browser's Cache Storage, so a later load of a file with the same bytes skips the transcoder. Throws E1411 when the file does not download, E1413 when a server of another origin does not allow the page to read it, E1412 when the file does not decode or passes a limit of the engine's (a KTX2 file larger than the device's textures, before it transcodes), E1406 when the transcoder does not load, and E1208 for options the engine does not know. |
| `loadGltf(url: string \| URL, options: LoadGltfOptions = {}): Promise<Prefab>` | Downloads a glTF 2.0 model, a `.glb` file or a `.gltf` file with the files it names, and makes a prefab of it: its meshes, materials, textures, lights and nodes, made once, which `scene.instantiate` copies. A worker parses the file off the sketch's frames, and the first call downloads the loader and its worker. The first file with meshopt compression also downloads the meshopt decoder. The loads count for `onProgress`, the files the model names too, and they take files that `preload` downloaded. Throws E1411 when a file does not download, E1413 when a server of another origin does not allow the page to read it, E1416 for a file that is not a glTF model the engine reads or that passes a limit on what one file may decode to, E1417 for a file that requires an extension the engine does not read, E1412 when an image does not decode, E1109 when a mesh does not fit engine memory, and E1406 when the loader or the meshopt decoder does not download. `options.rewriteUrl` checks the addresses that the file names. |
| `loadImageBitmap(url: string \| URL, options: LoadImageOptions = {}): Promise<ImageBitmap>` | Downloads an image file and decodes it into an `ImageBitmap`, off the sketch's frames. By default it decodes as `loadTexture` does, so `textures.fromImageBitmap` makes the same texture. Throws E1411, E1412 or E1413 as `loadTexture` does. |
| `loadCubemap(urls: readonly (string \| URL)[]): Promise<Cubemap>` | Downloads six images and makes a `Cubemap` from them, a sky box for `scene.setBackground`, as three.js's `CubeTextureLoader` does: the faces toward +X, -X, +Y, -Y, +Z and -Z, in that order, each square and of one size, at most 2,048 pixels a side. The images decode off the sketch's frames and upload in the frames after the call. A cube map does not light the scene: for light, and for a background that blurs, make an environment with `bunx |
| `loadLut(url: string \| URL): Promise<Lut>` | Downloads a color grading table in a `.cube` or a `.3dl` file and makes a `Lut` from it, for `post.set({ lut })`. It reads the forms that three.js's `LUTCubeLoader` and `LUT3dlLoader` read, with tables of 2 to 256 texels a side. A `.cube` file's domain and title come along; a `.3dl` file's values are whole numbers of the depth that its largest value or its `Mesh` line gives. The first table loads the readers. Throws E1411 or E1413 as `loadTexture` does, E1412 when the file holds no table that the engine reads, and E1406 when the readers do not load. |
| `lutFromData(table: LutData): Promise<Lut>` | Makes a color grading table from numbers, for `post.set({ lut })`, as three.js's `LUTPass` takes a `Data3DTexture` that code fills. It takes the numbers in the order of a `.cube` file: three or four per texel, red changing fastest. A file and its numbers make the same table. The first table loads the code that makes it, as `loadLut` does. Throws E1208 when the size is not a whole number from 2 to 256, when `data` does not hold three or four numbers per texel, or holds a number that is not finite, and when a domain is not three numbers whose maximum is above its minimum. Throws E1406 when the code does not load. |
| `loadEnvironment(url: string \| URL): Promise<Environment>` | Downloads an environment and makes an `Environment` from it, for `scene.setEnvironment`. It takes a KTX2 file that `bunx |
| `builtinEnvironment(name: BuiltinEnvironmentName): Promise<Environment>` | Makes a built-in environment: `room`, the room that three.js's `RoomEnvironment` builds, for soft, neutral light with no file of your own. No file downloads: the GPU draws the room into its cube map and filters it for each roughness, as three.js's `PMREMGenerator.fromScene` does. It resolves once the code and the shaders that make the map are ready. The next frame then makes the whole map before it draws, so the first frame with the environment already has its light. That frame takes longer, by the map's GPU time: call it while the scene loads, since a call during play makes one long frame. The first one loads the code that makes it, about 12 KB after Brotli. Throws E1213 for a name that no built-in environment has, and E1406 when its code does not download. |
| `skyEnvironment(): Promise<Environment>` | Makes an environment of the scene's sky, the sky that `scene.setBackground({ sky })` draws, as three.js's `PMREMGenerator.fromScene` makes one from a scene that holds its `Sky`. Light it with `scene.setEnvironment`. The map follows the sky: when the sketch moves the sun or changes the air or the clouds, the map refreshes over the next frames, and no call is needed. Until the scene's first sky background, it shows the sky's defaults. The map leaves out the sun's disc: the scene's directional light gives the sun's own light. The GPU draws the sky into the map and filters it for each roughness, and the CPU works out its diffuse light. It resolves once the code and the shaders that make the map are ready, and the next frame makes the whole map before it draws. The first call loads the code that makes environments, about 12 KB after Brotli. Throws E1406 when that code does not download. |
| `loadJson<T = unknown>(url: string \| URL): Promise<T>` | Downloads a JSON file and parses it. Throws E1411 or E1413 as `loadTexture` does, and E1412 when the file is not valid JSON. |
| `loadBinary(url: string \| URL): Promise<ArrayBuffer>` | Downloads a file as bytes. Throws E1411 or E1413 as `loadTexture` does. |
| `preload(urls: readonly (string \| URL)[]): Promise<void>` | Downloads files ahead of their loads, all at once, and resolves when every one has arrived. The next load of each address takes its file from memory. Pair it with `onProgress` for a loading screen. Throws the error of the first file that fails, as `loadBinary` does. |
| `onProgress(handler: ProgressHandler): () => void` | Calls `handler` each time a download finishes or fails, with the files downloaded so far and the files asked for so far. Loads that take a file that `preload` downloaded count no further. Returns a function that removes the handler. |

## `BuiltinEnvironmentName`

```ts
type BuiltinEnvironmentName = 'room';
```

The names of the built-in environments that `assets.builtinEnvironment` loads. `room` is the room that three.js's `RoomEnvironment` builds, blurred as three.js's examples blur it. It is a white room with six boxes and glowing panels, which gives soft, neutral light.

## `Cubemap`

Class `Cubemap`.

A cube map of six images, which `assets.loadCubemap` loads, for a sky box behind every object: `scene.setBackground(cubemap)`, as three.js's `CubeTextureLoader` makes a `CubeTexture` for `scene.background`. It does not light the scene: light comes from an environment.

| Member | Description |
| --- | --- |
| `readonly size: number` | The width of each face, in texels. |
| `readonly bytes: number` | The GPU bytes of its faces. |
| `destroy(): void` | Frees the faces' GPU memory. If `scene.setBackground` named the cube map last, the view shows the background color from then on. Passing it to `scene.setBackground` afterwards, or destroying it again, throws E1101. |

## `Environment`

Class `Environment`.

An environment map, which `assets.loadEnvironment` and `assets.builtinEnvironment` load. It holds the light around a scene from every direction, filtered for each roughness, and the diffuse light that it gives. Give it to `scene.setEnvironment`, which lights standard materials with it, as three.js's `scene.environment` does with a texture from `PMREMGenerator`.

| Member | Description |
| --- | --- |
| `readonly size: number` | The width of the largest faces of its cube map, in texels. |
| `readonly levels: number` | The mip levels of its cube map: one for each roughness step, from a mirror up. |
| `readonly format: EnvironmentFormat` | How its cube map stores its texels. |
| `readonly bytes: number` | The GPU bytes of its cube map, with every mip level. |
| `destroy(): void` | Frees the cube map's GPU memory. If `scene.setEnvironment` named the environment last, the scene shows without it from then on. Passing it to `scene.setEnvironment` afterwards, or destroying it again, throws E1101. |

## `EnvironmentFormat`

```ts
type EnvironmentFormat = 'rgb9e5ufloat' | 'rgba16float';
```

The texel format of an environment map: `rgb9e5ufloat`, three 9-bit values with a shared exponent in 4 bytes, or `rgba16float`, four half floats in 8 bytes.

## `LoadGltfOptions`

Interface `LoadGltfOptions`.

The options of `assets.loadGltf`.

| Member | Description |
| --- | --- |
| `rewriteUrl?: (address: URL) => URL \| string \| null` | Checks or changes each address that the file names, for a buffer or an image, before it downloads. It gets the address resolved against the file's own, and returns the address to download, or null to refuse the file with E1416. A model that a user uploads can name any address, which the page then requests with its cookies, so a page that loads such models should allow only the addresses it expects. three.js's `LoadingManager.setURLModifier` does the same for its loaders. |

## `LoadImageOptions`

Interface `LoadImageOptions`.

The options of `assets.loadImageBitmap`, which decode an image as `loadTexture` would.

| Member | Description |
| --- | --- |
| `colorSpace?: TextureColorSpace` | `srgb` keeps the browser's color management, which converts images with a color profile to sRGB. `linear` turns it off, so data such as normal maps keeps its values. The default is `srgb`. |
| `flipY?: boolean` | True to put the image's top row last, as textures read it. The default is true. |
| `premultipliedAlpha?: boolean` | True to multiply each color by its alpha. The default is false. |

## `LoadTextureOptions`

Interface `LoadTextureOptions`, which extends `TextureOptions`.

The options of `assets.loadTexture`: how the image decodes, and the texture's options. A KTX2 file takes its color space from the file unless `colorSpace` gives one, and its mip levels from the file unless `mipmaps` is false.

| Member | Description |
| --- | --- |
| `flipY?: boolean` | True to put the image's top row at v = 1, the top of a plane, as three.js's `TextureLoader` does. The default is true. glTF textures use false. A KTX2 file keeps the rows as it holds them, its first row at v = 0, as three.js's `KTX2Loader` does: encode it flipped, as `basisu -y_flip` does, for a plane. It takes no `flipY: true`. |
| `premultipliedAlpha?: boolean` | True to store each color multiplied by its alpha, as three.js's `premultiplyAlpha` does. The default is false. A KTX2 file takes no `premultipliedAlpha: true`. |

## `Lut`

Class `Lut`.

A color grading table, which `assets.loadLut` loads from a file and `assets.lutFromData` makes from numbers. It is a 3D texture that maps each color of the picture to its graded color. Give it to `post.set({ lut })`, which applies it to every pixel after the tone mapping, as three.js's `LUTPass` does.

| Member | Description |
| --- | --- |
| `readonly size: number` | The texels along each side of the table, such as 33 or 65. |
| `readonly title: string \| undefined` | The title that a `.cube` file or `lutFromData` names, or undefined. |
| `readonly domainMin: LutDomain` | The color that the first texel along each axis stands for: 0 in most files. |
| `readonly domainMax: LutDomain` | The color that the last texel along each axis stands for: 1 in most files. |
| `readonly bytes: number` | The GPU bytes of the table: four for each texel. |
| `destroy(): void` | Frees the table's GPU memory. If `post.set` named the table last, the picture shows without grading from then on. Passing the table to `post.set` afterwards, or destroying it again, throws E1101. |

## `LutData`

Interface `LutData`.

A color grading table's size and colors for `assets.lutFromData`, in the order of a `.cube` file's lines.

| Member | Description |
| --- | --- |
| `size: number` | The texels along each side of the table, a whole number from 2 to 256. |
| `data: Float32Array \| Float64Array \| readonly number[]` | The graded color of each texel: three numbers per texel, red, green and blue, or four, whose fourth the table skips. Red changes fastest, then green, then blue, as in a `.cube` file. The texel at red r, green g and blue b stands for the color (r, g, b) / (size - 1) of the domain. Values are display colors from 0 to 1, and values outside that range are clamped. |
| `domainMin?: LutDomain` | The color that the first texel along each axis stands for. The default is [0, 0, 0]. |
| `domainMax?: LutDomain` | The color that the last texel along each axis stands for. The default is [1, 1, 1]. |
| `title?: string` | A name for the table, which becomes its `title`. |

## `LutDomain`

```ts
type LutDomain = readonly [number, number, number];
```

The colors that a table's first and last texels stand for along each axis: red, green and blue.

## `Prefab`

Class `Prefab`.

A model that `assets.loadGltf` loaded: a template whose meshes, materials and textures exist once, on the GPU. Every copy shares them. `scene.instantiate` creates a copy of its objects. `scene.createInstances` draws many copies with instance batches. A prefab does not change until `destroy` frees it.

| Member | Description |
| --- | --- |
| `readonly url: string` | The address the model was loaded from. |
| `readonly bounds: PrefabBounds` | The bounds of the whole model, around the origin of its copies. |
| `readonly materials: readonly Material[]` | The model's materials, in the file's order. |
| `readonly textures: readonly Texture[]` | The model's textures, in the order the file names their images. |
| `destroy(): void` | Destroys the model, like calling three.js's `dispose()` on each geometry, material and texture of a loaded glTF scene. It frees the GPU memory and the engine data of every mesh, material and texture that the load made, and of its skeleton and animation clips. Destroy the copies that `scene.instantiate` and `scene.createInstances` made first, and the objects that use one of its meshes or materials, in the same frame or before. Throws E1111 while one still does, and E1101 for a model that is destroyed already. Materials of your own that map one of the model's textures draw with their colors alone afterwards. Later calls that pass the model throw E1101. |
| `readonly clips: readonly string[]` | The names of the model's clips, which a copy's animator plays. |
| `find(name: string): PrefabNode \| undefined` | The first node with `name`, in the file's order, or undefined when no node has it. The nodes of a copy have the same names, and its `find` gives them. |

## `PrefabBounds`

Interface `PrefabBounds`.

The bounds of a whole model, in the space of its copies' root: a box, and the sphere around the box's center that holds it.

| Member | Description |
| --- | --- |
| `readonly min: readonly [number, number, number]` | The box's lowest corner. |
| `readonly max: readonly [number, number, number]` | The box's highest corner. |
| `readonly center: readonly [number, number, number]` | The box's center. |
| `readonly radius: number` | The radius of the sphere around the center that holds the box. |

## `PrefabNode`

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
| `readonly occluder: boolean` | True when the asset tool gave the node's mesh a blocker, so its copies block the view. Pass it as `createMesh`'s `occluder` option to keep the tool's choice for a mesh made from the node. |

## `ProgressHandler`

```ts
type ProgressHandler = (loaded: number, total: number, url: string) => void;
```

Called each time a download finishes or fails. It gets the files downloaded so far, the files asked for so far, and the address of the file that finished.
