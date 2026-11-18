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

## `deviceKind`

```ts
function deviceKind(hints: DeviceHints): DeviceKind
```

The kind of device that the hints describe.

## `DeviceKind`

```ts
type DeviceKind = 'phone' | 'tablet' | 'desktop';
```

A kind of device, as the main pointer and the screen's smaller edge tell them apart.

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
| `readonly highest: QualityPreset` | The heaviest preset that the GPU path allows. `setPreset` caps a heavier request at this one, so a page can tell which presets this device cannot run. |
| `readonly settings: Readonly<QualitySettings>` | The settings in use: the preset's values, with the values of the page's options and the changes that `set` made. |
| `readonly renderScale: number` | The render scale that the engine draws the scene at: the part of the canvas's width and height, from `minRenderScale` to `maxRenderScale`. The engine lowers it when frames take too long and raises it again when they have time to spare. A change of the range applies to the frame being drawn. |
| `readonly governor: QualityGovernor` | What the frame-budget governor has lowered below `settings`. When frames take too long, the governor lowers the render scale, then the levels of detail, the shadow settings, the effects' settings and the far characters' updates, one step at a time, in the order that the quality presets page lists. The `onChange` handlers run after each of those steps, but not after a step of the render scale. Hold mode has no governor, so it draws with the settings as set. |
| `readonly textureMemory: TextureMemory` | The GPU memory that textures take, against `settings.textureMemoryMiB`, and the mip levels that the engine dropped to stay under it. The `onChange` handlers run after the engine drops levels or asks for them again. |
| `set(settings: Partial<QualitySettings>): Promise<void>` | Changes settings from the next frame on, and resolves at once. It takes the settings that change during play, each with a value that the setting takes, and throws E1213 for any other setting or value, or for a `minRenderScale` above `maxRenderScale`. A setting that it does not get keeps its value. |
| `setPreset(preset: QualityPreset): Promise<void>` | Switches to another preset at a point that the sketch picks, such as a menu or a loading screen. Every setting that changes during play takes the new preset's value, including the settings that `set` changed, apart from those that the page's options give. The settings fixed when the engine starts, such as `antialias`, keep their values. The GPU path caps the preset, as it caps the page's choice. The promise resolves once the engine has drawn a frame at the new preset with all of its pipelines built. Until then the last frame stays on screen, and the sketch's frames wait. A name that is no preset throws E1213. |
| `setBudget(options: QualityBudgetOptions): QualityBudget` | Registers a budget for a system of the sketch's own, such as its AI or its particles, and returns it. The frame-budget governor gives every budget one scale from 0 to 1, each no lower than its `min`. When frames take too long, the governor lowers the scale by 0.25 before each step of the render scale, so the system scales down before the render scale reaches its floor. It raises the scale again in the reverse order. A budget with the name of another replaces it. Options that the call does not take throw E1213. |
| `onChange(handler: (quality: Quality) => void): () => void` | Calls `handler` at the start of the first frame after the settings change. Returns a function that removes the handler. |

## `QualityBudget`

Interface `QualityBudget`.

A budget that `quality.setBudget` registered: the scale that the frame-budget governor gives the system now.

| Member | Description |
| --- | --- |
| `readonly name: string` | The system's name. |
| `readonly scale: number` | The scale from `min` to 1 that the system runs at now: 1 at full quality. The governor lowers it in steps of 0.25 when frames take too long, and raises it again when they have time to spare. |
| `readonly ms: number` | The time in ms that the system may take in each frame now: the budget's `ms` times `scale`. |
| `remove(): void` | Removes the budget: the governor stops lowering the system, and `onScale` is not called again. The scale keeps its last value. |

## `QualityBudgetOptions`

Interface `QualityBudgetOptions`.

A system of the sketch's own that the frame-budget governor scales, as `quality.setBudget` gets it.

| Member | Description |
| --- | --- |
| `name: string` | The system's name, such as `'ai'` or `'particles'`. A second budget with the same name replaces the first. |
| `ms: number` | The time in ms that the system may take in each frame at full quality: a number above 0. The engine does not measure the system. It scales this time into the budget's `ms`. |
| `min?: number` | The lowest scale that the governor gives the system, from 0 to 1. The default is 0. |
| `onScale?: (scale: number) => void` | Called with the budget's scale when the budget is set, and again at the start of each frame after the governor moves it. |

## `QualityGovernor`

Interface `QualityGovernor`.

What the frame-budget governor has lowered, in `quality.governor`. It lowers a sketch's budgets and the render scale in turn, a budget's step first, which `quality.renderScale` reports, then the settings here, and last the volumetric fog's slices, which have no member here.

| Member | Description |
| --- | --- |
| `readonly steps: number` | The steps past the render scale that the governor has taken: 0 while every setting applies as set. The steps of the levels of detail and of the volumetric fog count too. Each step lowers the frame's cost after the render scale has reached `minRenderScale`, so a sketch can lighten its own work too, such as its particles. |
| `readonly farCascadeInterval: number` | How often each far shadow cascade draws now: `settings.farCascadeInterval`, or up to twice as long for each of the governor's steps, at most every 8th frame. While `settings.followMovingCasters` is false, the governor takes no such step. |
| `readonly shadowFilter: 3 \| 5` | The shadow filter that shadows draw with now: `settings.shadowFilter`, or 3 after the last step. |
| `readonly bloomSize: number` | The texels on the short side of bloom's largest level now: `settings.bloomSize`, or half as many after the governor's step that follows the shadow steps, while bloom is on. The glow keeps its size. |
| `readonly aoScale: number` | The size of ambient occlusion's targets now: `settings.aoScale`, or half as large after the governor's step that follows bloom's while ambient occlusion draws, and then 0 when the frames still run long, which draws none. |
| `readonly ssrScale: number` | The size of screen-space reflections' grid now: `settings.ssrScale`, or a quarter of the render size after the governor's step that follows ambient occlusion's while reflections draw. |
| `readonly contactShadowSteps: number` | The steps of each search for the sun's contact shadows now: `settings.contactShadowSteps`, or the fewest after the governor's last step. |
| `readonly farAnimationInterval: number` | The frames between two updates of a far character's pose now. It is `settings.farAnimationInterval`, or up to twice as long for each of the governor's last steps, at most every 4th frame. Give it to `animator.setUpdateInterval` for the characters that the camera sees from far. |

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
| `farAnimationInterval: number` | How often a far character's pose updates: once in this many frames, from 1 to 4. Give it to `animator.setUpdateInterval` for the characters that the camera sees from far. Give 1 to the ones near it, so a crowd samples and skins less without a near character stepping. The governor raises it when frames take too long, after its shadow and effect steps and before its step of the volumetric fog. It changes during play. |
| `shadowCascadeBlend: number` | The share of each shadow cascade's length, at its far end, over which its shadow blends into the next cascade's, from 0 to 0.5. The blend hides the line where a near cascade's sharper shadows hand over to a far cascade's softer ones. Pixels in the band read both cascades, so a wider band costs a little more. 0 hands over at once. It changes during play. |
| `bloomSize: 64 \| 128 \| 256 \| 512` | The texels on the short side of the largest level of bloom's chain: 64, 128, 256 or 512. A smaller value costs less and keeps the glow's size, with a softer core. The base never takes more than half the canvas's short side. It changes during play, which makes bloom's targets again. |
| `aoScale: 0 \| 0.25 \| 0.5` | The size of ambient occlusion's targets, as a share of the render size each way: 0.5, 0.25, or 0, which draws no ambient occlusion even when `post.set` turns it on. A smaller share costs less, with softer occlusion. It changes during play: 0.5 and 0.25 make no GPU object, and a change to or from 0 adds or removes ambient occlusion's passes. |
| `contactShadowSteps: 0 \| 4 \| 8 \| 16` | The steps of each search for the sun's contact shadows: 4, 8 or 16, or 0, which draws none. More steps find thinner contacts and cost more. Contact shadows need a directional light that casts shadows, with a `contactDistance` above 0. They read the depth of a prepass, which they turn on where the preset leaves it off. It changes during play. |
| `dofSamples: 0 \| 16 \| 22 \| 43 \| 71` | The taps of depth of field's gather: 16, 22, 43 or 71, or 0, which draws no depth of field even when `post.set` turns it on. More taps fill a wide blur more smoothly and cost more. It changes during play. |
| `subsurfaceSamples: 0 \| 11 \| 17 \| 25` | /** The taps of each step of the subsurface blur, which spreads the light under the surface of materials with a `subsurfaceRadius`, such as skin: 11, 17 or 25, or 0, which draws no blur. More taps spread a wide blur more smoothly and cost more. High takes 17 and Ultra 25; Low and Medium take 0. The blur needs HDR color: a value above 0 that the page or the sketch gives moves compatibility mode from its 8-bit path to HDR color, as bloom does. It changes during play. |
| `ssrScale: 0 \| 0.25 \| 0.5` | The size of screen-space reflections' grid, as a share of the render size each way: 0.5, 0.25, or 0, which draws no screen-space reflections even when `post.set` turns them on. A smaller share costs less, with blockier edges where reflections start and stop. It changes during play: 0.5 and 0.25 make no GPU object, and a change to or from 0 adds or removes the reflections' passes. |
| `ssrSteps: 16 \| 24 \| 32 \| 48 \| 64` | The most steps of each reflected ray's march: 16, 24, 32, 48 or 64. More steps let rays reach farther objects and cost more. It changes during play. |
| `bounceRays: 0 \| 4 \| 8 \| 16` | The rays that each texel of screen-space bounce light casts: 0, 4, 8 or 16. 0 draws no bounce light, which leaves the environment's indirect light alone. Each ray marches through the depth that the frame saw and takes the light that the frame before showed where it lands, so more rays make the light smoother and cost more. It changes during play. |
| `exposureMeter: 'downsample' \| 'histogram'` | How automatic exposure meters the scene's brightness while `post.set` turns it on: `histogram` bins a grid of samples in compute shaders, on WebGPU, and `downsample` averages 16 x 16 cells of the image, on every GPU path. WebGL2 always takes the downsample. The downsample costs less, with a coarser meter. It changes during play. |
| `fogSlices: 0 \| 32 \| 64 \| 96` | The slices of the volumetric fog's grid along the view: 32, 64 or 96, with 64, 96 or 128 cells across its short side, or 0, which draws no volumetric fog even when `scene.setFog` turns it on. The fog then keeps its sun glow. More slices give finer light shafts and cost more. It changes during play. |
| `reflectionScale: 0.25 \| 0.5 \| 1` | The size of a reflection pass's texture, as a share of the render size each way: 1, 0.5 or 0.25, for each reflection whose `scale` option names none. A reflection draws the scene again, so a smaller share costs less, with a softer reflection. It changes during play, which makes the reflections' textures again. |
| `probeSize: 128 \| 256 \| 512` | The texels across the largest level of each reflection probe's map: 128, 256 or 512. A larger map gives sharper reflections on polished surfaces, and takes four times the memory for each step. It changes during play, which makes the maps again and captures every probe again. |
| `areaLights: number` | The most rectangle and tube lights that one frame shades, a whole number from 0 to 64. When more are in view, the ones that give the camera the most light shade: the brightest and largest, for their distance. A light that joins or leaves them fades over a few frames. An area light costs each surface it reaches several times what a point light costs. It changes during play. |
| `lightFit: boolean` | Whether the light clustering fits its depth slices to the depth that the frame before measured, on WebGPU. A fitted slice lists fewer lights per shaded fragment, and every fragment reads the grid's header to find its slice. False keeps the CPU's slicing and its lookup in the frame uniform. It changes during play. |
| `lodThreshold: number` | The error in pixels under which a mesh's coarser level of detail draws (see `mesh.setLevels`). Each object and instance row draws the coarsest level whose error covers fewer pixels than this on the screen, at the render scale. A larger number draws coarser levels nearer the camera, which costs less. 0 draws every mesh's base level. It takes a number from 0 to 16, and changes during play. |
| `lodShadowThreshold: number` | The error in texels of a shadow map under which a shadow caster's coarser level of detail draws in that map. Each cascade and each spot or point light's tile picks the level in its own texels, whatever the camera's distance, so a shadow map that keeps its depth between draws stays right as the camera moves. A caster whose bounds cover fewer texels than this draws nothing in the map. A larger number draws coarser casters, which costs less. 0 draws every caster's base level. It takes a number from 0 to 16, and changes during play. |
| `lodFade: boolean` | Whether a mesh's distance band, from `setDrawRange`, fades at each edge over a short band where a dither pattern drops a growing share of the pixels, so the mesh does not pop. False cuts each edge at once. A level of detail's own hand-over follows the level: a hand-set level fades whatever this setting, and a measured one switches at once until the governor raises the threshold above about one and a half pixels, where it fades. It changes during play. |
| `physicalSky: boolean` | Whether `{ atmosphere }` backgrounds draw the physical sky from its tables. False draws three.js's analytic sky in its place, with the same sun, moon, air and clouds, matched to the physical sky's brightness, and keeps the haze on distant objects. It changes during play. |
| `cloudSteps: number` | The steps of each ray of the sky's volumetric cloud tier. Above 0 the sky draws volumetric clouds in place of the flat layer, from the same cloud settings, with this many steps along each ray; 0 draws the flat layer, as the lighter presets do. It changes during play. The noise field and the tier's shaders load at its first use. The sky's environment map marches at most 16 steps, and draws them only from a start above 0, because it picks its tier's shaders then. |
| `governor: boolean` | Whether the frame-budget governor runs. When frames take too long, it lowers the settings one step at a time: a sketch's budget and the render scale in turn, a budget's step first, so a sketch's system scales down before the render scale reaches `minRenderScale`; once the scale is at its floor, the budgets' remaining steps come first. Then it raises `lodThreshold` up to four times while a mesh has levels of detail. Then it lowers how often far shadow cascades draw, the shadow filter, bloom's size while bloom is on, ambient occlusion's scale while it draws, the scale of screen-space reflections while they draw, the steps of contact shadows, how often far characters' poses update, and the volumetric fog's slices while it draws. It raises them again, in the reverse order, once frames have time to spare. `quality.governor` reports its steps. False keeps the render scale at `maxRenderScale` and the other settings as set, as benchmarks and captures need. It changes during play. |
| `antialias: 'none' \| 'fxaa' \| 'msaa'` | How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa` smooths edges in the final pass, and `none` leaves them sharp. The mode is fixed when the engine starts: the page's `antialias` option of `createEngine` sets it, and `set` does not take it. |
| `momentTransparency: boolean` | True to blend the camera's blended surfaces in the moment transparency layer, which needs no sort and is nearer an exact back-to-front blend than `blending: 'weighted'` is, and which draws those surfaces twice. The mode is fixed when the engine starts: the page's `momentTransparency` option of `createEngine` sets it, and `set` does not take it. |
| `shadowCascades: number` | The cascades of a directional light's shadows, a whole number from 1 to 4, for each light whose `shadow` options name none. More cascades keep shadows sharp further from the camera, and each draws the shadow casters once more. The `shadowCascades` option of `createEngine` sets it, and `set` does not take it. |
| `shadowMapSize: number` | Texels on each side of each cascade's shadow map, for each directional light whose `shadow` options name no `mapSize`: 512, 1,024, 2,048 or 4,096. A larger map gives sharper shadow edges and takes more memory, 2 bytes per texel in each cascade. The `shadowMapSize` option of `createEngine` sets it, and `set` does not take it. |
| `shadowTiles: number` | The most tiles of the shadow atlas, which spot and point lights cast their shadows into: a spot light takes one tile. When more lights cast shadows than the tiles hold, the lights that look largest from the camera get them. It takes a whole number from 0, which turns the shadows of spot and point lights off, to 24. The `shadowTiles` option of `createEngine` sets it, and `set` does not take it. |
| `shadowTileSize: number` | Texels on each side of each tile of the shadow atlas: 256, 512, 1,024 or 2,048. Larger tiles give sharper shadows and take more memory, 4 bytes per texel. The `shadowTileSize` option of `createEngine` sets it, and `set` does not take it. |
| `heroTileSize: number` | Texels on each side of the tile that holds a directional light's hero shadow, for each light whose `shadow` options name no `heroTileSize`: 1,024, 2,048 or 4,096. The tile is a layer of the shadow atlas, so every layer takes its size and a larger one takes more memory, 4 bytes per texel. The `heroTileSize` option of `createEngine` sets it, and `set` does not take it. |
| `pointLightShadows: boolean` | True when point lights cast shadows. Each point light that casts them takes six tiles of the shadow atlas, one for each face of a cube around it, within `shadowTiles`. The `pointLightShadows` option of `createEngine` sets it, and `set` does not take it. |
| `depthPrepass: boolean` | True when the engine draws the depth of the opaque objects before it shades them, so it shades each pixel once, for its nearest surface. Every preset turns it on for WebGL2 and off for WebGPU. The setting is fixed when the engine starts: the page's `depthPrepass` option of `createEngine` sets it, and `set` does not take it. |
| `gpuOcclusion: boolean` | True when GPU occlusion culling runs on WebGPU: each camera view draws the depth of the opaque objects that showed in the last frame and look large on the screen, and skips every object that lies wholly behind them. `setOccluder(false)` keeps an object out of them. A check during play turns the extra passes off while they hide too little or make the GPU's frame longer, and on again when they pay. High and Ultra turn it on for desktops, and phones and tablets keep it off unless the page asks for it. The page's `gpuOcclusion` option of `createEngine` sets it, and `set` does not take it. It is always false on WebGL2, and when the depth prepass is on. |
| `morphTargets: number` | The most morph target weights of each object that a WebGL2 device draws, a whole number from 1 to 256. Each object keeps the weights farthest from 0, and draws the others as 0. WebGPU draws every weight. The `morphTargets` option of `createEngine` sets it, and `set` does not take it. |
| `softwareOcclusion: boolean` | True when software occlusion culling runs on WebGL2: each frame, the job workers draw the objects that `setOccluder(true)` marks into a small depth buffer, and the engine skips every object that lies wholly behind them. It costs the job workers time for each blocker, and saves drawing what they hide. Every preset leaves it off, and the `softwareOcclusion` option of `createEngine` turns it on. It changes during play. WebGPU ignores it. |
| `parallax: boolean` | True when materials with `parallax` draw it. Off, they draw with their displacement map alone, which saves a dozen texture reads or more at each of their pixels. It changes during play. |
| `softParticles: boolean` | True when particle systems with `softness` fade where they near the surfaces behind them. The camera then copies its opaque depth once per frame, while such a system draws. False draws them with hard edges where they cut into the scene. It changes during play. |

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
