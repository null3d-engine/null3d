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

- `fit(preset)` draws the preset's count. `setCount(n)` picks any count. Both thin every lane alike,
  because the rows were shuffled once.
- `update(eye, time)` moves the real lights to the nearest vehicles, four times a second. It looks
  at a share of the rows, so its cost does not follow the count. Give no `realLights` for none.
- `createVehicleHull(ctx, size)` builds a vehicle that fits the surface: its nose along local +Z,
  its belly just above y = 0. `look.size` gives its half width, its height and its half length,
  which place the tail bars, the nose lamps and the skirt. A hull of your own may replace it, as
  long as it keeps that space.
- The rows take four values each, which the shader reads as `object.values`: the start offset, the
  speed, the lane's length and the tint. Use one material for the same heading; the add-on makes
  four, one for each.
- Put the rows on the effect layer when a showcase scene's route guard must not treat a moving
  vehicle as a wall.

## Costs and limits

- A frame's CPU work is the same at 30,000 and at 100,000 vehicles: everything moves on the GPU.
  The draws are four, and the rows are 100,000 small hulls. The Skyway demo's figures, and the
  phone expectation, are in the [examples guide](../../../.dev/examples.md#skyway-m3-c1-22-october-2026).
- The lanes are straight and axis-aligned. A curved lane needs a route the vertex shader can
  evaluate, which this add-on does not build.
- The vehicles keep clear of each other only by their start offsets. Two lanes at one height may
  overlap when a lane's span differs from its neighbour's.
- The real lights cost a point light each, which a surface pays for as any point light. Six is a
  good look for a road near the camera; a hundred is not.

## Licence

MIT OR Apache-2.0, the engine's licences. See `LICENSE-MIT` and `LICENSE-APACHE` at the repository
root.
