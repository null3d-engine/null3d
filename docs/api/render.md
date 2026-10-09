---
id: api/render
title: Render graph API
status: experimental
since: "0.2"
summary: "render.addPass for scene passes and reflection passes that draw into textures; switching and removing passes; render.dumpGraph."
---

# Render graph API

> Ships in null3D 0.2. The API is experimental, so it can still change between versions. Scene passes, reflection passes, `render.setPassEnabled`, `render.removePass` and `render.dumpGraph` are built. Full-screen passes of your own WGSL are not built yet, so coding agents must not use them: use [custom effects](post.md#custom-effects) for full-screen WGSL.

```mermaid
flowchart LR
    map["Scene pass 'minimap'<br/>from the map camera"] --> texture[("texture 'minimap'")]
    texture --> material["A material's map:<br/>textures.fromPass(pass)"]
    material --> opaque["The camera's passes"]
    opaque --> final["Final pass"] --> canvas[("canvas")]
```

`ctx.render` adds passes of your own to the engine's [render graph](../concepts/render-graph.md). A scene pass draws the scene from a second camera into a texture. `textures.fromPass` gives that texture to materials and sprites, so a minimap, a security camera's screen or a portal shows it. A reflection pass draws the camera's view mirrored across a plane, for water and polished floors ([Reflection passes](#reflection-passes)). The render graph orders the passes, plans their memory and checks them as one.

## A minimap

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry, textures, render }) => {
  const mapCamera = scene.createOrthographicCamera({ height: 40, near: 1, far: 100, position: [0, 50, 0] });
  mapCamera.setRotationEuler(-Math.PI / 2, 0, 0);
  const map = render.addPass({ kind: 'scene', camera: mapCamera, writes: 'minimap', size: [256, 256] });
  const screen = materials.unlit({ map: textures.fromPass(map) });
  scene.createMesh({ mesh: geometry.plane({ width: 2, height: 2 }), material: screen, position: [0, 1, -4] });
  return {};
});
```

## Scene passes

`render.addPass({ kind: 'scene', ... })` adds a pass from the next frame on and returns a `RenderPass`.

| Option | Meaning | Default |
| --- | --- | --- |
| `kind` | `'scene'`: the pass draws the scene's objects from `camera`. | Required |
| `camera` | The camera that the pass draws from. Its lens takes the texture's shape, so a perspective camera's aspect ratio follows `size`. | Required |
| `writes` | The name of the pass's texture. Other passes name it in `reads`, and `render.dumpGraph()` and errors show it. | Required |
| `size` | The texture's size in pixels, as `[width, height]`, from 1 to `textures.maxSize`. | Required |
| `name` | The pass's name in `render.dumpGraph()` and errors. | `writes` |
| `layers` | The layers of the objects that the pass draws, as a 32-bit mask. | The camera's layers |
| `reads` | The textures of other passes that the objects of this pass may show, by their `writes` names. | None |
| `clearColor` | The color that the texture clears to before the pass draws. | The scene's background color |
| `clearAlpha` | The alpha that the texture clears to with `clearColor`, from 0 to 1. | 1 |

- A pass runs only while something shows its texture: a texture from `textures.fromPass`, or another running pass that names it in `reads`. A pass that nothing shows costs nothing, not even its texture's memory.
- The texture holds linear color, after the exposure and before the tone curve. On most devices it holds high dynamic range color. A material that shows it, such as an unlit material, gives the camera the same light that the pass saw. The final pass then maps it as it maps the rest of the scene.
- Devices that draw 8-bit color tone map in each material's shader: compatibility mode with MSAA, and WebGL2 devices without float targets ([Color management](../concepts/color-management.md)). In compatibility mode the engine turns the pass's colors back to linear as it fills the texture, but they stay tone mapped, so the material that shows the texture applies the tone curve a second time. With the default `'aces'` curve the image then looks a little lighter in the middle tones. On WebGL2 devices without float targets the texture holds display color, so the image looks brighter and flatter.
- The image stands upright on a plane, with v = 0 at its bottom row, as three.js's render targets do.
- Each pass texture has the scene's anti-aliasing: with MSAA the pass draws with the same samples, then resolves.
- A pass never draws an object whose material shows the texture of a pass that it does not read, or its own texture. So a mirror does not show itself, and a minimap's screen does not appear in the minimap. To show a mirror in a mirror, add a second pass for it.
- A sketch can add at most 31 scene and reflection passes at once.

### What a scene pass draws

A scene pass draws the scene's objects with their materials, the sun, its shadows where the camera's shadow cascades reach, the ambient light, the environment's light and the fog. In this version it draws no point or spot lights, no ambient occlusion and no sky background, and it culls each frame in one pass, without occlusion culling. Its texture clears to `clearColor` instead of the sky.

## Reflection passes

```mermaid
flowchart LR
    camera["The camera's view"] --> mirror["Reflection pass 'water':<br/>the view mirrored across the plane,<br/>clipped at the plane"]
    mirror --> texture[("texture 'water'")]
    texture --> water["The water's custom material:<br/>reflection_uv, then s.reflection"]
    water --> opaque["The camera's passes"]
```

`render.addPass({ kind: 'reflection', ... })` draws what a mirror on a plane shows. It draws the camera's view, mirrored across the plane, into a texture of the render size or a part of it. Everything below the plane is clipped, so a riverbed or the floor's underside never shows in the reflection. A custom material reads the texture where its surface shows on the screen. It gives the color to the engine's lighting as the surface's `reflection` ([Surface functions](../shaders/surface-functions.md#reflections)).

```ts
import { defineSketch } from '@null3d/engine';

const mirrorFloor = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, vec2f(0.0));
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, textures, render }) => {
  scene.setBackground({ sky: { sunPosition: [0.4, 0.35, -0.85] } });
  const camera = scene.createPerspectiveCamera({ position: [0, 2.5, 8], target: [0, 0.5, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-0.4, -1, -0.5], intensity: 2.5 });
  scene.createMesh({
    mesh: geometry.box(),
    material: materials.standard({ color: '#e03030' }),
    position: [0, 0.5, 0],
  });
  const reflection = render.addPass({ kind: 'reflection', writes: 'floor', plane: { point: [0, 0, 0] } });
  const floor = materials.shader({
    wgsl: mirrorFloor,
    color: '#20242a',
    roughness: 0.05,
    textures: { mirror: textures.fromPass(reflection) },
  });
  const ground = scene.createMesh({ mesh: geometry.plane({ width: 20, height: 20 }), material: floor });
  ground.setRotationEuler(-Math.PI / 2, 0, 0);
  return {};
});
```

| Option | Meaning | Default |
| --- | --- | --- |
| `kind` | `'reflection'`: the pass draws the camera's view mirrored across `plane`. | Required |
| `plane` | The plane: `point`, a point on it in the world, and `normal`, toward the side that the reflection shows. The normal need not have length 1. | Required; `normal` is up, `[0, 1, 0]` |
| `writes` | The name of the pass's texture, as for a scene pass. | Required |
| `scale` | The texture's size as a share of the render size each way: `1`, `0.5` or `0.25`. | The quality preset's `reflectionScale` |
| `every` | The pass draws in one frame of every `every`, from the first, and the texture keeps its last image between. | 1: every frame |
| `name` | The pass's name in `render.dumpGraph()` and errors. | `writes` |
| `layers` | The layers of the objects that the pass draws, as a 32-bit mask. | The camera's layers, which it follows |
| `reads` | The textures of other passes that the objects of this pass may show, as for a scene pass. | None |
| `clearColor` | The color that the texture clears to, behind the scene's background. | The scene's background color |
| `clearAlpha` | The alpha that the texture clears to with `clearColor`, from 0 to 1. | 1 |

- The pass follows the active camera, its lens and the canvas's shape, so it needs no camera of its own. Its texture follows the render size: `RenderPass.width` and `height` are 0.
- The texture holds the mirrored image, turned around across x and upright. `reflection_uv` from `null3d::reflection` finds where a surface point lies in it. It takes the point's clip position, and an offset that moves the place. A normal that ripples then bends the reflection.
- The pass clips the scene at the plane with the projection's near plane, so the clip costs nothing in any shader. An object that crosses the plane shows only its part above the plane.
- When the camera stands on the plane or below it, the pass draws nothing, and its texture keeps its last image.
- A material that shows the pass's texture never draws in the pass, so the water does not reflect itself.
- With `every` above 1, the reflection lags a moving camera in the frames between draws. Use it where the camera moves slowly.
- The pass culls the scene once more, with the plane as its near plane, and without occlusion culling.

### What a reflection draws

A reflection draws the scene's objects with their materials, and the scene's background: the color, texture, environment, cube map or sky that `scene.setBackground` sets. It draws the sun, its shadows where the camera's shadow cascades reach, the ambient light, the environment's light and the fog. In this version a reflection draws no point or spot lights and no ambient occlusion, as scene passes do not. A lamp's glowing material still shows in the reflection. The light that the lamp casts on the objects around it does not. Development builds warn once when the scene has point or spot lights.

Devices that draw 8-bit color apply the tone curve twice to a reflection, as to a scene pass's texture. The reflected sky looks a little grayer there.

### Cost of a reflection

A reflection draws the scene a second time. Its cost follows its pixels and the part of the scene that it sees. At half the render size each way it shades a quarter of the pixels. Each quality preset gives it a share of the render size. Low takes a quarter, Medium and High take half, and Ultra takes the whole size. Take S1, the swarm benchmark, with water under 100,000 boxes. On a MacBook Pro on WebGPU, the reflection added about 0.6 ms of GPU time per frame at half size, and 0.7 ms at full size. On WebGL2 it added 0.2 to 0.4 ms. Small objects such as S1's boxes cost the reflection their vertices at any size, so its size matters most where large surfaces fill its pixels.

### Switching and removing passes

- `render.setPassEnabled(pass, false)` stops a pass from the next frame on. Its texture keeps the last image that it drew. A sketch can draw a costly pass every few frames this way. The call allocates nothing.
- `render.removePass(pass)` removes a pass and destroys the textures that `textures.fromPass` made of it.
- `pass.live` is false after `removePass`, and `pass.enabled` gives the switch.

## The graph as text

`render.dumpGraph()` returns the whole render graph as Graphviz DOT text: the engine's passes and yours, in the order they run, grouped into the GPU's render passes. Each texture shows its format, size and memory. Passes that are switched off show dashed, and so do passes that nothing reads, with the words "culled: nothing uses its output". Paste the text into a Graphviz viewer to see it as a picture.

```ts
console.log(render.dumpGraph());
```

## Cost

- A scene pass culls the scene and draws it again, at its own size. A 256 by 256 minimap costs far less than the main view. A pass at the canvas's size costs about as much as the main view.
- On WebGPU, a full-screen copy turns each pass's image upright, at one texel read per texel of the texture. WebGL2 draws it upright directly.
- Each pass texture takes memory for its texels, and for its samples with MSAA, while something shows it.
- To save time, switch a pass off in frames where its image need not change.

## Errors

| Code | Cause |
| --- | --- |
| E1220 | Options that `render.addPass` does not take, a `writes` or `name` that another pass has, or a 32nd pass. A reflection's plane without a point, a normal of no length, or a `scale` or `every` that it does not take. Or something that is not a render pass, given to `render.setPassEnabled`, `render.removePass` or `textures.fromPass`. |
| E1502 | A name in `reads` that no pass writes. Or `render.removePass` on a pass whose texture another pass reads. |
| E1503 | A `writes` name that the engine's own passes write, such as `sceneColor`. |
| E1504 | A pass that reads its own texture. |
| E1101 | A call on a pass that `render.removePass` removed. |

The core checks the whole graph when `render.addPass`, `render.removePass` or `textures.fromPass` changes it, so the call that breaks the graph throws.

## Related pages

- [Custom passes and render targets](../guides/custom-passes.md): render-to-texture with examples, reflections, a water recipe, and custom effects.
- [Surface functions](../shaders/surface-functions.md#reflections): the surface's `reflection`.
- [The render graph](../concepts/render-graph.md): how the graph orders passes and plans their memory.
- [Textures](textures.md): `textures.fromPass`.
- [Cameras](cameras.md): perspective and orthographic cameras.
- [The security camera demo](https://github.com/null3d-engine/null3d/tree/main/examples/security-camera): a camera on a pole sweeps a yard behind a wall, and a monitor shows what it sees.

## API reference

[The API reference](reference/render.md) lists every export of this page with its type and description. The engine's doc comments make it.
