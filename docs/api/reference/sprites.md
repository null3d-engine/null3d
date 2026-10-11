---
id: api/reference/sprites
title: "Sprites: API reference"
status: generated
since: "0.2"
summary: "Every export of the Sprites API, from the engine's doc comments."
---

# Sprites: API reference

> [Sprites](../sprites.md) explains these exports. The engine's doc comments make this page.

## `SpriteAtlas`

Interface `SpriteAtlas`.

A grid of frames in one texture: `columns` across and `rows` down, all the same size. Frame 0 is the top left frame, and frames count along each row, then down.

| Member | Description |
| --- | --- |
| `columns: number` | The frames across the texture, from 1 to 2048. |
| `rows: number` | The frames down the texture, from 1 to 2048. |

## `SpriteBatch`

Class `SpriteBatch`.

Many sprites: quads that face the camera, each with its own position, size, rotation, color and atlas frame. Write rows straight into the typed arrays, as for an instance batch. A dynamic batch updates every sprite every frame, and a static batch updates the rows you mark dirty.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of sprites: the batch's capacity. |
| `readonly material: Material<SpriteValues>` | The sprites' material: `set` changes the color, opacity and alpha cutoff of every sprite. |
| `readonly positions: Float32Array` | Positions in the world, 3 floats per sprite. A new sprite is at the origin. |
| `readonly sizes: Float32Array` | Width and height, 2 floats per sprite: world units, or CSS pixels without size attenuation. A new sprite is 1 by 1. A negative size mirrors the sprite. |
| `readonly rotations: Float32Array` | The turn of each sprite on the screen, in radians, counterclockwise, 1 float per sprite, like three.js's `SpriteMaterial.rotation`. A new sprite has 0. |
| `readonly colors: Float32Array` | Linear RGBA colors, 4 floats per sprite, which multiply the material's color and map. A new sprite is white. Components from 0 to 1024 draw, and alpha from 0 to 1. |
| `readonly frames: Uint32Array` | The frame of the atlas that each sprite shows, 1 per sprite. Frame 0 is the top left. A frame past the last one counts again from the first. |
| `setActiveCount(count: number): void` | Draws only the first `count` sprites. |
| `setLayers(mask: number): void` | Puts every sprite on the layers of a 32-bit mask. A new mask needs no rebuild. |
| `markDirty(start = 0, count = this.count - start): void` | Marks sprites of a static batch to update and upload. |
| `on(type: ObjectEventType, handler: ObjectEventHandler): void` | Calls `handler` for each pointer event of `type` on a sprite of the batch, as `Object3D.on` does. A ray hits a sprite where its quad draws. The event's `instance` names the sprite. |
| `off(type: ObjectEventType, handler: ObjectEventHandler): void` | Removes a handler that `on` added for events of `type`. |
| `destroy(): void` | Removes the batch and frees its rows. Its typed arrays are not valid after this: another batch can take their memory. |

## `SpriteOptions`

Interface `SpriteOptions`, which extends `SpriteValues`, `Omit`.

Options of `scene.createSprites`. The look of the sprites takes the options of an unlit material, but sprites blend by default, as three.js's `SpriteMaterial` does.

| Member | Description |
| --- | --- |
| `count: number` | The number of sprites: the batch's capacity, which never changes. |
| `map?: Texture` | A color map, in sRGB, whose color multiplies `color` and each sprite's color. With `atlas`, each sprite shows one frame of it. It is fixed when the batch is created. |
| `atlas?: SpriteAtlas` | Splits `map` into a grid of frames, which each sprite picks from with its `frames` row. |
| `sizeAttenuation?: boolean` | True gives sizes in world units, so far sprites look smaller, as three.js's `sizeAttenuation` does. False gives sizes in CSS pixels, so every sprite keeps its size on screen. The default is true. |
| `center?: readonly [number, number]` | The point of each sprite that sits at its position, as a fraction of its width and height from its bottom left corner, like three.js's `Sprite.center`. The sprite turns about it. The default, `[0.5, 0.5]`, is the middle; `[0.5, 0]` stands a sprite on its position. |
| `dynamic?: boolean` | Every sprite updates and uploads every frame; a static batch updates rows marked dirty only. |
| `layers?: number` | The layers every sprite is on, as a 32-bit mask. The default, 1, is layer 0. |
| `origin?: Vec3` | The point that every sprite's position is relative to, as an instance batch's `origin`. The default is (0, 0, 0). Sprites near it keep the precision of 32-bit floats at any distance from the world's origin. |
| `alphaMode?: MaterialFeatures['alphaMode']` | How the sprites use their alpha. The default is `blend`, as three.js's sprites blend. |

## `SpriteValues`

```ts
type SpriteValues = MaterialOptions;
```

The values of a sprite batch's material, which `sprites.material.set` changes at any time.
