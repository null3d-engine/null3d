---
id: api/reference/render
title: "Render graph API: API reference"
status: generated
since: "0.2"
summary: "Every export of the Render graph API API, from the engine's doc comments."
---

# Render graph API: API reference

> [Render graph API](../render.md) explains these exports. The engine's doc comments make this page.

## `Render`

Class `Render`.

The sketch's own render passes. A sketch finds it as `ctx.render`.

| Member | Description |
| --- | --- |
| `addPass(options: RenderPassOptions): RenderPass` | Adds a pass to the render graph, from the next frame on, and returns it. A scene pass draws the scene from a camera into a texture of its own, which `textures.fromPass` gives to materials. A reflection pass draws the camera's view mirrored across a plane, with the scene's background, and clips everything below the plane. A pass runs only while something shows its texture. Both kinds draw the sun, its shadows where the main camera's cascades reach, the ambient light, the environment's light and fog. They do not draw point or spot lights or ambient occlusion yet, and development builds warn once when the scene has point or spot lights. A scene pass draws no sky background. Throws E1220 for options it does not take, a name that a live pass writes already, or the 32nd live pass. Throws the render graph's code when the pass does not fit the graph: E1502 for a texture in `reads` that no pass writes, E1503 for a name that the engine's own passes write, and E1505 for targets that one render pass cannot hold. |
| `setPassEnabled(pass: RenderPass, enabled: boolean): void` | Switches a pass on or off, from the next frame on. A pass switched off keeps the last image it drew, so a sketch can draw a costly pass every few frames. Throws E1101 for a pass that was removed. It allocates nothing. |
| `removePass(pass: RenderPass): void` | Removes a pass from the next frame on, and destroys the textures that `textures.fromPass` made of it. Throws E1101 for a pass that was removed, and E1502 while another pass reads its texture: remove that pass first. |
| `dumpGraph(): string` | The render graph as it stands, as Graphviz DOT text: every pass of the frame, the engine's and the sketch's, in the order they run, grouped into the GPU's render passes, with each texture's format, size and memory. Passes that are switched off, or that nothing reads, show dashed. Paste the text into a Graphviz viewer to see it as a picture. |

## `RenderPass`

Class `RenderPass`.

A pass that `render.addPass` added. `render.setPassEnabled` switches it, and `render.removePass` removes it.

| Member | Description |
| --- | --- |
| `readonly kind: 'scene' \| 'reflection'` | The kind of pass. |
| `readonly name: string` | The pass's name in the render graph. |
| `readonly writes: string` | The name of the texture it draws into. |
| `readonly width: number` | The texture's width in pixels, or 0 for a reflection, whose texture follows the render size. |
| `readonly height: number` | The texture's height in pixels, or 0 for a reflection, whose texture follows the render size. |
| `readonly live: boolean` | True until `render.removePass` removes the pass. |
| `readonly enabled: boolean` | True while the pass draws in each frame. A pass switched off keeps its last image. |

## `RenderPassOptions`

```ts
type RenderPassOptions = ScenePassOptions | ReflectionPassOptions;
```

Options of `render.addPass`.

## `RenderPassSize`

```ts
type RenderPassSize = readonly [width: number, height: number];
```

The size of a pass's texture in pixels, as `[width, height]`: whole numbers from 1 to the device's largest texture.

## `ScenePassOptions`

Interface `ScenePassOptions`.

Options of `render.addPass` for a scene pass, which draws the scene from a camera into a texture of its own size. `textures.fromPass` gives the texture to materials and sprites.

| Member | Description |
| --- | --- |
| `readonly kind: 'scene'` | `'scene'`: the pass draws the scene's objects from `camera`. |
| `readonly camera: Camera` | The camera that the pass draws from. Its lens takes the texture's shape, so an aspect ratio follows `size`. A camera that is destroyed leaves the texture with its last image. |
| `readonly writes: string` | The name of the pass's texture in the render graph. Other passes name it in `reads`, and `render.dumpGraph()` and errors show it. Each pass writes a name of its own. |
| `readonly size: RenderPassSize` | The texture's size in pixels. |
| `readonly name?: string` | The pass's name in `render.dumpGraph()` and errors. It is `writes` by default. |
| `readonly layers?: number` | The layers of the objects the pass draws, as a 32-bit mask. It is the camera's layers by default, and follows them when they change. |
| `readonly reads?: readonly string[]` | The textures of other passes that the objects this pass draws may show, by the names those passes write. The pass runs after them. An object whose material shows the texture of a pass that this pass does not read, or its own texture, does not draw in this pass. |
| `readonly clearColor?: ColorInput` | The color that the texture clears to before the pass draws. It is the scene's background color by default. |
| `readonly clearAlpha?: number` | The alpha that the texture clears to with `clearColor`, from 0 to 1. It is 1 by default. |
