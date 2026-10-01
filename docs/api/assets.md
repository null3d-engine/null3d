---
id: api/assets
title: Assets
status: experimental
since: "0.1"
summary: "loadTexture, loadImageBitmap, loadJson, loadBinary, preload, onProgress; glTF models and environments."
---

# Assets

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Models and environments are not built yet: `assets.loadGltf`, `loadEnvironment`, `builtinEnvironment`, `loadCubemap`, `loadLut` and prefabs. Coding agents must not use them.

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
| `loadTexture(url, options)` | A texture from a PNG, JPEG or WebP file, an AVIF file where the browser decodes AVIF, or a KTX2 file of ETC1S or UASTC data, in the compressed format that the device supports. [Textures](textures.md) lists its options. |
| `loadImageBitmap(url, options)` | A decoded `ImageBitmap`, flipped for textures by default, as `loadTexture` decodes it |
| `loadJson(url)` | The file parsed as JSON |
| `loadBinary(url)` | The file's bytes, as an `ArrayBuffer` |
| `preload(urls)` | Nothing: it downloads the files ahead of their loads |
| `onProgress(handler)` | A function that removes the handler |

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
| [E1412](../errors/E1412.md) | The file downloaded, but the browser could not decode the image, the file was not a KTX2 file that the engine loads, or the file was not valid JSON |
| [E1406](../errors/E1406.md) | The KTX2 transcoder's files did not download, when the first KTX2 file loads |
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
| `loadImageBitmap(url: string \| URL, options: LoadImageOptions = {}): Promise<ImageBitmap>` | Downloads an image file and decodes it into an `ImageBitmap`, off the sketch's frames. By default it decodes as `loadTexture` does, so `textures.fromImageBitmap` makes the same texture. Throws E1411, E1412 or E1413 as `loadTexture` does. |
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

### `ProgressHandler`

```ts
type ProgressHandler = (loaded: number, total: number, url: string) => void;
```

Called each time a download finishes or fails. It gets the files downloaded so far, the files asked for so far, and the address of the file that finished.

<!-- null3d:api:end -->
