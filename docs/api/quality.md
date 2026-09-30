---
id: api/quality
title: Quality API
status: experimental
since: "0.1"
summary: "quality.preset, quality.set, frame budgets, quality events."
---

# Quality API

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. `quality.set` takes `maxPixelRatio`, `minRenderScale` and `maxRenderScale` only: the other settings of the preset table are not built yet. Neither are `quality.setPreset`, the frame-budget governor and its budgets (`quality.setBudget` comes in null3D 0.2). Coding agents must not use them.

`ctx.quality` gives a sketch the quality preset that the engine runs and its settings. The sketch can change the settings that change during play, and hear when they change. [Quality presets](../concepts/quality-presets.md) explains how the engine chooses the preset, and lists each preset's values.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ quality, page }) => {
  console.log(quality.preset); // 'low', 'medium', 'high' or 'ultra'
  console.log(quality.settings.maxPixelRatio); // 1.5 on Low, Infinity on Ultra

  // A menu on the page asks for a sharper or a faster picture.
  page.onMessage((type, data) => {
    if (type === 'sharpness') quality.set({ maxPixelRatio: data as number });
  });
  quality.onChange(() => page.post('quality', quality.settings));
});
```

## Choosing the preset on the page

The page names the preset with the `preset` option of `createEngine`, or leaves the choice to the engine with `auto`, the default. The engine reports the preset that it runs in `engine.mode.preset`:

```ts
const engine = await createEngine({ canvas, sketch, preset: 'auto' });
console.log(engine.mode.preset, engine.mode.crashedStarts, engine.mode.memoryMaximumMiB);
```

| Option or switch | What it does |
| --- | --- |
| `preset: 'auto'` | The engine chooses the preset for the device. |
| `preset: 'low'` to `'ultra'` | Names the preset. The GPU path still caps it, and a crashed start lowers it. |
| `maxPixelRatio` | Replaces the preset's pixel ratio cap. |
| `memory: { maximumMiB }` | Replaces the preset's memory maximum: [Page API](engine.md#memory). |
| `?preset=low` to `?preset=ultra` | Fixes the preset for tests. It wins over the option, and the engine ignores earlier crashes. |

## Settings

`quality.settings` holds the settings that a sketch can read and change. Each starts at the preset's value, or at the value of the page's option for it.

| Setting | Takes | Changes |
| --- | --- | --- |
| `maxPixelRatio` | A number from 0.5 up. `Infinity` draws at the screen's full pixel ratio. | During play. The canvas takes its new size within a frame or two. |
| `minRenderScale` | A number from 0.25 to 1, at most `maxRenderScale`: the lowest render scale that dynamic resolution may draw at. 1 keeps the whole canvas. | During play. |
| `maxRenderScale` | A number from 0.25 to 1: the highest render scale, where the engine starts. | During play. |

`quality.set(settings)` changes the settings it gets and keeps the others. A setting that it does not take, or a value outside the setting's range, throws [E1213](../errors/E1213.md) and changes nothing. So does a `minRenderScale` above `maxRenderScale`, and a preset name that `createEngine` does not know. To move both ends of the render scale's range past each other, give both in one call.

## Render scale

`quality.renderScale` is the render scale that the engine draws the scene at: the part of the canvas's width and height, from `minRenderScale` to `maxRenderScale`. The engine lowers it when frames take too long, and raises it again when they have time to spare. Its final pass scales the image up to the canvas. Give both settings one value to fix the scale:

```ts
quality.set({ minRenderScale: 0.75, maxRenderScale: 0.75 });
console.log(quality.renderScale); // 0.75
```

[Quality presets](../concepts/quality-presets.md#dynamic-resolution) says when the engine moves the scale.

## Quality events

`quality.onChange(handler)` calls the handler at the start of the first frame after the settings change. It returns a function that removes the handler. Keep handlers cheap: they run when quality changes, not every frame.

## Related pages

- [Quality presets](../concepts/quality-presets.md): how the engine chooses the preset, and every preset's settings.
- [Phones and tablets](../guides/phones.md): pixel ratios, memory and testing on real devices.
- [Sketch API: defineSketch and the context](sketch.md): the other fields of the context.

## API reference

<!-- null3d:api:start -->

### `DeviceHints`

Interface `DeviceHints`.

The facts about the device that the engine chooses a quality preset from. The page reads them when the engine starts, and `engine.report` holds them.

| Member | Description |
| --- | --- |
| `coarsePointer: boolean` | True when the main pointer is coarse, as on a touch screen: `(pointer: coarse)`. |
| `screenMinEdge: number` | The screen's smaller edge in CSS pixels, which stays the same when the device turns or the window changes size. |
| `deviceMemoryGB: number \| null` | The device's memory in GB, as `navigator.deviceMemory` rounds it, or null in browsers that do not report it, such as Safari and Firefox. |

### `Quality`

Interface `Quality`.

The quality preset and settings, as a sketch reads and changes them through `ctx.quality`.

| Member | Description |
| --- | --- |
| `readonly preset: QualityPreset` | The preset that the engine runs. |
| `readonly settings: Readonly<QualitySettings>` | The settings in use: the preset's values, with the values of the page's options and the changes that `set` made. |
| `readonly renderScale: number` | The render scale that the engine draws the scene at: the part of the canvas's width and height, from `minRenderScale` to `maxRenderScale`. The engine lowers it when frames take too long and raises it again when they have time to spare. A change of the range applies to the frame being drawn. |
| `set(settings: Partial<QualitySettings>): void` | Changes settings from the next frame on. It takes the settings that can change during play, each with a value that the setting takes, and throws E1213 for any other setting or value, or for a `minRenderScale` above `maxRenderScale`. A setting that it does not get keeps its value. |
| `onChange(handler: (quality: Quality) => void): () => void` | Calls `handler` at the start of the first frame after the settings change. Returns a function that removes the handler. |

### `QualityPreset`

```ts
type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
```

A quality preset: `low`, `medium`, `high` or `ultra`, from the lightest to the heaviest. Each preset gives every quality setting a value, and the engine starts with the values of the preset it runs.

### `QualitySettings`

Interface `QualitySettings`.

The quality settings that a sketch reads and changes through `ctx.quality`. Each starts at the value of the preset that the engine runs, or at the value of the page's `createEngine` option for the setting.

| Member | Description |
| --- | --- |
| `maxPixelRatio: number` | The highest device pixel ratio that the engine draws at. The canvas's drawing buffer is its CSS size times the lower of this and the screen's pixel ratio. `Infinity` draws at the screen's full ratio. It takes a number from 0.5 up, and changes during play: the canvas takes its new size within a frame or two. |
| `minRenderScale: number` | The lowest render scale: the smallest part of the canvas's width and height that the scene draws at when frames take too long. The engine draws the scene at a render scale between this and `maxRenderScale`, and scales the image up to the canvas. It takes a number from 0.25 to 1, at most `maxRenderScale`, and changes during play. 1 keeps the whole canvas. |
| `maxRenderScale: number` | The highest render scale, where the engine starts. It takes a number from 0.25 to 1, and changes during play. With `minRenderScale` at the same value, the scene always draws at that scale. |

<!-- null3d:api:end -->
