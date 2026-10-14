---
id: api/post
title: Post-processing API
status: experimental
since: "0.1"
summary: "post.set for tone mapping, exposure and a camera's EV100, automatic exposure, bloom, ambient occlusion, screen-space reflections, the volumetric fog, depth of field, outlines, color grading tables and the vignette; custom effects with post.addEffect, and custom tone curves."
---

# Post-processing API

> Roadmap step 0.1, first released in null3D 0.1.0. Step 0.2 adds automatic exposure, bloom, ambient occlusion, depth of field, outlines, color grading, the vignette, custom effects and custom tone curves. The API is experimental, so it can still change between versions.

`
c
t
x
.
p
o
s
t
`
 
h
o
l
d
s
 
t
h
e
 
s
e
t
t
i
n
g
s
 
t
h
a
t
 
t
h
e
 
e
n
g
i
n
e
 
a
p
p
l
i
e
s
 
t
o
 
t
h
e
 
s
c
e
n
e
'
s
 
c
o
l
o
r
 
o
n
 
i
t
s
 
w
a
y
 
t
o
 
t
h
e
 
c
a
n
v
a
s
.
 
T
h
e
y
 
a
r
e
 
t
h
e
 
t
o
n
e
 
m
a
p
p
i
n
g
,
 
t
h
e
 
e
x
p
o
s
u
r
e
,
 
b
l
o
o
m
,
 
a
m
b
i
e
n
t
 
o
c
c
l
u
s
i
o
n
,
 
s
c
r
e
e
n
-
s
p
a
c
e
 
r
e
f
l
e
c
t
i
o
n
s
,
 
a
u
t
o
m
a
t
i
c
 
e
x
p
o
s
u
r
e
,
 
d
e
p
t
h
 
o
f
 
f
i
e
l
d
,
 
o
u
t
l
i
n
e
s
,
 
a
 
c
o
l
o
r
 
g
r
a
d
i
n
g
 
t
a
b
l
e
,
 
t
h
e
 
v
i
g
n
e
t
t
e
 
a
n
d
 
t
h
e
 
s
k
e
t
c
h
'
s
 
o
w
n
 
e
f
f
e
c
t
s
.
 
[
C
o
l
o
r
 
m
a
n
a
g
e
m
e
n
t
]
(

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
- A custom tone curve is WGSL that declares `fn toneCurve(color: vec3f) -> vec3f`, compiled by the null3D Vite plugin. [Custom effects](#custom-effects) shows one.
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
| `dof.focalLength` | The lens's focal length in millimetres, above 0, or `'camera'` for the active camera's. | `'camera'` |
| `dof.maxBlur` | The largest blur radius, as a share of the image's height, from 0 to 0.1. | 0.02 |
| `dof.blades` | The aperture's blades: 0 for round out-of-focus highlights, or a whole number from 3 to 12 for polygons. | 0 |

- The lens is a photographer's: a focal length on a full-frame sensor, 24 mm tall, and an f-number. World units count as metres, as in glTF. An aperture of 1.4 blurs twice as much as 2.8. At the same aperture, an 85 mm lens blurs far more than a 24 mm one.
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

- The vignette multiplies each pixel's light before the tone mapping, as Filament, Unity's URP, Bevy and Babylon.js do. Bright corners darken as dark corners do.
- At a distance `d` from the center, in canvas widths and heights times `size`, the light is multiplied by `1 - intensity × (1 - (1 - d²)^falloff)`, and never by less than 0.
- three.js's `VignetteShader` blends display color toward a gray instead. A port sets `size` to its `offset` and `intensity` to its `darkness`. Under ACES the default falloff gives a close match. Under AgX, a port keeps `intensity` at 1 or less and sets `falloff` to 3. With a `darkness` below 1, three.js also lifts dark corners toward the gray, and null3D does not.
- A setting that a call leaves out keeps its value, also while the vignette is off. `post.set({ vignette: {} })` turns it on with the values it had.

Grading and the vignette draw on every GPU path, with HDR color or without it. Without HDR color, the scene's shaders darken their light by the vignette before their tone mapping, and a plain background color then draws as a background so the vignette darkens it too. The table costs the final pass a few operations per pixel and one texture read. On a device that resolves its multisampled picture straight into the canvas, the table makes the final pass run, which reads the picture once more.

The final pass dithers last, after the table and the vignette. It adds noise of up to one step of the 8-bit canvas, so smooth gradients show no bands. The noise is the same in every frame.

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
| `textures` | The texture of each `var name: texture_2d<f32>;` that the WGSL declares, by name: a texture from a file or data, or a render pass's texture from `textures.fromPass` | None: white |
| `order` | A number. Effects run from the lowest order to the highest. | 0 |

A custom tone curve takes the place of the built-in curves:

```ts
const reinhard = /* wgsl */ `
fn toneCurve(color: vec3f) -> vec3f {
    return color / (vec3f(1.0) + color);
}
`;

post.set({ toneMapping: reinhard });
```

- Effects run on linear HDR color, after the exposure and before bloom and the tone curve. At most 8 run at once. The engine joins effects that read only their own pixel into fewer passes ([Custom passes](../guides/custom-passes.md#cost)).
- `setEffectUniform` allocates nothing, so a sketch can call it every frame. Keep a vector's values in one array that the sketch changes in place.
- An effect samples a texture as `textureSampleLevel(name, nameSampler, uv, 0.0)`. A render pass's texture holds its bottom row first: sample it at `effectPassUv(input.uv)`. The textures are fixed when the effect is added, and an effect with textures draws in a pass of its own.
- Effects and custom curves need HDR color. On a device without it they stay off, and development builds warn once.
- [Custom passes](../guides/custom-passes.md) lists what an effect reads, and what effects cost.

## Errors

| Code | Cause |
| --- | --- |
|
 
[
E
1
2
1
3
]
(
.
.
/
e
r
r
o
r
s
/
E
1
2
1
3
.
m
d
)
 
|
 
A
 
n
i
n
t
h
 
e
f
f
e
c
t
.
 
A
 
s
e
t
t
i
n
g
 
t
h
a
t
 
t
h
i
s
 
v
e
r
s
i
o
n
 
d
o
e
s
 
n
o
t
 
h
a
v
e
,
 
s
u
c
h
 
a
s
 
t
h
r
e
e
.
j
s
'
s
 
v
i
g
n
e
t
t
e
 
`
o
f
f
s
e
t
`
 
a
n
d
 
`
d
a
r
k
n
e
s
s
`
,
 
a
 
t
o
n
e
 
m
a
p
p
i
n
g
 
t
h
a
t
 
t
h
e
 
e
n
g
i
n
e
 
d
o
e
s
 
n
o
t
 
k
n
o
w
,
 
o
r
 
a
 
b
l
o
o
m
,
 
a
m
b
i
e
n
t
 
o
c
c
l
u
s
i
o
n
,
 
d
e
p
t
h
 
o
f
 
f
i
e
l
d
,
 
a
u
t
o
m
a
t
i
c
 
e
x
p
o
s
u
r
e
,
 
o
u
t
l
i
n
e
 
o
r
 
v
i
g
n
e
t
t
e
 
v
a
l
u
e
 
o
t
h
e
r
 
t
h
a
n
 
s
e
t
t
i
n
g
s
 
o
r
 
`
f
a
l
s
e
`
.
 
A
n
 
a
u
t
o
m
a
t
i
c
 
e
x
p
o
s
u
r
e
 
`
m
e
t
e
r
i
n
g
`
 
o
t
h
e
r
 
t
h
a
n
 
`
'
m
e
a
n
'
`
 
o
r
 
`
'
p
e
r
c
e
n
t
i
l
e
'
`
,
 
`
p
e
r
c
e
n
t
i
l
e
s
`
 
t
h
a
t
 
a
r
e
 
n
o
t
 
t
w
o
 
n
u
m
b
e
r
s
 
f
r
o
m
 
0
 
t
o
 
1
 
w
i
t
h
 
t
h
e
 
l
o
w
e
r
 
f
i
r
s
t
,
 
a
 
`
c
e
n
t
e
r
W
e
i
g
h
t
`
 
o
u
t
s
i
d
e
 
0
 
t
o
 
1
,
 
a
 
s
p
e
e
d
 
b
e
l
o
w
 
0
,
 
a
 
`
m
i
n
E
v
`
,
 
`
m
a
x
E
v
`
 
o
r
 
`
c
o
m
p
e
n
s
a
t
i
o
n
`
 
o
u
t
s
i
d
e
 
-
2
0
 
t
o
 
2
0
,
 
o
r
 
a
 
`
m
i
n
E
v
`
 
a
b
o
v
e
 
`
m
a
x
E
v
`
.
 
A
 
s
c
r
e
e
n
-
s
p
a
c
e
 
r
e
f
l
e
c
t
i
o
n
 
v
a
l
u
e
 
b
e
l
o
w
 
0
,
 
i
t
s
 
`
i
n
t
e
n
s
i
t
y
`
 
o
r
 
`
m
a
x
R
o
u
g
h
n
e
s
s
`
 
a
b
o
v
e
 
1
 
o
r
 
a
 
`
m
a
x
D
i
s
t
a
n
c
e
`
 
o
f
 
0
.
 
A
 
d
e
p
t
h
 
o
f
 
f
i
e
l
d
 
`
f
o
c
u
s
D
i
s
t
a
n
c
e
`
,
 
`
a
p
e
r
t
u
r
e
`
 
o
r
 
`
f
o
c
a
l
L
e
n
g
t
h
`
 
t
h
a
t
 
i
s
 
n
o
t
 
a
b
o
v
e
 
0
,
 
a
 
`
m
a
x
B
l
u
r
`
 
o
u
t
s
i
d
e
 
0
 
t
o
 
0
.
1
,
 
`
b
l
a
d
e
s
`
 
o
t
h
e
r
 
t
h
a
n
 
0
 
o
r
 
a
 
w
h
o
l
e
 
n
u
m
b
e
r
 
f
r
o
m
 
3
 
t
o
 
1
2
,
 
o
r
 
a
 
`
f
o
c
u
s
P
o
i
n
t
`
 
t
h
a
t
 
i
s
 
n
o
t
 
t
h
r
e
e
 
f
i
n
i
t
e
 
n
u
m
b
e
r
s
 
o
r
 
`
f
a
l
s
e
`
.
 
A
l
s
o
 
a
 
`
l
u
t
`
 
t
h
a
t
 
i
s
 
n
o
t
 
a
 
t
a
b
l
e
 
f
r
o
m
 
`
a
s
s
e
t
s
.
l
o
a
d
L
u
t
`
 
o
r
 
`
a
s
s
e
t
s
.
l
u
t
F
r
o
m
D
a
t
a
`
,
 
o
r
 
a
 
v
a
l
u
e
 
o
u
t
 
o
f
 
i
t
s
 
r
a
n
g
e
.
 
T
h
e
s
e
 
a
r
e
 
a
n
 
e
x
p
o
s
u
r
e
,
 
b
l
o
o
m
 
i
n
t
e
n
s
i
t
y
,
 
t
h
r
e
s
h
o
l
d
 
o
r
 
k
n
e
e
,
 
v
i
g
n
e
t
t
e
 
i
n
t
e
n
s
i
t
y
 
o
r
 
s
i
z
e
,
 
o
r
 
o
u
t
l
i
n
e
 
w
i
d
t
h
 
b
e
l
o
w
 
0
,
 
a
 
v
i
g
n
e
t
t
e
 
f
a
l
l
o
f
f
 
o
f
 
0
 
o
r
 
b
e
l
o
w
 
o
r
 
a
 
r
o
u
n
d
n
e
s
s
 
a
b
o
v
e
 
1
,
 
a
 
b
l
o
o
m
 
b
l
e
n
d
 
o
t
h
e
r
 
t
h
a
n
 
`
'
m
i
x
'
`
,
 
`
'
a
d
d
'
`
 
o
r
 
`
'
s
c
r
e
e
n
'
`
,
 
b
l
o
o
m
 
w
e
i
g
h
t
s
 
t
h
a
t
 
a
r
e
 
n
o
t
 
1
 
t
o
 
1
0
 
n
u
m
b
e
r
s
 
o
f
 
0
 
o
r
 
m
o
r
e
,
 
o
r
 
t
h
a
t
 
a
r
e
 
a
l
l
 
0
,
 
a
 
`
l
u
t
I
n
t
e
n
s
i
t
y
`
 
o
u
t
s
i
d
e
 
0
 
t
o
 
1
,
 
a
n
 
a
m
b
i
e
n
t
 
o
c
c
l
u
s
i
o
n
 
v
a
l
u
e
 
b
e
l
o
w
 
0
 
o
r
 
i
t
s
 
`
d
i
s
t
a
n
c
e
F
a
l
l
o
f
f
`
 
o
r
 
`
i
n
t
e
n
s
i
t
y
`
 
a
b
o
v
e
 
1
,
 
a
 
`
d
i
s
t
a
n
c
e
E
x
p
o
n
e
n
t
`
 
o
f
 
0
,
 
`
s
a
m
p
l
e
s
`
 
t
h
a
t
 
a
r
e
 
n
o
t
 
a
 
w
h
o
l
e
 
n
u
m
b
e
r
 
f
r
o
m
 
1
 
t
o
 
6
4
,
 
o
r
 
a
n
 
`
e
v
1
0
0
`
 
o
u
t
s
i
d
e
 
-
2
0
 
t
o
 
3
0
.
 
|
| [E1203](../errors/E1203.md) | A value that is not a finite number, such as NaN, or an effect's `order` that is not one. |
| [E1204](../errors/E1204.md) | An outline color that is not a hex string, a hex number or three linear components from 0 to 1. |
| [E1215](../errors/E1215.md) | An effect or a tone curve as WGSL that the null3D Vite plugin did not compile, or compiled WGSL of another kind. |
| [E1216](../errors/E1216.md) | An effect's uniform that its WGSL does not declare, or a value of the wrong kind. |
| [E1101](../errors/E1101.md) | A table whose `destroy()` was called, or an effect that `removeEffect` removed. |

## Related pages

- [Color management](../concepts/color-management.md): HDR color, the final pass, the 8-bit path and the background.
- [The post-processing chain](../concepts/post-processing.md): how bloom, ambient occlusion, screen-space reflections, depth of field, outlines and custom effects work, and what they cost.
- [Cameras](cameras.md#focal-length): `camera.setFocalLength`, the lens that depth of field takes.
- [Custom passes](../guides/custom-passes.md): how to write custom effects and tone curves.
- [three.js to null3D mapping](../porting/threejs-mapping.md): `renderer.toneMapping`, `toneMappingExposure`, `UnrealBloomPass`, `GTAOPass`, `SSRPass`, `BokehPass`, `OutlinePass`, `LUTPass`, `VignetteShader` and `ShaderPass`.
- [Quality presets](../concepts/quality-presets.md): `aoScale`, `ssrScale`, `ssrSteps`, `dofSamples` and `exposureMeter` on each preset.
- [Objects and transforms](objects.md#mesh-calls): `setOutlined`.
- [Assets](assets.md): `assets.loadLut`, which loads color grading tables, and `assets.lutFromData`, which makes them from numbers.
- [The post effects demo](https://github.com/null3d-engine/null3d/tree/main/examples/post-effects): bloom, ambient occlusion, an outline, a vignette and color grading tables in one scene. It makes its warm and cool tables from lift, gamma and gain in code.
- [The depth of field demo](https://github.com/null3d-engine/null3d/tree/main/examples/camera-lens): the focus racks across a chess board with `focusPoint`, while a dolly zoom changes the camera's focal length in every frame.

## API reference

[The API reference](reference/post.md) lists every export of this page with its type and description. The engine's doc comments make it.
