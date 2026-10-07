---
id: api/lights
title: Lights
status: experimental
since: "0.1"
summary: "Directional, point, spot, hemisphere and ambient lights; shadow options."
---

# Lights

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Hemisphere lights do not light surfaces yet, and surfaces show one directional light. That light, spot lights and point lights cast shadows. Coding agents must not rely on these parts.

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

Every light takes `color` and `intensity`, except the hemisphere light, which takes `skyColor`, `groundColor` and `intensity`. Every light also takes the options of every object: `name`, `position`, `rotation`, `scale`, `parent`, `dynamic` and `layers`. [Objects and transforms](objects.md) describes them.

## Where a light points

Directional and spot lights send their light along their -Z axis, the way a camera looks. The `direction` option and `setDirection` turn that axis to a direction relative to the light's parent. `lookAt` turns it toward a point. A spot light's `target` option does the same when you create the light. The default points straight down, (0, -1, 0). Parents turn a light with them, as they turn any object.

A directional light's position does not matter: only its direction does. The sky of a hemisphere light lies along its +Y axis, which points straight up until you turn the light.

A light's scale changes neither its range nor its cone.

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

Every setter allocates nothing except `setColor` and `setGroundColor`, which convert the color. So `onUpdate` can call `setIntensity`, `setDirection`, `setRange` and the others in every frame. Set colors at setup, and animate intensities.

## Which lights reach surfaces

In this version:

- Surfaces show one directional light: the first one you created that is visible and shares a layer with the camera.
- Every ambient light that is visible and shares a layer with the camera adds its light.
- Point and spot lights light the surfaces that their ranges reach. Each frame the engine finds the ones whose ranges reach into the camera's view. It lists each one in the clusters of the view that it reaches. The camera lists up to 1,024 of them, the nearest, and up to 128 in each cluster. [Lighting and environment](../concepts/lighting.md#clustered-forward-shading) explains clusters.
- Hemisphere lights are stored. They do not light surfaces yet.
- Without lights, standard materials draw black.

To turn a light off, hide it with `setVisible(false)`, set its intensity to 0, or destroy it. A light lights a camera's view only when their layer masks share a bit, as in three.js. [Render layers](../concepts/render-layers.md) explains masks.

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

Point lights cast them where the quality preset's `pointLightShadows` is on, as on High and Ultra. [Shadows](../concepts/shadows.md) explains cascades, the shadow atlas of spot and point lights, each setting and its default, and the biases.

## Coming from three.js

| three.js | null3D |
| --- | --- |
| `new DirectionalLight(color, intensity)` with a position and a target | `createDirectionalLight({ color, intensity, direction })`, with the target minus the position as `direction`, or `lookAt(target)` |
| `light.target = object`, which the light follows | Call `light.lookAt(x, y, z)` with the object's position when it moves |
| `new PointLight(color, intensity, distance, decay)` | `createPointLight({ color, intensity, range: distance, decay })` |
| `new SpotLight(color, intensity, distance, angle, penumbra, decay)` | `createSpotLight({ color, intensity, range: distance, angle, penumbra, decay, target: [x, y, z] })` |
| `new HemisphereLight(skyColor, groundColor, intensity)` | `createHemisphereLight({ skyColor, groundColor, intensity })` |
| `new AmbientLight(color, intensity)` | `createAmbientLight({ color, intensity })` |
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

<!-- null3d:api:start -->
<!-- null3d:api:end -->
