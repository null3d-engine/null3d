---
id: api/quality
title: Quality API
status: experimental
since: "0.1"
summary: "quality.preset, quality.set, quality.setPreset, the preset check, frame budgets, quality events."
---

# Quality API

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. `quality.set` takes `maxPixelRatio` only: the other settings of the preset table are not built yet. Neither are the frame-budget governor and its budgets (`quality.setBudget` comes in null3D 0.2). Coding agents must not use them.

`ctx.quality` gives a sketch the quality preset that the engine runs and its settings. The sketch can change the settings that change during play, switch to another preset, and hear when either changes. [Quality presets](../concepts/quality-presets.md) explains how the engine chooses and checks the preset, and lists each preset's values.

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

The page names the preset with the `preset` option of `createEngine`, or leaves the choice to the engine with `auto`, the default. The engine reports the preset that it runs in `engine.mode.preset`, and what the preset check measured in `engine.mode.presetCheck`:

```ts
const engine = await createEngine({ canvas, sketch, preset: 'auto' });
console.log(engine.mode.preset, engine.mode.crashedStarts, engine.mode.memoryMaximumMiB);
console.log(engine.mode.presetCheck); // { from: 'high', targetFps: 60, rounds: [...] }, or null
```

| Option or switch | What it does |
| --- | --- |
| `preset: 'auto'` | The engine chooses the preset for the device, then checks it with the sketch's scene and lowers it where the GPU cannot hold the frame rate. |
| `preset: 'low'` to `'ultra'` | Names the preset. The GPU path still caps it, and a crashed start lowers it. |
| `maxPixelRatio` | Replaces the preset's pixel ratio cap. |
| `memory: { maximumMiB }` | Replaces the preset's memory maximum: [Page API](engine.md#memory). |
| `?preset=low` to `?preset=ultra` | Fixes the preset for tests. It wins over the option, and the engine ignores earlier crashes and checks no preset. |

## Settings

`quality.settings` holds the settings that a sketch can read and change. Each starts at the preset's value, or at the value of the page's option for it.

| Setting | Takes | Changes |
| --- | --- | --- |
| `maxPixelRatio` | A number from 0.5 up. `Infinity` draws at the screen's full pixel ratio. | During play. The canvas takes its new size within a frame or two. |

`quality.set(settings)` changes the settings it gets and keeps the others. It takes the settings that change during play. A setting that it does not take, or a value outside the setting's range, throws [E1213](../errors/E1213.md) and changes nothing. So does a preset name that `createEngine` does not know.

## Switching presets

`quality.setPreset(preset)` switches to another preset at a point that the sketch picks, such as a menu or a loading screen. Every setting takes the new preset's value, including the settings that change only at the start, apart from those that the page's options give. The GPU path caps the preset: `setPreset('ultra')` on WebGL2 runs Medium.

```ts
export default defineSketch(({ quality, page }) => {
  page.onMessage(async (name, data) => {
    if (name !== 'preset') return;
    await quality.setPreset(data as 'low' | 'medium' | 'high' | 'ultra');
    page.post('preset', quality.preset);
  });
});
```

The new preset can need new pipelines and render targets. The engine keeps the last frame on screen until the new preset's first frame has all of its pipelines built. The sketch's frames wait meanwhile. The promise resolves once that frame is on screen. A name that is no preset, such as `'auto'`, throws [E1213](../errors/E1213.md). A call that names the preset that runs, with its settings unchanged, resolves at once.

## Quality events

`quality.onChange(handler)` calls the handler at the start of the first frame after the settings or the preset change. It returns a function that removes the handler. Keep handlers cheap: they run when quality changes, not every frame. After a change of preset, the handler's frame waits for its pipelines too. So objects that a handler creates for the new preset appear with it.

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

### `PresetCheck`

Interface `PresetCheck`.

What the preset check measured when the engine started, as `engine.mode.presetCheck` reports it.

| Member | Description |
| --- | --- |
| `from: QualityPreset` | The preset that the engine chose from the device before the check. |
| `targetFps: number` | The frame rate that each preset had to hold: the display's refresh rate, at most 60. |
| `rounds: PresetCheckRound[]` | Each preset that the check measured, from `from` down. The last is the preset that the engine runs. |

### `PresetCheckRound`

Interface `PresetCheckRound`.

What the preset check measured at one preset.

| Member | Description |
| --- | --- |
| `preset: QualityPreset` | The preset that the check measured. |
| `presentedFps: number` | Frames per second that the thread that draws presented. |
| `completedFps: number` | Frames per second that the GPU finished. |

### `Quality`

Interface `Quality`.

The quality preset and settings, as a sketch reads and changes them through `ctx.quality`.

| Member | Description |
| --- | --- |
| `readonly preset: QualityPreset` | The preset that the engine runs. |
| `readonly settings: Readonly<QualitySettings>` | The settings in use: the preset's values, with the values of the page's options and the changes that `set` made. |
| `set(settings: Partial<QualitySettings>): void` | Changes settings from the next frame on. It takes the settings that can change during play, each with a value that the setting takes, and throws E1213 for any other setting or value. A setting that it does not get keeps its value. |
| `setPreset(preset: QualityPreset): Promise<void>` | Switches to another preset at a point that the sketch picks, such as a menu or a loading screen. Every setting takes the new preset's value, apart from those that the page's options give. The GPU path caps the preset, as it caps the page's choice. The promise resolves once the engine has drawn a frame at the new preset with all of its pipelines built. Until then the last frame stays on screen, and the sketch's frames wait. A name that is no preset throws E1213. |
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

<!-- null3d:api:end -->
