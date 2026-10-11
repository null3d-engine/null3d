---
id: api/scene
title: Scene
status: experimental
since: "0.1"
summary: "Creating objects; models and copies; find; background, environment, fog, sky; warmUp."
---

# Scene

> Ships in null3D 0.1, with the environment, the sky and environment backgrounds, the sky's environment and `timeOfDay` from 0.2. The API is experimental, so it can still change between versions.

The scene holds everything the engine draws: the objects, the camera that the canvas shows, the lights and the background. A sketch gets it as `scene` in its setup function, and creates everything through it.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
  scene.setBackground('#101418');
  const camera = scene.createPerspectiveCamera({ fov: 60, position: [0, 4, 10], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });

  const box = geometry.box();
  const red = materials.standard({ color: '#e8554e' });
  const left = scene.createGroup({ name: 'left', position: [-3, 0, 0] });
  scene.createMesh({ mesh: box, material: red, parent: left });
  scene.createMesh({ mesh: geometry.sphere({ radius: 0.6 }), material: red, parent: left, position: [0, 1.5, 0] });

  // 25 flat tiles: one batch that draws the box 25 times.
  const floor = scene.createInstances(box, 25, { material: materials.standard({ color: '#5bc27a' }) });
  for (let i = 0; i < 25; i++) {
    floor.positions.set([((i % 5) - 2) * 1.2, -1.5, (Math.floor(i / 5) - 2) * 1.2], i * 3);
    floor.scales.set([1, 0.2, 1], i * 3);
  }
  floor.markDirty();
});
```

## What the scene creates

| Call | Creates |
| --- | --- |
| `createGroup(options)` | A `Group`: an empty object that holds other objects |
| `createMesh({ mesh, material, ...options })` | A `Mesh`: an object that draws a mesh with a material |
| `createInstances(mesh, count, { material })` | An `InstanceBatch`: `count` copies of one mesh with one material |
| `instantiate(prefab, options)` | A `PrefabInstance`: a group that holds a copy of a model that `assets.loadGltf` loaded |
| `createInstances(prefab, count, options)` | An `InstanceBatch` whose rows each draw a whole copy of a model |
| `clone(object)` | A copy of an object and of every object below it |
| `createPerspectiveCamera(options)` | A `PerspectiveCamera` that the scene can draw from |
| `createOrthographicCamera(options)` | An `OrthographicCamera`, whose view is a box, that the scene can draw from |
| `createDirectionalLight(options)` | A `DirectionalLight`: light from one direction, like sunlight |
| `createPointLight(options)` | A `PointLight`: light from a point in every direction, out to its range |
| `createSpotLight(options)` | A `SpotLight`: light from a point in a cone, out to its range |
| `createHemisphereLight(options)` | A `HemisphereLight`: light from the sky above and the ground below |
| `createAmbientLight(options)` | An `AmbientLight`: the same light on every surface |

Groups, meshes, cameras and lights take the same object options: `name`, `position`, `rotation`, `scale`, `parent`, `dynamic` and `layers`. [Objects and transforms](objects.md) describes them. `createMesh` also takes `castShadows` and `receiveShadows`, which [Shadows](../concepts/shadows.md) explains. Meshes come from `geometry` and materials from `materials` in the sketch context. One mesh and one material can serve any number of objects.

## Models and copies

`scene.instantiate(prefab, options)` creates the objects of a model that [`assets.loadGltf`](assets.md#gltf-models) loaded. It returns a `PrefabInstance`: a group that holds the copy of the file's nodes. The `options` place that group as they place any object. Every copy shares the model's meshes, materials and textures, so a second copy costs only its objects. `castShadows` and `receiveShadows` apply to every mesh of the copy, and to every row of the instance batches of nodes with instancing of their own. The engine reserves the places of all the copy's objects with one call, and queues their changes as one batch. So no frame shows part of a copy.

```ts
const ship = await assets.loadGltf('/models/ship.glb');
const fleet = [0, 1, 2].map((k) => scene.instantiate(ship, { position: [k * 6, 0, 0], castShadows: true }));
const turret = fleet[0].find('Turret'); // this copy's object of the node named Turret
turret?.rotateY(0.5);
```

`instance.find(name)` gives the copy's object of a node, by the node's name in the file. `scene.find` searches every object. When several copies share a name, it gives the first copy's object.

`scene.clone(object)` copies an object and every object below it, with their meshes, materials, lights, cameras and settings, as three.js's `clone` does. The copy goes under the same parent, so it starts in the same place. It uses the same path as `instantiate`: one call and one batch of changes for the whole tree. Instance batches are not objects, so `clone` leaves them out.

`scene.createInstances(prefab, count, options)` draws many copies of a model with instance batches, one for each mesh of the model. The batches share one set of rows, so each row places a whole copy. Write the returned batch's `positions`, `rotations` and `scales` as for a batch of one mesh. Each mesh keeps its place in the model. The model's lights are left out. A model with no meshes, or with instancing of its own, throws E1417. Give `createInstances` one of its meshes and a material instead, from `prefab.find(name)`.

```ts
const tree = await assets.loadGltf('/models/tree.glb');
const forest = scene.createInstances(tree, 500); // trunk and leaves move together
for (let i = 0; i < 500; i++) forest.positions.set([Math.random() * 100, 0, Math.random() * 100], i * 3);
forest.markDirty();
```

## Finding objects by name

`scene.find(name)` returns the first object created with that name that is not destroyed, or `undefined` when no object has it. Names need not be unique. The scene keeps an index of names, so the call costs the same in a scene of any size.

```ts
import type { Mesh } from '@null3d/engine';

// At setup: the sketch created a mesh named 'door' earlier.
const door = scene.find('door') as Mesh | undefined;
door?.setVisible(false);
```

`find` returns the general `Object3D` type. When you know which kind of object has the name, cast the result to its class, such as `Mesh`, to use its own calls. Look objects up at setup and keep them, rather than calling `find` in every frame.

## The camera and the background

The canvas shows the scene from the active camera, which `setActiveCamera` picks. It can be either kind of camera, and [Cameras](cameras.md) covers both lenses. Until you pick a camera, the canvas shows only the background. `setBackground` takes a color. The default background is black, or the page behind a transparent canvas. Exposure and tone mapping change the background as they change the objects: [Color management](../concepts/color-management.md#the-background).

`setBackground` also takes a [texture](textures.md). The texture fills the camera's view behind every object, as a texture in three.js's `scene.background` does. It stretches to the shape of the view. A texture that loads with the default `flipY` stands upright. The engine samples it with the texture's own filter and ignores its alpha. The texture draws behind every object, in the pixels that no object covers.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, assets }) => {
  scene.setBackground('#20242a'); // shows until the picture is on the GPU
  scene.setBackground(await assets.loadTexture('/tex/sky.jpg'));
  return {};
});
```

The color set before a texture shows until the texture's texels are on the GPU, and again if you destroy the texture. A later color takes the place of the texture.

### Environments, cube maps and the sky

`setBackground` also takes three backgrounds that surround the scene, as three.js's `scene.background` does with a cube texture and its `Sky` object:

- An environment from [`assets.loadEnvironment` or `assets.builtinEnvironment`](assets.md#environments). It can blur, as three.js's `backgroundBlurriness` blurs a PMREM texture.
- A cube map of six images from [`assets.loadCubemap`](assets.md#cube-maps), a sky box.
- three.js's analytic sky: `{ sky: { sunPosition } }`, with the settings of three.js's `Sky` object.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, assets }) => {
  const sunset = await assets.loadEnvironment('/env/sunset.ktx2');
  scene.setEnvironment(sunset);
  // The same light behind the objects, blurred, dimmed and turned a quarter turn.
  scene.setBackground(sunset, { blur: 0.3, intensity: 0.7, rotation: [0, Math.PI / 2, 0] });
  return {};
});
```

| Option | Takes | Default | What it sets |
| --- | --- | --- | --- |
| `intensity` | Every background but a color | 1 | The factor of the background's light, 0 or more, as three.js's `scene.backgroundIntensity` |
| `blur` | Environments | 0 | How much the background blurs, from 0 (sharp) to 1, as `scene.backgroundBlurriness` |
| `rotation` | Environments and cube maps | `[0, 0, 0]` | The background's turn, as Euler angles in radians in the order X, Y, Z, as `scene.backgroundRotation` |

An environment's map holds its light blurred for each roughness. So the background reads the level of the blur's roughness, as three.js reads its PMREM texture. A blurred background costs no more than a sharp one. The background and `setEnvironment` are separate: a scene can show one environment and take its light from another. A cube map shows its six images as three.js's `CubeTextureLoader` shows them, and does not light the scene.

The sky takes the names and the defaults of three.js's `Sky` uniforms:

| Setting | Default | What it sets |
| --- | --- | --- |
| `sunPosition` | `[0, 0.0349, -0.9994]` | A point toward the sun, as `sunPosition`. The default puts the sun 2 degrees over the horizon, as three.js's sky example does |
| `turbidity` | 2 | The haze in the air |
| `rayleigh` | 1 | The scattering by the air's molecules, which makes the sky blue |
| `mieCoefficient` | 0.005 | The scattering by haze |
| `mieDirectionalG` | 0.8 | How much the haze scatters toward the sun, from 0 to below 1 |
| `cloudCoverage` | 0.4 | The share of the sky that clouds cover, from 0 to 1. 0 draws no clouds |
| `cloudDensity` | 0.4 | How solid the clouds are |
| `cloudElevation` | 0.5 | The height of the clouds, from 0 to 1 |
| `cloudScale` | 0.0002 | The size of the clouds' pattern. Larger values make smaller clouds |
| `cloudSpeed` | 0.00002 | How fast the clouds drift as `time` grows |
| `time` | 0 | The time in seconds that moves the clouds, such as the sketch's time |
| `showSunDisc` | true | Whether the sky shows the sun's disc |

Two more settings are null3D's own. They add a second sky, which `timeOfDay` uses to fade the moon's sky in as night falls:

| Setting | Default | What it sets |
| --- | --- | --- |
| `secondSunPosition` | `[0, 1, 0]` | A point toward the second sky's sun. The second sky has the first sky's air and clouds |
| `secondSkyWeight` | 0 | The weight of the second sky's light beside the first sky's. 0 draws no second sky and costs nothing |

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, time }) => {
  const sun: [number, number, number] = [0, 0.1, -1];
  const settings = { sunPosition: sun, turbidity: 10, rayleigh: 3, time: 0 };
  const sky = { sky: settings };
  return {
    onUpdate() {
      // The sun rises and sets, and the clouds drift with the sketch's time.
      sun[1] = 0.1 + 0.05 * Math.sin(time.now * 0.1);
      settings.time = time.now;
      scene.setBackground(sky);
    },
  };
});
```

The sky lights nothing by itself. [`assets.skyEnvironment()`](assets.md#environments) makes an environment of it, which follows the sky's settings as they change: [Lighting and environment](../concepts/lighting.md#sky-and-backgrounds) shows how.

The first background of each kind downloads its shaders, `'background'` or `'sky'`, and the view shows the background color until they are built. [Loading screens](../guides/loading-screens.md#loading-everything-up-front) shows how to load them before the first frame. Each call sets every option and every setting, and one left out takes its default. The settings are values, not shader builds, and the call allocates nothing. So a sketch can move the sun or turn a cube map in every frame. Each background draws behind every object, in the pixels that no object covers, and exposure and tone mapping change it with the rest of the scene. An orthographic camera's view rays are parallel, so an environment, a cube map or the sky fills its view with one color. The color set before an environment or a cube map shows until its texels are on the GPU, and again after you destroy it.

Development builds throw E1203 for a number that is not finite, and E1108 for a number out of its range. They throw E1213 for `blur` on a background that is not an environment, and for `rotation` on a texture or the sky. Every build throws E1101 for a background that was destroyed. [Lighting and environment](../concepts/lighting.md#sky-and-backgrounds) says how each background draws, and what it costs.

## The environment

`setEnvironment` lights the scene with an environment map from [`assets.loadEnvironment`, `assets.builtinEnvironment` or `assets.skyEnvironment`](assets.md#environments), as three.js's `scene.environment` does with a texture from `PMREMGenerator`. Standard materials reflect it, sharply when smooth and blurred when rough, and take its diffuse light. `setEnvironment(null)` removes it. The background stays as `setBackground` set it.

```ts
const sunset = await assets.loadEnvironment('/env/sunset.ktx2');
scene.setEnvironment(sunset, { intensity: 0.8, rotation: [0, Math.PI / 2, 0] });
```

| Option | Default | What it sets |
| --- | --- | --- |
| `intensity` | 1 | The factor of the environment's light, 0 or more, as three.js's `scene.environmentIntensity` |
| `rotation` | `[0, 0, 0]` | The environment's turn, as Euler angles in radians in the order X, Y, Z, as `scene.environmentRotation` |

Each call sets both options, and an option left out takes its default. The call allocates nothing, so a sketch can turn the environment in every frame. A material's `envIntensity` scales the light on that material. The scene draws without a file's environment until its map is on the GPU. The built-in room's map and the sky's map are whole in the first frame that uses them. The sky's map follows the sky background: after a change of the sky, the scene takes the new light 19 frames later. The scene draws without the environment again after `environment.destroy()`. Development builds throw E1203 for a number that is not finite and E1108 for a negative intensity. They throw E1213 for a value that is not an environment. Every build throws E1101 for an environment that was destroyed. [Lighting and environment](../concepts/lighting.md#environment-maps) says how the environment lights a surface, and what it costs.

## Fog

`setFog` covers every object in fog that thickens with its distance from the camera. The distance is the straight line from the camera to the point, so an object keeps its fog as the camera turns. A curve sets how the fog thickens:

- `'exponential'`, the default: an even haze. An object at distance d takes the fog color by a factor of 1 - exp(-density × d).
- `'exp2'`: thicker with the square of the distance, 1 - exp(-(density × d)²), as three.js's `FogExp2`.
- `'linear'`: clear up to `near`, and hides objects from `far`, with a smooth change between them, as three.js's `Fog`.

The fog can also thin with height, as mist lies in a valley, and glow toward the main directional light. `setFog(null)` removes the fog.

```ts
scene.setBackground('#b8c4d0');
scene.setFog({ color: '#b8c4d0', density: 0.04 });
// Mist on the ground that thins upward:
scene.setFog({ color: '#b8c4d0', density: 0.1, height: 0, heightFalloff: 0.5 });
// A low sun that lights the haze around it:
scene.setFog({ color: '#b8c4d0', density: 0.04, sunGlow: 1.5 });
```

| Option | Curves | Default | What it sets |
| --- | --- | --- | --- |
| `color` | All | none | The fog's color, in any form that `setBackground` takes |
| `curve` | All | `'exponential'` | How the fog thickens: `'exponential'`, `'exp2'` or `'linear'` |
| `density` | Exponential and exp2 | 0.01 | How fast the fog thickens, 0 or more. At 0.01, exponential fog hides about two thirds of an object 100 units away |
| `near` | Linear | 1 | The distance where the fog starts |
| `far` | Linear | 1000 | The distance from which the fog hides every object. It must be above `near` |
| `height` | All | 0 | The height where the fog has its `density`, or its `near` and `far` |
| `heightFalloff` | All | 0 | How fast the fog thins with height, 0 or more. The fog's density falls to about a third every 1 / `heightFalloff` units up, and grows below `height`. 0 keeps the fog the same at every height |
| `sunGlow` | All | 0 | How much of the main directional light the fog scatters toward the camera, 0 or more. Fog toward that light glows in its color |
| `sunGlowExponent` | All | 8 | How tightly the glow gathers around the light's direction, above 0. Higher values make a smaller glow |

Height fog sums the fog along each line of sight. A view down into the mist then sees thick fog, and a view up sees clear air. The sun glow takes the color and the intensity of the scene's main directional light, so it follows the light as it moves. Shadows do not block the glow.

The fog does not cover the background, so give the background the fog's color to fade far objects into it. A material created with `fog: false` keeps its color at every distance, as [Materials](materials.md#options-fixed-at-creation) says. The engine mixes the fog into each pixel as it shades the pixel, before the tone mapping, so fog adds almost no work. The fog applies from the next frame. Development builds throw E1108 for an unknown curve, a `far` that is not above `near`, a negative `density`, `heightFalloff` or `sunGlow`, and a `sunGlowExponent` that is not above 0. They throw E1203 for a value that is not a finite number. The `null3d::fog` module of the [shader library](../shaders/library.md#null3dfog) holds the same formulas for WGSL shaders.

## Time of day

`timeOfDay(hours)` works out the settings of a time of day. They are the sky, the main light (the sun, or the moon at night), the fog's color and glow, an ambient light, the sky's intensity and the exposure. It takes an hour from 0 to 24, or a preset: `'afternoon'`, `'goldenHour'`, `'blueHour'` or `'night'`. It returns plain values, which the sketch applies to its own objects. At night the sky is lit from the moon's place, a navy blue, and the sky's sun disc draws the moon. As night falls the sunset's sky fades straight into the moon's sky.

```ts
import { defineSketch, timeOfDay } from '@null3d/engine';

export default defineSketch(async ({ scene, assets, post }) => {
  const day = timeOfDay('afternoon');
  scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
  scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
  scene.createDirectionalLight(day.light);
  scene.setFog({ color: day.fog.color, density: 0.01, sunGlow: day.fog.sunGlow });
  post.set({ exposure: day.exposure });
  return {};
});
```

[Lighting and environment](../concepts/lighting.md#time-of-day) explains each value, the presets and the sun's path. A value that is not a finite number, or an unknown preset, throws a `RangeError`. The [time of day demo](https://github.com/null3d-engine/null3d/tree/main/examples/time-of-day) passes a whole day over a lighthouse in 40 seconds, and lights its windows and its lamp at dusk.

## Lights

Each light is an object, so a scene can hold many, and each call creates another. Without lights, standard materials draw black. [Lights](lights.md) covers each kind, and which of them light surfaces in this version.

## When changes take effect

Creating an object, `destroy`, `setParent`, `setVisible`, `setLayers` and `setDynamic` change the structure of the scene, and so do the mesh calls: `setMaterial`, `setMesh`, `setCastShadows`, `setReceiveShadows`, `setRenderOrder`, `setFrustumCulled` and `setBounds`. The engine queues these changes and applies them after `onUpdate` returns, before it updates transforms and draws. The frame drawn after the call shows the change. Some of them make the engine rebuild its draw tables, as the [performance guide](../guides/performance.md#objects-during-play) lists.

Values that the engine computes, such as the result of `getWorldPosition`, come from the engine's last transform update. In `onUpdate` they come from the previous frame. In `onLateUpdate` they already hold the frame's changes, because the engine updates transforms before it calls `onLateUpdate`. Setters that `onLateUpdate` calls show in the same frame, and structural changes that it makes wait for the next frame ([Sketch API](sketch.md#when-changes-show)).

When the engine cannot apply a change, such as a parent loop (E1104), it skips that change and logs the error to the console. The rest of the queue still applies.

## Warm-up

The GPU draws each kind of object with a pipeline, which takes time to build. The first frame waits until its pipelines are built. After that, an object whose pipeline is still building draws nothing until it is built. A warm-up, `await scene.warmUp()`, resolves once every pipeline that the scene needs is built, hidden objects included. So create a later loading stage hidden, warm up, then show it. [Loading screens and warm-up](../guides/loading-screens.md) shows the pattern.

## Instance batches

An instance batch is one object that draws many copies of one mesh with one material. Its rows live in typed arrays that sketch code writes directly, with no call per row. A static batch, the default, uploads the rows you mark with `markDirty`. A batch created with `dynamic: true` uploads every row in every frame. Every row of a batch shares the batch's layers, which the `layers` option and `setLayers(mask)` set, as [Render layers](../concepts/render-layers.md) explains. Rows are relative to the batch's `origin`, which keeps rows precise far from the world's origin: [Batch origins](../concepts/large-worlds.md#batch-origins). [Instances and batching](../concepts/instances.md) explains batches in full.

## Limits

- A scene starts with room for 1,023 objects: groups, meshes, cameras and lights together. When it needs more, it grows on its own. It doubles its room at the start of a frame once it is three quarters full. A create call that finds it full doubles it at once. A destroyed object frees its place when the frame applies the change.
- Each growth copies the scene's tables, about 263 bytes per object, in one short pause. A scene that knows its size can start with room for every object, with the `expectedObjects` option of [`createEngine`](engine.md#options), and never grows during play.
- A scene holds up to 1,048,575 objects, the most that a handle can name. Past that, a create call throws E1102. A growth that the engine's memory cannot hold throws E1109. Each place counts toward the objects and instance rows that the GPU draws (`engine.capabilities.maxInstances`), and a growth past that limit throws E1501.
- The rows of an instance batch take none of those places. One engine holds up to 256 batches, and `createInstances(prefab, ...)` takes one for each mesh of the model.
- The queue holds up to 65,536 changes between two frames. One more throws E1102.
- The animation table holds up to 1,024 animated objects: each copy of a model with clips or skins takes one. One more throws E1102, and `instantiate` or `clone` then creates no part of the copy.

## Related pages

- [Objects and transforms](objects.md): the calls that every object has.
- [Handles and objects](../concepts/handles.md): how objects keep their data in the engine's memory.
- [Static and dynamic objects](../concepts/static-dynamic.md): what the `dynamic` option changes.
- [Materials](materials.md) and [Geometry](geometry.md): what a mesh draws.
- [Loading screens and warm-up](../guides/loading-screens.md): waiting for the scene's pipelines.
- [Assets and prefabs](../concepts/assets.md): models from glTF files, and what a prefab shares.
- [Lighting and environment](../concepts/lighting.md#environment-maps): how an environment lights the scene.

## API reference

[The API reference](reference/scene.md) lists every export of this page with its type and description. The engine's doc comments make it.
