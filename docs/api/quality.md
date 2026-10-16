---
id: api/quality
title: Quality API
status: experimental
since: "0.1"
summary: "quality.preset, quality.set, quality.setPreset, the preset check, the frame-budget governor, budgets for a sketch's own systems, quality events."
---

# Quality API

> Roadmap step 0.1, first released in null3D 0.1.0. Step 0.2 adds `quality.setBudget`. The API is experimental, so it can still change between versions. `quality.set` takes every setting that changes during play, as [Settings](#settings) says. The others stay fixed while the engine runs. The settings that the preset table marks as planned are not built yet. Coding agents must not use them.

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
| `targetFps: 'display'` or a whole number | The frame rate that the preset check and the governor defend. Without it, the display's refresh rate, at most 60. `'display'` defends the display's full rate, and a number caps the target at that rate: [The target frame rate](../concepts/quality-presets.md#the-target-frame-rate). |
| `maxPixelRatio` | Replaces the preset's pixel ratio cap. |
| `antialias: 'msaa'`, `'fxaa'` or `'none'` | Replaces the preset's anti-aliasing mode. |
| `shadowCascades`, `shadowMapSize`, `shadowTiles`, `shadowTileSize`, `pointLightShadows`, `depthPrepass`, `gpuOcclusion`, `morphTargets` | Replace the preset's values of these settings, which stay fixed while the engine runs. |
| `softwareOcclusion`, `textureMemoryMiB` | Replace the preset's values of these settings. A sketch can change them during play. |
| `memory: { maximumMiB }` | Replaces the preset's memory maximum: [Page API](engine.md#memory). |
| `?preset=low` to `?preset=ultra` | Fixes the preset for tests. It wins over the option, and the engine ignores earlier crashes and checks no preset. |
| `?target-fps=display` or `?target-fps=90` | Sets the target frame rate. It wins over the `targetFps` option. |

## Settings

`quality.settings` holds the settings that a sketch can read. Each starts at the preset's value, or at the value of the page's option for it. The API reference lists every setting with what it takes and when it changes: [`QualitySettings`](reference/quality.md#qualitysettings). The engine's own doc comments make that list, so it holds every setting of this version. [Quality preset tables](../concepts/quality-preset-tables.md#settings-of-each-preset) gives each preset's value of each setting.

Most settings change during play. The preset tables' "Changes" column names the ones that stay fixed from the start, which the page's `createEngine` options set.

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

When frames take too long, the engine lowers the render scale first. Then it lowers the detail, shadow and effect settings one step at a time, and raises them again once frames have time to spare. [Quality presets](../concepts/quality-presets.md#the-frame-budget-governor) gives the order of the steps and the rules. `quality.settings` keeps the values that the preset and the sketch gave. `quality.governor` reports what the engine draws with now:

| Member | What it holds |
| --- | --- |
| `steps` | The governor's steps past the render scale: 0 while every setting that the governor lowers applies as set. |
| `farCascadeInterval` | How often each far shadow cascade draws now: the setting's value, or up to twice as long for each step, at most every 8th frame. |
| `shadowFilter` | The shadow filter now: the setting's value, or 3 after its step. |
| `bloomSize` | Bloom's size now: the setting's value, or half of it after its step while bloom is on. |
| `aoScale` | Ambient occlusion's scale now: the setting's value, or half of it after the step that follows bloom's while ambient occlusion draws. |
| `contactShadowSteps` | The steps of contact shadows now: the setting's value, or 4 after its step while the directional light casts shadows. |
| `farAnimationInterval` | How often a far character's pose updates now: the setting's value, or up to twice as long for each of its steps, at most every 4th frame. |
| `fogSlices` | The slices that the volumetric fog draws now: the setting's value, or half of it after the last step while the fog draws. |

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

## Budgets for the sketch's own systems

`quality.setBudget(options)` registers a budget for a system of the sketch's own, such as its AI, its particles or its crowd. The governor lowers the budget's scale with its own steps, and the sketch decides what a lower scale means for the system:

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ quality }) => {
  const searches: (() => void)[] = []; // path searches that the crowd asks for
  let thinkers = 200; // the crowd members that think in each frame
  const ai = quality.setBudget({
    name: 'ai',
    ms: 2,
    min: 0.25,
    onScale: (scale) => {
      thinkers = Math.round(200 * scale);
    },
  });
  return {
    onUpdate() {
      // Let `thinkers` crowd members think. Then search paths until the budget's time runs out,
      // and go on in the next frame.
      const end = performance.now() + ai.ms;
      while (searches.length > 0 && performance.now() < end) searches.shift()?.();
    },
  };
});
```

| Option | What it takes |
| --- | --- |
| `name` | The system's name. A budget with the name of another replaces it. |
| `ms` | The time in ms that the system may take in each frame at full quality: a number above 0. The engine does not measure the system. It scales this time into the budget's `ms`. |
| `min` | The lowest scale that the governor gives the system, from 0 to 1. The default is 0. |
| `onScale` | A function that gets the budget's scale when the budget is set, and again at the start of each frame after the governor moves it. |

The call returns the budget. Its `scale` runs from `min` to 1, where 1 is full quality. Its `ms` is the time that the system may take now: the option's `ms` times the scale. `remove()` removes the budget. The governor then stops lowering the system, and `onScale` is not called again. Options that the call does not take throw [E1213](../errors/E1213.md).

The governor moves the budgets by these rules:

- All budgets share one scale, which moves in steps of 0.25: 1, 0.75, 0.5, 0.25 and 0. Each budget takes that scale, but never less than its `min`. The governor takes the steps down to the lowest `min` of all the budgets.
- When frames take too long, a step of the budgets comes before each step of the render scale, while both can go lower. So the sketch's systems scale down before the render scale reaches `minRenderScale`.
- Once the render scale is at `minRenderScale`, the budgets take the steps they have left. Then the governor takes the shadow and effect steps.
- When frames have time to spare again, the governor raises the settings in the reverse order. The budgets' first step down comes back last.
- Each step follows the governor's rules for the render scale. A step down needs about a second over budget, and a step up 5 seconds with time to spare. With the governor off, and in hold mode, every budget's scale is 1.

Each budget step adds a step before a step of the render scale. So with budgets, the render scale reaches `minRenderScale` some seconds later. When a lower budget does not make the frames faster, the governor's next step lowers the render scale. This happens, for example, when the GPU and not the system sets the frame rate.

## Texture memory

The `quality.textureMemory` object reports the GPU memory of textures against their budget, the `textureMemoryMiB` setting. Its `bytes` are the GPU bytes that every texture takes, with the free layers of texture arrays. Its `budgetBytes` give the budget in bytes. Its `droppedLevels` count the mip levels that the engine dropped from every texture to stay under the budget. Its `droppedTextures` count the textures that hold fewer levels than their own. Each texture's `droppedLevels` gives its own count. [Quality presets](../concepts/quality-presets.md#texture-memory) explains which levels drop and how they come back.

```ts
quality.onChange(({ textureMemory }) => {
	if (textureMemory.droppedLevels > 0)
		console.log(`textures: ${textureMemory.bytes} of ${textureMemory.budgetBytes} bytes`);
});
```

Some textures never drop levels: those that the sketch made from images or data, and those under 64 KiB. A scene whose textures stay over the budget holds too many of them. Destroy the textures that the scene no longer shows, or load large ones from KTX2 files.

## Quality events

`quality.onChange(handler)` calls the handler at the start of the first frame after the settings or the preset change. It also calls it after each shadow step of the frame-budget governor, and after the texture memory budget drops levels or asks for them again. A step of the budgets calls their `onScale` functions, not these handlers. It returns a function that removes the handler. Keep handlers cheap: they run when quality changes, not every frame. After a change of preset, the handler's frame waits for its pipelines too. So objects that a handler creates for the new preset appear with it.

## Related pages

- [Quality presets](../concepts/quality-presets.md): how the engine chooses the preset, and every preset's settings.
- [Phones and tablets](../guides/phones.md): pixel ratios, memory and testing on real devices.
- [Sketch API: defineSketch and the context](sketch.md): the other fields of the context.

## API reference

[The API reference](reference/quality.md) lists every export of this page with its type and description. The engine's doc comments make it.
