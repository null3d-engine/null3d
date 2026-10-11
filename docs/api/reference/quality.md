---
id: api/reference/quality
title: "Quality API: API reference"
status: generated
since: "0.1"
summary: "Every export of the Quality API API, from the engine's doc comments."
---

# Quality API: API reference

> [Quality API](../quality.md) explains these exports. The engine's doc comments make this page.

## `DeviceHints`

Interface `DeviceHints`.

The facts about the device that the engine chooses a quality preset from. The page reads them when the engine starts, and `engine.report` holds them.

| Member | Description |
| --- | --- |
| `coarsePointer: boolean` | True when the main pointer is coarse, as on a touch screen: `(pointer: coarse)`. |
| `screenMinEdge: number` | The screen's smaller edge in CSS pixels, which stays the same when the device turns or the window changes size. |
| `deviceMemoryGB: number \| null` | The device's memory in GB, as `navigator.deviceMemory` rounds it, or null in browsers that do not report it, such as Safari and Firefox. |

## `PresetCheck`

Interface `PresetCheck`.

What the preset check measured when the engine started, as `engine.mode.presetCheck` reports it.

| Member | Description |
| --- | --- |
| `from: QualityPreset` | The preset that the engine chose from the device before the check. |
| `targetFps: number` | The frame rate that each preset had to hold: the display's refresh rate, at most 60 or at most the page's `targetFps` option. |
| `rounds: PresetCheckRound[]` | Each preset that the check measured, from `from` down. The last is the preset that the engine runs. |
| `reused: boolean` | True when the engine took this result from an earlier start of the sketch in this browser on this device, and did not measure again. The engine stores each check's result for a week. |

## `PresetCheckRound`

Interface `PresetCheckRound`.

What the preset check measured at one preset.

| Member | Description |
| --- | --- |
| `preset: QualityPreset` | The preset that the check measured. |
| `presentedFps: number` | Frames per second that the thread that draws presented. |
| `completedFps: number` | Frames per second that the GPU finished. |

## `Quality`

Interface `Quality`.

The quality preset and settings, as a sketch reads and changes them through `ctx.quality`.

| Member | Description |
| --- | --- |
| `readonly preset: QualityPreset` | The preset that the engine runs. |
| `readonly settings: Readonly<QualitySettings>` | The settings in use: the preset's values, with the values of the page's options and the changes that `set` made. |
| `readonly renderScale: number` | The render scale that the engine draws the scene at: the part of the canvas's width and height, from `minRenderScale` to `maxRenderScale`. The engine lowers it when frames take too long and raises it again when they have time to spare. A change of the range applies to the frame being drawn. |
| `readonly governor: QualityGovernor` | What the frame-budget governor has lowered below `settings`. When frames take too long, the governor lowers the render scale, then the shadow settings, then bloom's size, one step at a time. The `onChange` handlers run after each of those steps, but not after a step of the render scale. Hold mode has no governor, so it draws with the settings as set. |
| `readonly textureMemory: TextureMemory` | The GPU memory that textures take, against `settings.textureMemoryMiB`, and the mip levels that the engine dropped to stay under it. The `onChange` handlers run after the engine drops levels or asks for them again. |
| `set(settings: Partial<QualitySettings>): Promise<void>` | Changes settings from the next frame on, and resolves at once. It takes the settings that change during play, each with a value that the setting takes, and throws E1213 for any other setting or value, or for a `minRenderScale` above `maxRenderScale`. A setting that it does not get keeps its value. |
| `setPreset(preset: QualityPreset): Promise<void>` | Switches to another preset at a point that the sketch picks, such as a menu or a loading screen. Every setting that changes during play takes the new preset's value, including the settings that `set` changed, apart from those that the page's options give. The settings fixed when the engine starts, such as `antialias`, keep their values. The GPU path caps the preset, as it caps the page's choice. The promise resolves once the engine has drawn a frame at the new preset with all of its pipelines built. Until then the last frame stays on screen, and the sketch's frames wait. A name that is no preset throws E1213. |
| `onChange(handler: (quality: Quality) => void): () => void` | Calls `handler` at the start of the first frame after the settings change. Returns a function that removes the handler. |

## `QualityGovernor`

Interface `QualityGovernor`.

What the frame-budget governor has lowered, in `quality.governor`. It lowers the render scale first, which `quality.renderScale` reports, then the shadow settings and bloom's size here.

| Member | Description |
| --- | --- |
| `readonly steps: number` | The steps past the render scale that the governor has taken: 0 while the shadow settings and bloom's size apply as set. Each step lowers the frame's cost after the render scale has reached `minRenderScale`, so a sketch can lighten its own work too, such as its particles. |
| `readonly farCascadeInterval: number` | How often each far shadow cascade draws now: `settings.farCascadeInterval`, or up to twice as long for each of the governor's steps, at most every 8th frame. While `settings.followMovingCasters` is false, the governor takes no such step. |
| `readonly shadowFilter: 3 \| 5` | The shadow filter that shadows draw with now: `settings.shadowFilter`, or 3 after the last step. |
| `readonly bloomSize: number` | The texels on the short side of bloom's largest level now: `settings.bloomSize`, or half as many after the governor's step that follows the shadow steps, while bloom is on. The glow keeps its size. |
| `readonly aoScale: number` | The size of ambient occlusion's targets now: `settings.aoScale`, or half as large after the governor's last step while ambient occlusion draws. |

## `QualityPreset`

```ts
type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
```

A quality preset: `low`, `medium`, `high` or `ultra`, from the lightest to the heaviest. Each preset gives every quality setting a value, and the engine starts with the values of the preset it runs.

## `QualitySettings`

Interface `QualitySettings`.

The quality settings that a sketch reads and changes through `ctx.quality`. Each starts at the value of the preset that the engine runs, or at the value of the page's `createEngine` option for the setting.

| Member | Description |
| --- | --- |
| `maxPixelRatio: number` | The highest device pixel ratio that the engine draws at. The canvas's drawing buffer is its CSS size times the lower of this and the screen's pixel ratio. `Infinity` draws at the screen's full ratio. It takes a number from 0.5 up, and changes during play: the canvas takes its new size within a frame or two. |
| `minRenderScale: number` | The lowest render scale: the smallest part of the canvas's width and height that the scene draws at when frames take too long. The engine draws the scene at a render scale between this and `maxRenderScale`, and scales the image up to the canvas. It takes a number from 0.25 to 1, at most `maxRenderScale`, and changes during play. 1 keeps the whole canvas. |
| `maxRenderScale: number` | The highest render scale, where the engine starts. It takes a number from 0.25 to 1, and changes during play. With `minRenderScale` at the same value, the scene always draws at that scale. |
| `maxAnisotropy: number` | The highest anisotropy that textures sample with. A texture whose own `anisotropy` option is higher samples at this value. It takes a whole number from 1 to 16, and changes during play. |
| `textureMemoryMiB: number` | The GPU memory in MiB that textures may take: 256, 512, 1,024 or 2,048 from Low to Ultra, and at most 1,008 on phones and tablets unless the page's `textureMemoryMiB` option gives a value. When the textures take more, the engine drops the largest mip levels of the textures that it can load again from their files, and loads those levels again once room returns. It takes a whole number from 64 to 16,384, and changes during play. |
| `uploadBytesPerFrame: number` | The texel bytes that one frame may upload, so that loading many textures does not make one frame slow. A larger texture goes up in bands of rows over several frames. It takes a whole number from 65,536 (64 KiB) to 67,108,864 (64 MiB), and changes during play. |
| `shadowFilter: 3 \| 5` | The texels on each side of the square of shadow map texels that blend into each point's shadow: 3 or 5. A larger square gives softer shadow edges and costs more per pixel that receives shadows. It changes during play. |
| `farCascadeInterval: number` | How often each far shadow cascade draws: once in this many frames, a whole number from 1 to 8. The nearest cascade draws in every frame, and the far ones take turns. A far cascade that a dynamic object touches draws in every frame, so moving shadows follow their casters. A higher value costs less where far cascades hold still casters alone. It changes during play. |
| `followMovingCasters: boolean` | True when a far shadow cascade draws in every frame while a dynamic object that casts shadows touches it, so moving shadows stay under their casters. False keeps each far cascade to its turns of `farCascadeInterval` frames: a moving shadow in a far cascade then trails its caster by up to that many frames less one, and the frames draw fewer shadow passes. The governor then leaves `farCascadeInterval` as set, so the trail never grows. Every preset turns it on. It changes during play. |
| `shadowCascadeBlend: number` | The share of each shadow cascade's length, at its far end, over which its shadow blends into the next cascade's, from 0 to 0.5. The blend hides the line where a near cascade's sharper shadows hand over to a far cascade's softer ones. Pixels in the band read both cascades, so a wider band costs a little more. 0 hands over at once. It changes during play. |
| `bloomSize: 64 \| 128 \| 256 \| 512` | The texels on the short side of the largest level of bloom's chain: 64, 128, 256 or 512. A smaller value costs less and keeps the glow's size, with a softer core. The base never takes more than half the canvas's short side. It changes during play, which makes bloom's targets again. |
| `aoScale: 0 \| 0.25 \| 0.5` | The size of ambient occlusion's targets, as a share of the render size each way: 0.5, 0.25, or 0, which draws no ambient occlusion even when `post.set` turns it on. A smaller share costs less, with softer occlusion. It changes during play: 0.5 and 0.25 make no GPU object, and a change to or from 0 adds or removes ambient occlusion's passes. |
| `dofSamples: 0 \| 16 \| 22 \| 43 \| 71` | The taps of depth of field's gather: 16, 22, 43 or 71, or 0, which draws no depth of field even when `post.set` turns it on. More taps fill a wide blur more smoothly and cost more. It changes during play. |
| `reflectionScale: 0.25 \| 0.5 \| 1` | The size of a reflection pass's texture, as a share of the render size each way: 1, 0.5 or 0.25, for each reflection whose `scale` option names none. A reflection draws the scene again, so a smaller share costs less, with a softer reflection. It changes during play, which makes the reflections' textures again. |
| `governor: boolean` | Whether the frame-budget governor runs. When frames take too long, it lowers the render scale toward `minRenderScale`, then how often far shadow cascades draw, then the shadow filter, then bloom's size while bloom is on, then ambient occlusion's scale while it draws. It raises them again, in the reverse order, once frames have time to spare. `quality.governor` reports its steps. False keeps the render scale at `maxRenderScale` and the other settings as set, as benchmarks and captures need. It changes during play. |
| `antialias: 'none' \| 'fxaa' \| 'msaa'` | How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa` smooths edges in the final pass, and `none` leaves them sharp. The mode is fixed when the engine starts: the page's `antialias` option of `createEngine` sets it, and `set` does not take it. |
| `shadowCascades: number` | The cascades of a directional light's shadows, a whole number from 1 to 4, for each light whose `shadow` options name none. More cascades keep shadows sharp further from the camera, and each draws the shadow casters once more. The `shadowCascades` option of `createEngine` sets it, and `set` does not take it. |
| `shadowMapSize: number` | Texels on each side of each cascade's shadow map, for each directional light whose `shadow` options name no `mapSize`: 512, 1,024, 2,048 or 4,096. A larger map gives sharper shadow edges and takes more memory, 4 bytes per texel in each cascade. The `shadowMapSize` option of `createEngine` sets it, and `set` does not take it. |
| `shadowTiles: number` | The most tiles of the shadow atlas, which spot and point lights cast their shadows into: a spot light takes one tile. When more lights cast shadows than the tiles hold, the lights that look largest from the camera get them. It takes a whole number from 0, which turns the shadows of spot and point lights off, to 24. The `shadowTiles` option of `createEngine` sets it, and `set` does not take it. |
| `shadowTileSize: number` | Texels on each side of each tile of the shadow atlas: 256, 512, 1,024 or 2,048. Larger tiles give sharper shadows and take more memory, 4 bytes per texel. The `shadowTileSize` option of `createEngine` sets it, and `set` does not take it. |
| `pointLightShadows: boolean` | True when point lights cast shadows. Each point light that casts them takes six tiles of the shadow atlas, one for each face of a cube around it, within `shadowTiles`. The `pointLightShadows` option of `createEngine` sets it, and `set` does not take it. |
| `depthPrepass: boolean` | True when the engine draws the depth of the opaque objects before it shades them, so it shades each pixel once, for its nearest surface. Every preset turns it on for WebGL2 and off for WebGPU. The setting is fixed when the engine starts: the page's `depthPrepass` option of `createEngine` sets it, and `set` does not take it. |
| `gpuOcclusion: boolean` | True when GPU occlusion culling runs on WebGPU: each camera view draws the depth of the objects that `setOccluder(true)` marks and that it showed in the last frame, and skips every object that lies wholly behind them. A frame without marked objects pays nothing for it. The page's `gpuOcclusion` option of `createEngine` sets it, and `set` does not take it. It is always false on WebGL2, and when the depth prepass is on. |
| `morphTargets: number` | The most morph target weights of each object that a WebGL2 device draws, a whole number from 1 to 256. Each object keeps the weights farthest from 0, and draws the others as 0. WebGPU draws every weight. The `morphTargets` option of `createEngine` sets it, and `set` does not take it. |
| `softwareOcclusion: boolean` | True when software occlusion culling runs on WebGL2: each frame, the job workers draw the objects that `setOccluder(true)` marks into a small depth buffer, and the engine skips every object that lies wholly behind them. It costs the job workers time for each blocker, and saves drawing what they hide. It changes during play. WebGPU ignores it. |

## `TargetFps`

```ts
type TargetFps = 'display' | number;
```

The frame rate that the engine defends, as `createEngine`'s `targetFps` option and the `?target-fps=` switch name it: `display` for the display's full refresh rate, or a whole number of frames per second that caps the target. Without it, the target is at most 60.

## `TextureMemory`

Interface `TextureMemory`.

The GPU memory that textures take, against the quality setting `textureMemoryMiB`, and the mip levels that the engine dropped to stay under it, as `quality.textureMemory` reports them.

| Member | Description |
| --- | --- |
| `readonly bytes: number` | The GPU bytes that every texture takes now, with the free layers of their texture arrays. |
| `readonly budgetBytes: number` | The GPU bytes that textures may take: `textureMemoryMiB` in bytes. |
| `readonly droppedLevels: number` | The largest mip levels that the engine dropped, over every texture. |
| `readonly droppedTextures: number` | The textures that hold fewer mip levels than their own. |
