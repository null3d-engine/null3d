---
id: api/quality
title: Quality API
status: experimental
since: "0.1"
summary: "quality.preset, quality.set, quality.setPreset, the preset check, frame budgets, quality events."
---

# Quality API

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. `quality.set` takes `maxPixelRatio`, `minRenderScale`, `maxRenderScale`, `maxAnisotropy`, `uploadBytesPerFrame`, `shadowFilter`, `farCascadeInterval`, `followMovingCasters`, `shadowCascadeBlend` and `governor`. `quality.settings` also holds `antialias`, `shadowCascades`, `shadowMapSize`, `shadowTiles`, `shadowTileSize`, `pointLightShadows` and `depthPrepass`, which stay fixed while the engine runs. The settings that the preset table marks as planned are not built yet. Neither are frame budgets for a sketch's own systems (`quality.setBudget` comes in null3D 0.2). Coding agents must not use them.

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
console.log(engine.mode.presetCheck); // { from: 'high', targetFps: 60, rounds: [...], reused: false }, or null
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
| `followMovingCasters` | `true` or `false`: whether a far shadow cascade draws in every frame while a moving caster touches it. `false` keeps each far cascade to its turns, so a far moving shadow can trail its caster by a few frames. Every preset turns it on. | During play. |
| `shadowCascadeBlend` | A number from 0 to 0.5: the share of each shadow cascade's length, at its far end, over which its shadows blend into the next cascade's. 0 hands over at once. | During play. |
| `governor` | `true` or `false`: whether the frame-budget governor lowers the render scale and the shadow settings when frames take too long. | During play. Off, the scene draws at `maxRenderScale` with the shadow settings as set. |
| `antialias` | `'msaa'`: 4 samples per pixel. `'fxaa'`: the final pass smooths edges. `'none'`: no smoothing. | At the start only. The scene's targets and pipelines depend on it, so the page's `antialias` option sets it. |
| `shadowTiles` | A whole number from 0 to 24: the tiles of the shadow atlas that spot and point lights cast their shadows into. 0 turns their shadows off. | At the start only. The page's `shadowTiles` option sets it. |
| `shadowTileSize` | 256, 512, 1,024 or 2,048: the texels on each side of a tile of the shadow atlas. | At the start only. The page's `shadowTileSize` option sets it. |
| `pointLightShadows` | `true` or `false`: whether point lights cast shadows. Each one takes six tiles of the atlas. | At the start only. The page's `pointLightShadows` option sets it. |
| `depthPrepass` | `true` or `false`: whether the engine draws the opaque objects' depth before it shades them. | At the start only. The page's `depthPrepass` option sets it. |

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
<!-- null3d:api:end -->
