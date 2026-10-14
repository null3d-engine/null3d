---
id: api/lights
title: Lights
status: experimental
since: "0.1"
summary: "Directional, point, spot, hemisphere, ambient, rectangle and tube lights; shadow options."
---

# Lights

> Roadmap step 0.1, first released in null3D 0.1.0. Step 0.2 adds the light from the sky, the light of hemisphere lights, rectangle and tube lights and contact shadows. The API is experimental, so it can still change between versions. Surfaces show only the first directional light, so a second one adds no light.

A light is a scene object, like a mesh or a camera. It has a position, a rotation, a parent and layers, and `setVisible` and `destroy` work on it. Each kind of light has a class and a create call of its own. The standard material reflects lights, and the unlit material ignores them.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, time }) => {
  const sun = scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#fff4e0', intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });
  const lamp = scene.createPointLight({ name: 'lamp', position: [0, 2, 0], range: 8, intensity: 20, dynamic: true });

  return {
    onUpdate() {
      // The sun circles the scene, and the lamp bobs up and down.
      const angle = time.now * 0.2;
      sun.setDirection(Math.cos(angle), -1, Math.sin(angle));
      lamp.setPosition(0, 2 + Math.sin(time.now), 0);
    },
  };
});
```

## Kinds of light

| Call | Class | Light | Its own options |
| --- | --- | --- | --- |
| `createDirectionalLight(options)` | `DirectionalLight` | Parallel light from one direction, like sunlight | `direction`, `castShadows`, `shadow`, `intensityUnit` |
| `createPointLight(options)` | `PointLight` | Light from a point in every direction, out to its range | `range` (required), `decay`, `castShadows`, `shadow`, `intensityUnit` |
| `createSpotLight(options)` | `SpotLight` | Light from a point in a cone, out to its range | `range` (required), `angle`, `penumbra`, `decay`, `direction`, `target`, `castShadows`, `shadow`, `intensityUnit` |
| `createHemisphereLight(options)` | `HemisphereLight` | Light from the sky above and the ground below | `skyColor`, `groundColor`, `intensityUnit` |
| `createAmbientLight(options)` | `AmbientLight` | The same light on every surface | `intensityUnit` |
| `createRectAreaLight(options)` | `RectAreaLight` | Light from a glowing rectangle, out to its range | `range` (required), `width`, `height`, `direction`, `target`, `image` |
| `createTubeLight(options)` | `TubeLight` | Light from a glowing tube, out to its range | `range` (required), `length`, `radius`, `direction`, `target` |

Every light takes `color` and `intensity`, except the hemisphere light, which takes `skyColor`, `groundColor` and `intensity`. Every light also takes the options of every object: `name`, `position`, `rotation`, `scale`, `parent`, `dynamic` and `layers`. [Objects and transforms](objects.md) describes them.

## Where a light points

Directional, spot and rectangle lights send their light along their -Z axis, the way a camera looks. A tube light runs along its -Z axis. The `direction` option and `setDirection` turn that axis to a direction relative to the light's parent. `lookAt` turns it toward a point. A spot light's `target` option does the same when you create the light. The default points straight down, (0, -1, 0). Parents turn a light with them, as they turn any object.

A directional light's position does not matter: only its direction does. The sky of a hemisphere light lies along its +Y axis, which points straight up until you turn the light. Its position does not matter either.

A light's scale changes neither its range, its cone nor its size.

## Color, intensity and units

Each color is a hex string or a number, which are sRGB, or three linear components from 0 to 1. The default is white. The intensity scales the color, and the default is 1. A hemisphere light's intensity scales both of its colors.

Units follow three.js since r155. The intensity of a point or spot light is in candela. A directional light's intensity is in lux: the light that reaches a surface facing it. The standard material uses the lighting formulas of three.js's `MeshStandardMaterial`, so the same colors and intensities give the same result in both engines. Take a white directional light with an intensity of π, about 3.14, and no ambient light. A rough surface that faces it shows nearly its full color. [Lighting and environment](../concepts/lighting.md#units-and-exposure) covers the units in full.

The `intensityUnit` option names another unit for the intensity and for `setIntensity`:

| Light | `intensityUnit` | What the engine does |
| --- | --- | --- |
| Point | `'lumen'` | Divides by 4π, as three.js's `PointLight.power` does |
| Spot | `'lumen'` | Divides by π at any cone angle, as three.js's `SpotLight.power` does |
| Directional, hemisphere, ambient | `'lux'` | Nothing: lux is three.js's unit for these lights |

A light in lumens with no `intensity` gives 1 lumen. A unit that the light does not take throws [E1213](../errors/E1213.md). Lights in real units need a camera exposure to match, such as `post.set({ ev100: 15 })` for a sunny day:

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, post }) => {
  // Real units: a sun of 100,000 lux and an 800-lumen bulb, with a camera set for a sunny day.
  post.set({ ev100: 15 });
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 100_000, intensityUnit: 'lux' });
  scene.createPointLight({ position: [0, 2, 0], range: 8, intensity: 800, intensityUnit: 'lumen' });
});
```

A point or spot light ends at its `range`, in meters. It has no default, because the engine finds the lights near each surface by their ranges. Its light fades with distance by `decay`, and the default, 2, is the physical rate. A spot light's `angle` goes from its direction to the edge of its cone, in radians, up to π/2, and the default is π/3. Its `penumbra`, from 0 to 1, is the part of the cone over which the light fades out toward the edge.

Every setter allocates nothing, `setColor` and `setGroundColor` included. So `onUpdate` can call `setIntensity`, `setColor`, `setDirection`, `setRange` and the others in every frame.

## Which lights reach surfaces

In this version:

- Surfaces show one directional light: the first one you created that is visible and shares a layer with the camera.
- Every ambient light that is visible and shares a layer with the camera adds its light.
- Point and spot lights light the surfaces that their ranges reach. Each frame the engine finds the ones whose ranges reach into the camera's view. It lists each one in the clusters of the view that it reaches. The camera lists up to 1,024 of them, the nearest, and up to 128 in each cluster. [Lighting and environment](../concepts/lighting.md#clustered-forward-shading) explains clusters.
- Rectangle and tube lights light the surfaces that their ranges reach, in the same clusters. The quality preset's `areaLights` caps how many one frame shades: 4 on Low, 8 on Medium, 16 on High and 32 on Ultra. Past it, the ones that give the camera the most light shade: the brightest and largest for their distance. A light that joins or leaves them fades over a few frames, so none switches on or off at once. [Area lights](#area-lights) says more.
- Every hemisphere light that is visible and shares a layer with the camera adds its light. [Hemisphere lights](#hemisphere-lights) says how.
- Without lights, standard materials draw black.

To turn a light off, hide it with `setVisible(false)`, set its intensity to 0, or destroy it. A light lights a camera's view only when their layer masks share a bit, as in three.js. [Render layers](../concepts/render-layers.md) explains masks.

## Area lights

A rectangle light glows over its whole area, like a shop window, a screen or a studio's soft box. A tube light glows along a tube, like a neon sign or a fluorescent lamp. A point light gives a shiny surface a small dot of light. An area light gives it the light's whole shape, stretched along the surface as on a wet street, and lights a rough surface softly. The engine shades them with linearly transformed cosines, as three.js shades its `RectAreaLight`, so a rectangle light gives three.js's look.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry }) => {
  // A wet street: a dark, smooth ground that shows each light's shape.
  const street = materials.standard({ color: '#202428', roughness: 0.15 });
  scene.createMesh({ mesh: geometry.plane({ width: 20, height: 20 }), material: street, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] });
  // A warm window, 3 m by 2 m, that faces down the street along +Z.
  scene.createRectAreaLight({ position: [0, 2, -4], direction: [0, 0, 1], width: 3, height: 2, range: 15, color: '#ffd29a', intensity: 8 });
  // A pink neon tube, 2 m long, that runs across the street above it.
  scene.createTubeLight({ position: [0, 3.5, 0], direction: [1, 0, 0], length: 2, range: 8, color: '#ff4fa8', intensity: 40 });
});
```

- The intensity is the brightness of the light's surface, in nits, as three.js's `RectAreaLight` takes it. A larger light of the same intensity gives more light.
- A rectangle light's light leaves the side that its -Z axis points to. Surfaces behind it get none. `width` runs along its X axis and `height` along its Y axis, and both default to 1 meter.
- A tube light shines all around. `length` runs along its -Z axis, and defaults to 1 meter. `radius` defaults to 0.025 meters, a thin neon tube. The ends of the tube add no light, which a thin tube does not show.
- Area lights need a `range`, as point and spot lights do. The light fades to nothing at the range from the light's middle. three.js's `RectAreaLight` has no range: pick the distance where the light no longer matters.
- A rectangle light can show a picture over its area, such as a shop window or a screen. The `image` option and `setImage({ width, height, data })` take sRGB pixels, four bytes each, top row first. The light then varies over its area: a puddle shows the picture, and a rough wall gets its blurred colors. The color and intensity tint the picture. The light gives out its intensity times the picture's average color, in linear light. A mostly dark picture, such as thin neon tubes on black, lights little around it. Keep the intensity at the tubes' brightness, and paint a faint glow around the tubes to light more. The engine resamples it to 128 x 128 texels with every mip level. Up to 32 lights show pictures at once, and `setImage(null)` goes back to one color. A new picture allocates, so set it at setup or now and then.
- `setSize`, `setRange`, `setDirection` and `setIntensity` take effect in the next frame and allocate nothing.
- Area lights cast no shadows. Use a spot light beside one for a shadow.
- An area light costs each surface it reaches several times what a point light costs. The quality preset's `areaLights` caps how many one frame shades.
- The engine downloads the area lights' tables, a file of 19 KB, with the first area light. It also downloads the builds of the lit shaders that shade area lights. Area lights give light once both have arrived, and the scene draws as before meanwhile. A scene without area lights downloads neither, and its shaders carry no code for them. `createEngine`'s `preload` takes `'area_lights'` to download the builds before the first frame. A failed download reports [E1431](../errors/E1431.md).
- Area lights light every GPU path in the same way: WebGPU, WebGPU's compatibility mode and WebGL2.
- Scene passes and reflection passes draw area lights too, with their pictures. The `areaLights` cap applies to each pass on its own.

## Hemisphere lights

A hemisphere light gives a cheap fill light from the sky and the ground. A surface that faces up gets the sky color, and a surface that faces down gets the ground color. A surface between them gets a blend. The blend follows the angle between the surface's normal and the light's +Y axis, as three.js's `HemisphereLight` blends it. The light is diffuse only: it gives no highlights, as in three.js.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, time }) => {
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 2 });
  const fill = scene.createHemisphereLight({ skyColor: '#9ec5ff', groundColor: '#5a4632', intensity: 0.8 });

  return {
    onUpdate() {
      // The fill light swells and fades. setIntensity allocates nothing, so it can run every frame.
      fill.setIntensity(0.6 + 0.2 * Math.sin(time.now));
    },
  };
});
```

- Any number of hemisphere lights add up. The engine sums them on the CPU into the ambient light and one color per world axis. So each pixel pays three multiply-adds, however many lights there are, and the same with none.
- `setIntensity`, `setColor` (the sky color) and `setGroundColor` take effect in the next frame. Turning the light turns its sky.
- An environment's light adds to the hemisphere lights' light, as in three.js. The environment's `intensity` and a material's `envIntensity` scale only the environment's light, never a hemisphere light's. This holds for every environment: a file's, the built-in room and the sky's.
- The occlusion map and ambient occlusion darken a hemisphere light's light, as they darken an ambient light's.
- Scene passes and reflection passes draw with the hemisphere lights too.

`timeOfDay` and the sky's environment already give the sky's light. A scene lit by the sky's environment needs no hemisphere light, or it gets the sky's light twice.

## Light from the sky

A directional light gives the sun's own light. The light of the sky around it comes from an environment. [`assets.skyEnvironment()`](assets.md#environments) makes one of the sky that `scene.setBackground({ sky })` draws, and it follows the sky as the sun moves. [`timeOfDay`](scene.md#time-of-day) gives the sun's direction, color and intensity for an hour, and the sky that matches them. At night it gives the moon, and a navy sky lit from the moon's place.

```ts
import { defineSketch, timeOfDay } from '@null3d/engine';

export default defineSketch(async ({ scene, assets }) => {
  const day = timeOfDay(16);
  scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
  scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
  scene.createDirectionalLight({ ...day.light, castShadows: true });
  return {};
});
```

## Shadows

`castShadows: true` and `setCastShadows(true)` make a directional light cast shadows. The first directional light created casts them, and objects need `castShadows` and `receiveShadows` of their own. The `shadow` option and `setShadow` set the light's cascades, map size, distance and biases:

```ts
const sun = scene.createDirectionalLight({
  direction: [-1, -2, -1],
  intensity: 3,
  castShadows: true,
  shadow: { cascades: 3, mapSize: 2048, distance: 100 },
});
sun.setShadow({ bias: 0.02, normalBias: 0.04 });
```

The `distance` default is `'auto'`. The engine follows the farthest surface that receives shadows in the camera's view, rounded up on a ladder. A small scene then gets sharper shadows without naming a distance. Pass a number to fix it, as a port of a scene with its own shadow distance does. See [Shadows](../concepts/shadows.md#settings).

Spot and point lights cast shadows with `castShadows` too. Their `shadow` option and `setShadow` take the biases alone:

```ts
const lamp = scene.createSpotLight({
  position: [0, 6, 0],
  target: [0, 0, 0],
  range: 15,
  intensity: 80,
  castShadows: true,
  shadow: { bias: 0.02 },
});
```

Point lights cast them where the quality preset's `pointLightShadows` is on, as on High and Ultra.

The directional light also draws contact shadows: short shadows from the camera's depth where small objects touch the ground. `contactDistance` sets how far they reach in meters, 0.3 by default, and 0 turns them off. They draw where the quality setting `contactShadowSteps` is above 0, as on High and Ultra.

[Shadows](../concepts/shadows.md) explains cascades, contact shadows, the shadow atlas of spot and point lights, each setting and its default, and the biases.

## Coming from three.js

| three.js | null3D |
| --- | --- |
| `new DirectionalLight(color, intensity)` with a position and a target | `createDirectionalLight({ color, intensity, direction })`, with the target minus the position as `direction`, or `lookAt(target)` |
| `light.target = object`, which the light follows | Call `light.lookAt(x, y, z)` with the object's position when it moves |
| `new PointLight(color, intensity, distance, decay)` | `createPointLight({ color, intensity, range: distance, decay })` |
| `new SpotLight(color, intensity, distance, angle, penumbra, decay)` | `createSpotLight({ color, intensity, range: distance, angle, penumbra, decay, target: [x, y, z] })` |
| `new HemisphereLight(skyColor, groundColor, intensity)` | `createHemisphereLight({ skyColor, groundColor, intensity })`. three.js points the sky from the light's position toward the origin, and null3D along the light's +Y axis, so turn the light where three.js moves it |
| `new AmbientLight(color, intensity)` | `createAmbientLight({ color, intensity })` |
| `new RectAreaLight(color, intensity, width, height)`, with `RectAreaLightUniformsLib.init()` | `createRectAreaLight({ color, intensity, width, height, range })`, with no setup call. It needs a `range` |
| `scene.environment = pmremGenerator.fromScene(skyScene).texture`, again after each change of the sky | `scene.setEnvironment(await assets.skyEnvironment())` once: the map follows `setBackground({ sky })` |
| `pointLight.power = lumens` or `spotLight.power = lumens` | `intensity: lumens, intensityUnit: 'lumen'` at create; `setIntensity` then takes lumens |
| `scene.add(light)` or `group.add(light)` | Nothing for the scene; the `parent` option or `setParent(group)` for a group |
| `light.visible = false` | `light.setVisible(false)` |
| `light.castShadow = true`, `light.shadow.mapSize`, `light.shadow.bias` | `castShadows: true`, and `shadow: { mapSize, bias, normalBias }`, both biases in meters. [Shadows](../concepts/shadows.md) covers the differences. |
| `spotLight.castShadow = true` or `pointLight.castShadow = true`, and `shadow.bias` | `castShadows: true`, and `shadow: { bias, normalBias }` in meters. The quality preset sets the tile size. |

A three.js `distance` of 0 means a light with no end. null3D needs a finite range, so pick the distance where the light no longer matters.

## Related pages

- [Lighting and environment](../concepts/lighting.md): light units, and how the engine finds each frame's lights.
- [Scene](scene.md): creating lights.
- [Objects and transforms](objects.md): the calls that lights share with every object.
- [Materials](materials.md): the standard material, which lights shade, and the unlit material, which they do not.
- [Math helpers](math.md#colors): color conversions.

## API reference

[The API reference](reference/lights.md) lists every export of this page with its type and description. The engine's doc comments make it.
