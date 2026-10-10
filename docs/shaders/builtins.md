---
id: shaders/builtins
title: Built-in shader inputs
status: experimental
since: "0.1"
summary: "Camera, time, object, instance and light values available to custom shaders."
---

# Built-in shader inputs

> Ships in null3D 0.1, with the values of batch rows in 0.2. The API is experimental, so it can still change between versions. The view and projection matrices, the camera's near and far planes, the object's matrices and id are not built yet. Nor are light values. Coding agents must not use them.

A custom material's WGSL reads four built-in values besides its inputs: `frame`, `camera`, `object` and `material`. The engine fills them before it calls your functions, in the vertex offset and in the surface function alike. Read them anywhere in your WGSL, as global values. A [full shader](../guides/custom-shaders.md#full-shaders) imports `frame`, `camera` and `object` from `null3d::builtins`, and fills them with `fill_builtins`.

```wgsl
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // A stripe that moves up the surface with the sketch time.
    let stripe = step(0.5, fract(input.uv.y * 4.0 - frame.time * 0.5));
    s.emissive += vec3f(1.0, 0.4, 0.1) * stripe;
    // Darker with distance from the camera.
    s.baseColor *= clamp(20.0 / length(input.relativePosition), 0.2, 1.0);
    return s;
}
```

## `frame`

The values of the frame, the same for every draw in it.

| Field | Type | What it holds |
| --- | --- | --- |
| `time` | `f32` | The sketch time in seconds, as `time.now` gives it to the sketch |
| `deltaTime` | `f32` | The seconds since the frame before, as `time.dt` gives them |
| `index` | `u32` | The frame's number, counting from 1, as `time.frame` gives it |
| `resolution` | `vec2f` | The size in pixels that the scene draws at. It is the canvas's size at the [render scale](../api/quality.md#render-scale), and `@builtin(position)` counts in the same pixels. |

The time stops while the sketch is paused, as the sketch's own time does. In hold mode, it is the held time, so an image test of an animated material draws the same image each time.

## `camera`

The values of the camera that the view draws from.

| Field | Type | What it holds |
| --- | --- | --- |
| `position` | `vec3f` | The camera's position in the world |
| `viewProjection` | `mat4x4f` | The matrix from positions relative to the camera to clip space |

## `object`

The values of the object that the draw shows. For instances of a batch, they are the instance's values.

| Field | Type | What it holds |
| --- | --- | --- |
| `position` | `vec3f` | The position of the object's origin in the world |
| `values` | `vec4f` | The four numbers of the instance's row, for a batch made with `values: true`. Zeros elsewhere |

Use `object.position` to give each object or instance a look of its own from one material, such as a hue or a phase. Use `object.values` for what the sketch sets row by row, such as a phase of the wind, an age or a tint. The sketch writes them in the batch's `values` array ([Instances and batching](../concepts/instances.md#per-row-values)). A full shader reads zeros there, as `fill_builtins` leaves them.

## `material`

The custom material's uniforms, which the WGSL declares as `struct Uniforms`. [Surface functions](surface-functions.md#uniforms) describes them.

## Positions relative to the camera

The engine draws everything relative to the camera, so positions stay precise far from the origin of the world. The surface input's `relativePosition` is the position of a point relative to the camera. It is exact near the camera wherever the camera is. Use it for distances, fades and effects that depend on the view.

The surface input's `worldPosition`, and the values `camera.position` and `object.position`, are absolute positions in the world. They hold 32-bit floats, as all shader values do, so far from the origin they hold fewer digits. At 10 km from the origin, the step between two values is about 1 mm. Use them for patterns in world space, such as noise or grid lines, and keep those patterns coarse in large worlds.

## Related pages

- [Surface functions](surface-functions.md): the surface input, the surface, uniforms and vertex offsets.
- [Custom shaders](../guides/custom-shaders.md): WGSL in sketch code, and how the Vite plugin compiles it.
- [Large worlds](../concepts/large-worlds.md): why the engine draws relative to the camera.
