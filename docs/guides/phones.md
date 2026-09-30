---
id: guides/phones
title: Phones and tablets
status: experimental
since: "0.1"
summary: "Pixel-ratio caps; memory budgets; heat; testing on real devices."
---

# Phones and tablets

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Dynamic resolution, the frame-budget governor that lowers settings when a phone heats up, and the texture memory budgets are not built yet, so coding agents must not use them.

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

## Memory

A phone closes a tab that uses too much memory, with no warning. On a page with worker threads, the engine's threads share one WebAssembly memory, whose maximum the preset sets. The browser reserves address space for the whole maximum, and every other engine and WebAssembly module on the page shares what is left. [Page API: createEngine](../api/engine.md#memory) says when to ask for more.

To use less memory, share meshes and materials, draw many copies with instance batches, and create objects during setup. `engine.measure` reports the WebAssembly memory in use.

When the tab crashes during a start, the next start of the sketch runs one preset lower, and a second crash in a row starts it at Low. [Quality presets](../concepts/quality-presets.md#starts-that-crashed-the-tab) explains the note that the engine keeps for this. The page reads the count in `engine.mode.crashedStarts`.

## Heat

A phone lowers its clock speeds when it heats up, often after a few minutes of play. Leave room for it: aim for about 70% of the frame budget, and test runs of 10 minutes. The [Performance guide](performance.md) shows how to measure the frame.

## Testing on real devices

Desktop browsers that emulate a phone show neither its GPU nor its heat, so test on the phones and tablets that your audience uses.

- Serve the page over HTTPS, or reach it as `localhost` over USB. [Hosting and cross-origin isolation](../getting-started/hosting.md#during-development) shows both.
- Check the preset that the engine chose in `engine.mode.preset`. The capability report in `engine.report` holds the facts that it chose from: `coarsePointer`, `screenMinEdge` and `deviceMemoryGB`.
- Add `?preset=low`, `?preset=medium`, `?preset=high` or `?preset=ultra` to the page's address to test each preset on one device. The GPU path still caps the preset.
- Add `?gpu=webgl2` to test the WebGL2 path, which many phones use.
- Start with a cool, charged device, with its battery saver off and its display at a fixed refresh rate.

## Related pages

- [Quality presets](../concepts/quality-presets.md): how the engine chooses a preset, and each preset's settings.
- [Quality API](../api/quality.md): the preset and settings in the sketch.
- [Performance guide](performance.md): measuring the frame and fixing slow frames.
- [3D scenes on content pages](content-pages.md): the page without the scene, for product pages.
