---
id: api/feature-draws
title: Add-on feature draws
status: experimental
since: "0.3"
summary: "scene.addFeatureDraw and scene.addFeatureInstances turn a draw feature description into a draw of your WGSL, your vertices or your instances, your uniforms and the description's sort place, on both GPU paths and in every thread mode."
---

# Add-on feature draws

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions. A draw records in the main view alone, and at the opaque or the transparent point.

```mermaid
flowchart LR
    description["defineFeature<br/>frame 'transparent', kind 'draw'"] --> draw["scene.addFeatureDraw"]
    description --> instances["scene.addFeatureInstances"]
    shader["Your WGSL"] --> draw
    shader --> instances
    vertices["Your vertices"] --> draw
    vertices --> instances
    rows["Your rows<br/>positions, rotations, scales"] --> instances
    uniforms["Your uniforms"] --> draw
    uniforms --> instances
    draw --> object["A scene object<br/>your shader, your vertex format"]
    instances --> batch["An instance batch<br/>one shape, many rows"]
    object --> list["The frame's draw list"]
    batch --> list
    list --> gpu["WebGPU or WebGL2"]
```

`scene.addFeatureDraw` draws a shape that an add-on declares. The add-on gives the WGSL, the vertex data of one shape, and the uniforms that change its look. The description says where the draw records, and the band and order say where a blended draw sorts. The engine makes the mesh, the material and the scene object, and records them in the frame's draw list like the scene's other objects. The draw therefore reaches WebGPU and WebGL2, in the pipelined, low-latency and single-threaded modes, with the same picture.

`scene.addFeatureInstances` draws one shape many times, with one instance for each row that the page fills. It takes the same description and the same shader options. [Instanced draws](#instanced-draws) gives it.

This is the adapter for a [feature description](features.md) with `kind: 'draw'`. The description carries the sorting and the resources; the shader, the vertex format and the uniforms are the draw's own declaration, which these calls take.

## A point cloud

```ts
import { defineFeature, defineSketch } from '@null3d/engine';

const points = /* wgsl */ `
struct Uniforms {
  softness: f32,
  gain: f32,
}

fn surface(input: SurfaceInput) -> Surface {
  var s = defaultSurface(input);
  const away = length(input.uv - vec2f(0.5)) * 2.0;
  const cover = smoothstep(1.0, 1.0 - material.softness, away);
  s.baseColor = vec3f(0.0);
  s.emissive = input.vertexColor.rgb * (material.gain * cover);
  s.alpha = cover;
  return s;
}
`;

export default defineSketch(async ({ scene }) => {
  scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 0, 9] }));
  const description = defineFeature({
    name: 'points',
    frame: 'transparent',
    kind: 'draw',
    views: ['main'],
  });
  const draw = await scene.addFeatureDraw(description, {
    shader: points,
    vertices: {
      positions: new Float32Array([-0.2, -0.2, 0, 0.2, -0.2, 0, 0.2, 0.2, 0, -0.2, 0.2, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      colors: new Float32Array([1, 0.3, 0.2, 1, 1, 0.3, 0.2, 1, 1, 0.3, 0.2, 1, 1, 0.3, 0.2, 1]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    },
    uniforms: { softness: 1, gain: 1.5 },
  });
  // Later, from any frame: move or change the draw.
  draw.object.setPosition(1, 0, 0);
});
```

## The description

Both draw calls read these fields of the description. The [feature description page](features.md) gives the others: `name`, `reads`, `writes`, `outputs`, `provides` and the callbacks.

| Field | What a draw takes |
| --- | --- |
| `kind` | `'draw'`. Any other kind throws E1223. |
| `frame` | `'opaque'` or `'transparent'`. A draw records at one of these two points. |
| `band` | `'before'`, `'normal'` or `'after'`. It places the draw against the pass's other blended objects. |
| `order` | The place inside the band. A lower number draws first. |
| `views` | `['main']`. The adapter refuses another view rather than drawing in the wrong one. |

The frame point and the material's blending must agree. With `'opaque'`, the draw needs an `opaque` or `mask` alpha mode. With `'transparent'`, it needs the `blend` alpha mode, which is the default for that frame. A draw that names the other one throws E1223, because the engine would draw it in a pass that the description never named.

## The shader

`shader` takes the same compiled WGSL that `materials.shader` takes: a surface function that keeps the engine's lighting, or a full shader with a `@vertex` and a `@fragment` entry point. The plugin compiles it to WGSL and to GLSL ES 3.00, so the draw works on both GPU paths. [Custom shaders](../guides/custom-shaders.md) describes both forms.

A surface function reads the draw's vertex colors as `input.vertexColor` when the vertices have colors. The adapter turns `vertexColors` on for them, so each vertex's color multiplies the surface's base color and emissive light.

## The vertex format

`vertices` holds the arrays of one shape, as `geometry.fromArrays` takes them: `positions`, `normals`, `uvs`, `uvs1`, `colors`, `tangents` and `indices`. The arrays fix the draw's vertex format and its bounds. A surface function needs `uvs`; a full shader reads the attributes at the engine's locations, which the plugin gives in [Custom shaders](../guides/custom-shaders.md#full-shaders).

Geometries are shared, so the engine allocates the draw's buffers once and draws them with the whole scene's draw list. `draw.updateVertices` writes new values into one attribute, and the next frame uploads them. Keep the arrays that you made the vertices with, as `mesh.updateVertices` asks.

## The payload

The uniforms that the add-on declares in `struct Uniforms` are the draw's payload. `uniforms` gives their first values, and `draw.setUniform(name, value)` or `draw.set(values)` changes them at any time without allocating. A uniform reaches the WGSL as `material.<name>`, in a surface function or a full shader. [Surface functions](../shaders/surface-functions.md#uniforms) gives the types and the 32-number limit.

The draw also takes the material's values, such as `color`, `alphaMode`, `blending`, `depthWrite`, `doubleSided` and `map`, with the same names and meanings as `materials.shader`. A texture that its WGSL declares comes from `textures`, as `materials.shader` takes it.

## Instanced draws

`scene.addFeatureInstances` draws one shape many times, with one instance for each row of an instance batch. It takes the same description and shader options, and the page fills the rows. The engine culls, sorts and draws the rows as it does the rows of `scene.createInstances`.

```ts
const description = defineFeature({ name: 'discs', frame: 'transparent', kind: 'draw' });
const discs = await scene.addFeatureInstances(description, {
  shader: DISC,
  vertices: quad, // the one shape that each instance draws
  capacity: 10_000, // the rows, which never changes
  alphaMode: 'blend',
  depthWrite: false,
});
for (let i = 0; i < discs.count; i++) {
  discs.positions[i * 3] = (i % 100) - 50;
  discs.scales[i * 3] = 0.2;
}
```

The rows are the arrays of an instance batch: `positions` (3 floats), `rotations` (4), `scales` (3) and, with the options, `colors` (4) and `values` (4). The call keeps the batch's own calls:

| Call | What it does |
| --- | --- |
| `count` | The capacity: the number of rows that the draw may use |
| `setActiveCount(n)` | Draws only the first `n` rows |
| `markDirty(start, count)` | Uploads the rows that changed, on a static draw |
| `setRenderOrder(order)` | Places the instances among the other blended objects |
| `setLayers(mask)` | Puts every instance on the mask's layers |
| `setCastShadows(on)`, `setReceiveShadows(on)` | Sets the shadows of every instance |
| `setBoundingRadius(radius)` | Gives each instance a bound of its own, for a shader that moves it |
| `setUniform`, `set` | Changes the shader's uniforms |
| `destroy()` | Frees the instances, the material and the shape |

A full shader reads each instance's transform through `InstanceIn` and `find_instance` from `null3d::mesh`:

```wgsl
#import null3d::mesh::{InstanceIn, clip_position, find_instance}

struct Varyings {
    @builtin(position) clip: vec4f,
}

@vertex
fn vs(@location(0) position: vec3f, i: InstanceIn) -> Varyings {
    let found = find_instance(i);
    var out: Varyings;
    out.clip = clip_position(found, position);
    return out;
}
```

A full shader reads no `object.values`: the engine fills those for a surface function alone. Use `values` with a surface function, such as a vertex offset that sways each instance by its own phase. [Instances and batching](../concepts/instances.md) gives both forms.

A blended draw's rows sort back to front among themselves. The description's band and order place the whole draw among the other blended objects, and `setRenderOrder` changes that place later.

## Where it sorts

A draw's vertex data and material draw as one scene object. The engine culls it by its bounds and draws it once per view that sees it:

- `'opaque'` draws with the pass's other opaque objects, in the engine's own order, which the depth test decides.
- `'transparent'` draws with the blended objects, back to front. The description's band and order place it among them, as `mesh.setRenderOrder` does: `draw.setRenderOrder(order)` changes the place later.

A draw can cast the shadows that a directional light casts with `castShadows`, and receive shadows with `receiveShadows`. `draw.object` gives the scene object for every other object call: `setPosition`, `setRotation`, `setScale`, `setVisible`, `setLayers` and `destroy`.

## Limits

- The adapter places the main view alone. A scene pass and a reflection pass do not draw a feature draw yet, and a description that names one throws E1223.
- A draw has one shape and one material. `addFeatureInstances` draws that shape once for each row that the page fills. A count that the GPU writes is not this hook, and it arrives with the compute hook.
- A full shader reads each instance's transform, and a surface function reads the row's `values`. One shader cannot do both yet.
- The feature description's `reads`, `writes`, `outputs` and `provides` stay with the [feature registry](features.md): this draw reads and writes no scene resource and provides no lighting slot.

## Errors

| Code | Cause |
| --- | --- |
| E1223 | A description that the draw adapter cannot place: another kind, another frame point, another view, or an alpha mode that draws in the other pass. |
| E1108 | An instance capacity that is not a whole number from 1. |
| E1206 | Vertex data that makes no mesh, as `geometry.fromArrays` reports it. |
| E1215, E1216, E1217 | WGSL that the plugin did not compile, a uniform or a texture that the WGSL does not declare, or an option that the material does not take. |
| E1406 | The draw adapter did not download. |

## Related pages

- [Add-on feature descriptions](features.md): the one description shape, its fields and its registry.
- [Custom shaders](../guides/custom-shaders.md): the WGSL that the plugin compiles, surface functions and full shaders.
- [Surface functions](../shaders/surface-functions.md): the surface input, the surface record, uniforms and textures.
- [Render graph API](render.md): the sketch's own passes, which draw into textures.

## API reference

[The API reference](reference/feature-draws.md) lists every export of this page with its type and description. The engine's doc comments make it.
