---
id: api/quality
title: Quality API
status: experimental
since: "0.1"
summary: "quality.preset, quality.set, quality.setPreset, the preset check, frame budgets, quality events."
---

# Quality API

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. `quality.set` takes `maxPixelRatio`, `minRenderScale`, `maxRenderScale`, `maxAnisotropy`, `uploadBytesPerFrame`, `shadowFilter`, `farCascadeInterval` and `governor`. `quality.settings` also holds `antialias`, `shadowTiles`, `shadowTileSize`, `pointLightShadows` and `depthPrepass`, which stay fixed while the engine runs. The settings that the preset table marks as planned are not built yet. Neither are frame budgets for a sketch's own systems (`quality.setBudget` comes in null3D 0.2). Coding agents must not use them.

`ctx.quality` gives a sketch the quality preset that the engine runs and its settings. The sketch can change the settings that change during play, switch to another preset, and hear when either changes. [Quality presets](../concepts/quality-presets.md) explains how the engine chooses and checks the preset, and lists each preset's values.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ quality, page }) => {
  console.log(quality.preset); // 'low', 'medium', 'high' or 'ultra'
  console.log(quality.settings.maxPixelRatio); // 1.5 on Low, Infinity on Ultra
  console.log(quality.settings.antialias); // 'fxaa' on Low, 'msaa' from Medium up

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
| `antialias: 'msaa'`, `'fxaa'` or `'none'` | Replaces the preset's anti-aliasing mode. |
| `shadowTiles`, `shadowTileSize`, `pointLightShadows`, `depthPrepass` | Replace the preset's values of these settings, which stay fixed while the engine runs. |
| `memory: { maximumMiB }` | Replaces the preset's memory maximum: [Page API](engine.md#memory). |
| `?preset=low` to `?preset=ultra` | Fixes the preset for tests. It wins over the option, and the engine ignores earlier crashes and checks no preset. |

## Settings

`quality.settings` holds the settings that a sketch can read. Each starts at the preset's value, or at the value of the page's option for it.

| Setting | Takes | Changes |
| --- | --- | --- |
| `maxPixelRatio` | A number from 0.5 up. `Infinity` draws at the screen's full pixel ratio. | During play. The canvas takes its new size within a frame or two. |
| `minRenderScale` | A number from 0.25 to 1, at most `maxRenderScale`: the lowest render scale that dynamic resolution may draw at. 1 keeps the whole canvas. | During play. |
| `maxRenderScale` | A number from 0.25 to 1: the highest render scale, where the engine starts. | During play. |
| `maxAnisotropy` | A whole number from 1 to 16. A texture whose `anisotropy` option is higher samples at this value. | During play. Textures sample with the new cap from the next frame. |
| `uploadBytesPerFrame` | A whole number of texel bytes from 65,536 (64 KiB) to 67,108,864 (64 MiB). | During play, from the next frame. |
| `shadowFilter` | 3 or 5: the texels on each side of the square that blends each shadow's edge. 5 gives softer edges and costs more for each pixel that receives shadows. | During play. |
| `farCascadeInterval` | A whole number from 1 to 8: each far shadow cascade draws once in this many frames. The nearest cascade draws in every frame. | During play. |
| `governor` | `true` or `false`: whether the frame-budget governor lowers the render scale and the shadow settings when frames take too long. | During play. Off, the scene draws at `maxRenderScale` with the shadow settings as set. |
| `antialias` | `'msaa'`: 4 samples per pixel. `'fxaa'`: the final pass smooths edges. `'none'`: no smoothing. | At the start only. The scene's targets and pipelines depend on it, so the page's `antialias` option sets it. |
| `shadowTiles` | A whole number from 0 to 24: the tiles of the shadow atlas that spot and point lights cast their shadows into. 0 turns their shadows off. | At the start only. The page's `shadowTiles` option sets it. |
| `shadowTileSize` | 256, 512, 1,024 or 2,048: the texels on each side of a tile of the shadow atlas. | At the start only. The page's `shadowTileSize` option sets it. |
| `pointLightShadows` | `true` or `false`: whether point lights cast shadows. Each one takes six tiles of the atlas. | At the start only. The page's `pointLightShadows` option sets it. |
| `depthPrepass` | `true` or `false`: whether the engine draws the opaque objects' depth before it shades them. It is always `false` on WebGL2. | At the start only. The page's `depthPrepass` option sets it. |

[GPU tiers and backends](../concepts/backends.md#color-and-anti-aliasing-on-each-tier) compares the anti-aliasing modes on each GPU path.

`quality.set(settings)` changes the settings it gets and keeps the others. It takes the settings that change during play, applies them from the next frame on, and returns a promise that resolves at once. Another setting, or a value outside the setting's range, throws [E1213](../errors/E1213.md) and changes nothing. So does a `minRenderScale` above `maxRenderScale`, an option of `createEngine` with a value that its setting does not take, and a preset name that `createEngine` does not know. To move both ends of the render scale's range past each other, give both in one call.

## Switching presets

`quality.setPreset(preset)` switches to another preset at a point that the sketch picks, such as a menu or a loading screen. Every setting that changes during play takes the new preset's value, apart from those that the page's options give. The values that `set` gave end with the switch too. The settings fixed at the start, such as `antialias`, keep their values. The preset check is different: when it lowers the preset after the setup, the settings that the setup changed with `set` keep their values. The GPU path caps the preset: `setPreset('ultra')` on WebGL2 runs Medium.

```ts
export default defineSketch(({ quality, page }) => {
  page.onMessage(async (name, data) => {
    if (name !== 'preset') return;
    await quality.setPreset(data as 'low' | 'medium' | 'high' | 'ultra');
    page.post('preset', quality.preset);
  });
});
```

The new preset can need new pipelines, for objects that the sketch's `quality.onChange` handlers create. The engine keeps the last frame on screen until the new preset's first frame has all of its pipelines built. The sketch's frames wait meanwhile. The promise resolves once that frame is on screen. A name that is no preset, such as `'auto'`, throws [E1213](../errors/E1213.md). A call that names the preset that runs gives each setting back the preset's value, and resolves at once.

## Render scale

`quality.renderScale` is the render scale that the engine draws the scene at: the part of the canvas's width and height, from `minRenderScale` to `maxRenderScale`. The engine lowers it when frames take too long, and raises it again when they have time to spare. Its final pass scales the image up to the canvas. Give both settings one value to fix the scale:

```ts
quality.set({ minRenderScale: 0.75, maxRenderScale: 0.75 });
console.log(quality.renderScale); // 0.75
```

[Quality presets](../concepts/quality-presets.md#dynamic-resolution) says when the engine moves the scale.

## The frame-budget governor

When frames take too long, the engine lowers the render scale first, then the live shadow settings. It raises them again once frames have time to spare. [Quality presets](../concepts/quality-presets.md#the-frame-budget-governor) gives the order and the rules. `quality.settings` keeps the values that the preset and the sketch gave. `quality.governor` reports what the engine draws with now:

| Member | What it holds |
| --- | --- |
| `steps` | The governor's steps past the render scale: 0 while the shadow settings apply as set. |
| `farCascadeInterval` | How often each far shadow cascade draws now: the setting's value, or up to twice as long for each step, at most every 8th frame. |
| `shadowFilter` | The shadow filter now: the setting's value, or 3 after the last step. |

The `quality.onChange` handlers run after each of these steps. So a sketch can lighten its own work with the engine's:

```ts
import { defineSketch } from '@null3d/engine';

const SPARKS = { low: 500, medium: 2000, high: 5000, ultra: 10000 };

export default defineSketch(({ quality }) => {
  let sparks = SPARKS[quality.preset];
  quality.onChange(() => {
    // Half the sparks for each step that the governor took past the render scale.
    sparks = SPARKS[quality.preset] >> quality.governor.steps;
  });
  return {
    onUpdate() {
      // Move `sparks` sparks.
    },
  };
});
```

A step of the render scale does not call the handlers: read `quality.renderScale` for it. Turn the governor off where every frame must draw the same way, such as a benchmark or a recorded video: `quality.set({ governor: false })`.

## Quality events

`quality.onChange(handler)` calls the handler at the start of the first frame after the settings or the preset change. It also calls it after each shadow step of the frame-budget governor. It returns a function that removes the handler. Keep handlers cheap: they run when quality changes, not every frame. After a change of preset, the handler's frame waits for its pipelines too. So objects that a handler creates for the new preset appear with it.

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
| `readonly renderScale: number` | The render scale that the engine draws the scene at: the part of the canvas's width and height, from `minRenderScale` to `maxRenderScale`. The engine lowers it when frames take too long and raises it again when they have time to spare. A change of the range applies to the frame being drawn. |
| `readonly governor: QualityGovernor` | What the frame-budget governor has lowered below `settings`. When frames take too long, the governor lowers the render scale, then the shadow settings, one step at a time. The `onChange` handlers run after each step of the shadow settings, but not after a step of the render scale. Hold mode has no governor, so it draws with the settings as set. |
| `set(settings: Partial<QualitySettings>): Promise<void>` | Changes settings from the next frame on, and resolves at once. It takes the settings that change during play, each with a value that the setting takes, and throws E1213 for any other setting or value, or for a `minRenderScale` above `maxRenderScale`. A setting that it does not get keeps its value. |
| `setPreset(preset: QualityPreset): Promise<void>` | Switches to another preset at a point that the sketch picks, such as a menu or a loading screen. Every setting that changes during play takes the new preset's value, including the settings that `set` changed, apart from those that the page's options give. The settings fixed when the engine starts, such as `antialias`, keep their values. The GPU path caps the preset, as it caps the page's choice. The promise resolves once the engine has drawn a frame at the new preset with all of its pipelines built. Until then the last frame stays on screen, and the sketch's frames wait. A name that is no preset throws E1213. |
| `onChange(handler: (quality: Quality) => void): () => void` | Calls `handler` at the start of the first frame after the settings change. Returns a function that removes the handler. |

### `QualityGovernor`

Interface `QualityGovernor`.

What the frame-budget governor has lowered, in `quality.governor`. It lowers the render scale first, which `quality.renderScale` reports, then the shadow settings here.

| Member | Description |
| --- | --- |
| `readonly steps: number` | The steps past the render scale that the governor has taken: 0 while the shadow settings apply as set. Each step lowers the frame's cost after the render scale has reached `minRenderScale`, so a sketch can lighten its own work too, such as its particles. |
| `readonly farCascadeInterval: number` | How often each far shadow cascade draws now: `settings.farCascadeInterval`, or up to twice as long for each of the governor's steps, at most every 8th frame. |
| `readonly shadowFilter: 3 \| 5` | The shadow filter that shadows draw with now: `settings.shadowFilter`, or 3 after the last step. |

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
| `maxAnisotropy: number` | The highest anisotropy that textures sample with. A texture whose own `anisotropy` option is higher samples at this value. It takes a whole number from 1 to 16, and changes during play. |
| `uploadBytesPerFrame: number` | The texel bytes that one frame may upload, so that loading many textures does not make one frame slow. A larger texture goes up in bands of rows over several frames. It takes a whole number from 65,536 (64 KiB) to 67,108,864 (64 MiB), and changes during play. |
| `shadowFilter: 3 \| 5` | The texels on each side of the square of shadow map texels that blend into each point's shadow: 3 or 5. A larger square gives softer shadow edges and costs more per pixel that receives shadows. It changes during play. |
| `farCascadeInterval: number` | How often each far shadow cascade draws: once in this many frames, a whole number from 1 to 8. The nearest cascade draws in every frame, and the far ones take turns. A far cascade that a dynamic object touches draws in every frame, so moving shadows follow their casters. A higher value costs less where far cascades hold still casters alone. It changes during play. |
| `governor: boolean` | Whether the frame-budget governor runs. When frames take too long, it lowers the render scale toward `minRenderScale`, then how often far shadow cascades draw, then the shadow filter. It raises them again, in the reverse order, once frames have time to spare. `quality.governor` reports its steps. False keeps the render scale at `maxRenderScale` and the shadow settings as set, as benchmarks and captures need. It changes during play. |
| `antialias: 'none' \| 'fxaa' \| 'msaa'` | How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa` smooths edges in the final pass, and `none` leaves them sharp. The mode is fixed when the engine starts: the page's `antialias` option of `createEngine` sets it, and `set` does not take it. |
| `shadowTiles: number` | The most tiles of the shadow atlas, which spot and point lights cast their shadows into: a spot light takes one tile. When more lights cast shadows than the tiles hold, the lights that look largest from the camera get them. It takes a whole number from 0, which turns the shadows of spot and point lights off, to 24. The `shadowTiles` option of `createEngine` sets it, and `set` does not take it. |
| `shadowTileSize: number` | Texels on each side of each tile of the shadow atlas: 256, 512, 1,024 or 2,048. Larger tiles give sharper shadows and take more memory, 4 bytes per texel. The `shadowTileSize` option of `createEngine` sets it, and `set` does not take it. |
| `pointLightShadows: boolean` | True when point lights cast shadows. Each point light that casts them takes six tiles of the shadow atlas, one for each face of a cube around it, within `shadowTiles`. The `pointLightShadows` option of `createEngine` sets it, and `set` does not take it. |
| `depthPrepass: boolean` | True when the engine draws the depth of the opaque objects before it shades them, so it shades each pixel once, for its nearest surface. The setting is fixed when the engine starts: the page's `depthPrepass` option of `createEngine` sets it, and `set` does not take it. It is always false on WebGL2, which draws without the prepass. |

<!-- null3d:api:end -->
