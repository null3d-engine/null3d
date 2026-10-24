# Screens

Displays in the world that a sketch paints on `OffscreenCanvas` objects. A screen holds one
canvas-backed texture, reads the canvas at its own refresh rate, and uploads only the rectangles
that changed. Its material draws the panel as a lit surface:

- **An LCD look by distance.** Each texel shows red, green and blue bars when it covers several
  pixels, and blurs to its own color further away. A band of light drifts up the panel, the foot of
  each texel row darkens, and a share of the texels stays dead. The pattern's size in pixels comes
  from the texture coordinates' derivatives, so the look follows the distance with no camera value.
- **A boot glitch.** `screen.boot()` tears rows sideways, rolls a dark band up the panel and fades
  the picture in for the look's boot time.
- **Clicks in canvas coordinates.** `screen.pointOf(event)` turns a pointer hit's texture
  coordinates into a point on the canvas, so the sketch draws at the point that was clicked instead
  of working out where the surface lies in space.

The screen reaches the engine only through `@null3d/engine`, and its shader loads with the demo
that imports it.

## Use it

```ts
import { createScreen } from '../addons/screens';

const screen = createScreen(ctx, {
  width: 512,
  height: 256,
  refreshHz: 12,
  size: [2.4, 1.2],
  draw: (context) => {
    context.fillStyle = '#061019';
    context.fillRect(0, 0, 512, 256);
    context.fillStyle = '#9fe8ff';
    context.font = 'bold 48px sans-serif';
    context.fillText('REACTOR 62.0', 24, 90);
  },
});
screen.mesh.setPosition(0, 1.4, -3);

screen.onClick((point) => {
  // The point is on the canvas, so a square lands where the pointer hit.
  screen.paint((context) => {
    context.fillStyle = '#ffd678';
    context.fillRect(point.x - 4, point.y - 4, 8, 8);
  }, { x: point.x - 4, y: point.y - 4, width: 8, height: 8 });
});

// A change that the refresh rate holds back goes in the next frame.
onUpdate(() => screen.flush());
```

`draw` runs in the setup, before the texture's first upload, so a held frame shows the picture.
`screen.paint(draw, changed)` draws and uploads the rectangle that changed; without a rectangle it
uploads the whole canvas. `screen.mark(rect)` adds a rectangle without drawing, and `screen.flush()`
uploads the marked rectangles together.

`createScreen(ctx, options)` takes these options:

| Option | Meaning | Default |
| --- | --- | --- |
| `width`, `height` | The canvas's size in texels | `512`, `256` |
| `refreshHz` | The most reads of the canvas each second | `12` |
| `size` | The plane's size in meters, as `[width, height]` | One meter across, at the canvas's shape |
| `lcd` | The LCD look, or `false` for a plain image | The look |
| `draw` | Paints the first picture, before the first upload | None, a blank canvas |

The LCD look takes `subpixels`, `scan`, `deadPixels`, `glow` and `bootSeconds`. `screen.set` changes
them and `power` at any time. A screen made with `lcd: false` draws its canvas through the unlit
material and takes no values.

`screen.pointOf(event)` returns `{ x, y }` on the canvas in texels, from its top-left corner, or
null for a hit without texture coordinates. `screen.texelOf(event)` returns the whole texel under
the point. The rectangle that `paint` and `mark` take is in the canvas's own coordinates.

## Cost

The LCD look adds one texture sample and the panel's math to each pixel: two derivative reads, a
few hashes, the sub-pixel bars, the scan band and the dead-texel test. A screen made with
`lcd: false` skips all of it and draws as an unlit image. The design is in [the screen decision record](../../../.dev/decisions/D-252-in-world-screens.md),
which records the cost figures that `tests/pages/screens-cost.html` times on each GPU path and
preset, in a quiet window, with `NULL3D_SCREEN_COST=1 bun run test:browser -- screens-cost.spec.ts`.

The upload side is the engine's canvas-to-texture path: a changed rectangle costs the bytes of that
rectangle, and the refresh rate caps the reads. [The canvas texture tests](../../../tests/image/canvas-texture.spec.ts)
hold that path's figures.

## Limits

- The shader draws on both GPU paths. It uses `fwidth`, which both paths have.
- The panel's mesh needs texture coordinates, as the plane from `geometry.plane` has.
- A refresh that a rate or an upload holds back returns false. The change stays for the next
  `flush`, so call `flush` from the frame's update.
- `texture.refresh` reads the canvas with `getImageData` in the sketch worker. A large canvas at a
  high refresh rate costs its rectangle's bytes each time, so give a screen only the rate that its
  content needs.
- A held frame runs no update. Paint the picture through `draw` or in the setup, never only in an
  update.

## Licence

MIT OR Apache-2.0. The engine's two licence files at the repository root hold the terms.
