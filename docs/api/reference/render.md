---
id: api/reference/render
title: "Render graph API: API reference"
status: generated
since: "0.2"
summary: "Every export of the Render graph API API, from the engine's doc comments."
---

# Render graph API: API reference

> [Render graph API](../render.md) explains these exports. The engine's doc comments make this page.

## `ComputeDispatch`

```ts
type ComputeDispatch = 'writes' | ComputeWorkgroup;
```

The workgroup counts of a compute pass's dispatch: `'writes'` divides the target's size by the workgroup size and rounds up, so every pixel of the target is written, and three whole numbers give the counts along each axis.

## `ComputeFallback`

Interface `ComputeFallback`.

The fragment-pass form of a compute pass, which a WebGL2 page runs in its place: WGSL written as a custom effect's, which declares `fn effect(input: EffectInput) -> vec4f`. It draws over the whole target with the same values and textures as the compute pass.

| Member | Description |
| --- | --- |
| `readonly wgsl: Wgsl` | The compiled WGSL of the fragment form, as a custom effect's. |

## `ComputeFormat`

```ts
type ComputeFormat = 'rgba16float' | 'r32float' | 'rgba8unorm';
```

The format of a compute pass's storage texture. `'rgba16float'` holds HDR color, `'r32float'` holds one 32-bit number per pixel, and `'rgba8unorm'` holds 8-bit color.

## `ComputePassOptions`

Interface `ComputePassOptions`.

Options of `render.addPass` for a compute pass, which runs a compiled compute shader over a storage texture of its own. The texture is the description's output, which `textures.fromPass` gives to materials, effects and other passes: they sample it in the frame that the pass writes it, and the render graph orders the pass before them. A compute pass runs on WebGPU. On WebGL2 it runs its fragment form when the options give one, and the call throws otherwise. The shader declares `@group(0)

| Member | Description |
| --- | --- |
| `readonly kind: 'compute'` | `'compute'`: the pass runs `wgsl` once for each workgroup of its dispatch. |
| `readonly description: FeatureDescription` | The feature description that places the pass: its frame point, its order band and order, and its single output, which names the texture that the pass writes. |
| `readonly wgsl: Wgsl` | The compiled WGSL, whose `@compute` entry point fills the storage texture. |
| `readonly format?: ComputeFormat` | The storage texture's format. The default is `'rgba16float'`. |
| `readonly history?: boolean` | The pass keeps two states, and each run reads the state of the run before and writes the other. The texture holds the states as two ranges of layers: the first run's state, then the other's. Readers sample the state that the last run wrote by its layer, which `Texture.layer` gives once the pass is added. The shader reads the previous state from `@group(0) |
| `readonly layers?: number` | The array layers of each state: the texture has that many, or twice as many with `history`. A `'writes'` dispatch runs one workgroup along z for each layer, so the shader writes layer `id.z`. The default is 1. WebGL2's fragment form draws each layer in a pass of its own, up to 32, and the call throws E1220 past them. |
| `readonly steps?: number` | The runs that a frame records, swapping the two states between them, so a 40-step pressure solve is one pass. It is 1 by default, and `render.setPassSteps` changes it. Zero runs keep the states that the frame before left. A pass without `history` runs once. |
| `readonly workgroupSize?: ComputeWorkgroup` | The invocations along each axis of a workgroup. The default is the shader's `@workgroup_size`. Another value throws, so a pass cannot dispatch another grid. |
| `readonly dispatch?: ComputeDispatch` | The workgroup counts. The default is `'writes'`, the target's size divided by a workgroup. |
| `readonly size?: RenderPassSize` | The texture's size in pixels. A pass takes `size` or `scale`. |
| `readonly scale?: PassScale` | The texture's size as a share of the render size each way. It is 1 by default. |
| `readonly textures?: readonly (Texture \| undefined)[]` | The textures that the shader samples, in the order of its map slots: textures from files or data, or other passes' textures from `textures.fromPass`. A missing slot samples as white. The pass runs after the passes that write the textures it gives. |
| `readonly values?: readonly number[]` | The pass's values: up to 32 numbers, which the shader reads as eight vectors in its block. Change them with `render.setPassUniforms`. |
| `readonly buffers?: readonly [FeatureInstanceBuffer, FeatureInstanceBuffer]` | The two buffers of one instance draw that the pass writes, in binding order: the draw's count word, then its per-instance rows. A pass with buffers has no storage texture and publishes no output, gives its workgroup counts, and runs on WebGPU alone. |
| `readonly fallback?: ComputeFallback` | The fragment form, which a WebGL2 page runs in place of the compute pass. |
| `readonly name?: string` | The pass's name in `render.dumpGraph()` and errors. It is the output's name by default. |
| `readonly every?: number` | The pass runs in one frame of every `every`, from the first, and its texture keeps its last image in between. It is 1 by default: every frame. |

## `ComputeWorkgroup`

```ts
type ComputeWorkgroup = readonly [x: number, y: number, z: number];
```

The invocations of a workgroup along each axis, from 1: x and y up to 128 and z up to 64.

## `FullscreenPassOptions`

Interface `FullscreenPassOptions`.

Options of `render.addPass` for a full-screen pass, which runs WGSL written as a custom effect's over the whole of a texture of its own. `Wgsl` is the type of the WGSL. It gives the names and types of the uniforms and the names of the textures.

| Member | Description |
| --- | --- |
| `readonly kind: 'fullscreen'` | `'fullscreen'`: the pass runs `wgsl` for each pixel of its texture. |
| `readonly wgsl: Wgsl` | WGSL compiled by the null3D Vite plugin that declares `fn effect(input: EffectInput) -> vec4f`, as a custom effect's does. `input.uv` and `input.pixel` place the pixel on the pass's own texture, and `input.color` is the input image there. |
| `readonly writes: string` | The name of the pass's texture in the render graph, as a scene pass's `writes`. |
| `readonly size?: RenderPassSize` | The texture's size in pixels. A pass takes `size` or `scale`. |
| `readonly scale?: PassScale` | The texture's size as a share of the render size each way, which the pass fills at any render scale. It is 1 by default, without `size`. |
| `readonly input?: PassInput` | The image that the pass reads as its input, through `input.color`, `effectColor` and `effectPixel`. Without one, they read transparent black. A pass with an input, or whose WGSL reads the scene's depth, runs after the camera's passes, so a material that shows its texture shows the frame before. |
| `readonly textures?: NoInfer<TextureValues<Wgsl>>` | The texture of each `var name: texture_2d<f32>;` that the WGSL declares, by name, as an effect's `textures`. The pass runs after the passes whose textures it reads. |
| `readonly uniforms?: NoInfer<[keyof UniformValues<Wgsl>] extends [never] ? { readonly [name: string]: never; } : UniformValues<Wgsl>>` | The first value of each uniform, by name. A uniform without one starts at 0. |
| `readonly name?: string` | The pass's name in `render.dumpGraph()` and errors. It is `writes` by default. |
| `readonly every?: number` | The pass draws in one frame of every `every`, from the first, and the texture keeps its last image in between. It is 1 by default: every frame. |

## `PassInput`

```ts
type PassInput = 'sceneColor' | 'outlineMask';
```

The image of the camera's view that a full-screen pass reads as its input: the scene color as the camera's passes leave it, before custom effects and bloom, or the outline mask, which holds the outlined objects' coverage in red and the parts that nothing hides in green.

## `PassReadRegion`

Interface `PassReadRegion`.

A frame's region: texels from the texture's stored first row.

| Member | Description |
| --- | --- |
| `readonly x?: number` | The region's first texel along x. It is 0 by default. |
| `readonly y?: number` | The region's first texel along y. It is 0 by default. |
| `readonly width: number` | The region's width in texels, at most 64. |
| `readonly height: number` | The region's height in texels, at most 64. |
| `readonly layer?: number` | The array layer the region lies in. It is the state that the pass wrote last by default, so a pass that keeps history reads its newer state without naming a layer. |

## `PassReadResult`

Interface `PassReadResult`.

What a read found: four numbers for each texel, top row first, and how late it came.

| Member | Description |
| --- | --- |
| `readonly data: Float32Array` | The texels: red, green, blue and alpha for each, row by row from the top left. |
| `readonly width: number` | The region's width in texels. |
| `readonly height: number` | The region's height in texels. |
| `readonly frames: number` | The frames between the request and the answer, which is at least one. |

## `PassScale`

```ts
type PassScale = 1 | 0.5 | 0.25;
```

A share of a size each way: the whole size, half or a quarter.

## `ReflectionPassOptions`

Interface `ReflectionPassOptions`.

Options of `render.addPass` for a reflection pass, which draws the camera's view mirrored across a plane into a texture of the render size or a part of it. A custom material reads it where its surface shows on the screen, with `reflection_uv` from `null3d::reflection`, and lights it as the surface's `reflection`. Nothing below the plane shows in it.

| Member | Description |
| --- | --- |
| `readonly kind: 'reflection'` | `'reflection'`: the pass draws the camera's view mirrored across `plane`. |
| `readonly plane: ReflectionPlane` | The plane that the pass mirrors the view across. |
| `readonly writes: string` | The name of the pass's texture in the render graph, as a scene pass's `writes`. Each pass writes a name of its own. |
| `readonly scale?: PassScale` | The texture's size as a share of the render size each way, which the pass fills at any render scale. It follows the quality preset's `reflectionScale` by default. |
| `readonly every?: number` | The pass draws in one frame of every `every`, from the first, and the texture keeps its last image in between. It is 1 by default: every frame. The reflection lags a moving camera in the frames between, so a larger value suits a camera that moves slowly. |
| `readonly name?: string` | The pass's name in `render.dumpGraph()` and errors. It is `writes` by default. |
| `readonly layers?: number` | The layers of the objects the pass draws, as a 32-bit mask. It is the camera's layers by default, and follows them when they change. |
| `readonly reads?: readonly string[]` | The textures of other passes that the objects this pass draws may show, as a scene pass's. |
| `readonly clearColor?: ColorInput` | The color that the texture clears to before the pass draws, behind the scene's background. It is the scene's background color by default. |
| `readonly clearAlpha?: number` | The alpha that the texture clears to with `clearColor`, from 0 to 1. It is 1 by default. |

## `ReflectionPlane`

Interface `ReflectionPlane`.

The plane that a reflection pass mirrors the camera's view across.

| Member | Description |
| --- | --- |
| `readonly point: Vec3` | A point on the plane, in the world, such as a point on the water's surface. |
| `readonly normal?: Vec3` | The plane's normal, toward the side that the reflection shows. It need not have length 1. It is up, (0, 1, 0), by default, for water and floors. |

## `Render`

Class `Render`.

The sketch's own render passes. A sketch finds it as `ctx.render`.

| Member | Description |
| --- | --- |
| `addPass<const Wgsl extends string \| CompiledWgsl>(options: RenderPassOptions<Wgsl>): RenderPass` | Adds a pass to the render graph, from the next frame on, and returns it. A scene pass draws the scene from a camera into a texture of its own, which `textures.fromPass` gives to materials. A reflection pass draws the camera's view mirrored across a plane, with the scene's background, and clips everything below the plane. A full-screen pass runs WGSL written as a custom effect's over its whole texture, which materials and effects read. A compute pass runs a compute shader over a storage texture of its own on WebGPU, which materials, effects and other passes sample in the same frame. A WebGL2 page runs its fragment form, or the call throws when it gives none. A pass runs only while something shows or reads its texture. Scene and reflection passes draw the sun, its shadows where the main camera's cascades reach, the ambient light, the point and spot lights that the pass's view sees, the environment's light and fog. A point or spot light casts its shadow in a pass where the main camera's view gives it a shadow. A light that only the pass sees casts none there. Both draw the scene's background unless a scene pass has a `clearColor`. Neither kind draws ambient occlusion. Throws E1220 for options it does not take, a name that a live pass writes already, or the 32nd live pass. Throws E1215 for full-screen WGSL that the plugin did not compile as an effect, and E1216 for a wrong uniform or texture. Throws the render graph's code when the pass does not fit the graph: E1502 for a texture in `reads` that no pass writes, E1503 for a name that the engine's own passes write, E1504 for passes that read each other's textures, and E1505 for targets that one render pass cannot hold. |
| `setPassUniform(pass: RenderPass, name: string, value: UniformValue): void` | Changes one uniform of a full-screen pass, from the next frame on. It allocates nothing, so a sketch can change a uniform every frame. Keep a vector's values in one array that the sketch changes in place. Throws E1220 for a pass of another kind, E1216 for a uniform that the pass's WGSL does not declare or a value of the wrong kind, and E1101 for a pass that was removed. |
| `setPassUniforms(pass: RenderPass, values: readonly number[]): void` | Changes the values of a compute pass, from the next frame on: up to 32 numbers, which its shader reads as eight vectors in its block. The array's first number takes the block's first value, and a number left out stays as it was. It allocates nothing, so a sketch can change the values every frame. Throws E1101 for a removed pass, E1220 for a pass of another kind, and E1220 for a value that is not a number or more than 32 of them. |
| `setPassSteps(pass: RenderPass, steps: number): void` | Changes the runs that a compute pass records in a frame, from the next frame on: each run dispatches its workgroups and swaps the pass's two states. A 40-step pressure solve is one pass of 40 runs. Zero runs keep the states that the frame before left. It allocates nothing. Throws E1101 for a removed pass, E1220 for a pass of another kind or a count that is not a whole number from 0 to 65535, and E1220 for more than one run of a pass without history. |
| `resetPass(pass: RenderPass): void` | Starts a compute pass's states again from empty, from the next frame on: the frame clears both states before the pass's first run. A pass that keeps history then reads the first state of the next run as zeros, and a stopped pass's texture reads black. It allocates nothing. Throws E1101 for a removed pass and E1220 for a pass of another kind. |
| `readPass(pass: RenderPass, region: PassReadRegion): Promise<PassReadResult>` | Reads a small region of a compute pass's texture through a promise, a few frames after the call. No thread waits for it: a frame copies the region into a buffer, the GPU puts its bytes in engine memory, and the sketch's frame loop answers the promise. The result holds four numbers for each texel, its red, green, blue and alpha, row by row from the top left, and the frames that the read took. A pass that does not run keeps its last image, so its texels read as the frame before left them. Throws E1220 for a pass of another kind, a region that is not whole texels from 0 to 64 each way, or a layer that the pass does not hold. The engine refuses a region that a pass has no texture for, and one that waits more than 240 frames fails with E1220. |
| `setPassEnabled(pass: RenderPass, enabled: boolean): void` | Switches a pass on or off, from the next frame on. A pass switched off keeps the last image it drew. A pass that draws in some frames only takes a cadence from `setPassEvery`, which compiles nothing. Throws E1101 for a pass that was removed. It allocates nothing. |
| `setPassEvery(pass: RenderPass, every: number): void` | Gives a pass a cadence: it draws in one frame of every `every`, from the next frame on, and its texture keeps the last image that it drew in between. A cadence of 1 draws every frame. It compiles nothing, so a sketch may change it whenever the quality preset or the frame budget moves, as often as once a frame. Throws E1101 for a pass that was removed, and E1220 for a cadence that is not a whole number from 1. It allocates nothing. In hold mode every pass draws in every frame, so a held frame never shows a pass's older picture. |
| `removePass(pass: RenderPass): void` | Removes a pass from the next frame on, and destroys the textures that `textures.fromPass` made of it. Throws E1101 for a pass that was removed, and E1502 while another pass reads its texture: remove that pass first. |
| `dumpGraph(): string` | The render graph as it stands, as Graphviz DOT text: every pass of the frame, the engine's and the sketch's, in the order they run, grouped into the GPU's render passes, with each texture's format, size and memory. Passes that are switched off, or that nothing reads, show dashed. Paste the text into a Graphviz viewer to see it as a picture. |

## `RenderPass`

Class `RenderPass`.

A pass that `render.addPass` added. `render.setPassEnabled` switches it, and `render.removePass` removes it.

| Member | Description |
| --- | --- |
| `readonly kind: 'scene' \| 'reflection' \| 'fullscreen' \| 'compute'` | The kind of pass. |
| `readonly name: string` | The pass's name in the render graph. |
| `readonly writes: string` | The name of the texture it draws into. |
| `readonly width: number` | The texture's width in pixels, or 0 for a texture that follows the render size. |
| `readonly height: number` | The texture's height in pixels, or 0 for a texture that follows the render size. |
| `readonly live: boolean` | True until `render.removePass` removes the pass. |
| `readonly enabled: boolean` | True while the pass draws in each frame. A pass switched off keeps its last image. |

## `RenderPassOptions`

```ts
type RenderPassOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> =
	| ScenePassOptions
	| ReflectionPassOptions
	| FullscreenPassOptions<Wgsl>
	| ComputePassOptions<Wgsl>;
```

Options of `render.addPass`.

## `RenderPassSize`

```ts
type RenderPassSize = readonly [width: number, height: number];
```

The size of a pass's texture in pixels, as `[width, height]`: whole numbers from 1 to the device's largest texture.

## `ScenePassOptions`

Interface `ScenePassOptions`.

Options of `render.addPass` for a scene pass, which draws the scene from a camera into a texture of its own size or a share of the render size. `textures.fromPass` gives the texture to materials and sprites.

| Member | Description |
| --- | --- |
| `readonly kind: 'scene'` | `'scene'`: the pass draws the scene's objects from `camera`. |
| `readonly camera: Camera` | The camera that the pass draws from. Its lens takes the texture's shape, so an aspect ratio follows `size`. A camera that is destroyed leaves the texture with its last image. |
| `readonly writes: string` | The name of the pass's texture in the render graph. Other passes name it in `reads`, and `render.dumpGraph()` and errors show it. Each pass writes a name of its own. |
| `readonly size?: RenderPassSize` | The texture's size in pixels. A pass takes `size` or `scale`. |
| `readonly scale?: PassScale` | The texture's size as a share of the render size each way, which the pass fills at any render scale, so its aspect ratio follows the canvas. A pass takes `size` or `scale`. |
| `readonly name?: string` | The pass's name in `render.dumpGraph()` and errors. It is `writes` by default. |
| `readonly layers?: number` | The layers of the objects the pass draws, as a 32-bit mask. It is the camera's layers by default, and follows them when they change. |
| `readonly every?: number` | The pass draws in one frame of every `every`, from the first, and the texture keeps its last image in between. It is 1 by default: every frame. |
| `readonly reads?: readonly string[]` | The textures of other passes that the objects this pass draws may show, by the names those passes write. The pass runs after them. An object whose material shows the texture of a pass that this pass does not read, or its own texture, does not draw in this pass. |
| `readonly clearColor?: ColorInput` | The color that the texture clears to before the pass draws. It is the scene's background color by default. |
| `readonly clearAlpha?: number` | The alpha that the texture clears to with `clearColor`, from 0 to 1. It is 1 by default. |
