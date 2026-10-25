---
id: api/post
title: Post-processing API
status: experimental
since: "0.1"
summary: "post.set for tone mapping, exposure and a camera's EV100, automatic exposure, bloom, ambient occlusion, screen-space reflections, depth of field, outlines, color grading tables and controls, the vignette and sharpening; custom effects with post.addEffect, custom tone curves, and still views."
---

# Post-processing API

> Roadmap step 0.1, first released in null3D 0.1.0. Step 0.2 adds automatic exposure, bloom, ambient occlusion, depth of field, outlines, color grading, the vignette, sharpening, custom effects, custom tone curves and still views. The API is experimental, so it can still change between versions.

`ctx.post` holds the settings that the engine applies to the scene's color on its way to the canvas. They are the tone mapping, the exposure, automatic exposure, bloom, ambient occlusion, screen-space reflections, depth of field, outlines, a color grading table, the vignette, the sharpening and the sketch's own effects. [Color management](../concepts/color-management.md) explains how the first two fit into the frame. [The post-processing chain](../concepts/post-processing.md) explains how bloom, ambient occlusion, screen-space reflections, depth of field and sharpening do.

## Tone mapping and exposure

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ post }) => {
  post.set({ toneMapping: 'neutral', exposure: 1.2 });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `toneMapping` | `'agx-punchy'`, `'agx'`, `'neutral'`, `'aces'`, `'none'`, or a custom tone curve's WGSL | `'agx-punchy'` |
| `exposure` | A number from 0 up. 2 is one stop brighter, and 0.5 one stop darker. | 1 |
| `ev100` | The camera's exposure value at ISO 100, for lights in real units: a number from -20 to 30, or `false` for none | `false` |

- The curves use three.js's formulas: `'agx'` for `AgXToneMapping`, `'neutral'` for `NeutralToneMapping` and `'aces'` for `ACESFilmicToneMapping`. `'agx-punchy'` is AgX with Filament's punchy look, which adds contrast and color. three.js has no such curve.
- `'aces'` serves ports of three.js scenes that set `ACESFilmicToneMapping`. It shifts the hues of bright colors, so new scenes use AgX.
- `'none'` scales the color by the exposure and clips it at white, as three.js's `LinearToneMapping` does.
- three.js uses no tone mapping by default. A port of a three.js scene without tone mapping sets `toneMapping: 'none'`.
- A custom tone curve is WGSL that declares `fn toneCurve(color: vec3f) -> vec3f`, compiled by the null3D Vite plugin. [Custom effects](#custom-effects) shows one. `@null3d/three-compat` gives `ReinhardToneMapping` and `CineonToneMapping` as the `reinhard` and `cineon` curves ([three.js compatibility](three-compat.md)).
- The settings apply to the whole scene, the background included, from the next frame on. A setting that a call leaves out keeps its value.

## Lights in real units

Most scenes and ports keep three.js's units, which need no camera setting. Lights in real units, such as a sun of 100,000 lux, need `ev100`: the exposure value of a camera at ISO 100. The units are on the [Lights](lights.md#color-intensity-and-units) page. Typical values are 15 for a sunny day, 12 for an overcast day and 7 for a lit room. Each step up is one stop darker. The engine scales the scene by 1 / (1.2 × 2^ev100), the formula of Filament, Bevy and Unity's HDRP. The `exposure` setting then scales that, as exposure compensation does. Setting `ev100: false` turns the camera off again.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, post }) => {
  // A sunny day, half a stop brighter than the camera's own exposure.
  post.set({ ev100: 15, exposure: 1.41 });
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 100_000, intensityUnit: 'lux' });
  return {};
});
```

The engine multiplies the exposure into each light, the environment's light, the background color and the fog color. The shaders multiply it into emissive light and unlit colors. The tone mapping then works on values near 1, even with a sun of 100,000 lux. Otherwise its highlights would pass the largest value of the 16-bit float scene color. The picture is the one that an exposure at the end gives. Background and unlit colors take the exposure too. At EV100 15 they draw black unless their own values are in real units, as in three.js at the same exposure.

## Changing the exposure during play

`post.set` allocates nothing, so a sketch can change the exposure every frame. Keep one settings object and change its field, so your own code allocates nothing either:

```ts
export default defineSketch(({ post, time }) => {
  const settings = { exposure: 1 };
  return {
    onUpdate() {
      settings.exposure = 1 + 0.5 * Math.sin(time.now);
      post.set(settings);
    },
  };
});
```

## Automatic exposure

Automatic exposure adapts the picture to the scene's brightness over time, as an eye does. Walk from a sunny street into a dark hall, and the hall starts dark, then brightens over a few seconds. It is off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, post }) => {
  // A dim room: the eye adapts up to 6 stops to see it, and stays a little dark, as eyes do.
  post.set({ autoExposure: { minEv: -6, compensation: -0.5 } });
  scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 1.6, 4], target: [0, 1, 0] }));
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 0.05 });
  scene.createMesh({
    mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
    material: materials.standard({ color: '#c8643c' }),
    position: [0, 0.5, 0],
  });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `autoExposure` | Its settings to turn it on, or `false` to turn it off. | Off |
| `autoExposure.metering` | `'percentile'` leaves out the darkest and brightest parts of the image, and `'mean'` averages all of it. | `'percentile'` |
| `autoExposure.percentiles` | For `'percentile'`, the shares of the image, from the darkest, that the average starts and ends at: two numbers from 0 to 1, the lower first. `[0.5, 0.5]` takes the median. | `[0.1, 0.9]` |
| `autoExposure.centerWeight` | How much more the center of the image counts than its edges, from 0, the same, to 1. | 0.5 |
| `autoExposure.speedUp` | How fast the eye adapts while the scene grows brighter, in stops per second: 0 or more. | 3 |
| `autoExposure.speedDown` | How fast the eye adapts while the scene grows darker, in stops per second: 0 or more. | 1 |
| `autoExposure.minEv` | The darkest scene that the eye adapts to, in stops from the camera's exposure, from -20 to 20. A darker scene shows darker. | -4 |
| `autoExposure.maxEv` | The brightest scene that the eye adapts to, in stops from the camera's exposure, from -20 to 20 and no lower than `minEv`. A brighter scene shows brighter. | 4 |
| `autoExposure.compensation` | Stops added to the adapted exposure, from -20 to 20: 1 shows the picture twice as bright. | 0 |

- The engine meters each frame on the GPU, in the same frame. The meter finds the scene's average brightness on a log scale, and the eye moves toward the exposure that shows it as middle gray.
- The scene draws at the camera's exposure, the `exposure` and `ev100` settings, and the eye adapts from there. A brightness of 0 stops is a scene that the camera's exposure shows as middle gray. With `ev100: 15`, `minEv: -8` lets the eye adapt down to a scene of about EV100 7.
- Within one stop of its target, the eye slows down, so it settles smoothly. Eyes adapt to the dark more slowly than to the light, so `speedDown` is lower by default.
- The first frame that meters takes its target at once, so a scene starts adapted. Hold mode draws one frame, so its image is the adapted image, the same in every run.
- The final pass multiplies the scene's color, bloom's glow and folded effects by the adapted exposure, before FXAA, the vignette and the tone curve. Custom effects and depth of field see the camera's exposure. Bloom's `threshold` keeps its meaning in the scene's units.
- The quality setting `exposureMeter` picks the meter. `'histogram'` bins a grid of samples in compute shaders on WebGPU, on Medium and above. `'downsample'` averages 16 x 16 cells of the image, on Low and on WebGL2. Both take the same settings.
- It needs HDR color, as bloom does. In WebGPU's compatibility mode with MSAA, turning it on moves the engine to HDR color with FXAA. On a device with no HDR target it stays off, and development builds warn once.
- A setting that a call leaves out keeps its value, also while it is off. `post.set({ autoExposure: {} })` turns it on with the values it had.
- `post.set` allocates nothing, and a meter costs nothing while it is off. Its shaders download the first time it turns on.

## Bloom

Bloom spreads light from the bright parts of the scene through a chain of blurred levels. It is off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ post }) => {
  post.set({ bloom: { intensity: 0.2, threshold: 1 } });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `bloom` | Bloom's settings to turn it on, or `false` to turn it off. | Off |
| `bloom.intensity` | How strong the glow is: a number from 0 up. With the `'mix'` blend it is the glow's share of each pixel, at most 1. | 0.15 |
| `bloom.threshold` | The luminance from which a pixel glows, in linear color before the exposure: a number from 0 up. | 0 |
| `bloom.knee` | The width of the threshold's soft edge, in luminance: a number from 0 up. | 0.1 |
| `bloom.blend` | How the glow meets the scene's color: `'mix'`, `'add'` or `'screen'`. | `'mix'` |
| `bloom.weights` | Each level's share of the glow, from the narrowest to the widest: up to 10 numbers from 0 up, not all 0. | Shares for 8 levels |

- `'mix'` moves each pixel's color toward the glow, so the image keeps its total light. `'add'` adds the glow, as three.js's `UnrealBloomPass` does. `'screen'` screens it, as pmndrs's `BloomEffect` does.
- At a threshold of 0, all light glows a little. At 1, only light brighter than white glows, such as an emissive material with an `emissiveIntensity` above 1.
- Each level spreads light twice as far as the one before. The eighth spreads it over about a quarter of the canvas's shorter side, and the tenth over all of it. The engine divides the weights by their sum. Levels past the last one with a weight cost nothing.
- The glow keeps its size as a share of the screen at any pixel ratio, render scale and orientation. The quality setting `bloomSize` sets how many texels the chain's largest level has, which trades the glow's detail for cost.
- A setting that a call leaves out keeps its value, also while bloom is off. `post.set({ bloom: {} })` turns bloom on with the values it had.
- The threshold and its soft edge keep their meaning at any exposure: the engine scales them with the exposure, as it scales the scene's light. In a scene in real units, give them in the scene's units, such as 40,000 for about white at EV100 15.
- In WebGPU's compatibility mode with MSAA, turning bloom on moves the engine to HDR color with FXAA. On a WebGL2 device with no float target, bloom stays off. [The post-processing chain](../concepts/post-processing.md#effects-on-devices-without-hdr-color) explains both.
- `post.set` allocates nothing, so a sketch can change bloom's settings every frame.

## Ambient occlusion

Ambient occlusion darkens the ambient light in corners, in creases and under objects, with the meanings of three.js's `GTAOPass`. It is off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ post, quality }) => {
  quality.set({ aoScale: 0.5 });
  post.set({ ao: { radius: 0.5 } });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `ao` | Its settings to turn it on, or `false` to turn it off. | Off |
| `ao.radius` | How far from a surface the search reaches, in world units: a number from 0 up. | 0.25 |
| `ao.thickness` | How far in front of a surface, along the view, an object still hides it: a number from 0 up. | 1 |
| `ao.distanceExponent` | How the search's steps spread over the radius: a number above 0. Higher values gather them near the surface. | 1 |
| `ao.distanceFalloff` | How much less the farther steps count: a number from 0 to 1. | 1 |
| `ao.scale` | The power that the occlusion is raised to: a number from 0 up. Above 1 darkens it. | 1 |
| `ao.samples` | The depth samples of each pixel's search: a whole number from 1 to 64. | 16 |
| `ao.intensity` | How much of the occlusion reaches the ambient light: a number from 0 to 1. | 1 |

- It darkens only the ambient light and the light that light maps add. `GTAOPass` darkens the whole image, direct light included.
- It draws where the quality setting `aoScale` is above 0: on the High and Ultra presets, or after `quality.set({ aoScale })`. On Low and Medium, the presets of phones and tablets, the scale is 0.
- It turns the depth prepass on while it draws. On a WebGL2 device without float render targets it stays off.
- A setting that a call leaves out keeps its value, also while it is off. `post.set({ ao: {} })` turns it on with the values it had.
- `post.set` allocates nothing, so a sketch can change its settings every frame. Turning it on or off adds or removes passes, which takes a few frames.

## Screen-space reflections

Screen-space reflections make shiny opaque surfaces reflect what the screen shows: wet streets, puddles, polished floors and metal. They are off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, post, quality }) => {
  quality.set({ ssrScale: 0.5 });
  post.set({ ssr: { maxDistance: 50 } });
  scene.createDirectionalLight({ direction: [-1, -2, -1] });
  scene.createMesh({
    mesh: geometry.box({ width: 1, height: 2, depth: 1 }),
    material: materials.standard({ color: '#e05030' }),
    position: [0, 1, 0],
  });
  const street = scene.createMesh({
    mesh: geometry.plane({ width: 40, height: 40 }),
    material: materials.standard({ color: '#202326', roughness: 0.1 }),
  });
  street.setRotationEuler(-Math.PI / 2, 0, 0);
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `ssr` | Its settings to turn them on, or `false` to turn them off. | Off |
| `ssr.intensity` | How much of the environment's reflection the screen's reflection replaces where a ray hits: a number from 0 to 1. | 1 |
| `ssr.maxDistance` | How far a reflected ray travels, in world units: above 0. Reflections fade out over the last fifth. | 100 |
| `ssr.thickness` | How far behind a surface on the screen a ray may pass and still hit it, in world units: a number from 0 up. | 0.5 |
| `ssr.maxRoughness` | The roughest surface that shows them: a number from 0 to 1. Rougher surfaces keep the environment's reflection. | 0.5 |

- Each surface's reflection takes the place of the environment's reflection where its ray hits something on the screen. The material's Fresnel term, metalness and specular values weigh it, as they weigh the environment. So a dark plastic street reflects little straight down and much at a low angle, as wet asphalt does.
- Rough surfaces blur their reflections. They fade into the environment's reflection from 70% of `maxRoughness`.
- Where a ray leaves the screen or hits nothing, as near the screen's edges, the reflection fades into the environment's light, with no hard edge. Set an environment, such as the sky's, so those parts look right.
- The reflections read the frame before's colors. A fast object's reflection lags it by one frame, and blended objects and particles do not show in them.
- A planar reflection pass's reflection ([Render passes](render.md#reflection-passes)) wins on its plane. Blended surfaces and surfaces that let light through keep the environment's reflection.
- They draw where the quality setting `ssrScale` is above 0: half the render size on High and Ultra, and a quarter on Medium. On Low, the preset of phones, the scale is 0, and shiny surfaces keep the environment's light. `ssrSteps` sets how far each ray can search.
- They turn the depth prepass on while they draw, and share ambient occlusion's grid. On a WebGL2 device without float render targets they stay off, and development builds warn once.
- On the 8-bit path, in compatibility mode with MSAA, they read display color, so they look a little grayer there.
- A setting that a call leaves out keeps its value, also while they are off. `post.set({ ssr: {} })` turns them on with the values they had.
- `post.set` allocates nothing. Turning them on or off adds or removes passes, which takes a few frames, and their shaders download the first time.


## Depth of field

Depth of field blurs what lies in front of and behind the focus distance, as a camera lens does. It is off by default. The camera's focal length frames the shot, and the aperture and the focus set the blur:

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, post }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 1.6, 4], target: [0, 1, 0] });
  // An 85 mm portrait lens on a full-frame camera, wide open at f/1.8.
  camera.setFocalLength(85);
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1] });
  const vase = scene.createMesh({
    mesh: geometry.sphere({ radius: 0.3 }),
    material: materials.standard({ color: '#c8643c' }),
    position: [0, 1, 0],
  });
  post.set({ dof: { aperture: 1.8, focusPoint: [0, 1, 0] } });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `dof` | Its settings to turn it on, or `false` to turn it off. | Off |
| `dof.focusDistance` | The distance from the camera, along its view, that is sharp, in world units: above 0. | 10 |
| `dof.focusPoint` | A point in the world to focus on in every frame, as a camera's autofocus does, or `false` to focus at `focusDistance`. | `false` |
| `dof.aperture` | The aperture as an f-number, above 0. A lower number opens the lens and blurs more. | 2.8 |
| `dof.focalLength` | The lens's focal length in millimeters, above 0, or `'camera'` for the active camera's. | `'camera'` |
| `dof.maxBlur` | The largest blur radius, as a share of the image's height, from 0 to 0.1. | 0.02 |
| `dof.blades` | The aperture's blades: 0 for round out-of-focus highlights, or a whole number from 3 to 12 for polygons. | 0 |

- The lens is a photographer's: a focal length on a full-frame sensor, 24 mm tall, and an f-number. World units count as meters, as in glTF. An aperture of 1.4 blurs twice as much as 2.8. At the same aperture, an 85 mm lens blurs far more than a 24 mm one.
- `'camera'` takes the focal length of the active camera's field of view, which `camera.setFocalLength` sets. So the blur always matches the framing. An orthographic camera takes 50 mm.
- With `focusPoint`, the engine finds the point's distance along the camera's view in each frame, so the focus follows a moving camera. To follow a moving object, pass its position again each frame, from an array that the sketch changes in place. Setting `focusDistance` stops the focus on the point.
- The blur is the circle of confusion of a thin lens. It is 0 at the focus. Behind the focus it grows toward a limit, and in front of it, it grows without limit. `maxBlur` caps it.
- It runs after the custom effects and before bloom, so bloom glows from the blurred image.
- It draws where the quality setting `dofSamples` is above 0: 22 taps on Medium, 43 on High and 71 on Ultra. On Low it is 0, so it draws nothing there unless the sketch sets `quality.set({ dofSamples: 16 })` or more.
- It needs HDR color, as bloom does. In WebGPU's compatibility mode with MSAA, turning it on moves the engine to HDR color with FXAA. On a device with no HDR target it stays off, and development builds warn once.
- A setting that a call leaves out keeps its value, also while it is off. `post.set({ dof: {} })` turns it on with the values it had.
- `post.set` allocates nothing, so a sketch can move the focus every frame. Turning depth of field on or off adds or removes passes, which takes a few frames, and its shaders download the first time.

## Outlines

Outlines draw a crisp line around the meshes that `setOutlined(true)` marks, as three.js's `OutlinePass` draws edges around its selected objects. They are off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, post }) => {
  post.set({ outline: { color: '#ffcc00', width: 3 } });
  const camera = scene.createPerspectiveCamera({ position: [0, 2, 6], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1] });
  const crate = scene.createMesh({
    mesh: geometry.box(),
    material: materials.standard({ color: '#8a6a4a' }),
  });
  crate.setOutlined(true);
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `outline` | The outline's settings to turn it on, or `false` to turn it off. | Off |
| `outline.color` | The color of the line around the parts that nothing hides. | White |
| `outline.hiddenColor` | The color of the line around the parts that other objects hide, or `false` for no line there. | `false` |
| `outline.width` | The line's width in CSS pixels, from 0 up. | 2 |

- `mesh.setOutlined(true)` marks a mesh, and `setOutlined(false)` clears it. A model's copy from `scene.instantiate` has `setOutlined` too, which marks each of its meshes. Instance batches take no outline.
- One outline style covers every outlined mesh. three.js needs one `OutlinePass` for each style, and null3D draws one.
- The exposure, the tone mapping and the vignette do not change the line's colors. The color grading table still applies, and the dither moves them by up to one 8-bit step.
- The line is as wide as `width` says on every screen and at every render scale. The engine multiplies it by the device's pixel ratio.
- Above about 4 pixels of the canvas, a part of a mesh thinner than the line can leave a gap between itself and its line.
- The outline covers the mesh's whole shape. It ignores the holes that an alpha cutoff cuts, and the vertices that a custom material moves.
- A setting that a call leaves out keeps its value, also while outlines are off. `post.set` allocates nothing. So a sketch can change the outline's color or width every frame.
- Turning outlines on or off, and `setOutlined`, rebuild the engine's draw tables, as a new material does. Do it in response to a click, not in every frame.
- A full-screen pass reads the outline's mask with `input: 'outlineMask'`, for a soft glow such as `OutlinePass` draws ([Custom passes](../guides/custom-passes.md#a-soft-outline-glow)). `width: 0` draws the mask without the line.
- `@null3d/three-compat`'s `createOutlinePass` draws `OutlinePass`'s soft edge, glow and pulse from this mask, through five full-screen passes and an effect ([three.js compatibility](three-compat.md)).

[The post-processing chain](../concepts/post-processing.md#outlines) explains how outlines draw and what they cost.

## Color grading

A color grading table maps each color of the picture to a graded color, as three.js's `LUTPass` does. Load one from a `.cube` or a `.3dl` file with [`assets.loadLut`](assets.md#color-grading-tables), or make one from numbers with [`assets.lutFromData`](assets.md#tables-from-numbers). Then give it to `post.set`:

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ assets, post }) => {
  const lut = await assets.loadLut('/grades/warm.cube');
  post.set({ lut, lutIntensity: 0.8 });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `lut` | A table from `assets.loadLut` or `assets.lutFromData`, or `false` to turn grading off. | Off |
| `lutIntensity` | The share of the table's color in each pixel, from 0 to 1, as `LUTPass`'s `intensity`. | 1 |

- The table grades each pixel after the tone mapping and the sRGB encoding, as `LUTPass` does after three.js's `OutputPass`. Tables made for sRGB display color, as most are, look as their authors made them.
- The final pass reads the table with a linear filter between its texel centers, as `LUTPass` does. It maps the colors of a `.cube` file's domain onto the table, which `LUTPass` leaves out.
- The table grades the picture from the first frame after its texels reach the GPU, usually the next one.
- `lutIntensity` keeps its value while the table is off, and `post.set` allocates nothing, so a sketch can fade a grade in every frame.

### Grading controls

The grading controls set a look from a few numbers, without a table file. A job worker bakes them
into a table of its own. The final pass applies that table to the display color that the tone curve
leaves, before a `lut`. Changing a value costs the frames nothing: the picture shows the new grade
once the worker's bake reaches the GPU, usually within a few frames.

```ts
post.set({
  grading: {
    whiteBalance: { temperature: 5000 },
    lift: [0.01, 0.01, 0.02],
    gamma: [1, 1, 0.95],
    gain: [1.04, 1.01, 0.94],
    saturation: 0.9,
    splitToning: { shadows: '#3a4a7a', highlights: '#f0c088', balance: 0.2, strength: 0.25 },
  },
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `grading` | Its settings to turn it on, or `false` to turn it off. A setting that a call leaves out keeps its value. | Off |
| `grading.whiteBalance.temperature` | The color temperature of the light that whites are corrected for, from 1667 to 25000 kelvin. A low value, such as 3200 for a tungsten lamp, makes the picture cooler. | 6500 |
| `grading.whiteBalance.tint` | The green to magenta shift, from -1 to 1. Each step of 1 halves or doubles the green channel. | 0 |
| `grading.lift` | Three values, one per channel, from -1 to 1, added to the color: positive values lift the blacks. | `[0, 0, 0]` |
| `grading.gamma` | The gamma of each channel, above 0. A channel is raised to the power of one over its gamma, so values above 1 brighten the shadows. | `[1, 1, 1]` |
| `grading.gain` | Three factors, one per channel, from 0 up: higher values brighten the highlights. | `[1, 1, 1]` |
| `grading.saturation` | How much color the picture keeps: 0 is gray, 1 leaves it as it is, and higher values add color. | 1 |
| `grading.splitToning.shadows` | The hue that tints the dark parts, as a color. Its brightness does not matter. | Gray, so no tint |
| `grading.splitToning.highlights` | The hue that tints the bright parts, as a color. | Gray, so no tint |
| `grading.splitToning.balance` | Where the split falls, from -1 to 1: higher values tint more of the picture with the shadows' hue. | 0 |
| `grading.splitToning.strength` | How much of the tints reaches the picture, from 0 to 1. | 0 |

- The controls apply in this order: white balance, then saturation around the luma, then lift and gamma and gain on each channel, then split toning. They act on the display color, after the tone curve.
- White balance corrects the light of the given temperature to the neutral white of daylight at 6500 kelvin. It keeps the picture's brightness.
- The table holds 32 texels along each side. The final pass takes the square root of the color before it reads the table. Its texels therefore lie closer together toward black, where a grade's curve is steepest.
- The table holds the grade alone, and the tone curve stays a calculation in the pass. A custom tone curve therefore still works with the controls.
- The final pass applies the built-in grade first and a `lut` after it, so a look from a file can sit over a grade from the controls.
- The final pass draws on every GPU path, with HDR color or without it, so both paths grade alike.
- The bake runs in a job worker, so a value that changes in a frame loop does not stall the frames. Where no worker can run tasks, the picture keeps its colors and development builds warn once.
- The values are designed for the null3D grading controls. To match a grade that a colorist made in another tool, load its `.cube` file instead.

## Vignette

The vignette darkens the picture toward its edges:

```ts
post.set({ vignette: { intensity: 0.8, size: 1.2 } });
```

| Setting | Values | Default |
| --- | --- | --- |
| `vignette` | Its settings to turn it on, or `false` to turn it off. | Off |
| `vignette.intensity` | How dark the edges turn, from 0 up. At 1 the edges turn black where the darkening is full, and above 1 they turn black sooner. | 1 |
| `vignette.size` | How much of the picture the darkening covers, from 0 up. It scales the distance from the center. From about 1.41 the corners take the full intensity. | 1 |
| `vignette.falloff` | How fast the light falls from the center: the power of the falloff curve, above 0. Higher values darken more of the picture. | 2 |
| `vignette.roundness` | The shape, from 0 to 1: 0 follows the canvas's shape, an ellipse on a wide canvas, and 1 is a circle. | 0 |

- The vignette multiplies each pixel's light before the tone mapping. [The post-processing chain](../concepts/post-processing.md#color-grading-and-the-vignette) gives the rule, the engines it follows and the difference from three.js's `VignetteShader`.
- At a distance `d` from the center, in canvas widths and heights times `size`, the light is multiplied by `1 - intensity × (1 - (1 - d²)^falloff)`, and never by less than 0.
- A port of three.js's `VignetteShader` sets `size` to its `offset` and `intensity` to its `darkness`. Under ACES the default falloff gives a close match. Under AgX, a port keeps `intensity` at 1 or less and sets `falloff` to 3. With a `darkness` below 1, three.js also lifts dark corners toward the gray, and null3D does not.
- A setting that a call leaves out keeps its value, also while the vignette is off. `post.set({ vignette: {} })` turns it on with the values it had.

Grading and the vignette draw on every GPU path, with HDR color or without it. Without HDR color, the scene's shaders darken their light by the vignette before their tone mapping. A plain background color then draws as a background, so the vignette darkens it too. Each table costs the final pass a few operations per pixel and one texture read. On a device that resolves its multisampled picture straight into the canvas, the table makes the final pass run, which reads the picture once more.

The final pass dithers last, after the table and the vignette. It adds noise of up to one step of the 8-bit canvas, so smooth gradients show no bands. The noise is the same in every frame.

## Sharpening

The sharpening makes edges and fine detail crisper:

```ts
post.set({ sharpen: 0.5 });
```

| Setting | Values | Default |
| --- | --- | --- |
| `sharpen` | The strength, from 0 for none to 1 for the most, or `false` to turn it off. | Off |

- The engine sharpens the display color, after the tone mapping and the sRGB encoding. A sharpened bright edge therefore cannot gain the colored rings that sharpened light gains before the curve.
- It uses RCAS, FSR 1's robust contrast-adaptive sharpening. Each pixel takes a share of the four neighbors that cross it. The share grows where they form an edge and stays small where they are noise, so a flat area keeps its color. It also never pushes a channel past the range of the colors around it.
- It draws at the whole canvas's render scale. A render scale below 1 sharpens its own upscale, so the value adds nothing there ([quality presets](../concepts/quality-presets.md#dynamic-resolution)).
- While it is on, the frame draws in two steps at the whole render scale. The first step tone maps the scene into an 8-bit target, and the second sharpens that display color. A sketch whose render scale can drop already keeps that target, so sharpening adds no memory there. One that holds the render scale at 1 keeps a target of the canvas's size while sharpening is on.
- While it is on, a still view keeps drawing instead of blending its frames and resting, because the sharpening draws in the moving frame's second step. [The post-processing chain](../concepts/post-processing.md#still-camera-accumulation) says what a still view does.
- A setting that a call leaves out keeps its value. `post.set({ sharpen: false })` turns it off, and 0 does the same.

## Custom effects

`post.addEffect` adds a full-screen effect of the sketch's own WGSL. It returns the effect, which the other two calls take:

```ts
const grade = /* wgsl */ `
struct Uniforms { warmth: f32 }

fn effect(input: EffectInput) -> vec4f {
    let warm = input.color.rgb * vec3f(1.0 + uniforms.warmth, 1.0, 1.0 - uniforms.warmth);
    return vec4f(warm, input.color.a);
}
`;

const effect = post.addEffect({ wgsl: grade, uniforms: { warmth: 0.1 } });
post.setEffectUniform(effect, 'warmth', 0.2);
post.removeEffect(effect);
```

| Option | Values | Default |
| --- | --- | --- |
| `wgsl` | WGSL that the null3D Vite plugin compiled, which declares `fn effect(input: EffectInput) -> vec4f` | Required |
| `uniforms` | The first value of each field of the WGSL's `struct Uniforms`, by name | 0 for each field |
| `textures` | The texture of each `var name: texture_2d<f32>;` that the WGSL declares, by name, or a texture of several layers for a `var name: texture_2d_array<f32>;` declaration: a texture from a file or data, or a render pass's texture from `textures.fromPass` | None: white |
| `order` | A number. Effects run from the lowest order to the highest. | 0 |
| `bloomLevel` | The level of bloom's chain that the WGSL reads with `effectBloom`, a whole number from 0 for the narrowest glow to 9 for the widest | None: the WGSL reads no bloom |

A custom tone curve takes the place of the built-in curves:

```ts
const reinhard = /* wgsl */ `
fn toneCurve(color: vec3f) -> vec3f {
    return color / (vec3f(1.0) + color);
}
`;

post.set({ toneMapping: reinhard });
```

- Effects run on linear HDR color, after the exposure and before bloom and the tone curve. At most 8 run at once. The engine joins effects that read only their own pixel into fewer passes, while the render scale cannot drop below the whole canvas. While it can, each effect draws in a pass of its own, at every scale ([The post-processing chain](../concepts/post-processing.md#below-the-whole-canvass-render-scale)).
- `effectBloom(input.uv)` returns the glow of the level that `bloomLevel` names, as linear HDR color after the exposure: an anamorphic streak, a glare or a halo can read bloom's chain instead of blurring the picture again. Bloom's chain holds light that passed its threshold, blurred wider at each level, with level 0 the narrowest. The level is drawn while `post.bloom` is on, and a level that the chain does not draw reads black. An effect that calls `effectBloom` draws in a pass of its own.
- `setEffectUniform` allocates nothing, so a sketch can call it every frame. Keep a vector's values in one array that the sketch changes in place.
- An effect samples a texture as `textureSampleLevel(name, nameSampler, uv, 0.0)`. A render pass's texture holds its bottom row first: sample it at `effectPassUv(input.uv)`. The textures are fixed when the effect is added, and an effect with textures draws in a pass of its own.
- Effects and custom curves need HDR color. On a device without it they stay off, and development builds warn once.
- [Custom passes](../guides/custom-passes.md) lists what an effect reads, and what effects cost.

## Still views

A view that holds still blends its frames into a sharper picture, then stops drawing until something changes. It needs no setting: `post.set` turns nothing on for it. Bloom, outlines and automatic exposure keep a view drawing every frame, as [the post-processing chain](../concepts/post-processing.md#still-camera-accumulation) explains. `createEngine({ still: false })` and the page switch `?still-camera=off` turn it off.

## Errors

| Code | Cause |
| --- | --- |
| [E1213](../errors/E1213.md) | A ninth effect. A setting that this version does not have, such as three.js's vignette `offset` and `darkness`, a tone mapping that the engine does not know, or a bloom, ambient occlusion, depth of field, automatic exposure, outline, vignette or sharpening value other than settings, a number or `false`. An automatic exposure `metering` other than `'mean'` or `'percentile'`, `percentiles` that are not two numbers from 0 to 1 with the lower first, a `centerWeight` outside 0 to 1, a speed below 0, a `minEv`, `maxEv` or `compensation` outside -20 to 20, or a `minEv` above `maxEv`. A depth of field `focusDistance`, `aperture` or `focalLength` that is not above 0, a `maxBlur` outside 0 to 0.1, `blades` other than 0 or a whole number from 3 to 12, or a `focusPoint` that is not three finite numbers or `false`. Also a `lut` that is not a table from `assets.loadLut` or `assets.lutFromData`, a `grading` value out of its range, such as a white balance outside 1667 to 25000 kelvin, a lift channel outside -1 to 1, a gamma channel of 0 or below, a negative gain or saturation, or a split toning balance outside -1 to 1 or strength outside 0 to 1, or a value out of its range. These are an exposure, bloom intensity, threshold or knee, vignette intensity or size, or outline width below 0, a vignette falloff of 0 or below or a roundness above 1, a bloom blend other than `'mix'`, `'add'` or `'screen'`, bloom weights that are not 1 to 10 numbers of 0 or more, or that are all 0, a `lutIntensity` outside 0 to 1, a sharpening strength outside 0 to 1, an ambient occlusion value below 0 or its `distanceFalloff` or `intensity` above 1, a `distanceExponent` of 0, `samples` that are not a whole number from 1 to 64, or an `ev100` outside -20 to 30. |
| [E1203](../errors/E1203.md) | A value that is not a finite number, such as NaN, or an effect's `order` that is not one. |
| [E1204](../errors/E1204.md) | An outline color that is not a hex string, a hex number or three linear components from 0 to 1. |
| [E1215](../errors/E1215.md) | An effect or a tone curve as WGSL that the null3D Vite plugin did not compile, or compiled WGSL of another kind. |
| [E1216](../errors/E1216.md) | An effect's uniform that its WGSL does not declare, or a value of the wrong kind. |
| [E1101](../errors/E1101.md) | A table whose `destroy()` was called, or an effect that `removeEffect` removed. |

## Related pages

- [Color management](../concepts/color-management.md): HDR color, the final pass, the 8-bit path and the background.
- [The post-processing chain](../concepts/post-processing.md): how bloom, ambient occlusion, depth of field, outlines, custom effects and still views work, and what they cost.
- [Cameras](cameras.md#focal-length): `camera.setFocalLength`, the lens that depth of field takes.
- [Custom passes](../guides/custom-passes.md): how to write custom effects and tone curves.
- [three.js to null3D mapping](../porting/threejs-mapping.md): `renderer.toneMapping`, `toneMappingExposure`, `UnrealBloomPass`, `GTAOPass`, `BokehPass`, `OutlinePass`, `LUTPass`, `VignetteShader`, `SharpenNode` and `ShaderPass`. three.js has no grading controls; a null3D grade has no three.js twin.
- [Quality presets](../concepts/quality-presets.md): `aoScale`, `dofSamples` and `exposureMeter` on each preset.
- [Objects and transforms](objects.md#mesh-calls): `setOutlined`.
- [Assets](assets.md): `assets.loadLut`, which loads color grading tables, and `assets.lutFromData`, which makes them from numbers.
- [The post effects demo](https://github.com/null3d-engine/null3d/tree/main/examples/post-effects): bloom, ambient occlusion, an outline, a vignette, sharpening and color grading tables in one scene. It makes its warm and cool tables from lift, gamma and gain in code.
- [The depth of field demo](https://github.com/null3d-engine/null3d/tree/main/examples/camera-lens): the focus racks across a chess board with `focusPoint`, while a dolly zoom changes the camera's focal length in every frame.

## API reference

[The API reference](reference/post.md) lists every export of this page with its type and description. The engine's doc comments make it.
