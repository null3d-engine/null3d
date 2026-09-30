---
id: api/lights
title: Lights
status: experimental
since: "0.1"
summary: "Directional, point, spot, hemisphere and ambient lights; shadow options."
---

# Lights

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Point, spot and hemisphere lights do not light surfaces yet, and surfaces show one directional light. Shadows are not built yet either, so `castShadows` only stores the setting. Coding agents must not rely on these parts.

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
| `createDirectionalLight(options)` | `DirectionalLight` | Parallel light from one direction, like sunlight | `direction`, `castShadows` |
| `createPointLight(options)` | `PointLight` | Light from a point in every direction, out to its range | `range` (required), `decay`, `castShadows` |
| `createSpotLight(options)` | `SpotLight` | Light from a point in a cone, out to its range | `range` (required), `angle`, `penumbra`, `decay`, `direction`, `target`, `castShadows` |
| `createHemisphereLight(options)` | `HemisphereLight` | Light from the sky above and the ground below | `skyColor`, `groundColor` |
| `createAmbientLight(options)` | `AmbientLight` | The same light on every surface | |

Every light takes `color` and `intensity`, except the hemisphere light, which takes `skyColor`, `groundColor` and `intensity`. Every light also takes the options of every object: `name`, `position`, `rotation`, `scale`, `parent`, `dynamic` and `layers`. [Objects and transforms](objects.md) describes them.

## Where a light points

Directional and spot lights send their light along their -Z axis, the way a camera looks. The `direction` option and `setDirection` turn that axis to a direction relative to the light's parent. `lookAt` turns it toward a point. A spot light's `target` option does the same when you create the light. The default points straight down, (0, -1, 0). Parents turn a light with them, as they turn any object.

A directional light's position does not matter: only its direction does. The sky of a hemisphere light lies along its +Y axis, which points straight up until you turn the light.

A light's scale changes neither its range nor its cone.

## Color, intensity and units

Each color is a hex string, a number, or three sRGB components from 0 to 1, and the default is white. The intensity scales the color, and the default is 1. A hemisphere light's intensity scales both of its colors.

Units follow three.js since r155. The intensity of a point or spot light is in candela. A directional light's intensity is the light that reaches a surface facing it. The standard material uses the lighting formulas of three.js's `MeshStandardMaterial`, so the same colors and intensities give the same result in both engines. Take a white directional light with an intensity of π, about 3.14, and no ambient light. A rough surface that faces it shows nearly its full color. [Lighting and environment](../concepts/lighting.md) covers the units in full.

A point or spot light ends at its `range`, in meters. It has no default, because the engine finds the lights near each surface by their ranges. Its light fades with distance by `decay`, and the default, 2, is the physical rate. A spot light's `angle` goes from its direction to the edge of its cone, in radians, up to π/2, and the default is π/3. Its `penumbra`, from 0 to 1, is the part of the cone over which the light fades out toward the edge.

Every setter allocates nothing except `setColor` and `setGroundColor`, which convert the color. So `onUpdate` can call `setIntensity`, `setDirection`, `setRange` and the others in every frame. Set colors at setup, and animate intensities.

## Which lights reach surfaces

In this version:

- Surfaces show one directional light: the first one you created that is visible and shares a layer with the camera.
- Every ambient light that is visible and shares a layer with the camera adds its light.
- Point, spot and hemisphere lights are stored. Each frame the engine finds the point and spot lights whose ranges reach into the camera's view. They do not light surfaces yet.
- Without lights, standard materials draw black.

To turn a light off, hide it with `setVisible(false)`, set its intensity to 0, or destroy it. A light lights a camera's view only when their layer masks share a bit, as in three.js. [Render layers](../concepts/render-layers.md) explains masks.

## Shadows

`castShadows: true` and `setCastShadows(true)` mark a directional, point or spot light as one that casts shadows. This version stores the setting and draws no shadows. When shadows draw, one directional light per scene casts them.

## Coming from three.js

| three.js | null3D |
| --- | --- |
| `new DirectionalLight(color, intensity)` with a position and a target | `createDirectionalLight({ color, intensity, direction })`, with the target minus the position as `direction`, or `lookAt(target)` |
| `light.target = object`, which the light follows | Call `light.lookAt(x, y, z)` with the object's position when it moves |
| `new PointLight(color, intensity, distance, decay)` | `createPointLight({ color, intensity, range: distance, decay })` |
| `new SpotLight(color, intensity, distance, angle, penumbra, decay)` | `createSpotLight({ color, intensity, range: distance, angle, penumbra, decay, target: [x, y, z] })` |
| `new HemisphereLight(skyColor, groundColor, intensity)` | `createHemisphereLight({ skyColor, groundColor, intensity })` |
| `new AmbientLight(color, intensity)` | `createAmbientLight({ color, intensity })` |
| `scene.add(light)` or `group.add(light)` | Nothing for the scene; the `parent` option or `setParent(group)` for a group |
| `light.visible = false` | `light.setVisible(false)` |

A three.js `distance` of 0 means a light with no end. null3D needs a finite range, so pick the distance where the light no longer matters.

## Related pages

- [Lighting and environment](../concepts/lighting.md): light units, and how the engine finds each frame's lights.
- [Scene](scene.md): creating lights.
- [Objects and transforms](objects.md): the calls that lights share with every object.
- [Materials](materials.md): the standard material, which lights shade, and the unlit material, which they do not.
- [Math helpers](math.md#colors): color conversions.

## API reference

<!-- null3d:api:start -->

### `AmbientLight`

Class `AmbientLight`, which extends `Light`.

Light that reaches every surface equally.

### `DirectionalLight`

Class `DirectionalLight`, which extends `Light`.

Light from one direction, like sunlight. It travels along the light's -Z axis, which `setDirection`, `lookAt` and the light's parents turn. Its position does not matter.

| Member | Description |
| --- | --- |
| `setDirection(x: number, y: number, z: number): void` | Turns the light so that its light travels along (x, y, z), relative to its parent. |
| `setCastShadows(cast: boolean): void` | Makes the light cast shadows, or stop. The default is false. This version stores the setting but draws no shadows yet. |

### `DirectionalLightOptions`

Interface `DirectionalLightOptions`, which extends `LightOptions`.

Options for `scene.createDirectionalLight`.

| Member | Description |
| --- | --- |
| `direction?: Vec3` | The direction the light travels, relative to the parent. The default, (0, -1, 0), points straight down. It sets the light's rotation, so it wins over `rotation`. |
| `castShadows?: boolean` | True makes the light cast shadows, like `setCastShadows(true)`. The default is false. This version stores the setting but draws no shadows yet. |

### `HemisphereLight`

Class `HemisphereLight`, which extends `Light`.

Light from the sky above and the ground below, which fades from one color to the other with the way a surface faces. The sky lies along the light's +Y axis. `setColor` sets the sky color.

| Member | Description |
| --- | --- |
| `setGroundColor(color: ColorInput): void` | Sets the ground color. Converting a color allocates. |

### `HemisphereLightOptions`

Interface `HemisphereLightOptions`, which extends `NodeOptions`.

Options for `scene.createHemisphereLight`.

| Member | Description |
| --- | --- |
| `skyColor?: ColorInput` | The color of the light from above. The default is white. |
| `groundColor?: ColorInput` | The color of the light from below. The default is white. |
| `intensity?: number` | A factor that scales both colors. The default is 1. |

### `Light`

Class `Light`, which extends `Object3D`.

A light: a scene object that lights the objects around it. Each kind of light has a class of its own. Setters allocate nothing except those that convert a color, so `onUpdate` can animate lights.

| Member | Description |
| --- | --- |
| `setColor(color: ColorInput): void` | Sets the color. Converting a color allocates, so per-frame code sets the intensity instead. |
| `setIntensity(intensity: number): void` | Sets the factor that scales the color. |
| `destroy(): void` | Removes the light at the next frame. Its children become roots. |

### `LightOptions`

Interface `LightOptions`, which extends `NodeOptions`.

Options every light takes, besides the options of every node.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The light's color. The default is white. |
| `intensity?: number` | A factor that scales the color. The default is 1. |

### `PointLight`

Class `PointLight`, which extends `Light`.

Light from a point in every direction, which fades with distance and ends at its range.

| Member | Description |
| --- | --- |
| `setRange(range: number): void` | Sets the distance in meters where the light ends, above 0. |
| `setDecay(decay: number): void` | Sets how fast the light fades with distance, at least 0: 2 is the physical rate. |
| `setCastShadows(cast: boolean): void` | Makes the light cast shadows, or stop. The default is false. This version stores the setting but draws no shadows yet. |

### `PointLightOptions`

Interface `PointLightOptions`, which extends `LightOptions`.

Options for `scene.createPointLight`.

| Member | Description |
| --- | --- |
| `range: number` | The distance in meters where the light ends, above 0. Every point light needs one, because the engine finds the lights near each surface by their ranges. |
| `decay?: number` | How fast the light fades with distance, at least 0. The default, 2, is the physical rate. |
| `castShadows?: boolean` | True makes the light cast shadows, like `setCastShadows(true)`. The default is false. This version stores the setting but draws no shadows yet. |

### `SpotLight`

Class `SpotLight`, which extends `Light`.

Light from a point in a cone, which fades with distance and ends at its range. The cone points along the light's -Z axis, which `setDirection`, `lookAt` and the light's parents turn.

| Member | Description |
| --- | --- |
| `setRange(range: number): void` | Sets the distance in meters where the light ends, above 0. |
| `setDecay(decay: number): void` | Sets how fast the light fades with distance, at least 0: 2 is the physical rate. |
| `setAngle(angle: number): void` | Sets the angle in radians from the light's direction to the edge of its cone: up to π/2. |
| `setPenumbra(penumbra: number): void` | Sets the part of the cone, from 0 to 1, over which the light fades out toward the edge. |
| `setDirection(x: number, y: number, z: number): void` | Turns the light so that its light travels along (x, y, z), relative to its parent. |
| `setCastShadows(cast: boolean): void` | Makes the light cast shadows, or stop. The default is false. This version stores the setting but draws no shadows yet. |

### `SpotLightOptions`

Interface `SpotLightOptions`, which extends `PointLightOptions`.

Options for `scene.createSpotLight`.

| Member | Description |
| --- | --- |
| `direction?: Vec3` | The direction the light travels, relative to the parent. The default, (0, -1, 0), points straight down. It sets the light's rotation, so it wins over `rotation`. |
| `target?: Vec3` | A point the light turns toward. It wins over `direction`. |
| `angle?: number` | The angle in radians from the light's direction to the edge of its cone, above 0 and at most π/2. The default is π/3. |
| `penumbra?: number` | The part of the cone, from 0 to 1, over which the light fades out toward the edge. The default, 0, gives a sharp edge. |

<!-- null3d:api:end -->
