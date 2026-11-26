# Particles for null3D

`@null3d/particles` adds GPU particle systems to a [null3D](https://github.com/null3d-engine/null3d)
scene: sparks, fire, smoke, dust, rain, falling leaves and fireflies. A system is an emitter and a
buffer of particles. The emitter decides where and when each particle is born. The GPU works out
each particle from its birth and its age, so no pass simulates them. A system costs the CPU one call
in a frame, and it draws the same on WebGPU and WebGL2.

## Install

```sh
bun add @null3d/particles @null3d/engine
```

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { createParticles, particleTextures } from '@null3d/particles';

export default defineSketch(async (ctx) => {
  const { scene, textures } = ctx;
  scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 2, 6], target: [0, 1, 0] }));
  const sparks = await createParticles(ctx, {
    ...particleTextures.spark(textures),
    position: [0, 0.5, 0],
    rate: 200,
    lifetime: [0.6, 1],
    shape: { type: 'sphere', radius: 0.05 },
    speed: [2, 4],
    gravity: [0, -9.8, 0],
    facing: 'velocity',
    stretch: 0.04,
    size: [0.03, 0.05],
    colors: ['#ffb060', '#ffd090'],
    intensity: 4,
    colorOverLife: ['#ffffff', '#ff7030'],
    alphaOverLife: [1, 0],
  });
  return {
    onLateUpdate() {
      sparks.update();
    },
  };
});
```

Pass the whole sketch context as the first argument. Call `update()` once per frame in
`onLateUpdate`, where each object is already at its place for the frame. An emitter that follows a
moving object then starts its particles where the object is now.

`particleTextures` makes particle textures in code, so a page downloads no image for them. It has
`glow`, `spark`, `smoke`, `flame`, `rain` and `leaves`. Each one takes the sketch's `textures` and
returns a map and its flipbook, which you spread into the options.

## Emitters and look

- Each entry of `bursts` gives `count` particles at `time` seconds, then again every `interval`
  seconds. `system.burst(count)` adds a burst at any time.
- `subEmitters` start another system where a particle dies or first meets the ground, as a
  firework's rocket bursts into sparks. Update that system after its parent in each frame.
- `softness` fades a particle as it nears the surface behind it, so it shows no hard line where it
  cuts into the ground or a wall.
- `flipbook` plays a grid of frames from the map on each particle. The `smoke` and `flame` textures
  hold sixteen frames each.

The options `gravity`, `drag`, `wind` and `turbulence` move the particles. With `groundHeight` and
`groundMode`, they bounce, stick or die on a ground plane. Give the field of `@null3d/wind` as
`windField`, and smoke and dust move with the same gusts as the plants. Then call the wind's
`update()` before the system's in each frame. Call `system.set(values)` to change the motion and
the look at any time.

## Costs and limits

- Each live particle costs the GPU one quad. The core writes 32 bytes per birth, and the engine
  uploads only the records born in the frame.
- A large `capacity` costs vertex work for every record, live or not. Size it for the particles you
  need.
- A system is one draw. Its particles draw in the order they were born, so `additive` blending,
  which needs no order, suits most effects.
- Soft particles cost one full-screen copy of the camera's depth per frame. The Low preset turns
  them off.
- Particles cast no shadows, and lights do not light them.

## Docs

The [particles docs page](https://github.com/null3d-engine/null3d/blob/generated/docs/api/particles.md)
describes every option.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
