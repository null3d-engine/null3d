# Car paint

A paint material for car bodies and other painted metal. It draws a metallic base under a clear
coat, with three parts that a look turns on and off:

- **Metal flakes.** The flakes are the metal's microfacets, drawn with the glint model of Deliot
  and Belcour. Each pixel counts how many of the flakes in its footprint reflect a light into the
  eye, and uses that count in place of the smooth highlight. The paint therefore sparkles
  where the light is, and draws as a smooth metal far away, without shimmering as the car moves.
- **Panel seams.** Narrow grooves at the look's intervals, as between a door and a wing. The groove
  keeps at least the width of a pixel, so it never crawls. The clear coat follows the groove and
  catches an edge of light along it.
- **An optional carbon weave.** A 2 x 2 twill of rounded tows, dark in the gaps between them. A
  tow's normal slopes across it and stays level along it, so its highlight runs along the tow and
  the two directions of the weave shine their own way.

The paint uses the engine's clear coat, which loads the first time a material asks for it. It is a
custom material with a surface function and a lobe, so it reaches the engine only through
`@null3d/engine`.

## Use it

```ts
import { createCarPaint } from '../addons/car-paint';

const paint = createCarPaint(ctx, {
  color: '#9e0b16',
  flakes: { cells: [120, 210], tilt: 0.25 },
  seams: { spacing: [0.34, 0], width: 0.0022 },
});

const carbon = createCarPaint(ctx, {
  color: '#141619',
  metalness: 0.25,
  roughness: 0.42,
  weave: { cells: [70, 120], shine: 0.9 },
});
```

Give the paint to a mesh whose geometry has texture coordinates. The first coordinate runs along
the surface and the second around or up it. The flakes, the seams and the weave read those
coordinates, so the caller sets their density and spacing.

`createCarPaint(ctx, look)` takes these options:

| Option | Meaning | Default |
| --- | --- | --- |
| `color` | The base color | `#9e0b16` |
| `metalness` | How metallic the base is | `0.72` |
| `roughness` | The base's perceptual roughness | `0.34` |
| `clearcoat` | How much clear coat covers the paint | `1` |
| `clearcoatRoughness` | The coat's perceptual roughness | `0.02` |
| `flakes` | `{ cells, tilt, angle, max }`, or `false` | `{ cells: [120, 210], tilt: 0.25, angle: 0.25, max: 64 }` |
| `seams` | `{ spacing, width, shade }`, or `false` | `{ spacing: [0.34, 0], width: 0.0022, shade: 0.85 }` |
| `weave` | `{ cells, shine }`, or `false` | `false` |

`flakes.cells` and `weave.cells` count cells across each texture coordinate. `flakes.tilt` is how
far the flakes' normals spread from the surface normal. `flakes.angle` is the angular radius of each
light in radians, which sets how many flakes glint at once, and `flakes.max` bounds a bright single
flake. `seams.spacing` gives the interval along each coordinate, and a value of 0 draws no seam
along that coordinate. A look with `weave` shapes each tow's normal, so the highlight runs along the
tow. A look without one draws a smooth panel.

## Cost

The paint pays for the clear coat's lobe. The flakes cost the footprint's derivatives and one hash
for each pixel, and the lobe adds two hashes and a short sum of terms for each pixel
of each light. The seams cost a few derivatives for each pixel. The weave adds its own pattern,
slope and roughness change.

## Limits

- The shader draws on both GPU paths. It uses `fwidth`, which both paths have.
- A mesh without texture coordinates does not draw with the paint.
- The flakes read the texture coordinates, so a mesh whose coordinates stretch draws stretched
  flakes. Give the paint a mesh with even coordinates, or change `cells`.
- The glints come from the main directional light and from each point and spot light. Area lights
  draw the base highlight alone, so a scene with no direct light shows no sparkle.

## Licence

MIT OR Apache-2.0. The engine's two licence files at the repository root hold the terms.
