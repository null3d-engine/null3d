---
id: api/vertex-draws
title: Draws from a vertex count
status: experimental
since: "0.2"
summary: "scene.createVertexDraw: a custom material and a vertex count with no mesh data, the vertex and instance index in the shader, a bounds sphere, and helpers that wrap positions around the camera."
---

# Draws from a vertex count

> Roadmap step 0.2, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

```mermaid
flowchart LR
    shader["Your WGSL<br/>@builtin(vertex_index)<br/>@builtin(instance_index)"] --> call["scene.createVertexDraw"]
    counts["vertices: 6<br/>instances: 50,000"] --> call
    bounds["bounds: a sphere"] --> call
    call --> object["A scene object<br/>place, layers, culling sphere"]
    object --> list["The frame's draw list<br/>one draw, no buffers"]
```

A draw from a vertex count has a material and two numbers instead of a mesh. The numbers say how many vertices make one shape, and how many copies of the shape to draw. The shader makes every vertex itself, from the vertex index and the instance index. So the draw needs no vertex buffer, no index buffer and no per-instance data. A frame uploads nothing for it, whatever the number of copies.

Use it for rain, streaks, sparks, card effects and shapes that a formula makes. You cannot change the shape per copy or hit-test it, and the whole draw sorts as one object in the transparent pass.

## Rain around the camera

```ts
import { defineSketch } from '@null3d/engine';

const rain = /* wgsl */ `
#import null3d::builtins::{camera, fill_builtins, frame}
#import null3d::mesh::finish
#import null3d::noise::{random}
#import null3d::wrap::wrap_relative

const HALF = vec3f(24.0, 16.0, 24.0);
const SPEED = vec3f(3.0, -22.0, 0.0);

struct Varyings {
  @builtin(position) clip: vec4f,
  @location(0) edge: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varyings {
  fill_builtins(vec3f(0.0));
  let seed = instance * 3u;
  let home = vec3f(random(seed), random(seed + 1u), random(seed + 2u));
  var place = (home - 0.5) * 2.0 * HALF + SPEED * frame.time;
  // The head wraps into the box around the camera, so the field never runs out.
  let head = wrap_relative(place, HALF);
  let right = normalize(vec3f(camera.view[0][0], camera.view[1][0], camera.view[2][0]));
  // The card's six vertices, two triangles of a square, counterclockwise, in the camera's plane.
  let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u)) * 2.0 - 1.0;
  let along = corner.y * 0.5 + 0.5;
  let p = mix(head, head - normalize(SPEED) * 0.9, along) + right * corner.x * 0.018;
  var out: Varyings;
  out.clip = camera.viewProjection * vec4f(p, 1.0);
  out.edge = corner;
  return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  fill_builtins(vec3f(0.0));
  let light = vec3f(0.42, 0.55, 0.72) * (1.0 - abs(in.edge.x));
  return finish(light, in.clip.xy);
}
`;

export default defineSketch(({ scene }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 2, 8], target: [0, 2, 0] });
  scene.setActiveCamera(camera);
  scene.createVertexDraw({
    shader: rain,
    vertices: 6,
    instances: 50_000,
    bounds: { center: [0, 8, 0], radius: 48 },
    blending: 'additive',
    depthWrite: false,
  });
});
```

## The shader

The draw's WGSL is a full shader of a custom material, as [Custom shaders](../guides/custom-shaders.md#full-shaders) describes. It differs in one way: its `@vertex` entry point takes the vertex and instance indices and no mesh attribute. So `materials.shader` and `scene.createVertexDraw` read it as a draw shader.

```wgsl
@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varyings
```

- The vertex index runs from 0 up to the draw's vertex count less one, in each copy.
- The instance index runs from 0 up to the draw's copies less one.
- The engine's own `fill_builtins`, `frame`, `camera` and `finish` work as in any full shader. Positions are relative to the camera.
- The plugin compiles a `@vertex` entry point with only these two indices as a draw shader. It reads an entry point that takes a mesh attribute or an `InstanceIn` as a mesh material. A custom pass's own shader reads the vertex index alone, so it stays a pass shader.

A draw's WGSL declares no texture, and the engine writes no values for a `struct Uniforms` in a full shader. Keep its settings as WGSL constants, and animate it with `frame.time`, which the engine writes every frame.

## The counts

`vertices` and `instances` are whole numbers from 1 up. Two vertices make a line, three a triangle and six a card of two triangles. A draw holds up to 1,048,576 vertices for one shape and 16,777,216 copies. Change them at any time:

```ts
draw.setCounts(6, 80_000);
```

A frame reads the counts from engine memory, so a change uploads nothing.

## The bounds

The engine culls the whole draw with one sphere: it draws all of the shapes or none of them.

```ts
// The sphere holds every shape that the shader makes.
bounds: { center: [0, 8, 0], radius: 48 },

// Or set it later, as the object moves.
draw.setBounds([0, 12, 0], 48);
```

`center` is in the object's space, and the object's place moves it. Give a sphere that holds every shape the shader makes. A shape that leaves it stops drawing. A field that follows the camera, as rain does, has two choices. It wraps inside a box that a large static sphere holds, or it moves its sphere when the camera travels.

## Wrapping around the camera

`null3d::wrap` gives two functions that keep a position inside a box:

| Function | Result |
| --- | --- |
| `wrap_relative(p, half)` | `p`, a position relative to the camera, inside a box `2 * half` long on each axis around the camera |
| `wrap_around(p, center, half)` | The same, around `center`, another position relative to the camera |

A copy that leaves one side of the box comes back on the other side. The field therefore never runs out as the camera moves, and the draw uploads nothing.

## Other options

`scene.createVertexDraw` takes every option of `materials.shader` but the maps, and `position`, `rotation`, `scale` and `layers`. The shader makes its own positions, so the object's place moves its culling sphere and its sort place, not the shapes. Put the shapes where they belong in the WGSL.

- A draw uses `alphaMode: 'blend'`. Its material draws in the transparent pass, back to front with the scene's other blended objects. Pass `blending: 'additive'`, `'multiply'` or `'normal'` to pick how it combines.
- `depthWrite` and `doubleSided` work as they do for a material. Give `doubleSided: true` to a card that the camera sees from behind, because the engine culls its back faces by default.

`draw.object` gives the scene object for every other object call: `setPosition`, `setVisible`, `setLayers`, `destroy`. `draw.destroy()` frees the draw and its object.

## What a draw does not do

- A draw sorts as one object. Per-copy sorting is not available: give several draws when copies must sort against each other.
- A draw casts no shadow and receives none.
- A raycast tests the small triangle that the engine keeps for the draw's object. It does not test the shapes that the shader makes, so do not use a draw to hit-test.
- The pick pass and the depth prepass draw no vertex draw, so it is no occluder.
- A draw has one shape and one material. For add-on draws with a feature description, use [scene.addFeatureDraw](feature-draws.md).

## Errors

| Code | Cause |
| --- | --- |
| E1108 | A count that is not a whole number from 1 up, a sphere radius that is not above 0, or more draws than the scene holds |
| E1215 | WGSL that the plugin did not compile, or one whose `@vertex` entry point is not the draw shader's |
| E1217 | An alpha mode other than `blend`, or the weighted blending |

## Related pages

- [Custom shaders](../guides/custom-shaders.md): the WGSL that the plugin compiles, and full shaders.
- [Built-in shader inputs](../shaders/builtins.md): `frame`, `camera` and `object`, which `fill_builtins` fills.
- [Shader library and imports](../shaders/library.md): `null3d::wrap` and the other modules.
- [Culling](../concepts/culling.md): how the engine culls objects by their spheres.

## API reference

[The API reference](reference/vertex-draws.md) lists every export of this page with its type and description. The engine's doc comments make it.
