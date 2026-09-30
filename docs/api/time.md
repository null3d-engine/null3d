---
id: api/time
title: Time
status: experimental
since: "0.1"
summary: "dt, time.now, fixed steps."
---

# Time

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Fixed steps (`onFixedUpdate`) and `time.dt` are not built yet, so coding agents must not use them.

The engine calls the sketch's `onUpdate` callback once per frame. Its argument, `dt`, is the frame's step: the time in seconds since the sketch's previous frame. The `time` object in the sketch's context holds the sketch time and the frame number.

Sketch time is the sum of every step that `onUpdate` received. Time while the engine is paused or the page is hidden does not count, so the sketch never jumps over a pause.

## Example: motion at the same speed at any frame rate

```ts
import { defineSketch, math } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, time }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 2, 6], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  const box = scene.createMesh({
    mesh: geometry.box(),
    material: materials.standard({ color: '#4a8cff' }),
    dynamic: true, // it moves in every frame
  });

  let angle = 0;
  let height = 0;
  return {
    onUpdate(dt) {
      angle += 1.5 * dt; // 1.5 radians per second
      // The goal changes every 2 seconds of sketch time. Paused time does not count.
      const goal = Math.floor(time.now / 2) % 2 === 0 ? 0 : 1;
      height = math.damp(height, goal, 5, dt); // eases toward the goal
      box.setRotationEuler(0, angle, 0);
      box.setPosition(0, height, 0);
    },
  };
});
```

## The step

`dt` is the time between the sketch's previous frame and this one, in seconds:

- It is 0 in the first frame.
- It is 0 in the first frame after a pause, whatever the length of the pause. This covers `engine.setPaused(false)`, `engine.attach` after `engine.detach`, and a hidden page that shows again.
- It is at most 0.25 seconds. A slower frame slows the sketch down instead of jumping it forward.
- It is never below 0.

In hold mode, the first frame gets 0 and each later frame gets 1/60 second. The last step ends exactly at the held time, so it is shorter when the held time is not a whole number of steps. See [Testing your sketch](../guides/testing.md).

## Sketch time and the frame number

| Field | Value |
| --- | --- |
| `time.now` | Sketch time in seconds: the sum of every step that `onUpdate` received. It is 0 during the setup function. |
| `time.frame` | The frame number: 0 during the setup function, 1 in the first `onUpdate`, and one more in each frame after it. |

The engine updates both fields before it calls `onUpdate`, so `time.now` already includes the frame's step. In hold mode, `time.now` in the last frame is the held time exactly.

`time` is one object that the engine changes in place. Read its fields when you need them. `const { now } = time` in the setup function copies the value once, and the copy never changes.

## Motion that looks the same at any frame rate

Frame rates differ between displays, from 60 to 144 frames per second and more. Scale each change by the step, so motion keeps the same speed at every rate:

- For a speed, multiply by `dt`: `angle += speed * dt`.
- To ease a number toward a goal, use `math.damp(current, goal, lambda, dt)`. A larger `lambda` moves faster.
- To ease a vector, use `vec3.lerp` with the factor `1 - Math.exp(-lambda * dt)`, which is the factor that `math.damp` uses.

A fixed factor per frame, such as `current += (goal - current) * 0.1`, moves faster at 144 frames per second than at 60. [Math helpers](math.md) has an example that eases a vector.

## Related pages

- [Sketch API: defineSketch and the context](sketch.md): `onUpdate` and the `time` object in the sketch's context.
- [Page API: createEngine](engine.md): `setPaused`, `detach` and `attach`, which pause and resume the sketch's frames.
- [Math helpers](math.md): `math.damp`, `math.lerp` and `vec3.lerp`.
- [Testing your sketch](../guides/testing.md): hold mode's fixed steps.
