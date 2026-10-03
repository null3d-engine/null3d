---
id: guides/phones
title: Phones and tablets
status: experimental
since: "0.1"
summary: "Pixel-ratio caps; memory budgets; heat; testing on real devices."
---

# Phones and tablets

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. The texture memory budgets are not built yet. Coding agents must not use them.

Phones have small GPUs, sharp screens and little memory, and they slow down when they heat up. The quality presets set how much work the engine does on each device. This guide says what the engine does on a phone or a tablet, and how to test your sketch on one.

## The preset on a phone

The engine tells a phone from a tablet or a desktop by its main pointer and its screen's smaller edge. A phone starts at a lighter preset than a tablet, and a tablet at a lighter one than a desktop. WebGL2, which many phones use, caps the preset further. [Quality presets](../concepts/quality-presets.md) lists how the engine chooses, and each preset's settings.

Read the preset in your sketch from `ctx.quality.preset`, and keep your own values per preset in one table:

```ts
const CROWD = { low: 40, medium: 120, high: 400, ultra: 1000 };
export default defineSketch(({ quality }) => {
  const people = CROWD[quality.preset];
  // ...
});
```

Do not force a heavier preset on phones. When a player picks one in a menu, pass it to `createEngine` with the `preset` option.

## Pixel ratio

The GPU fills every device pixel of the canvas, and a screen's device pixels grow with the square of its pixel ratio. So the pixel ratio is the largest cost you can cap. A full-screen canvas on a phone of 390 x 844 CSS pixels fills:

| Pixel ratio | Device pixels | Compared with a ratio of 2 |
| --- | --- | --- |
| 3, the phone's own | 2.96 million | 2.25 times |
| 2 | 1.32 million | the same |
| 1.5 | 0.74 million | 0.56 times |

The engine caps the ratio at the preset's value, which is lowest on the Low preset. The `maxPixelRatio` option of `createEngine` sets another cap, and `quality.set({ maxPixelRatio })` changes it during play, for example from a setting in your menu.

## Render scale

When frames take too long, the engine draws the scene at a lower render scale: a part of the canvas's width and height. It then scales the image up to the canvas. On the Low preset, the scale can drop to 0.5, a quarter of the pixels. It rises again when the frames have time to spare. [Quality presets](../concepts/quality-presets.md#dynamic-resolution) explains when the scale moves.

Text and fine lines in the scene get softer at a lower scale. The scaling also takes the place of FXAA, which Low uses to smooth edges. Draw your interface in HTML over the canvas, where it stays sharp. To keep the whole canvas on a device, set `quality.set({ minRenderScale: 1 })`. The savings of the pixel ratio cap and the render scale multiply. At a ratio of 1.5 and a scale of 0.5, the phone above fills 0.19 million pixels.

## Shadows

A directional light's shadows draw the shadow casters once for each cascade, into a map whose texels the GPU fills each frame. The preset sets the cascade count and the map size of each light whose options name neither. Low draws fewer cascades than Medium, with smaller maps, and blends fewer texels at each shadow's edge. So leave `cascades` and `mapSize` out of the light's `shadow` options, and phones draw lighter shadows by themselves. [Shadows](../concepts/shadows.md#settings) lists the options, and [Quality presets](../concepts/quality-presets.md#the-settings-of-each-preset) each preset's values.

## Memory

A phone closes a tab that uses too much memory, with no warning. The engine's tab memory test grew one kind of GPU memory in a tab, in steps of 32 MiB, until the tab died:

| Device and browser | GPU textures | GPU buffers |
| --- | --- | --- |
| 11-inch iPad Pro, Safari, WebGPU | 2,016 MiB | the GPU stopped answering at 512 MiB |
| 11-inch iPad Pro, Safari, WebGL2 | 2,528 MiB | 2,496 MiB |
| Galaxy S24+, Chrome, WebGL2 | 7,296 MiB | 7,616 MiB |

No allocation failed first, and no error came. A scene holds its textures, buffers, render targets and WebAssembly memory at once, and a device with less memory gives a tab less. So on phones and tablets, keep a scene's textures under 1 GiB. On an iPad's WebGPU path, keep its GPU buffers under 256 MiB.

On a page with worker threads, the engine's threads share one WebAssembly memory, whose maximum the preset sets. The browser reserves address space for the whole maximum, and every other engine and WebAssembly module on the page shares what is left. [Page API: createEngine](../api/engine.md#memory) says when to ask for more.

To use less memory, share meshes and materials, draw many copies with instance batches, and create objects during setup. `engine.measure` reports the WebAssembly memory in use.

Textures take GPU memory too. A texture of 1024 x 1024 texels takes about 5.3 MiB with its mip levels. The sketch reads the GPU memory of every texture in `textures.memoryBytes`, and frees a texture that it no longer needs with `texture.destroy()`. The engine keeps no copy of an image once its upload is done. [Textures](../api/textures.md#gpu-memory) gives the sizes.

Load large textures from KTX2 files. Phones and tablets have the ASTC and ETC2 formats, so a KTX2 texture stays compressed on the GPU. The same 1024 x 1024 texture then takes about 1.3 MiB, or 0.7 MiB in ETC2 without alpha. Encode its mip levels into the file, as `basisu -mipmap` does, because the GPU cannot make them for compressed texels. Use UASTC for normal maps and detailed color maps, and ETC1S where the download must stay small. `texture.format` tells which format the device got. [Textures](../api/textures.md#ktx2-files) covers KTX2 files.

A page that starts a second engine, for example in a single-page app, waits for the first engine's `destroy()` promise. The browser frees the first engine's memory only then.

When the tab crashes during a start, the next start of the sketch runs one preset lower. A second crash in a row starts it at Low. [Quality presets](../concepts/quality-presets.md#starts-that-crashed-the-tab) explains the note that the engine keeps for this. The page reads the count in `engine.mode.crashedStarts`.

## Heat

A phone lowers its clock speeds when it heats up, often after a few minutes of play. Leave room for it: aim for about 70% of the frame budget, and test runs of 10 minutes. When frames still take too long, the frame-budget governor lowers the render scale, then the live shadow settings. The `quality.onChange` handlers run after each shadow step, so the sketch can lighten its own work too ([Quality presets](../concepts/quality-presets.md#the-frame-budget-governor)). In the engine's benchmarks, a warm Galaxy S24+ took about 70% longer per frame than a cool one ([Performance guide](performance.md#phones-and-tablets)). Tablets heat up too. A warm 11-inch iPad Pro took about 17 ms of GPU time per S4 frame at Medium, against about 12.6 ms a minute earlier. It then ran at about 45 frames per second. On a warm tablet, only Low aims for 60 frames per second ([Quality presets](../concepts/quality-presets.md#how-the-engine-chooses-a-preset)). The [Performance guide](performance.md) also shows how to measure the frame.

## Touch input

The engine reads touches as it reads the mouse: the first finger presses `Mouse0`, and `input.touches` lists every finger on the canvas. A canvas that takes touch gestures needs `touch-action: none` in its CSS. Without it, the browser scrolls or zooms the page, and it cancels the touch. [Input](../api/input.md#touches) explains touches and pinches.

## Testing on real devices

Desktop browsers that emulate a phone show neither its GPU nor its heat, so test on the phones and tablets that your audience uses.

- Serve the page over HTTPS, or reach it as `localhost` over USB. [Hosting and cross-origin isolation](../getting-started/hosting.md#during-development) shows both.
- Check the preset that the engine chose in `engine.mode.preset`. The capability report in `engine.report` holds the facts that it chose from: `coarsePointer`, `screenMinEdge` and `deviceMemoryGB`.
- Add `?preset=low`, `?preset=medium`, `?preset=high` or `?preset=ultra` to the page's address to test each preset on one device. The GPU path still caps the preset.
- Add `?gpu=webgl2` to test the WebGL2 path, which many phones use.
- Start with a cool, charged device, with its battery saver off and its display at a fixed refresh rate.
- Debug the page on the device from your computer. For Chrome on Android, turn on USB debugging on the phone, and open `chrome://inspect` in Chrome on the computer. For Safari on an iPhone or iPad, turn on Web Inspector in Safari's advanced settings on the device. Then open the device from the Develop menu of Safari on a Mac. [Debugging](debugging.md) covers the console and the engine's errors.

## Related pages

- [Quality presets](../concepts/quality-presets.md): how the engine chooses a preset, and each preset's settings.
- [Quality API](../api/quality.md): the preset and settings in the sketch.
- [Performance guide](performance.md): measuring the frame and fixing slow frames.
- [3D scenes on content pages](content-pages.md): the page without the scene, for product pages.
