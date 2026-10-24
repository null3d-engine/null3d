---
id: api/feature-instances
title: Add-on instance draws
status: experimental
since: "0.3"
summary: "scene.addComputeInstances draws a capacity of instances from your own buffer, with a count that the GPU writes, on WebGPU, and an instance batch that the CPU fills on WebGL2."
---

# Add-on instance draws

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions. A draw records in the main view alone, at the opaque point.

```mermaid
flowchart LR
    description["defineFeature<br/>frame 'opaque', kind 'draw'"] --> call["scene.addComputeInstances"]
    shader["Your WGSL"] --> call
    vertices["Your shape"] --> call
    call --> buffers["Your count and instance buffers"]
    buffers --> compute["Your compute pass<br/>writes the count and the instances"]
    compute --> list["The frame's draw list<br/>the count copied into the indirect draw"]
    list --> gpu["WebGPU<br/>the GPU's count drawn"]
    call --> batch["WebGL2<br/>an instance batch the CPU fills"]
```

`scene.addComputeInstances` draws one shape once for each live instance. On WebGPU the live count comes from GPU memory. On WebGL2 the page gives it. Use it for a large set whose count a compute pass writes each frame, such as foliage that the pass places and culls. The add-on's compute writes the count word and the per-instance rows, and the engine draws exactly that many instances.

This is the adapter for a [feature description](features.md) with `kind: 'draw'` and `frame: 'opaque'`. The description places the draw; the options give the shape, the shader and the capacity.

## A draw of quads

```ts
import { defineFeature, defineSketch } from '@null3d/engine';

const quads = /* wgsl */ `
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish}
#import null3d::vertex::mesh_position

struct Varyings {
  @builtin(position) clip: vec4f,
  @location(0) color: vec4f,
}

@vertex
fn vs(@location(0) position: vec3f, i: InstanceIn) -> Varyings {
  const found = find_instance(i);
  var out: Varyings;
  out.clip = clip_position(found, mesh_position(position) * 0.1);
  out.color = vec4f(1.0, 0.6, 0.2, 1.0);
  return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  return finish(in.color, in.clip.xy);
}
`;

export default defineSketch(async ({ scene }) => {
  scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 0, 9] }));
  const description = defineFeature({
    name: 'foliage',
    frame: 'opaque',
    kind: 'draw',
    views: ['main'],
  });
  const draw = await scene.addComputeInstances(description, {
    shader: quads,
    vertices: {
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    },
    capacity: 100_000,
    count: 0,
  });
  // The add-on's compute pass binds draw.instances and draw.counts, then writes them each frame.
  // A page without compute fills both on the CPU, which draws the same picture.
  draw.setInstances(rows, liveCount);
});
```

## The description

`addComputeInstances` reads these fields of the description. The [feature description page](features.md) gives the others: `name`, `reads`, `writes`, `outputs`, `provides` and the callbacks.

| Field | What an instance draw takes |
| --- | --- |
| `kind` | `'draw'`. Any other kind throws E1223. |
| `frame` | `'opaque'`. A transparent instance draw is not placed yet. |
| `views` | `['main']`. The adapter refuses another view. |
| `band`, `order` | Read, but the opaque pass orders its own draws. |

## The options

| Option | What it gives |
| --- | --- |
| `shader` | The draw's WGSL, which `materials.shader` takes. A full shader finds its instance with `find_instance`, as [Custom shaders](../guides/custom-shaders.md) describes. |
| `vertices` | The arrays of one shape, as `geometry.fromArrays` takes them. |
| `capacity` | The most instances that the draw holds, which sizes its buffers. It is a whole number from 1 to 1,048,576. |
| `count` | The count at the first frame. The default is 0. |
| `layers` | The layers of the draw, as a 32-bit mask. The default, 1, is layer 0. |

The draw's material is opaque. The options take the material's other values, such as `color` and `doubleSided`, with the names that `materials.shader` gives them.

## The buffers

`draw.instances` and `draw.counts` are the engine's buffers for the draw. A compute pass binds them with its `buffers` option, which takes the draw's two handles in binding order:

- `draw.instances` holds `capacity` rows of 16 floats each. Each row is three world-matrix rows, with the translation in each row's `w`, then the ids. The engine's instance buffers hold the same shape. The vertex shader reads a row by `instance_index` through `find_instance`.
- `draw.counts` holds one 32-bit word: the count that the draw renders.

```ts
render.addPass({
  kind: 'compute',
  description: defineFeature({ name: 'fill', frame: 'opaque', kind: 'compute', band: 'before' }),
  wgsl: fill,
  buffers: [draw.counts, draw.instances],
  dispatch: [1, 1, 1],
});
```

The shader declares the count as `var<storage, read_write> counts: atomic<u32>;` and the rows as `var<storage, read_write> instances: array<vec4f>;`, at the pass group's two fixed storage bindings. A pass fills one target: its texture, or the draw's two buffers. A pass that fills buffers gives its workgroup counts, because it has no target size to divide.

The add-on's compute writes the count each frame. The engine copies the word into the draw's indirect arguments after the compute pass. It does so before the pass that draws. The count that the GPU writes is then the count that the GPU draws. A hidden draw copies nothing, so it draws nothing.

## The count and the instances without compute

WebGL2 has no compute shaders and no storage buffers. There the draw is an instance batch that the CPU fills, and the same shader reads the same instances:

```ts
draw.setInstances(rows, liveCount); // rows of 16 floats each, as draw.instances holds them
draw.setCount(liveCount);
```

On WebGL2, each row's matrix is split into a position, a rotation and a scale that the batch's rows carry. A matrix with shear does not split, so keep the rotation and the scale apart.

`draw.setCount(n)` works on both paths. On WebGPU it is the count that a shadow view draws. It is also the count of a frame that the add-on's compute has not written yet. The compute's word replaces it in the same frame.

## Limits

- The draw records in the main view alone, at the opaque point. A transparent instance draw, and one in a reflection or a scene pass, arrives with the add-on that first needs it.
- The engine does not cull the draw by the camera's frustum or layers. Your compute's cull, or your count, decides what draws. `draw.setVisible(false)` stops it, and so does a hidden parent.
- The engine does not bound the count. Keep the add-on's count at or under `capacity`. Past it, the GPU reads past the end of the buffer.
- A shadow view draws `draw.setCount`'s count, because the add-on's compute writes the main view's count alone.
- The feature description's `reads`, `writes`, `outputs` and `provides` stay with the [feature registry](features.md).

[The API reference](reference/feature-instances.md) lists every export of this page with its type and description. The engine's doc comments make it.
