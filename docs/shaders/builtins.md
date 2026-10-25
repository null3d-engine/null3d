---
id: shaders/builtins
title: Built-in shader inputs
status: experimental
since: "0.1"
summary: "Camera, time, object and instance values available to custom shaders, with the camera's and the object's matrices and ids."
---

# Built-in shader inputs

> Roadmap step 0.1, first released in null3D 0.1.0. Step 0.2 adds the values of batch rows, the view and projection matrices, the camera's near and far planes, and the object's matrices and id. The API is experimental, so it can still change between versions. Light values are not built yet. Coding agents must not use them.

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
| `lastFrame` | `bool` | True in the [motion pass](../concepts/render-graph.md#motion-vectors)'s second call of a vertex offset, which moves vertices as the frame before did. The time, the step and the index then hold that frame's values. False in every other call. |
| `resolution` | `vec2f` | The size in pixels that the scene draws at. It is the canvas's size at the [render scale](../api/quality.md#render-scale), and `@builtin(position)` counts in the same pixels. In a masked custom material's shadow caster it is the camera's size, which `input.fragCoord` counts in. |

The time stops while the sketch is paused, as the sketch's own time does. In hold mode, it is the held time, so an image test of an animated material draws the same image each time.

## `camera`

The values of the scene camera, in every pass, a shadow pass included.

| Field | Type | What it holds |
| --- | --- | --- |
| `position` | `vec3f` | The camera's position in the world |
| `viewProjection` | `mat4x4f` | The matrix from positions relative to the camera to clip space |
| `view` | `mat4x4f` | The matrix from positions relative to the camera to view space, where the camera looks down -z. It holds the camera's rotation only, because the camera sits at the origin of positions relative to it |
| `projection` | `mat4x4f` | The matrix from view space to clip space. `camera.projection * camera.view` is `camera.viewProjection` |
| `near` | `f32` | The distance of the camera's near plane |
| `far` | `f32` | The distance of the camera's far plane |

The engine stores depth reversed on every GPU path. Clip space's depth is 1 at the near plane and 0 at the far plane. `camera.projection` gives that depth. A light draws each shadow, but a material's surface still reads the scene camera there: `camera` and `frame.resolution` hold the scene camera's values in a shadow pass, as they do where the surface shades.

```wgsl
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The distance along the view, from 0 at the near plane to 1 at the far plane.
    let depth = -(camera.view * vec4f(input.relativePosition, 1.0)).z;
    s.emissive = vec3f(saturate((depth - camera.near) / (camera.far - camera.near)));
    return s;
}
```

## `object`

The values of the object that the draw shows. For instances of a batch, they are the instance's values.

| Field | Type | What it holds |
| --- | --- | --- |
| `position` | `vec3f` | The position of the object's origin in the world |
| `values` | `vec4f` | The four numbers of the instance's row, for a batch made with `values: true`. Zeros elsewhere |
| `worldMatrix` | `mat4x4f` | The object's or instance's world matrix, with its translation relative to the camera |
| `normalMatrix` | `mat3x3f` | The matrix that turns a normal from the mesh's space into world space: the inverse transpose of the world matrix's 3 x 3 part. Normalize the result |
| `id` | `u32` | The object's id, the same number as the mesh's `shaderId` in the sketch. Every row of a batch has the batch's id, `batch.shaderId` |

Use `object.position` to give each object or instance a look of its own from one material, such as a hue or a phase. Use `object.values` for what the sketch sets row by row, such as a phase of the wind, an age or a tint. The sketch writes them in the batch's `values` array ([Instances and batching](../concepts/instances.md#per-row-values)). A full shader reads zeros there, as `fill_builtins` leaves them.

`object.worldMatrix` takes positions in the mesh's space to positions relative to the camera, as every position of the engine is. So `camera.viewProjection * object.worldMatrix * vec4f(p, 1.0)` places a point `p` of the mesh in clip space. Its last column is the origin relative to the camera, and `object.position` is the origin in the world.

`object.id` stays the same while the object lives. A hash of it gives a moving object a random look that stays as it moves. Pass a mesh's `shaderId` to a uniform to pick out that mesh in a shader:

```wgsl
struct Uniforms { picked: u32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.emissive += vec3f(1.0, 0.5, 0.1) * select(0.0, 1.0, object.id == material.picked);
    return s;
}
```

```ts
material.set({ picked: mesh.shaderId });
```

A full shader reads zeros for the object's matrices and id, as `fill_builtins` leaves them. It finds its instance's matrices with `find_instance` from `null3d::mesh`.

## `material`

The custom material's uniforms, which the WGSL declares as `struct Uniforms`. [Surface functions](surface-functions.md#uniforms) describes them.

## What the inputs cost

The values above that a material does not read cost it nothing. A few inputs cost something, so only WGSL that reads them gets them. The plugin finds which fields the WGSL reads when it builds the material:

| Input | Its cost, only where the WGSL reads it |
| --- | --- |
| `uv1` | One more vertex attribute, the mesh's second texture coordinates |
| `VertexInput.colors` | One more vertex attribute, the mesh's vertex color, for a vertex offset that reads it as data |
| `instance`, `object.id` | A search per vertex in a small table of the scene's batches, which the engine keeps while a material reads them |
| `object.worldMatrix`, `object.normalMatrix` | Three more values from the vertex stage to the fragment stage, in materials whose surface function runs |

The pixel's position, the camera's values and `object.position` cost nothing.

## Positions relative to the camera

The engine draws everything relative to the camera, so positions stay precise far from the origin of the world. The surface input's `relativePosition` is the position of a point relative to the camera. It is exact near the camera wherever the camera is. Use it for distances, fades and effects that depend on the view.

The surface input's `worldPosition`, and the values `camera.position` and `object.position`, are absolute positions in the world. They hold 32-bit floats, as all shader values do, so far from the origin they hold fewer digits. At 10 km from the origin, the step between two values is about 1 mm. Use them for patterns in world space, such as noise or grid lines, and keep those patterns coarse in large worlds.

## Related pages

- [Surface functions](surface-functions.md): the surface input, the surface, uniforms and vertex offsets.
- [Custom shaders](../guides/custom-shaders.md): WGSL in sketch code, and how the Vite plugin compiles it.
- [Large worlds](../concepts/large-worlds.md): why the engine draws relative to the camera.
