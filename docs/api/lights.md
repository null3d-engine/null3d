---
id: api/lights
title: Lights
status: experimental
since: "0.1"
summary: "Directional, point, spot, hemisphere and ambient lights; shadow options."
---

# Lights

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Point, spot and hemisphere lights, shadows, and a second light of either kind are not built yet, so coding agents must not use them.

A scene has one directional light and one ambient light. The standard material reflects both, and the unlit material ignores them.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, time }) => {
  const sun = scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#fff4e0', intensity: 3 });
  scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

  return {
    onUpdate() {
      // The sun circles the scene.
      const angle = time.now * 0.2;
      sun.setDirection(Math.cos(angle), -1, Math.sin(angle));
    },
  };
});
```

## The directional light

A directional light sends parallel light from one direction, as the sun does. The `direction` option is the way that the light travels, and the engine scales it to length 1. The default, (0, -1, 0), points straight down.

A directional light has no position. three.js aims its directional light from the light's position toward a target. In null3D, pass the target minus the position as the direction.

## The ambient light

An ambient light adds the same light to every surface, whatever way the surface faces. It keeps the sides that the directional light misses from going black.

## Color and intensity

Both lights take `color` and `intensity`. The color is a hex string, a number, or three sRGB components from 0 to 1, and the default is white. The intensity scales the color, and the default is 1.

The standard material uses the lighting formulas of three.js's `MeshStandardMaterial`, so the same colors and intensities give the same result in both engines. Take a white directional light with an intensity of π, about 3.14, and no ambient light. A rough surface that faces it shows nearly its full color.

`setIntensity` and `setDirection` allocate nothing, so `onUpdate` can call them in every frame. `setColor` converts the color and allocates, so animate the intensity instead.

## One light of each kind

`createDirectionalLight` sets the scene's one directional light, so a second call replaces the first. The old light object still controls the same light, and the last call to either object wins, so keep one object for each kind. The ambient light works the same way.

Lights are not objects in this version. They have no position, parent, visibility or `destroy`. To turn a light off, set its intensity to 0. Without lights, standard materials draw black.

## Related pages

- [Scene](scene.md): creating lights.
- [Materials](materials.md): the standard material, which lights shade, and the unlit material, which they do not.
- [Math helpers](math.md#colors): color conversions.

## API reference

<!-- null3d:api:start -->

### `AmbientLight`

Class `AmbientLight`.

Light that reaches every surface equally. Its intensity setter allocates nothing.

| Member | Description |
| --- | --- |
| `setColor(color: ColorInput): void` | Sets the color. Converting a color allocates, so per-frame code sets the intensity instead. |
| `setIntensity(intensity: number): void` | Sets the factor that scales the color. |

### `DirectionalLight`

Class `DirectionalLight`.

Light arriving from one direction, like sunlight. Its direction and intensity setters allocate nothing.

| Member | Description |
| --- | --- |
| `setDirection(x: number, y: number, z: number): void` | Sets the direction the light travels. |
| `setColor(color: ColorInput): void` | Sets the color. Converting a color allocates, so per-frame code sets the intensity instead. |
| `setIntensity(intensity: number): void` | Sets the factor that scales the color. |

### `DirectionalLightOptions`

Interface `DirectionalLightOptions`, which extends `LightOptions`.

Options for `scene.createDirectionalLight`.

| Member | Description |
| --- | --- |
| `direction?: Vec3` | The direction the light travels. The default, (0, -1, 0), points straight down. |

### `LightOptions`

Interface `LightOptions`.

Options every light takes.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The light's color. The default is white. |
| `intensity?: number` | A factor that scales the color. The default is 1. |

<!-- null3d:api:end -->
