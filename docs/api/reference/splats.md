---
id: api/reference/splats
title: "Gaussian splats (@null3d/splats): API reference"
status: generated
since: "0.3"
summary: "Every export of the Gaussian splats (@null3d/splats) API, from the engine's doc comments."
---

# Gaussian splats (@null3d/splats): API reference

> [Gaussian splats (@null3d/splats)](../splats.md) explains these exports. The engine's doc comments make this page.

## `checkSplats`

```ts
function checkSplats(data: SplatData, what: string): SplatData
```

Checks that a cloud's arrays hold what its count says, and throws when they do not.

## `ChunkOptions`

Interface `ChunkOptions`.

How a cloud is cut, and what the caller sees as it is.

| Member | Description |
| --- | --- |
| `readonly yieldTo?: Yielder` | Runs between chunks, which lets the caller hand the thread back. |
| `readonly onChunk?: (chunk: SplatChunk) => void` | Sees each chunk as it is ready, so a draw can take the cloud one chunk at a time. |
| `readonly splatsPerChunk?: number` | The splats that a chunk holds, at about. The default is 25,000. |

## `chunkSplats`

```ts
function chunkSplats(data: SplatData, options: ChunkOptions = {}): Promise<SplatChunks>
```

Cuts a cloud into chunks of nearby splats, each ordered so that its first splats cover the most surface. `yieldTo` runs between chunks, and `onChunk` sees each chunk as it is ready: a draw that takes them one by one appears coarse to fine, and a large cloud never holds up a frame.

## `colorOfSh`

```ts
function colorOfSh(dc: readonly [number, number, number], encoded = true, out = new Float32Array(3)): Float32Array
```

The linear RGB of a first-band spherical-harmonic coefficient, from its three channels. `encoded` says that the reconstructed value is an sRGB display value, which this decodes; leave it out for a value that is already linear.

## `createSplats`

```ts
function createSplats(ctx: SketchContext, options: SplatsOptions): Promise<Splats>
```

Draws a cloud of Gaussian splats in a sketch. The cloud comes from an SPZ file, from a splat stream index, or from the data of another reader. A glTF model that carries `KHR_gaussian_splatting` loads through `assets.loadGltf`, because the add-on's module registers the reader as it loads. A cloud draws with detail levels, a budget that follows the quality preset and the GPU path, and a soft mix with the scene's opaque meshes. A splat stream starts drawing before its whole cloud has downloaded: give the address of its index, and the add-on fetches the chunks that the view needs as it needs them. Each chunk of the cloud is an SPZ file, and the index names them. Call `splats.update(eye)` once in each frame, with the camera's position from `getPosition`, and free the cloud with `splats.destroy()`.

## `decodeSpz`

```ts
function decodeSpz(file: Uint8Array | ArrayBuffer): Promise<SplatData>
```

Reads an SPZ file into a cloud of splats. `file` holds the file's bytes as the browser delivers them. Throws when the file is not an SPZ file this reader knows, when its sizes do not fit, and when a zstd stream needs a browser without the zstd decompressor.

## `encodeSpz`

```ts
function encodeSpz(data: SplatData): Promise<Uint8Array>
```

Writes a cloud as a version 3 SPZ file, gzipped as the readers of the format expect. A stream writer cuts a cloud with `chunkSplats` and writes each chunk with this call, then names the files in a stream index. Throws E2101 for a cloud whose arrays do not fit its count.

## `parseStreamIndex`

```ts
function parseStreamIndex(text: string, base: string | URL | undefined, what = 'the splat stream index'): SplatStream
```

Reads a stream index. `base` resolves each chunk's address, which a relative one needs. Throws E2112 for a text that is not a stream index of this version, and for a cloud whose chunks do not hold the number of splats that it names.

## `SPLAT_EXTENSION`

```ts
const SPLAT_EXTENSION: 'KHR_gaussian_splatting'
```

The glTF extension that a splat file carries, which this handler reads.

## `SplatChunk`

Interface `SplatChunk`.

One chunk of a cloud, with its splats in the order that a coarser level keeps.

| Member | Description |
| --- | --- |
| `readonly center: readonly [number, number, number]` | The center of the splats' bounds, in meters. |
| `readonly radius: number` | The distance from the center to the farthest splat, in meters. |
| `readonly count: number` | The number of splats. |
| `readonly positions: Float32Array` | The centers, 3 floats each, most important first. |
| `readonly rotations: Float32Array` | The rotations as unit quaternions, 4 floats each. |
| `readonly scales: Float32Array` | The principal standard deviations, 3 floats each. |
| `readonly colors: Float32Array` | Linear RGBA colors, 4 floats each. |
| `readonly coverage: Float32Array` | The share of the chunk's surface that its first splats cover: index 0 is the whole chunk, and each next index keeps a prefix the square root of two times shorter. A coarse level grows its splats by what its prefix leaves uncovered. |

## `SplatChunks`

Interface `SplatChunks`.

A cloud cut into chunks, and the splits that its levels take.

| Member | Description |
| --- | --- |
| `readonly chunks: readonly SplatChunk[]` | The chunks that the cut made. |
| `readonly total: number` | The number of splats, which the chunks together hold. |

## `SplatData`

Interface `SplatData`.

One cloud of Gaussian splats, ready to draw.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of splats. Every array holds this many entries. |
| `readonly positions: Float32Array` | The centers, 3 floats each, in meters. |
| `readonly scales: Float32Array` | The three principal standard deviations, 3 floats each, in meters, 0 or more. |
| `readonly rotations: Float32Array` | The rotations as unit quaternions (x, y, z, w), 4 floats each. |
| `readonly colors: Float32Array` | Linear RGBA colors, 4 floats each, with the opacity in alpha. |

## `Splats`

Interface `Splats`.

A cloud of Gaussian splats that a scene draws, with its levels and its budget.

| Member | Description |
| --- | --- |
| `readonly feature: FeatureHandle` | The add-on feature, whose settings, budget and figures the engine resolves. |
| `readonly draw: SplatsDraw` | The draw: its batch's rows are the splats that draw. |
| `readonly total: number` | The number of splats that the cloud holds. |
| `readonly drawn: number` | The number of splats that draw now. |
| `readonly chunks: number` | The number of chunks that the cloud has. |
| `readonly loaded: number` | The number of chunks whose data has loaded. |
| `readonly failed: number` | The number of chunks that stayed unreachable. |
| `readonly bytes: number` | The bytes of the whole cloud: the file's size, or the chunk sizes that a stream index gives. |
| `readonly loadedBytes: number` | The bytes of the cloud that have downloaded. |
| `readonly ready: Promise<void>` | Resolves when the cloud can draw its first view. For a file, every chunk is ready. For a stream, the nearest chunks that the last `update` needs are loaded, about a megabyte of files or the nearest chunk alone, and the rest keep loading behind the frames: call `update` once before awaiting it. |
| `settle(): Promise<void>` | Resolves once the splats that draw are chosen and packed, which a test or a still picture waits for. For a stream, it also waits for the chunks that the selection wants, so the view draws every part that it asks for. Call it after `update`. |
| `setBudget(count: number): void` | Caps the splats that draw below the preset's budget, as a device or a test needs. |
| `update(eye: Vec3Like): void` | Chooses the splats that draw from a camera's position. Call it once in each frame. |
| `destroy(): void` | Stops the draw and frees its memory. The glTF reader stays registered. |

## `SplatsDraw`

Interface `SplatsDraw`.

The draw that a cloud fills: the instance batch whose rows are the splats that draw. Write the rows, mark them, and set the number that draw. The draw's material is the add-on's shader.

| Member | Description |
| --- | --- |
| `readonly batch: InstanceBatch` | The batch whose rows place the splats. Write its arrays, then mark the rows that draw. |
| `readonly material: Material` | The draw's material, which the cloud makes. |
| `setCount(count: number): void` | Draws the first `count` rows, and hides the rest. |
| `destroy(): void` | Frees the rows, the material and the shape. |

## `SplatsOptions`

Interface `SplatsOptions`.

Options of `createSplats`. Give the cloud itself, or the address of a splat file or a stream index.

| Member | Description |
| --- | --- |
| `readonly data?: SplatData` | The cloud to draw, decoded already, such as `decodeSpz` gives it. |
| `readonly url?: string \| URL` | The address of an SPZ file or of a splat stream index to download and draw. |
| `readonly origin?: Vec3Like` | The point that the splats' positions are relative to, which keeps them precise far from the world's origin. The default is (0, 0, 0). |
| `readonly softness?: number` | How far in front of an opaque mesh a splat fades in, in meters. The default is 0.25, which softens the edge where a splat meets a wall or the ground. 0 keeps a hard edge. |
| `readonly extent?: number` | How many standard deviations of a splat its card covers. The default is 3.3. |
| `readonly capacity?: number` | The most splats that the batch holds, which caps every preset's budget. The default is the preset's own count on this device, or the cloud's own count where that is smaller, so a cloud allocates what the device may draw. |

## `SplatStream`

Interface `SplatStream`.

A splat stream's index: the cloud's count and the chunks that it is cut into.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of splats in the whole cloud. |
| `readonly chunks: readonly StreamChunk[]` | The chunks, in the index's order. |
| `readonly bytes: number` | The bytes that every chunk file takes together, as far as the index gives them. |

## `StreamChunk`

Interface `StreamChunk`.

One chunk of a splat stream: where its file lies, how many splats it holds, and the bounds that the selection needs before it loads.

| Member | Description |
| --- | --- |
| `readonly url: string` | The chunk's address, resolved against the index's own address. |
| `readonly count: number` | The number of splats in the chunk's file. |
| `readonly center: readonly [number, number, number]` | The center of the chunk's bounds, in meters. |
| `readonly radius: number` | The distance from the center to the farthest splat, in meters. |
| `readonly bytes: number` | The size of the chunk's file in bytes, or 0 when the index does not give it. |

## `Yielder`

```ts
type Yielder = () => Promise<void>;
```

Hands the thread back between chunks, so a large cloud never holds up a frame.
