---
id: api/time
title: Time
status: experimental
since: "0.1"
summary: "dt, time.now, fixed steps."
---

# Time

> Ships in null3D 0.1. The API is experimental, so it can still change between versions.

The engine calls the sketch's `onUpdate` callback once per frame. Its argument, `dt`, is the frame's step: the time in seconds since the sketch's previous frame. The `time` object in the sketch's context holds the sketch time, the frame's step and the frame number. Simulation that must step the same at every frame rate runs in fixed steps instead, in `onFixedUpdate`.

Sketch time is the sum of every frame's step. Time while the engine is paused or the page is hidden does not count, so the sketch never jumps over a pause.

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

`dt` is the time between the sketch's previous frame and this one, in seconds. `onUpdate` and `onLateUpdate` get it as their argument, and `time.dt` holds it too:

- It is 0 in the first frame.
- It is 0 in the first frame after a pause, whatever the length of the pause. This covers `engine.setPaused(false)`, `engine.attach` after `engine.detach`, and a hidden page that shows again.
- It is at most 0.25 seconds. A slower frame slows the sketch down instead of jumping it forward.
- It is never below 0.

In hold mode, the first frame gets 0 and each later frame gets 1/60 second. The last step ends exactly at the held time, so it is shorter when the held time is not a whole number of steps. See [Testing your sketch](../guides/testing.md).

## The time object

| Field | Value |
| --- | --- |
| `time.now` | Sketch time in seconds: the sum of every frame's step. It is 0 during the setup function. |
| `time.dt` | The frame's step in seconds: the `dt` that `onUpdate` and `onLateUpdate` get. It is 0 during the setup function. |
| `time.frame` | The frame number: 0 during the setup function, 1 in the first frame, and one more in each frame after it. |

The engine updates the fields at the start of each frame, before it calls `onFixedUpdate`, so `time.now` already includes the frame's step. The fields keep their values until the next frame, in every callback. In hold mode, `time.now` in the last frame is the held time exactly.

`time` is one object that the engine changes in place. Read its fields when you need them. `const { now } = time` in the setup function copies the value once, and the copy never changes.

## Fixed steps

`onFixedUpdate(step)` runs at a fixed rate of sketch time, 60 steps per second by default. Before `onUpdate`, a frame runs it once for each step that fell due since the previous frame. At 30 frames per second, each frame runs two steps. At 120 frames per second, every other frame runs one. `step` is the length of one step in seconds, 1/60 at the default rate.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 3, 10], target: [0, 2, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  const ball = scene.createMesh({
    mesh: geometry.sphere({ radius: 0.5 }),
    material: materials.standard({ color: '#e8554e' }),
    dynamic: true,
  });

  let y = 5; // the ball's height, in meters
  let speed = 0; // meters per second, upward
  return {
    onFixedUpdate(step) {
      speed -= 9.81 * step;
      y += speed * step;
      if (y < 0.5) {
        y = 0.5;
        speed = -speed * 0.8; // it bounces, and loses a fifth of its speed
      }
      ball.setPosition(0, y, 0);
    },
  };
});
```

- Step `n` falls due when sketch time reaches `n` steps. The engine counts the steps from the sketch time, so they never drift from it.
- The first frame runs no step, because sketch time is still 0. The first frame after a pause runs none either, because a pause adds no time.
- After a slow frame, a frame runs at most 8 steps and drops the rest. The simulation falls behind the sketch time by the dropped steps. The cap keeps a simulation that runs too slowly from slowing down every frame after it.
- The options of `defineSketch` set the rate and that cap, as in `defineSketch(setup, { fixedRate: 120, maxFixedSteps: 16 })`. [Sketch API](sketch.md#options) lists them.
- `time` keeps the frame's values during the fixed steps. To count time in steps, add `step` to a number of your own in each step.
- Input changes once per frame, so every step of a frame sees the same input, and some frames run no step. Read presses such as `input.wasPressed` in `onUpdate`, keep what they ask for, and act on it in the next step.
- In hold mode, each frame after the first runs one step at the default rate. When the held time is not a whole number of steps, the last frame is shorter than a step and runs none. Every hold runs the same steps, so the held frame of a simulation is the same on every run.

A display faster than the fixed rate draws some frames that run no step. An object that only the fixed steps move then stands still in those frames. Where that motion must look smooth, raise `fixedRate` to the display's rate or more.

## Motion that looks the same at any frame rate

Frame rates differ between displays, from 60 to 144 frames per second and more. Scale each change by the step, so motion keeps the same speed at every rate:

- For a speed, multiply by `dt`: `angle += speed * dt`.
- To ease a number toward a goal, use `math.damp(current, goal, lambda, dt)`. A larger `lambda` moves faster.
- To ease a vector, use `vec3.lerp` with the factor `1 - Math.exp(-lambda * dt)`, which is the factor that `math.damp` uses.

A fixed factor per frame, such as `current += (goal - current) * 0.1`, moves faster at 144 frames per second than at 60. [Math helpers](math.md) has an example that eases a vector.

## Related pages

- [Sketch API: defineSketch and the context](sketch.md): the callbacks, their order, and the options of `defineSketch`.
- [Page API: createEngine](engine.md): `setPaused`, `detach` and `attach`, which pause and resume the sketch's frames.
- [Math helpers](math.md): `math.damp`, `math.lerp` and `vec3.lerp`.
- [Testing your sketch](../guides/testing.md): hold mode's fixed steps.

## API reference

<!-- null3d:api:start -->

### `SketchTime`

Interface `SketchTime`.

The sketch's clock. The engine updates it at the start of each frame, before it calls `onFixedUpdate`.

| Member | Description |
| --- | --- |
| `readonly now: number` | Sketch time in seconds: the sum of every frame's step, so paused and hidden time do not count. It is 0 during the setup function. In hold mode, the last frame's time is the held time exactly. |
| `readonly dt: number` | The frame's step in seconds, which `onUpdate` and `onLateUpdate` also get. 0 during the setup function. |
| `readonly frame: number` | The frame number: 0 during the setup function, 1 in the first frame, and one more in each frame after it. |

<!-- null3d:api:end -->
