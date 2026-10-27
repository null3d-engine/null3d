# Facades

Walls with a room behind every lit window, and the power-on wave that lights a scene window by
window. The material draws a building's facade from the world position, so one material covers an
instanced batch of towers and a window keeps its size whatever a building's scale. A second form
draws a window that a scene places itself, such as the panes on a house.

Every window looks into a small room: a back wall, two side walls, a floor and a ceiling, a lamp's
pool of light, a block of furniture, blinds that some rooms draw down and a curtain in some. The eye
ray through the glass meets the room's own box, so the room moves in parallax as the camera passes,
and the view from the side of the street shows more of it than the view from in front.

Each room takes its own light, blinds and furniture from a window code. The wall finishes and the
codes are made in code when the sketch starts and upload with the material, so the add-on ships no
image file. Four wall finishes are built in: brick, timber, concrete and glass.

Where a window shrinks below a few pixels, the rooms fade to the wall's own average light. The
window's share of that average lives in the wall page's alpha channel, so a distant skyline draws a
steady glow instead of a crawling grid.

## Two forms

`createFacade(ctx, look)` draws a whole wall: a window in each bay of each floor, the frame around
each one and the pier between two windows. The facade maps its windows from the world position.

```ts
import { createFacade } from '../addons/facades';

const towers = createFacade(ctx, {
  kind: 'seed',
  window: { width: 2.2, height: 2.4, spacing: 0.76, floorHeight: 3.7, sill: 1.4 },
  room: { depth: 2.6, light: 2.8, litShare: 0.42 },
  power: { origin: [0, 0], speed: 2600 },
});
scene.createInstances(geometry.box(), count, {
  material: towers.material,
  values: true,
});
towers.start();
```

`createWindow(ctx, look)` draws one window across the mesh's own texture coordinates, for the
panes that a scene already places on a wall. Give the mesh the glass's size plus the frame's band on
each side. Each instance's row values give its own light:

| Row value | Meaning |
| --- | --- |
| `x` | Whether the window is lit, from 0 to 1. |
| `y` | How warm its light is, from 0 for cool to 1 for amber. |
| `z` | A phase in turns, which moves the flicker of its light. |
| `w` | Above 0.5 draws the room in the blue of a screen. |

```ts
const panes = createWindow(ctx, {
  kind: 'timber',
  window: { width: 0.73, height: 1.01, frame: 0.055 },
  room: { light: 2.2 },
});
scene.createInstances(geometry.plane({ width: 1, height: 1 }), count, {
  material: panes.material,
  values: true,
});
```

## The power-on wave

`start(at)` begins the wave at the sketch's time, or at a time in seconds. Each window waits for the
wave to reach it, its distance from the wave's origin divided by the wave's speed, and then its
light rises on a damped spring: it overshoots slightly and settles. A look that never calls `start`
is already lit, so a scene that wants no wave pays nothing for it.

`setPower(share)` scales the whole scene's own light, from 0 by day to 1 by night. It changes no
uniform per window: the wave, the flicker and the far fallback all read the one value.

| Look part | Meaning | Default |
| --- | --- | --- |
| `kind` | `brick`, `timber`, `concrete`, `glass`, or `seed` for each building's own pick | `seed` |
| `color` | The wall's tint, multiplied over the finish | white |
| `window.width` | The glass's width in metres | `1.7` |
| `window.height` | The glass's height in metres | `1.5` |
| `window.spacing` | The pier between two windows in metres | `1.1` |
| `window.floorHeight` | The floor-to-floor height in metres | `3.4` |
| `window.frame` | The frame's band around the glass in metres | `0.13` |
| `window.sill` | The first floor's cell base above the mesh's base in metres | `0.9` |
| `room.depth` | How deep a room reaches behind its glass in metres | `2.2` |
| `room.light` | How strongly a lit room glows | `2.4` |
| `room.flicker` | How much a room's light flickers, from 0 to 1 | `0.4` |
| `room.litShare` | The share of a facade's windows that are lit | `0.45` |
| `room.furniture` | Draw the furniture, or `false` for none | `true` |
| `room.blinds` | Draw the blinds, or `false` for none | `true` |
| `power.origin` | The point on the ground that the wave starts from, as x and z | `[0, 0]` |
| `power.speed` | How fast the wave crosses the ground, in metres a second | `2600` |
| `power.rise` | The spring's rate in radians a second | `12` |
| `power.damping` | The spring's damping | `6` |
| `power.start` | The wave's start time in seconds, or already complete | complete |

## Cost

The material costs one surface function and two texture reads per pixel up close: the wall page's
colour and its surface page, both with the cell's own derivatives. The room costs a ray against
three pairs of planes, a handful of hashes and one texel of the code page. The far fallback costs
the same reads at a coarser mip level.

The two wall pages hold 256 KB each, about 342 KB with their mip levels, and the code page holds
1 KB.

`tests/image/facades-cost.spec.ts` times a wall of rooms against a plain wall of the same size, on
each GPU path and preset, at 1920 by 1080 with a render scale of 1. It runs only in a quiet window
on a computer with a GPU of its own:

```sh
NULL3D_FACADE_COST=1 bun run test:browser -- facades-cost.spec.ts
```

Its figures are about 1.0 ms of GPU time a frame against a plain wall at 1920 by 1080, on both
WebGPU paths at every preset, and 0.85 ms at Low and 0.05 to 0.49 ms at Medium, High and Ultra on
WebGL2. Compatibility mode and WebGL2 stop at Medium, so their High and Ultra cells measure
Medium's work, and the spread over those three cells is the run's; the material costs under about
half a millisecond there. They were measured on a MacBook Pro with an Apple M3 Max in Chrome 156,
at a load of 2.0 to 2.9, and every row held the display's 16.665 ms interval. The run needs the
load under 8.

## Limits

- The shader draws on both GPU paths. It reads the wall pages through explicit derivatives, so its
  texture reads stay outside any branch, as WebGL2 requires.
- A facade maps its windows from the world position, so it expects walls along the world's two
  horizontal axes. A wall at an angle shows cells of another width.
- The wall pages repeat one cell for each window, so a wall's finish repeats with its windows.
- The material takes three texture slots of a material's six, so it leaves room for three maps of
  its own.

## Licence

MIT OR Apache-2.0. The engine's two licence files at the repository root hold the terms.
