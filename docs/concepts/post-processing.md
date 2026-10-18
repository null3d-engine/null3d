---
id: concepts/post-processing
title: The post-processing chain
status: experimental
since: "0.2"
summary: "HDR scene color, ambient occlusion and screen-space reflections at half size, custom effects, depth of field with near and far fields, bloom through a chain of mip levels, automatic exposure from a meter on the GPU, an outline mask, and the final pass for the vignette, tone mapping, FXAA, outlines, color grading and dithering, in two steps once the render scale can drop below the whole canvas; still views that blend and then rest the GPU."
---

# The post-processing chain

> Roadmap step 0.2, first released in null3D 0.1.0. The API is experimental, so it can still change between versions. The chain has HDR scene color, ambient occlusion, screen-space reflections, custom effects, depth of field, bloom, automatic exposure and outlines. The final pass adds color grading, the vignette and custom tone curves. A still view blends and then rests the GPU.

```mermaid
flowchart LR
    prepass["Depth prepass"] --> ao["Ambient occlusion:<br/>three steps at half size"]
    prepass --> ssr["Screen-space reflections:<br/>a depth pyramid and a trace<br/>at half size"]
    ao --> scene
    ssr --> scene
    copy["The frame before's<br/>opaque colors"] --> scene
    scene["Scene passes:<br/>linear HDR color"] --> fog["Volumetric fog:<br/>adds the light in the fog"]
    fog --> custom["Custom effects:<br/>joined into few passes"]
    custom --> dof["Depth of field:<br/>three steps at half size,<br/>then a composite"]
    dof --> down["Bloom's steps down:<br/>each level half the size<br/>of the one before"]
    down --> up["Bloom's steps up:<br/>each level blends in<br/>the one below"]
    dof --> meter["Exposure meter:<br/>a histogram or a downsample<br/>into one texel"]
    up --> meter
    meter --> final["Final pass: blends in bloom,<br/>applies the adapted exposure,<br/>then the vignette,<br/>FXAA and tone mapping"]
    dof --> final
    up --> final
    mask["Outline mask:<br/>outlined objects"] --> line
    final --> line["In the same pass:<br/>the outline's line,<br/>the color grading table,<br/>then dithering"]
    final -- "below the whole canvas,<br/>when the scale can drop" --> scaled["A second step:<br/>scales the image up, then<br/>the outline's line, the color<br/>grading table and dithering"]
    line --> canvas["Canvas"]
    scaled --> canvas
```

Ambient occlusion and screen-space reflections run before the scene's opaque objects shade. They read the depth that the depth prepass draws first, and the opaque pass darkens its ambient light with the occlusion and reflects the frame before's colors where the reflections' rays hit. The scene passes draw linear color with no upper limit into a float target, the scene color. The exposure scales each light and each color as it enters the scene, so the scene color holds exposed color. Effects that need that range, such as the volumetric fog's light, the sketch's custom effects, depth of field and bloom, read it before the final pass, in that order. [Lighting and environment](lighting.md#volumetric-fog) describes the volumetric fog. The final pass then does all of its work for each pixel in one pass, while the render scale cannot drop below the whole canvas. It smooths edges with FXAA, adds the effects' results, darkens the edges with the vignette and applies the tone mapping curve: AgX with a punchy look by default, which keeps the hues of bright colors. [Color management](color-management.md#exposure-and-tone-mapping) lists the curves. Then it encodes sRGB, draws the outline's line, and grades the display color with a color grading table, when the sketch sets one. Last, it dithers. [Below the whole canvas's render scale](#below-the-whole-canvass-render-scale) describes how that work splits in two when the scale can drop.

Every full-screen pass reads and writes the whole screen once more. On a phone at its full resolution that is tens of megabytes per frame, so the engine keeps such passes few. Bloom's passes draw small levels of a fixed size. The outline draws only a mask of the outlined meshes. The final pass reads their results without a pass of its own.

Turn effects on with `post.set` in the sketch:

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, post }) => {
  post.set({ bloom: { intensity: 0.2, threshold: 1 } });
  scene.setBackground('#06080c');
  const camera = scene.createPerspectiveCamera({ position: [0, 1, 6], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  // Emissive light above 1 is brighter than white, so it passes the threshold and glows.
  const lamp = materials.standard({ color: '#000000', emissive: '#ffd080', emissiveIntensity: 8 });
  scene.createMesh({ mesh: geometry.sphere({ radius: 0.5 }), material: lamp });
  return {};
});
```

## Below the whole canvas's render scale

The engine can draw the scene at a lower scale than the canvas, then scale the image up, to hold a frame rate on a slow GPU ([Dynamic resolution](quality-presets.md#dynamic-resolution)). Below the whole canvas's scale, the final pass runs in two steps, while the render scale can drop below 1, which the default presets allow. At the whole canvas's scale, and while the scale cannot drop below 1, one pass does that work, exactly as before the split.

1. The first step draws at the render size, one pixel for each render pixel. It adds bloom's light, darkens the edges with the vignette, and runs the output transform, which is the tone curve and the sRGB encode. It smooths edges with FXAA too. It writes an 8-bit target the size of the canvas, with the image in its corner at the render scale. The second step reads that target as display color. The first step leaves the dither to the second step: that step draws canvas pixels, so the noise lands at the canvas's size.
2. The second step is the plain final pass. It reads the 8-bit target and scales it up to the whole canvas, with a bilinear filter. Then it darkens the edges with the vignette, draws the outline's line, applies the color grading table, when the sketch sets one, and dithers.

Two costs come with the split. Both go away while the render scale cannot drop, which `quality.set({ minRenderScale: 1 })` keeps:

- While the scale can drop, the frame holds an extra 8-bit target the size of the canvas: 4 bytes for each canvas pixel, about 33 MB at 3840 x 2160. A frame at the whole canvas's scale does not draw into it.
- While the scale can drop, custom effects do not join into fewer passes. The last of them does not fold into the final pass either. Each runs in a full-screen pass of its own, at every scale.

The first step rounds to 8 bits before the second step blends. A frame below the whole canvas's scale can therefore differ from the same frame at scale 1 by one step of that target.

## Bloom

Bloom spreads light from the bright parts of the scene into their surroundings, as a camera lens does. It draws a chain of levels, each half the size of the one before, as Bevy, Filament and Unity draw bloom:

1. Steps down. The first step reads the scene color into the largest level, the base. It keeps the light that passes `threshold`, and limits each color to what a 16-bit float holds. Each later step reads the level above into the next level.
2. Each step down reads 13 texels around each texel, with the weights of Call of Duty: Advanced Warfare's bloom. The first step also takes a Karis average: a very bright group of texels counts less. So a small bright point does not flicker as it moves.
3. Steps up. From the smallest level back to the base, each step blurs the level below with a 3 x 3 tent filter. It blends the result into its own level. The base then holds the light of every level, each with its share of the glow.
4. The final pass reads the base once for each pixel, and blends it into the scene color before the tone mapping.

| Setting | Values | Default |
| --- | --- | --- |
| `intensity` | 0 or more. With the `'mix'` blend, the glow's share of each pixel, at most 1. With `'add'` and `'screen'`, a factor on the glow. | 0.15 |
| `threshold` | A luminance from 0 up, in linear color before the exposure. The first step reads exposed color, so it scales the threshold and its soft edge by the exposure, and a threshold keeps its meaning at any exposure. | 0 |
| `knee` | The width of the threshold's soft edge, in luminance: 0 or more. | 0.1 |
| `blend` | `'mix'`, `'add'` or `'screen'`. | `'mix'` |
| `weights` | Up to 10 numbers of 0 or more: each level's share of the glow, from the narrowest level to the widest. Not all 0. | Shares for 8 levels |

- The `'mix'` blend moves each pixel's color toward the glow by the intensity, so the image keeps its total light. A lit wall keeps its brightness and turns softer. `'add'` adds the glow, as three.js's `UnrealBloomPass` does, and `'screen'` screens it, as pmndrs's `BloomEffect` does.
- At a threshold of 0, all light glows a little, as in a real lens. At 1, only light brighter than white glows, such as an emissive material with an `emissiveIntensity` above 1.
- The levels have the canvas's shape and a fixed number of texels on its shorter side. So the glow keeps its size as a share of the screen at any pixel ratio, render scale and screen orientation.
- Each level spreads light twice as far as the one before. The eighth spreads it over about a quarter of the canvas's shorter side, and the tenth over all of it. The engine divides the weights by their sum. The default gives eight levels a share, most to the narrow ones, for a soft glow that keeps the shape of the light.
- Levels past the last one with a weight do not draw, so they cost nothing.
- Bloom works before the tone mapping, so it never clips at white on its own. On a transparent canvas it also adds coverage, so the glow shows over the page.
- `post.set({ bloom: false })` turns bloom off. The settings keep their values, so `post.set({ bloom: {} })` turns it on again with them.

### The size of the base

The quality setting `bloomSize` sets the base's texels on the canvas's shorter side. It is 512 on the Medium, High and Ultra presets, and 64 on Low, which phones run. A smaller base has fewer levels. Its finest levels fold into the base with their shares, so the glow keeps its size, with a softer core. The base never takes more than half the canvas's shorter side.

```ts
quality.set({ bloomSize: 256 });
```

A new `bloomSize` makes bloom's targets again. When frames take too long and bloom is on, the frame-budget governor halves the base once, after its shadow steps. Each level then draws into a corner of its target, so that step makes no target. [Quality presets](quality-presets.md) lists the governor's steps.

### Cost

With the default weights, bloom draws 15 small passes: 8 steps down and 7 steps up. The final pass reads one texture for it.

- The chain's work does not follow the render scale. A lower scale changes only where the first step reads, and a new scale makes no new target.
- At 1920 x 1080, with a base of 512, bloom reads about 7.6 texels for each pixel of the canvas, over all its passes. On a phone's canvas of 540 x 932 at a base of 128, it reads about 2.7.
- Its levels hold 16-bit floats, whatever the scene color's format. In a smaller float format the rounding of the chain's many steps adds up, and the glow loses light. At 1920 x 1080 with a base of 512, the levels take about 5 MB.
- The bloom scene of the engine's effect cost test ran on a MacBook Pro in Chrome, with WebGPU at 1920 x 1080. Bloom added 0.79 to 0.85 ms of GPU time per frame at a render scale of 1, and 0.79 ms at 0.5. A base of 128 added 0.52 to 0.66 ms.
- Phone GPUs pay a fixed cost for each pass, so a smaller base, with fewer levels, saves the most there. Each halving of the base removes two passes.
- The targets exist only while bloom is on.

## Depth of field

Depth of field blurs what lies in front of and behind the focus distance, as a camera lens does. Each pixel's blur is the circle of confusion of a thin lens, from the pixel's depth, the focal length, the aperture and the focus distance. The near field, what lies in front of the focus, and the far field, what lies behind it, blur apart:

1. The setup step reads four pixels of the scene's color and depth for each texel of a target at half the render size. It finds each pixel's blur, and writes their color with the smallest blur. In-focus color counts less in the average, so sharp detail does not bleed into the blur.
2. The gather reads a spiral of taps over a disk around each texel, or over a polygon when the aperture has blades. A tap adds to the far field only where both its own blur and the texel's reach it. It adds to the near field wherever its own blur reaches the texel.
3. A small tent filter smooths the gather.
4. The composite mixes the blur into each pixel of the scene's color at the render size. The pixel's own blur, read from the full-size depth, decides how much, and so does how much of it the near field covers.

```ts
camera.setFocalLength(85);
post.set({ dof: { aperture: 1.8, focusPoint: [0, 1, 0] } });
```

[The post-processing API](../api/post.md#depth-of-field) lists the settings, and [Cameras](../api/cameras.md#focal-length) the focal length.

- A sharp object in front of a blurred background keeps its edges, and its color never spreads into the background as a halo. A blurred object in front spreads over a sharp one behind it, as a lens shows it.
- With MSAA, the composite reads each pixel's nearest depth sample. An edge pixel's color is mostly the object in front, so where that object is sharp, its smoothed edge stays.
- Out-of-focus highlights draw as disks, or as polygons with `blades`. A round aperture turns its taps by a different angle at each texel. A small highlight then fills its disk with a fine grain, which more taps smooth.
- It runs after the custom effects and before bloom. Bloom then glows from the blurred image, and the final pass tone maps it. The outline's line stays sharp, as it draws in the final pass.
- Custom effects that would fold into the final pass draw in passes of their own while it is on, as while bloom is on.

### Where depth of field draws

The quality setting `dofSamples` sets the taps of the gather: 22 on Medium, 43 on High and 71 on Ultra. On Low, which phones run, it is 0, so depth of field draws nothing there even when the sketch turns it on. A sketch that wants it on every device sets the taps too:

```ts
quality.set({ dofSamples: 16 });
post.set({ dof: { aperture: 2 } });
```

WebGL2 and WebGPU's compatibility mode run Medium at most, so they draw 22 taps. More taps cost more and fill a wide blur more smoothly. A new tap count changes only the gather's settings, so it makes no GPU object.

### Cost

Depth of field adds three passes at half the render size and one at the render size. The engine's effect cost test timed its scene on a MacBook Pro in Chrome, at 1920 x 1080. With WebGL2, depth of field added about 0.6 ms of GPU time per frame at 22 taps, and 0.9 ms at 43. With WebGPU and MSAA it added about 0.85 ms at 22 taps, and 1.3 ms at 43. Bloom costs about 0.8 ms on the same Mac.

- The gather reaches only as far as the frame's largest blur. A lens closed down to an aperture of 16 reads a smaller disk than one wide open.
- The scene's render pass keeps its depth for the setup and the composite, where it could be thrown away before.
- Its half-size targets take 8 bytes per texel. The setup's and the tent's share one texture, so the three take about 4 bytes per pixel of the canvas. The composite's target takes 8 bytes per pixel. They exist only while it draws.
- While it is off, it costs nothing: none of its passes run, and its shaders do not download until the first `post.set({ dof })`.

## Automatic exposure

Automatic exposure adapts the picture to the scene's brightness, as an eye or a camera does. A meter on the GPU reads the color that the final pass reads, in the same frame. It writes the adapted exposure into one texel, and the final pass multiplies the color by it before FXAA, the vignette and the tone curve.

```ts
post.set({ autoExposure: { minEv: -6, speedDown: 0.7 } });
```

[The post-processing API](../api/post.md#automatic-exposure) lists the settings. The meter works in four steps:

1. It reads the brightness of each sample of the image in stops: the base-2 logarithm of its luminance over middle gray, 0.18. Each sample counts with its center weight.
2. It adds the samples to 128 bins of a quarter stop each, from -16 to +16 stops.
3. It takes the weighted mean of the bins, or with `metering: 'percentile'` the mean between two shares of the total weight. So a bright window or a black corner moves the exposure less.
4. It moves the stored exposure toward that result, within `minEv` to `maxEv`, at `speedUp` stops per second while the scene grows brighter, and `speedDown` while it grows darker. Within one stop it slows down, so it settles without a jump.

- The scene draws at the camera's exposure, and the eye adapts from there. The adapted exposure multiplies the scene's color, bloom's glow and the effects that fold into the final pass. Custom effects, depth of field and bloom's threshold see the camera's exposure.
- The first frame that meters takes its result at once. So a scene starts adapted, and hold mode's one frame shows the adapted image, the same in every run.
- The scene color holds the camera's exposure, a 16-bit float with its full precision from about 2^-14 to 2^15. The default range of 4 stops either way loses nothing that shows. A scene that adapts much further does best with the camera's exposure near the middle of its range.

### Where the meter runs

The quality setting `exposureMeter` picks one of two meters:

| Meter | How it meters | Where |
| --- | --- | --- |
| `'histogram'` | A compute step reads a grid of 128 samples on the render size's short side, one filtered tap each, and bins them in workgroup memory. A second step meters the bins and stores the exposure. | WebGPU, core and compatibility mode, on Medium and above |
| `'downsample'` | A full-screen step draws 16 x 16 cells, each the mean of 16 filtered taps. A second step draws one texel: its one fragment bins the 256 cells and meters them, and a copy stores the result. | WebGL2, which has no compute shaders, and the Low preset on every path |

Both meters take the same settings and meter the same way. The downsample's cells average their part of the image first, so its percentiles are coarser.

It needs HDR color, as bloom does. In WebGPU's compatibility mode with MSAA, turning it on moves the engine to HDR color with FXAA. On a device with no HDR target it stays off, and development builds warn once.

### Cost

The meter adds two small steps and reads only a grid of the image, so its cost hardly follows the canvas's size. While automatic exposure is off, it costs nothing: none of its steps run, the final pass skips its texel, and its shaders do not download until the first `post.set({ autoExposure })`.

## Custom effects and tone curves

A sketch adds effects of its own with `post.addEffect`. Each is a WGSL function that the engine calls for each pixel, in a full-screen pass of its own. [Custom passes](../guides/custom-passes.md) shows how to write one.

```ts
const warm = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    return vec4f(input.color.rgb * vec3f(1.1, 1.0, 0.9), input.color.a);
}
`;

post.addEffect({ wgsl: warm });
```

- Effects run after the scene passes and before depth of field and bloom, on linear HDR color after the exposure. Light that an effect adds can glow, and the tone curve maps it with the rest.
- Each effect reads the color that the effect before it wrote. It can read any pixel, and the scene's depth on every GPU path.
- Effects run from the lowest `order` to the highest, at most 8 at once.
- Two targets of the render size serve all the effects. The render graph lets them share memory, because each effect's target lives only until the next effect has read it.
- A full-screen pass reads and writes 8 bytes per pixel. The engine joins an effect that reads only its own pixel into the pass of the effect before it, while the render scale cannot drop below the whole canvas. With bloom and FXAA off, the last of these passes folds into the final pass then too. While the scale can drop, each effect draws a pass of its own, at every scale ([below the whole canvas's render scale](#below-the-whole-canvass-render-scale)). [Custom passes](../guides/custom-passes.md#cost) gives the rules.

A custom tone curve replaces the built-in curves. Its WGSL declares `fn toneCurve(color: vec3f) -> vec3f`, and `post.set({ toneMapping })` takes it. The final pass calls it in place of the built-in curve, after bloom and before FXAA and dithering.

## Ambient occlusion

Ambient occlusion darkens the light that comes from all around where nearby surfaces hide a surface from it. That happens in corners, in creases and under objects that rest on the ground. It follows three.js's `GTAOPass` step by step, at half the render size:

1. The depth prepass draws the opaque objects' depth. Ambient occlusion turns the prepass on while it draws.
2. A first step copies the depth of one pixel under each texel.
3. The horizon step rebuilds each surface's normal from the depth around it. Then it searches 3 slices around the view for the surfaces that hide the sky, and finds how open the surface is.
4. A blur over a disk of 16 taps smooths the result along each surface, and keeps it apart from other surfaces.
5. The opaque pass reads the four texels around each pixel, and darkens its ambient light. The texels whose depth lies near the pixel's own get the most weight.

```ts
post.set({ ao: { radius: 0.5, intensity: 1 } });
```

| Setting | Values | Default |
| --- | --- | --- |
| `radius` | How far from a surface the search reaches, in world units: 0 or more. | 0.25 |
| `thickness` | How far in front of a surface, along the view, an object still hides it: 0 or more. | 1 |
| `distanceExponent` | Above 0. Higher values gather the search's steps near the surface. | 1 |
| `distanceFalloff` | From 0 to 1: how much less the farther steps count. | 1 |
| `scale` | The power that the occlusion is raised to: above 1 darkens it. | 1 |
| `samples` | The depth samples of each pixel's search, a whole number from 1 to 64: 3 directions below 30, and 5 from 30. | 16 |
| `intensity` | From 0 to 1: how much of the occlusion reaches the ambient light. | 1 |

- The settings mean what `GTAOPass`'s settings mean, with the same search and blur. In the engine's parity tests, with `GTAOPass`'s defaults, null3D's image differs from three.js's in under 0.1% of the pixels on every GPU path. With a wider, darker search, under 1% differ, along the soft edges of the darkened areas.
- `GTAOPass` darkens the whole image, direct light and highlights included. null3D darkens only the ambient light, and the light that light maps add. A surface in the sun keeps its sunlight in a corner, as it would in the real world. In a scene that only ambient light lights, the two give the same image.
- Blended objects draw over the surfaces that ambient occlusion saw, so they take none.
- `post.set({ ao: false })` turns ambient occlusion off. The settings keep their values, so `post.set({ ao: {} })` turns it on again with them.

### Where ambient occlusion draws

The quality setting `aoScale` sets the size of ambient occlusion's targets, as a share of the render size each way. The High and Ultra presets, which desktops start with, draw at half size. Low and Medium, which phones and tablets start with, set 0, so ambient occlusion draws nothing there even when the sketch turns it on. A sketch that wants it on every device sets the scale too:

```ts
quality.set({ aoScale: 0.5 });
post.set({ ao: {} });
```

Ambient occlusion needs no HDR color, so it draws on the 8-bit path too. Its targets hold floats, which WebGL2 draws into only with the `EXT_color_buffer_float` extension. On a WebGL2 device without it, ambient occlusion stays off, and development builds warn once in the console.

### Cost

Ambient occlusion adds the depth prepass and three small passes at half the render size. It also adds four texture reads to each pixel that the opaque pass shades. The engine's ambient occlusion scene ran on a MacBook Pro in Chrome, at 3,024 x 1,518 pixels. There it added 2.42 ms of GPU time per frame. three.js's `GTAOPass` added about 5.3 ms to the same scene and canvas. At a render scale of 0.5 it added 1.18 ms.

- Its targets follow the render scale, so a lower scale costs less, and a new scale makes no new target. They take 20 bytes per texel at half size, 5 bytes per pixel of the canvas. They exist only while ambient occlusion draws.
- The depth prepass costs a second pass over the opaque objects' vertices. In a scene with many vertices it adds time of its own. [Quality presets](quality-presets.md#the-depth-prepass) says when the prepass pays.
- `aoScale: 0.25` draws at a quarter of the render size each way, with softer occlusion. Its steps then find a quarter as many texels. When frames take too long, the frame-budget governor takes that step last.
- Turning ambient occlusion on or off adds or removes passes. The last image stays on screen while the new pipelines build, which takes a few frames.

## Screen-space reflections

Screen-space reflections make shiny opaque surfaces reflect what the screen shows along their mirror direction. A wet street shows the lamps and windows above it, a polished floor the furniture on it, and a metal pipe the wall beside it. They work in four steps, the first three at the size of ambient occlusion's grid:

1. The depth prepass draws the opaque objects' depth, and a first step copies the depth of one pixel under each texel, as for ambient occlusion.
2. Six small steps build a depth pyramid. Each texel of a level keeps the nearest depth of the four texels under it, so a level shows where nothing stands in front of a ray.
3. The trace rebuilds each surface's normal from the depth, and marches its mirror ray through the pyramid. Where a cell holds nothing nearer than the ray, the ray crosses the whole cell and climbs to a larger one. Where it does, the ray drops to a smaller cell, until it meets a surface. A hit counts only where the ray passes no further behind that surface than `thickness`. The trace keeps the ray's length.
4. The opaque pass casts each pixel's own reflected ray, along its shading normal, for the length of the hits around it. So a normal map's ripples bend the reflection. It reads the frame before's colors where the ray ends, from the copy of the opaque colors that transmission samples too. The rougher the surface and the longer the ray, the blurrier the mip level it reads.

```ts
quality.set({ ssrScale: 0.5 });
post.set({ ssr: { maxDistance: 50, thickness: 0.5 } });
```

| Setting | Values | Default |
| --- | --- | --- |
| `intensity` | From 0 to 1: how much of the environment's reflection the screen's reflection replaces where a ray hits. | 1 |
| `maxDistance` | How far a ray travels, in world units: above 0. | 100 |
| `thickness` | How far behind a surface a ray may pass and still hit it, in world units: 0 or more. | 0.5 |
| `maxRoughness` | From 0 to 1: the roughest surface that shows them. | 0.5 |

- The reflection takes the place of the environment's reflection, weighed by the material's Fresnel term, metalness and specular values. A metal floor reflects most of what it sees. A dark plastic floor reflects a few percent straight down and most of it at a low angle, which is what makes a wet street shine.
- Where a ray leaves the screen, hits nothing, turns back toward the camera or nears `maxDistance`, the reflection fades into the environment's reflection. Rough surfaces fade into it from 70% of `maxRoughness`. So there is no hard edge, but the environment fills those parts: give the scene one, such as the sky's.
- Rough reflections blur through the copy's mip levels: a level as wide as the cone of the surface's roughness over the ray's length. This blur has no noise, so the reflections stay steady from frame to frame.
- The frame before's colors hold the opaque objects, the background and the reflections of that frame. Blended objects, particles and surfaces that let light through do not show in the reflections. A fast object's reflection lags it by one frame. The first frame after the reflections turn on shows none.
- A planar reflection pass's reflection wins on its plane, over both the screen's reflection and the environment. Blended surfaces and surfaces that let light through keep the environment's reflection.

### Where screen-space reflections draw

The quality setting `ssrScale` sets the size of the trace's grid, as a share of the render size each way. High and Ultra draw at half size, and Medium at a quarter. Low, which phones start with, sets 0, so phones keep the environment's light even when the sketch turns the reflections on. `ssrSteps` sets the most steps of each ray's march: 24 on Medium, 48 on High and 64 on Ultra. Rays that cross much of the screen need more steps.

Screen-space reflections and ambient occlusion share one grid, at the larger of their scales. Like ambient occlusion, the reflections need float targets, which WebGL2 draws into only with the `EXT_color_buffer_float` extension. On the 8-bit path the copy holds display color, so the reflections look a little grayer there.

### Cost

The reflections add the depth prepass, the depth copy, six small steps for the pyramid, the trace and the copy of the opaque colors with its mip levels. Transmission shares that copy. The opaque pass reads four texels of the screen texture at each pixel, the same reads that ambient occlusion and contact shadows use. It adds one filtered read to each pixel of a smooth enough surface. While the reflections are off, the frame has none of these passes or targets, and the shaders download only when a sketch first turns them on.

The engine's benchmark scene of 100,000 boxes over a polished floor ran on a MacBook Pro in Chrome. With WebGPU, the reflections added about 0.7 ms of GPU time per frame on Medium, at a quarter of the render size. On High, at half the size, they added about 1.8 ms. On WebGL2 they added between 0.25 and 1.24 ms. They added no CPU time beyond the noise.

- The trace's targets follow the render scale, and a new scale makes no new target. The pyramid takes about 5 bytes per texel of the grid, and the trace 8.
- When frames take too long, the frame-budget governor lowers `ssrScale` to a quarter, in the step after ambient occlusion's.


## Outlines

Outlines draw a crisp line around the meshes that `setOutlined(true)` marks:

1. The mask pass draws the outlined meshes from the camera into a mask of the render size. Its depth test reads the depth that the scene passes drew, so it knows which parts other objects hide. Each mesh draws twice: once to mark all of it, and once to mark the parts that nothing hides.
2. The final pass reads the mask at each pixel and at 8 places on a circle of the line's width around it. Outside the outlined meshes, a pixel near a marked part is on the line. The line takes `color` beside a part that nothing hides, and `hiddenColor` where every part beside it is hidden.
3. The final pass paints the line after the tone mapping and before the color grading, so the line shows its colors exactly.

[The post-processing API](../api/post.md#outlines) lists the settings.

- The line has no blur, so it ends as sharply as the meshes' own edges. Its width counts pixels of the canvas, so it stays sharp at every pixel ratio and render scale.
- The mask pass culls the outlined meshes with the camera's view on its own, so outlined meshes out of view cost nothing.
- three.js draws every other object's depth again for its hidden parts. The mask pass reads the depth that the scene passes drew instead.
- The 8-bit path draws the same line as the HDR path.
- While nothing is outlined, the mask pass and the mask are off, so turning outlines on costs nothing until a mesh is outlined.

### Cost

Outlines draw the outlined meshes twice into the mask, which takes 4 bytes per pixel of the render size. The final pass then reads the mask once at each pixel, and 8 more times outside the outlined meshes. No other pass runs. The scene's depth stays in memory after the scene's render pass, where it could be thrown away before. On a phone's GPU, which keeps the depth on chip, that costs a write of the depth to memory.

## Color grading and the vignette

A color grading table, from a `.cube` or a `.3dl` file through `assets.loadLut` or from numbers through `assets.lutFromData`, maps each display color to a graded color, as three.js's `LUTPass` does after its `OutputPass`. The vignette darkens the picture toward its edges. [The post-processing API](../api/post.md#color-grading) lists their settings.

- The vignette multiplies HDR color before the tone mapping, as Filament, Unity's URP, Bevy and Babylon.js do. Bright corners then darken as dark corners do. three.js's `VignetteShader` blends display color toward a gray after the tone mapping, which turns bright corners gray.
- The table works on display color, after the tone mapping. Grading tools make tables for display color, so they look as their authors made them.
- Both draw on every GPU path, with HDR color or without it, as [Post-processing API](../api/post.md#vignette) says.
- They are settings of the final pass, not passes of their own. Turning one on builds no pipeline, so the picture changes in the next frame with no pause.
- The table is a 3D texture, read with one filtered texture read per pixel. The vignette costs a few operations per pixel.
- The engine's parity test compares a `.cube` table alone with three.js's composer. It matches in all but under 0.1% of the pixels on every GPU path. With the vignette too, mapped from `VignetteShader`'s settings for AgX, it matches as closely.

## Dithering

An 8-bit canvas holds 256 steps of each color, and a smooth gradient between two close colors shows as bands. The final pass adds noise of up to one step to each pixel, so the bands break up into fine grain. This is dithering. It runs last, after the table and the vignette.

- The noise has the shape of a triangle: values near 0 come most often. Its strength is then the same at every brightness. Noise of even spread still shows bands at some brightness levels, as Mikkel Gjoel showed in "Banding in Games" (2016). Filament and Unity's URP dither with triangle noise too.
- The noise is the same in every frame, so a still picture does not shimmer.
- The dither comes after every other step, so no later step shrinks it. In the dark corners of a vignette, where bands show first, it keeps its full step.
- On the 8-bit path the scene's shaders dither as they draw. The final pass then dithers again only where it changes the color, with a table.

## Still-camera accumulation

When nothing in the view changes, the engine sharpens the picture and then stops drawing. Each frame draws the scene with the camera moved by a fraction of a pixel, and blends into a kept 16-bit history. After 63 blended frames, about a second at 60 frames per second, the history holds their average. Its edges and fine detail are smoother than any one frame's. The thread that draws then takes frames without drawing them, so the GPU rests, and the canvas keeps the sharp picture. The first frame that changes draws at once, as a moving view does, and the blending starts again.

The engine finds a still view by comparing each frame's draw commands and uploaded values with those of the frame two frames before. It leaves out only the values that change on their own in every frame: the clock, the sub-pixel offset and the blend's weight. Anything else that changes counts as a change, so the picture never freezes while something moves. The sketch keeps running while the view rests, so `onUpdate` sees input and time as before.

- While the view blends, the final pass skips FXAA: the blended frames smooth the edges instead. With MSAA, each blended frame keeps its 4 samples.
- Meshes and sprites move by the sub-pixel offset. Lines, points and particles draw without it.
- Some views never blend. Their picture can change on the GPU alone, or with the clock alone, or the blend would mix what it cannot average. Those views draw every frame as before. Views with bloom, outlines, automatic exposure, volumetric fog, particles, custom effects, custom materials or the physical sky never blend either. Nor does a canvas that keeps its alpha, or the 8-bit color path.
- The history is one 16-bit target the size of the canvas: 8 bytes per pixel, about 17 MB at 1920 × 1080.
- Hold mode, and so the image tests, draws without it. The option `createEngine({ still: false })` and the page switch `?still-camera=off` turn it off.

## Effects on devices without HDR color

Bloom, depth of field, automatic exposure, custom effects and custom tone curves need the scene's linear color. Two kinds of device draw it with no float target at first, on the 8-bit path that [color management](color-management.md#the-8-bit-path) describes:

- WebGPU in compatibility mode with MSAA: this mode cannot multisample a float target. Some features need HDR color: bloom, depth of field, automatic exposure, a custom effect, a custom tone curve, and volumetric fog with `fogSlices` above 0. The first of them moves the engine to HDR color with FXAA, for the rest of its life. Meanwhile the last image stays on screen until the new pipelines are built. On a desktop that takes two or three frames. `engine.capabilities.hdr` reports the path that the engine started on.
- WebGL2 devices whose float targets fail the engine's test. They have no HDR target, so bloom, depth of field, automatic exposure, volumetric fog and custom effects stay off, and the built-in tone curve stays. Development builds warn once in the console.

The devices that the engine was tested on all draw HDR color with WebGL2, and with core WebGPU.

## Porting from three.js

- Delete `EffectComposer`, `RenderPass` and `OutputPass`. The scene pass and the final pass are built in.
- `new UnrealBloomPass(resolution, strength, radius, threshold)` becomes `post.set({ bloom })` with `blend: 'add'`, the same `threshold` and a `knee` of 0.01. The intensity is about 8.8 times `strength`, and `radius` becomes the `weights`. The `null3d-port-threejs` skill holds a table of weights by radius, and a script that maps the settings for a canvas size. The resolution is the canvas's, so it needs no setting.
- three.js's glow spans a number of pixels, and null3D's a share of the screen. So a mapping matches at one canvas size, 1080 pixels on the shorter side by default. On a larger screen null3D's glow looks wider than three.js's.
- A strong bloom spreads a little wider at the edges of the frame than three.js's. three.js's faint haze fades toward the corners, and null3D's keeps its light there. To soften it, lower `strength` or `radius` before you map the settings, or lower `intensity`.
- pmndrs's `BloomEffect` maps the same way, with `blend: 'screen'`: its `intensity` stays, `luminanceThreshold` becomes `threshold`, and `luminanceSmoothing` becomes `knee`. three.js's `bloom()` node maps as `UnrealBloomPass` does, at a third of the intensity.
- `new BokehPass(scene, camera, { focus, aperture, maxblur })` becomes `post.set({ dof: { focusDistance: focus, maxBlur } })`, with the lens's `aperture` as an f-number. `BokehPass`'s aperture scales its blur with the distance from the focus. null3D's lens blurs as a camera does, so set `camera.setFocalLength` and pick an f-number by eye, such as 2.8.
- The `maxblur` of `BokehPass` is a share of the canvas's width, and `maxBlur` is a share of its height. Multiply it by the aspect ratio. In one pass, `BokehPass` blurs each pixel by its own depth, so a sharp object spreads a halo into a blurred background. null3D's near and far fields spread no halo.
- `new GTAOPass(scene, camera, width, height)` becomes `post.set({ ao: {} })`. Its `updateGtaoMaterial({ radius, thickness, distanceExponent, distanceFallOff, scale, samples })` settings keep their names, with `distanceFalloff` spelled so, and `blendIntensity` becomes `intensity`. Set `quality.set({ aoScale: 0.5 })` too where phones and tablets should draw it.
- `SSAOPass`, `SAOPass` and the N8AO library also become `post.set({ ao })`. Their settings have other meanings, so start from the defaults and tune `radius` and `scale` by eye.
- `new OutlinePass(resolution, scene, camera, selectedObjects)` becomes `post.set({ outline: { color, hiddenColor, width } })`, from `visibleEdgeColor` and `hiddenEdgeColor`. `OutlinePass` draws its edge at half size, so a `width` of twice its `edgeThickness` gives about the same line. three.js draws a dark brown line around hidden parts by default, and null3D draws none until `hiddenColor` is set. Each selected mesh calls `setOutlined(true)`. A selected model's copy from `scene.instantiate` calls it once for all of its meshes.
- `OutlinePass` blurs its edge, and `edgeStrength`, `edgeGlow` and `pulsePeriod` set how bright it is, how far it glows and how fast it pulses. null3D's line is crisp and opaque, so it has none of these settings. To pulse the line, change its color or width every frame.
- three.js has no automatic exposure. pmndrs's `ToneMappingEffect` with `mode: ToneMappingMode.REINHARD2_ADAPTIVE` adapts, and becomes `post.set({ autoExposure: { metering: 'mean' } })`. Its `adaptationRate` becomes about `speedUp` and `speedDown`, and its `middleGrey` the `compensation`: `log2(middleGrey / 0.18)` stops. Its Reinhard curve becomes a custom tone curve. pmndrs meters a mip chain of the whole frame. null3D meters on the GPU with center weighting, so the result differs a little.
- `renderer.toneMapping` and `toneMappingExposure` become `post.set({ toneMapping, exposure })`. three.js applies no tone mapping by default, and null3D applies punchy AgX. A port that set `AgXToneMapping` sets `'agx'`. The exposure gives the same picture: null3D applies it to each light rather than at the end, and bloom's threshold keeps its meaning.
- `new LUTPass({ lut: result.texture3D, intensity })` after a `LUTCubeLoader` or `LUT3dlLoader` becomes `post.set({ lut: await assets.loadLut(url), lutIntensity: intensity })`. A `Data3DTexture` that code fills becomes `await assets.lutFromData({ size, data })`.
- A `ShaderPass(VignetteShader)` with its `offset` and `darkness` uniforms becomes `post.set({ vignette: { size: offset, intensity: darkness } })`. Under ACES the default falloff gives a close match. Under AgX, keep `intensity` at 1 or less and set `falloff` to 3. With a `darkness` below 1, three.js also lifts dark corners toward a gray, and null3D does not.
- Any other `ShaderPass` becomes `post.addEffect` with the shader rewritten in WGSL. A pass after `OutputPass` saw display color, and an effect sees linear HDR color. Numbers that assume colors from 0 to 1 may need changes. `ReinhardToneMapping`, `CineonToneMapping` and `CustomToneMapping` become a custom tone curve. [Porting post-processing](../porting/threejs-postprocessing.md) shows both.

## Related pages

- [Post-processing API](../api/post.md): `post.set` and its settings, and `post.addEffect`.
- [Custom passes](../guides/custom-passes.md): how to write custom effects and tone curves.
- [Objects and transforms](../api/objects.md#mesh-calls): `setOutlined`.
- [Color management](color-management.md): HDR color, the final pass and the 8-bit path.
- [The render graph](render-graph.md): how the passes of a frame are declared and ordered.
- [Quality presets](quality-presets.md): `bloomSize`, `aoScale`, `dofSamples`, the depth prepass and the frame-budget governor.
