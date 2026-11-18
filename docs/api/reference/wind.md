---
id: api/reference/wind
title: "Wind (@null3d/wind): API reference"
status: generated
since: "0.3"
summary: "Every export of the Wind (@null3d/wind) API, from the engine's doc comments."
---

# Wind (@null3d/wind): API reference

> [Wind (@null3d/wind)](../wind.md) explains these exports. The engine's doc comments make this page.

## `createWind`

```ts
function createWind(ctx: SketchContext, options: WindOptions): Wind
```

Makes the air in a scene: the field, the pass that fills it, and the calls that a page uses to set the wind, send a gust and push the air.

## `FieldState`

Interface `FieldState`.

The field's settings, which a page sets once or changes at any time.

| Member | Description |
| --- | --- |
| `speed: number` | The wind's speed in meters a second, at the top of the profile. |
| `heading: number` | The heading that the wind blows toward, in radians: 0 blows toward +x, pi/2 toward +z. |
| `ground: number` | How much slower the air is at the ground, from 0 to 1, over `GROUND_HEIGHT` meters. |
| `gustStrength: number` | The strength of the gust's turn, in meters a second. |
| `gustRadius: number` | How wide the gust is, in meters. |
| `gustWave: number` | How far apart the gust's turns sit, so the gust arrives as a wave rather than one eddy. |
| `gustSpeed: number` | How fast the gust travels, in meters a second. |
| `pushRadius: number` | How wide a push turns the air, in meters. |
| `swirl: number` | The strength of the noise-built swirl, in meters a second. |
| `swirlScale: number` | The swirl's size: larger makes wider, slower eddies. |
| `swirlDrift: number` | How fast the swirl's pattern drifts, in meters a second. |
| `seed: number` | The seed of the swirl's pattern, so two pages may look different. |

## `NAMESPACE`

```ts
const NAMESPACE: AddonNamespace
```

The add-on's names, claimed once as the page loads: its shader library and its error codes.

## `Wind`

Interface `Wind`.

The wind that a page reads and drives.

| Member | Description |
| --- | --- |
| `readonly field: WindField` | The field that a plant, a flag or a smoke card samples. |
| `setBase(speed: number, heading: number): void` | Sets the steady wind: its speed in meters a second and its heading in radians. |
| `gust(at: readonly [number, number], strength?: number): void` | Sends a gust of `strength` from a ground place, whose wave then travels along the heading, so the air turns as it passes over the scene. |
| `push(at: readonly [number, number], strength?: number): void` | Pushes the air about a ground place, as a body moving through it does. |
| `sample(x: number, y: number, z: number, out: [number, number, number]): [number, number, number]` | The air at a world place, in meters a second, written into `out`, from the analytic field that the solver pulls the air toward and the pushes and the gust it injects. The solved air itself is on the GPU, so a page's own motion follows the forces rather than the wakes. This call works in TypeScript, which suits a test and a read outside a frame. A page that moves its own objects with the air in every frame asks `read` instead, whose work runs in a job worker. |
| `readonly settings: Readonly<Record<string, FeatureValue>>` | The feature's settings, as the preset and the frame-budget governor resolve them now: the step interval, the pressure steps, the spring trees and the grid. The object stays the same and its values change in place, so read it in a frame without allocating. |
| `readonly budget: { readonly ms: number; readonly scale: number; readonly allowedMs: number; }` | The field's budget, as the preset and the frame-budget governor leave it. The object stays the same, so read it in a frame without allocating. |
| `read(points: Float32Array, out: Float32Array): void` | Asks a job worker for the air at each place in `points`, three numbers a place across the ground, and puts the velocities in `out`, three numbers a place. The answer lands before the next frame's update, so a page reads it in its next `onUpdate`. One call takes about five thousand places. |
| `update(): void` | Places the box about the camera, runs the steps that the sketch time owes and sends the values to the GPU. Call once in each frame. |
| `destroy(): void` | Removes the pass and its texture. |

## `WindField`

Interface `WindField`.

The field that a reader samples: a texture of the air, and the box it covers.

| Member | Description |
| --- | --- |
| `readonly texture: Texture` | The texture. A reader declares it as `var wind: texture_2d<f32>;` and samples it through the sampling function, which gives the air back: the wind across the ground, the wind's rise, which is zero while the field is flat, and how fast the air moves. The grid keeps its state in the texture's own numbers, so a reader does not decode them itself. A preset change that changes the grid makes a new texture, so read this again after one. |
| `readonly origin: [number, number]` | The box's near corner across the ground, in meters: x and z. |
| `readonly size: number` | The box's width across the ground, in meters, or zero on a device that keeps no grid. A reader that is given zero works out the air from `air` everywhere. That is the steady field which the grid's edge and the far field hold where a device keeps one. |
| `readonly air: WindReading` | The steady settings that a reader works out beyond the box. Give them to a material with the sampling function's three vectors, and give them again when `setBase` or the air changes. |

## `WindOptions`

Interface `WindOptions`.

What a page gives the wind, at the start or later.

| Member | Description |
| --- | --- |
| `camera: Camera` | The camera whose ground place the box follows. The field is centered on it in every frame. |
| `box?: number` | The box's width across the ground, in meters. Zero keeps no grid, so every reader works the air out from the steady field. |
| `grid?: number` | The grid's texels across each way. A page that gives it keeps it; otherwise the preset's `windGrid` row sets it, and 0 keeps no grid. |
| `air?: Partial<FieldState>` | The air's settings: its speed, heading, gust, push and swirl. |

## `WindReading`

Interface `WindReading`.

The steady settings that a reader works out beyond the box, as the three vectors that its shader takes: the base wind, the gust and the swirl. A page gives them to a material once, and again when `setBase` or one of the air's settings changes; a frame changes nothing here.

| Member | Description |
| --- | --- |
| `readonly base: [number, number, number, number]` | The speed, the heading in radians, how much slower the air is at the ground, and the seed. |
| `readonly gust: [number, number, number, number]` | The gust's strength, its radius in meters, its wave number and how fast it travels. |
| `readonly swirl: [number, number, number, number]` | The swirl's strength, its size, how fast its pattern drifts, and a number it does not use. |
| `readonly sent: [number, number, number, number]` | The gust a page sent: its ground place in x and z, its strength, and the time it was sent. |
