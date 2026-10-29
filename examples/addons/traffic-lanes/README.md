# Traffic lanes

An example add-on that draws tens of thousands of vehicles moving along straight lanes, at no CPU
cost per frame. The lanes are cut in the vertex shader: each row carries its lane's start offset,
its speed and the lane's length, and the vertex offset wraps it at the far end.

It also draws the vehicles' own lights, tail bars, a nose lamp and a glowing skirt under the belly,
from each row's place in its own hull. Every lane's rows are one instance batch per heading, so four
draws carry a whole sky of traffic. The add-on gives each batch a bounding radius that covers its
lane, so culling keeps the rows a shader moves away from their origins.

## Use

```ts
import { createTrafficLanes } from '../../addons/traffic-lanes/index';

const traffic = createTrafficLanes(ctx, {
	mesh,                          // the vehicle hull: its nose along local +Z
	plan: {
		lines: [-525, -375, -225],   // the streets' centre lines, in meters
		from: -1200, to: 1200,       // where each lane runs
		low: 26, high: 88,           // the band of lane heights
		levels: 8,                   // lanes per street
		offset: 7,                   // how far a lane sits from its street's line
	},
	counts: { low: 30_000, medium: 50_000, high: 75_000, ultra: 100_000 },
	look: { tail: '#ff3a12', size: [0.96, 1.1, 2.0] },
	layers: EFFECT_LAYER,
	realLights: 6,
});
// In onUpdate, after the frame's camera moves:
traffic.update(eye, time.now);
```

- A plan can list its lanes one by one instead: `plan: { from, to, lanes }`, where each lane gives
  its heading (0 along +X, 1 along -X, 2 along +Z, 3 along -Z), its line across the way, its height
  and its speed. Every vehicle of a listed lane flies at the lane's speed, so the gaps between them
  hold and none flies through the one ahead. Use a list for traffic that keeps to its own side of
  the street, or for crossing streets at other heights. Skyway builds its list in
  `examples/showcase/skyway/layout.ts`.
- `fit(preset)` draws the preset's count. `setCount(n)` picks any count. Both thin every lane alike,
  because the rows were shuffled once.
- `update(eye, time)` moves the real lights to the vehicles nearest the camera, four times a second.
  The pool holds the nearest cars, whatever the count. A car that already holds a light keeps it a
  little past the light's range, so a camera that drifts across the edge cannot blink it. The search
  skips each lane whose line runs out of range before it reads a row, so only the lanes near the
  camera cost anything. Give no `realLights` for none.
- `dispose()` removes the batches, their materials and the real lights. A scene that draws another
  hull at another preset builds the lanes again around it, and drops the old ones with this call.
- `createVehicleHull(ctx, size)` builds a vehicle that fits the surface: its nose along local +Z,
  its belly just above y = 0. `look.size` gives its half width, its height and its half length,
  which place the tail bars, the nose lamps and the skirt. A hull of your own may replace it, as
  long as it keeps that space.
- The hull takes a detail as its third argument. `full`, the default, gives every face its own
  vertices, so the body reads as faceted panels: 72 vertices and 36 triangles. `light` shares each
  vertex between the faces that meet at it, so the same silhouette and the same lights take 24
  vertices and the same 36 triangles, and the body lights as one smooth shell. The vertex work is
  what a lane of tens of thousands of cars pays for in every pass that draws it, so a scene that
  draws many vehicles at once asks for `light` where its detail matters least, such as the preset
  that phones run. Skyway does that at Low and keeps `full` above it.
- The rows take four values each, which the shader reads as `object.values`: the start offset, the
  speed, the lane's length and the tint. Use one material for the same heading; the add-on makes
  four, one for each.
- `look.windows` tints the canopy's glass: it then draws as dark, smooth glass with a faint glow
  from the cabin. Without it the canopy takes the body's paint.
- Put the rows on the effect layer when a showcase scene's route guard must not treat a moving
  vehicle as a wall.

## Costs and limits

- A frame's CPU work is nearly the same at 30,000 and at 100,000 vehicles: everything moves on the
  GPU. The real-light search reads the rows of the lanes near the camera four times a second, so
  only those lanes cost anything. Measured on the Mac at a load near 55, one search takes about
  0.3 ms at 30,000 rows and 1.1 ms at 100,000 rows, with medians of 0.6 and 2.5 ms. A search
  lands whole in one frame, so the cost is a spike every quarter second, not a spread. The instances
  demo keeps all of its lanes in range of its camera and pays the 100,000-row figure at Ultra;
  Skyway's camera sees one or two of its ten streets and pays 0.25 to 0.5 ms. The row count sets the
  cost, so fewer lights do not lower it. A page that cannot spare the spike on its slowest device
  leaves `realLights` out.
  The draws are four, and the rows are 100,000 small hulls. The Skyway demo's figures, and the
  phone expectation, are in the [examples guide](../../../.dev/examples.md#skyway-m3-c1).
- The lanes are straight and axis-aligned. A curved lane needs a route the vertex shader can
  evaluate, which this add-on does not build.
- The vehicles keep clear of each other only by their start offsets. In the grid plan, each
  vehicle takes a speed of its own, so a fast one can pass through a slow one in the same lane, and
  the two headings of a street share their lanes. A listed lane has neither fault. Two lanes at one
  height may overlap when a lane's span differs from its neighbour's.
- The real lights cost a point light each, which a surface pays for as any point light. Six is a
  good look for a road near the camera; a hundred is not.

## Licence

MIT OR Apache-2.0, the engine's licences. See `LICENSE-MIT` and `LICENSE-APACHE` at the repository
root.
