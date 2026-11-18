---
id: api/reference/post
title: "Post-processing API: API reference"
status: generated
since: "0.1"
summary: "Every export of the Post-processing API API, from the engine's doc comments."
---

# Post-processing API: API reference

> [Post-processing API](../post.md) explains these exports. The engine's doc comments make this page.

## `AoSettings`

Interface `AoSettings`.

Ambient occlusion's settings, with the meanings of three.js's `GTAOPass`. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `radius?: number` | How far from a surface the search for what hides it reaches, in world units: 0 or more, and 0.25 by default, as `GTAOPass`'s `radius`. |
| `thickness?: number` | How far in front of a surface, along the view, an object still hides it, in world units: 0 or more, and 1 by default. Objects farther in front cast no occlusion, so a thin pole does not darken the wall far behind it. |
| `distanceExponent?: number` | How the search's steps spread over the radius: 1 spreads them evenly, the default, and higher values gather them near the surface. It is above 0. |
| `distanceFalloff?: number` | From 0 to 1: how much less the farther steps of the search count. It is 1 by default, as `GTAOPass`'s `distanceFallOff`. |
| `scale?: number` | The power that the occlusion is raised to: 0 or more, and 1 by default. Above 1 it darkens. |
| `samples?: number` | The depth samples that each pixel's search reads: a whole number from 1 to 64, and 16 by default. Below 30 they spread over 3 directions, and from 30 over 5. |
| `intensity?: number` | From 0 to 1: how much of the occlusion reaches the ambient light. It is 1 by default, as `GTAOPass`'s `blendIntensity`. |

## `AutoExposureSettings`

Interface `AutoExposureSettings`.

Automatic exposure's settings. The engine meters the scene's brightness on the GPU in each frame, and moves the exposure toward it, as an eye or a camera adapts. Brightness counts in stops from the camera's exposure: at 0 the scene shows as the `exposure` and `ev100` settings show it, and each stop is twice as bright. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `metering?: ExposureMetering` | How the meter averages the scene's brightness. It is `'percentile'` by default. |
| `percentiles?: readonly [number, number]` | For `'percentile'` metering, the shares of the image, from the darkest, that the mean starts and ends at: two numbers from 0 to 1, the first no larger, and `[0.1, 0.9]` by default. `[0.5, 0.5]` takes the median. |
| `centerWeight?: number` | How much more the center of the image counts than its edges: 0 counts every part the same, and 1 counts the edges very little. It is 0.5 by default. |
| `speedUp?: number` | How fast the eye adapts while the scene grows brighter, in stops per second: 0 or more, and 3 by default. Within one stop of the target it slows down, so it settles smoothly. |
| `speedDown?: number` | How fast the eye adapts while the scene grows darker, in stops per second: 0 or more, and 1 by default. Eyes adapt to the dark more slowly than to the light. |
| `minEv?: number` | The darkest scene that the eye adapts to, in stops from the camera's exposure: -4 by default. A darker scene shows darker. With `ev100`, the eye adapts down to a scene of about `ev100 + minEv`. |
| `maxEv?: number` | The brightest scene that the eye adapts to, in stops from the camera's exposure: 4 by default, and no lower than `minEv`. A brighter scene shows brighter. |
| `compensation?: number` | Stops added to the adapted exposure: 1 shows the picture twice as bright, and -1 half as bright. It is 0 by default. |

## `BloomBlend`

```ts
type BloomBlend = 'mix' | 'add' | 'screen';
```

How bloom's glow meets the scene's color. The `'mix'` blend moves each pixel's color toward the glow by the intensity, which keeps the image's total light. The `'add'` blend adds the glow, as three.js's `UnrealBloomPass` does. The `'screen'` blend screens it, as pmndrs's `BloomEffect` does.

## `BloomSettings`

Interface `BloomSettings`.

Bloom's settings. Bloom blurs the scene's color through a chain of up to 10 levels, each half the size of the one before. It blends their sum into the image. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `intensity?: number` | How strong the glow is: 0 or more, and 0.15 by default. With the `'mix'` blend it is the glow's share of each pixel, at most 1. With `'add'` and `'screen'` it multiplies the glow. |
| `threshold?: number` | The luminance from which a pixel glows, in linear color before the exposure: 0 or more, and 0 by default, so all light glows a little. At 1, only colors brighter than white glow, such as strong emissive light. |
| `knee?: number` | The width of the threshold's soft edge, in luminance: 0 or more, and 0.1 by default. A pixel glows more as its luminance rises from the threshold to the threshold plus this width. |
| `blend?: BloomBlend` | How the glow meets the scene's color. It is `'mix'` by default. |
| `weights?: readonly number[]` | Each level's share of the glow, from the narrowest level to the widest: up to 10 numbers of 0 or more, not all 0. The engine divides them by their sum, and a missing level takes 0. Each level spreads light twice as far as the one before: the eighth over about a quarter of the canvas's shorter side, and the tenth over all of it. Levels past the last one with a weight cost nothing. The default gives 8 levels weights, most to the narrow ones, for a soft glow. |

## `DofSettings`

Interface `DofSettings`.

Depth of field's settings: a camera lens's blur, which keeps sharp only what lies near the focus distance. The lens is a photographer's: a focal length in millimeters on a full-frame sensor, 24 mm tall, and an aperture as an f-number. World units count as meters. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `focusDistance?: number` | The distance from the camera, along its view, that is sharp, in world units: above 0, and 10 by default. Setting it stops a focus on `focusPoint`. |
| `focusPoint?: Vec3Like \| false` | A point in the world to focus on in every frame, as a camera's autofocus does: the focus follows the camera and the point. `false`, the default, focuses at `focusDistance`. The engine reads the point when `post.set` runs, so a sketch that follows a moving point passes it again each frame. |
| `aperture?: number` | The aperture as an f-number, above 0, and 2.8 by default. A lower number opens the lens and blurs more: f/1.4 blurs twice as much as f/2.8. |
| `focalLength?: number \| 'camera'` | The lens's focal length in millimeters, above 0, or `'camera'`, the default, for the active camera's: its field of view on a full-frame sensor, which `camera.setFocalLength` sets. A longer lens blurs more at the same aperture. |
| `maxBlur?: number` | The largest blur radius, as a share of the image's height: 0 to 0.1, and 0.02 by default. It caps the blur of things very near the camera, and the gather never reaches further. |
| `blades?: number` | The shape of out-of-focus highlights, the bokeh: 0, the default, for a round aperture, or a whole number from 3 to 12 for a polygon with that many blades. |

## `Effect`

Class `Effect`.

A custom effect that `post.addEffect` added. `post.setEffectUniform` changes its uniforms, and `post.removeEffect` removes it. `Values` gives the names and types of its uniforms.

| Member | Description |
| --- | --- |
| `readonly live: boolean` | True until `post.removeEffect` removes the effect. |

## `EffectOptions`

Interface `EffectOptions`.

Options of `post.addEffect`: the effect's WGSL, the first values of its uniforms, and its place among the effects. `Wgsl` is the type of the effect's WGSL. It gives the names and types of the uniforms.

| Member | Description |
| --- | --- |
| `wgsl: Wgsl` | The effect's WGSL, compiled by the null3D Vite plugin. It declares `fn effect(input: EffectInput) -> vec4f`, which the engine calls for each pixel of the scene's image. It can declare `struct Uniforms`, whose fields the effect reads from `uniforms`. Effects made from the same WGSL share their shader. |
| `uniforms?: NoInfer<[keyof UniformValues<Wgsl>] extends [never] ? { readonly [name: string]: never; } : UniformValues<Wgsl>>` | The first value of each uniform, by name. A uniform without one starts at 0. When TypeScript can see the WGSL's uniforms, a name that the WGSL does not declare fails the type check. |
| `textures?: NoInfer<TextureValues<Wgsl>>` | The texture of each `var name: texture_2d<f32>;` that the WGSL declares, by name: a texture from files or data, or a render pass's texture from `textures.fromPass`. The WGSL samples it as `textureSampleLevel(name, nameSampler, uv, 0.0)`. A texture samples as white until its image is on the GPU, and a declared texture without one stays white. An effect with textures draws in a pass of its own. The textures are fixed when the effect is added. |
| `order?: number` | The effect's place among the effects: effects run from the lowest order to the highest, and effects of the same order run in the order they were added. It is 0 by default. |
| `bloomLevel?: number` | The level of bloom's chain that the effect reads, from 0 for the narrowest glow to 9 for the widest, for WGSL that calls `effectBloom`. The effect reads the level at any pixel of the image, so it draws in a pass of its own. Turn bloom on, with `post.bloom`, to give the chain to the effect. A level that the chain does not draw reads black. |

## `ExposureMetering`

```ts
type ExposureMetering = 'mean' | 'percentile';
```

How automatic exposure averages the scene's brightness. `'mean'` takes the weighted mean of every part of the image. `'percentile'` leaves out its darkest and brightest parts, by the `percentiles` setting, so a bright window or a black corner moves the exposure less.

## `GradingSettings`

Interface `GradingSettings`.

The grading controls that `post.set` takes: white balance, then lift, gamma and gain on each channel, then saturation, then split toning. A job worker bakes them into a table of 32 texels a side, which the final pass reads on every GPU path. A setting that a call leaves out keeps its value; `false` turns the grading off.

| Member | Description |
| --- | --- |
| `whiteBalance?: WhiteBalanceSettings \| false` | Corrects the light's color temperature, or `false` to leave colors as they are. |
| `lift?: readonly [number, number, number]` | Adds a value to each channel before the curve: 0 leaves a channel as it is, and positive values lift the blacks. Each channel's value is between -1 and 1. |
| `gamma?: readonly [number, number, number]` | The gamma of each channel, above 0. A channel is raised to the power of one over its gamma, so values above 1 brighten the shadows and 1 leaves the channel as it is. |
| `gain?: readonly [number, number, number]` | A factor for each channel, from 0 up: 1 leaves a channel as it is, and higher values brighten the highlights and the whites. |
| `saturation?: number` | How much color the picture keeps: 0 is gray, 1 leaves it as it is, and higher values add color. |
| `splitToning?: SplitToningSettings \| false` | Tints the shadows and the highlights with a hue each, or `false` to leave them as they are. |

## `OutlineSettings`

Interface `OutlineSettings`.

The outline's settings: a sharp line of one width around the objects that `setOutlined(true)` marks. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The color of the line around the parts that nothing hides. The canvas shows this color exactly: the exposure and the tone mapping do not change it. It is white by default. |
| `hiddenColor?: ColorInput \| false` | The color of the line around the parts that other objects hide, or `false` for no line there. It is `false` by default. |
| `width?: number` | The line's width in CSS pixels: 0 or more, and 2 by default. Above about 4 pixels of the canvas, parts thinner than the line can leave a gap between themselves and their line. |

## `Post`

Class `Post`.

The post-processing settings, as `ctx.post`. The engine applies them to every pixel of the scene, the background included, after lighting and before the canvas shows it.

| Member | Description |
| --- | --- |
| `dropViews(): void` | Forgets the view of the block, which the next write makes again. |
| `addEffect<const Wgsl extends string \| CompiledWgsl>(options: EffectOptions<Wgsl>): Effect<UniformValues<Wgsl>>` | Adds a custom effect, which runs from the next frame on, and returns it. An effect is a full-screen pass of WGSL that declares `fn effect(input: EffectInput) -> vec4f`. It reads the scene's HDR color after the exposure, before bloom and the tone mapping, and returns the new color. Effects run from the lowest `order` to the highest. The engine joins an effect that reads only its own pixel into the pass of the effect before it, so effects take few passes. At most 8 run at once. An effect needs HDR color, as bloom does; on a device without an HDR target it stays off, and development builds warn once. Throws E1215 for WGSL that the null3D Vite plugin did not compile as an effect, E1216 for a uniform that the WGSL does not declare or a value of the wrong kind, E1203 for an order that is not a number, and E1213 for a ninth effect. |
| `setEffectUniform<Values, Name extends keyof Values & string>(effect: Effect<Values>, name: Name, value: NonNullable<Values[Name]>): void` | Changes one uniform of an effect, from the next frame on. It allocates nothing, so a sketch can change a uniform every frame. Keep a vector's values in one array that the sketch changes in place. Throws E1216 for a uniform that the effect's WGSL does not declare or a value of the wrong kind, and E1101 for an effect that `removeEffect` removed. |
| `removeEffect<Values>(effect: Effect<Values>): void` | Removes an effect from the next frame on. Removing an effect twice does nothing. |
| `addFeatureEffect<const Wgsl extends string \| CompiledWgsl>(description: FeatureDescription, options: FeatureEffectOptions<Wgsl>): Promise<FeatureEffect<UniformValues<Wgsl>>>` | An add-on's full-screen pass, declared by a feature description with the kind `'fullscreen'` at the `'resolve'` point. The description gives the place where the pass runs, what it reads and writes, and whether it draws at all. The options give the WGSL, its first values and its textures, as `addEffect` takes them. The adapter loads on first use. The effect runs while the feature is ready. The adapter asks again when the quality changes, so a feature that the preset or the sketch switches off costs no pass and no target. Its values stay, and apply when it draws again. Throws E1223 for a description that this adapter cannot place, and the errors of `addEffect` for WGSL and values that the chain refuses. E1406 when the adapter does not download. |
| `set(settings: PostSettings): void` | Changes the settings that `settings` gives, from the next frame on. It allocates nothing, so a sketch can change the exposure, bloom, the outline, the table's intensity or the vignette every frame. It throws E1213 for a setting or a tone mapping it does not know, or a value out of its range, E1203 for a value that is not a number, E1204 for a color it cannot read, and E1101 for a table that was destroyed. |

## `PostSettings`

Interface `PostSettings`.

Settings for `post.set`. A setting that the call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `toneMapping?: ToneMapping \| ToneCurve` | How the engine maps high dynamic range color to the screen: a built-in curve's name, or a custom tone curve's WGSL. The default is `'agx-punchy'`, which keeps the hues of bright colors on their way to white and keeps the picture's contrast. three.js uses no tone mapping by default, so a port of a three.js scene without it sets `'none'`. A custom curve needs HDR color, as bloom does; on a device without an HDR target the built-in curve stays. |
| `exposure?: number` | Scales the scene's color before the tone mapping, as three.js's `toneMappingExposure` does: 2 is one stop brighter, and 0.5 one stop darker. It is 0 or more, and 1 by default. With `ev100`, it scales the camera's exposure, as exposure compensation does. |
| `ev100?: number \| false` | The camera's exposure value at ISO 100, for lights in real units: 15 suits a sunny day lit by a sun of 100,000 lux, 12 an overcast day, and 7 a lit room. It scales the scene's color by 1 / (1.2 × 2^ev100), as Filament and Bevy do, so each step up is one stop darker. It is a number from -20 to 30, and `false`, the default, turns it off, which leaves three.js's units. |
| `bloom?: BloomSettings \| false` | Light that spreads from the bright parts of the scene through a chain of blurred levels. Settings turn bloom on, `{}` with the values it had, and `false` turns it off. It is off by default. Its glow keeps its size as a share of the canvas at any pixel ratio and render scale. |
| `ao?: AoSettings \| false` | Ambient occlusion: darkens the ambient light where nearby surfaces hide a surface from the sky, as three.js's `GTAOPass` finds it. It darkens only the light that comes from all around, where `GTAOPass` darkens the whole image. Settings turn it on, `{}` with the values it had, and `false` turns it off. It is off by default, and draws only where the quality setting `aoScale` is above 0. |
| `lut?: Lut \| false` | A color grading table from `assets.loadLut` or `assets.lutFromData`, which maps each pixel's color after the tone mapping, as three.js's `LUTPass` does. `false` turns it off. It is off by default. |
| `lutIntensity?: number` | The share of the table's color in each pixel, from 0 for none to 1 for all of it, as `LUTPass`'s `intensity`. It is 1 by default. |
| `grading?: GradingSettings \| false` | The grading controls: white balance, lift, gamma, gain, saturation and split toning, which a job worker bakes into a table of 32 texels a side. The final pass grades each pixel's display color with the table after the tone mapping, so changing a value costs no frame work. The picture shows the new grade once the worker has baked the table. Settings turn it on, `{}` with the values it had, and `false` turns it off. It is off by default. |
| `vignette?: VignetteSettings \| false` | Darkens the picture toward its edges. Settings turn the vignette on, `{}` with the values it had, and `false` turns it off. It is off by default. |
| `outline?: OutlineSettings \| false` | A sharp line around the objects that `setOutlined(true)` marks. Settings turn outlines on, `{}` with the values they had, and `false` turns them off. They are off by default. |
| `dof?: DofSettings \| false` | Depth of field: blurs what lies in front of and behind the focus distance, as a camera lens does, with the near and far fields apart, as three.js's `BokehPass` intends. It runs after the custom effects and before bloom. Settings turn it on, `{}` with the values it had, and `false` turns it off. It is off by default, and draws only where the quality setting `dofSamples` is above 0. |
| `ssr?: SsrSettings \| false` | Screen-space reflections: shiny opaque surfaces reflect what the screen shows along their mirror direction, blurred by their roughness, in place of the environment's reflection. They fade into the environment's light where the screen holds no hit, as near its edges, so wet streets, polished floors and metal reflect the scene around them. Settings turn them on, `{}` with the values they had, and `false` turns them off. They are off by default, and draw only where the quality setting `ssrScale` is above 0. A planar reflection pass's reflection wins on its plane. |
| `autoExposure?: AutoExposureSettings \| false` | Automatic exposure: the picture adapts to the scene's brightness over time, as an eye does, so a dark hall brightens after a sunny street. The engine meters each frame on the GPU, and the final pass multiplies the color by the adapted exposure before the tone mapping. The scene draws at the camera's `exposure` and `ev100`, and the eye adapts from there. Settings turn it on, `{}` with the values it had, and `false` turns it off. It is off by default. It needs HDR color, as bloom does. |
| `sharpen?: number \| false` | Sharpens edges and fine detail: a share from 0 for none to 1 for the most, or `false` to turn it off. It is off by default, and 0.5 is a good start. The engine sharpens the display color after the tone mapping, so bright edges cannot gain rings the way sharpened light does. It draws at the whole canvas's render scale; below one, the upscale sharpens the image itself. See the post-processing concepts page. |

## `SplitToningSettings`

Interface `SplitToningSettings`.

The colors that tint the shadows and the highlights, and where the split between them falls.

| Member | Description |
| --- | --- |
| `shadows?: ColorInput` | The hue that tints the dark parts of the picture, as a color. Its brightness does not matter, only the hue that it adds: a gray tint changes nothing. |
| `highlights?: ColorInput` | The hue that tints the bright parts of the picture, as a color. |
| `balance?: number` | Where the split between shadows and highlights falls, from -1 to 1: 0 the middle of the picture's brightness, higher values tint more of it with the shadows' hue, and lower values more with the highlights'. |
| `strength?: number` | How much of the tints reaches the picture, from 0 for none to 1 for the most. |

## `SsrSettings`

Interface `SsrSettings`.

Screen-space reflections' settings, with the meanings of three.js's `SSRPass`. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `intensity?: number` | From 0 to 1: how much of the environment's reflection the screen's reflection replaces where a ray hits, and 1 by default, as `SSRPass`'s `opacity`. The material's Fresnel term, metalness and specular values still weigh the reflection. |
| `maxDistance?: number` | How far a reflected ray travels, in world units: above 0, and 100 by default, as `SSRPass`'s `maxDistance`. Reflections fade out over the last fifth of it. |
| `thickness?: number` | How far behind a surface on the screen a ray may pass and still hit it, in world units: 0 or more, and 0.5 by default, as `SSRPass`'s `thickness`. Thin objects need a small value, or objects behind them reflect as if they were solid. |
| `maxRoughness?: number` | The roughest surface that shows screen-space reflections, from 0 to 1, and 0.5 by default. Rougher surfaces keep the environment's reflection. Reflections fade out from 70% of it, and blur more on rougher surfaces. |

## `ToneCurve`

```ts
type ToneCurve = CompiledWgsl | `${string}toneCurve${string}`;
```

A custom tone curve: WGSL that declares `fn toneCurve(color: vec3f) -> vec3f`, compiled by the null3D Vite plugin. The final pass calls it in place of the built-in curves, with the exposed linear color of each pixel. It clamps what the curve returns to 0 to 1. TypeScript sees a tagged template literal as its text, which names the function.

## `ToneMapping`

```ts
type ToneMapping = 'agx' | 'agx-punchy' | 'neutral' | 'aces' | 'none';
```

How the engine maps the scene's high dynamic range color to the screen. Three curves use three.js's formulas: `AgXToneMapping` (`'agx'`), `NeutralToneMapping` (`'neutral'`) and `ACESFilmicToneMapping` (`'aces'`). `'agx-punchy'` is AgX with Filament's punchy look, which adds contrast and color. `'aces'` serves ports of three.js scenes that set it. The value `'none'` clips the exposed color at 1, as `LinearToneMapping` does.

## `VignetteSettings`

Interface `VignetteSettings`.

The vignette's settings. The vignette multiplies each pixel's light by a factor that falls from 1 at the canvas's center toward its edges. It works before the tone mapping, so bright corners darken as dark ones do. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `intensity?: number` | How dark the edges turn: 0 or more, and 1 by default. At 0 nothing changes, and at 1 the edges turn black where the darkening is full. Above 1 they turn black sooner. |
| `size?: number` | How much of the picture the darkening covers: 0 or more, and 1 by default. It scales the distance from the center. From about 1.41 the corners take the full intensity, and higher values darken more of the picture. |
| `falloff?: number` | How fast the light falls from the center: the power of the falloff curve, above 0, and 2 by default. Higher values darken more of the picture, and lower values keep the darkening near the edges. |
| `roundness?: number` | The vignette's shape, from 0 to 1, and 0 by default. At 0 it follows the canvas's shape, an ellipse on a wide canvas. At 1 it is a circle. |

## `WhiteBalanceSettings`

Interface `WhiteBalanceSettings`.

The color temperature that whites take, and the green to magenta shift around it.

| Member | Description |
| --- | --- |
| `temperature?: number` | The color temperature of the light that whites are corrected for, in kelvin: 6500 is neutral. A lower value, such as 3200 for a tungsten lamp, makes the picture cooler, and a higher one, such as 8000 in the shade, makes it warmer. The value is between 1667 and 25000. |
| `tint?: number` | The green to magenta shift, from -1 for green to 1 for magenta. It is 0 by default, and each step of 1 halves or doubles the green channel. |
