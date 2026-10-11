---
id: api/reference/lights
title: "Lights: API reference"
status: generated
since: "0.1"
summary: "Every export of the Lights API, from the engine's doc comments."
---

# Lights: API reference

> [Lights](../lights.md) explains these exports. The engine's doc comments make this page.

## `AmbientLight`

Class `AmbientLight`, which extends `Light`.

Light that reaches every surface equally.

## `AmbientLightOptions`

Interface `AmbientLightOptions`, which extends `LightOptions`.

Options for `scene.createAmbientLight`.

| Member | Description |
| --- | --- |
| `intensityUnit?: 'lux'` | The unit of the intensity: `'lux'`, the light that reaches every surface. It is three.js's unit too, so the intensity stays as it is. |

## `DirectionalLight`

Class `DirectionalLight`, which extends `Light`.

Light from one direction, like sunlight. It travels along the light's -Z axis, which `setDirection`, `lookAt` and the light's parents turn. Its position does not matter.

| Member | Description |
| --- | --- |
| `setDirection(x: number, y: number, z: number): void` | Turns the light so that its light travels along (x, y, z), relative to its parent. |
| `setCastShadows(cast: boolean): void` | Makes the light cast shadows, or stop. The default is false. The first directional light created casts them. |
| `setShadow(shadow: DirectionalShadowOptions): void` | Changes how the light's shadows draw. Settings that `shadow` leaves out keep their values. A new cascade count or map size makes the shadow map again, so set them at setup. |

## `DirectionalLightOptions`

Interface `DirectionalLightOptions`, which extends `LightOptions`.

Options for `scene.createDirectionalLight`.

| Member | Description |
| --- | --- |
| `intensityUnit?: 'lux'` | The unit of the intensity: `'lux'`, the light that reaches a surface facing the light, such as 100,000 for direct sunlight. It is three.js's unit too, so the intensity stays as it is. |
| `direction?: Vec3` | The direction the light travels, relative to the parent. The default, (0, -1, 0), points straight down. It sets the light's rotation, so it wins over `rotation`. |
| `castShadows?: boolean` | True makes the light cast shadows, like `setCastShadows(true)`. The default is false. The first directional light created casts them. |
| `shadow?: DirectionalShadowOptions` | How the light's shadows draw, like `setShadow`. Each setting has a default. |

## `DirectionalShadowOptions`

Interface `DirectionalShadowOptions`.

The shadows of a directional light. The camera's view splits into cascades by distance, and each cascade has a shadow map of its own.

| Member | Description |
| --- | --- |
| `cascades?: number` | The cascades, a whole number from 1 to 4. More cascades keep shadows sharp further from the camera, and each draws the shadow casters once more. The default is the quality preset's `shadowCascades`. |
| `mapSize?: number` | Texels on each side of each cascade's shadow map: 256, 512, 1,024, 2,048 or 4,096. The default is the quality preset's `shadowMapSize`. |
| `bias?: number` | How far each receiving surface moves toward the light before its shadow test, in meters, at least 0. One texel of the surface's cascade caps it. A surface takes this times the tangent of its angle to the light, up to twice it. Raise it when surfaces show stripes of shadow on themselves. The default is 0.01. |
| `normalBias?: number` | How far each receiving surface moves along its normal before its shadow test, in meters, at least 0. One texel of the surface's cascade caps it. A surface takes this times the sine of its angle to the light. The default is 0.02. |
| `distance?: number` | The distance from the camera in meters, along its view, out to which shadows fall, above 0. Shadows fade out over the last tenth of it. The camera's far plane ends them sooner. The default is 200. |

## `HemisphereLight`

Class `HemisphereLight`, which extends `Light`.

Light from the sky above and the ground below, which fades from one color to the other with the way a surface faces. The sky lies along the light's +Y axis. `setColor` sets the sky color.

| Member | Description |
| --- | --- |
| `setGroundColor(color: ColorInput): void` | Sets the ground color. Converting a color allocates. |

## `HemisphereLightOptions`

Interface `HemisphereLightOptions`, which extends `NodeOptions`.

Options for `scene.createHemisphereLight`.

| Member | Description |
| --- | --- |
| `skyColor?: ColorInput` | The color of the light from above. The default is white. |
| `groundColor?: ColorInput` | The color of the light from below. The default is white. |
| `intensity?: number` | A factor that scales both colors. The default is 1. |
| `intensityUnit?: 'lux'` | The unit of the intensity: `'lux'`, the light that reaches a surface. It is three.js's unit too, so the intensity stays as it is. |

## `Light`

Class `Light`, which extends `Object3D`.

A light: a scene object that lights the objects around it. Each kind of light has a class of its own. Setters allocate nothing except those that convert a color, so `onUpdate` can animate lights.

| Member | Description |
| --- | --- |
| `setColor(color: ColorInput): void` | Sets the color. Converting a color allocates, so per-frame code sets the intensity instead. |
| `setIntensity(intensity: number): void` | Sets the factor that scales the color, in the unit that the light was created with. |
| `destroy(): void` | Removes the light at the next frame. Its children become roots. |

## `LightOptions`

Interface `LightOptions`, which extends `NodeOptions`.

Options every light takes, besides the options of every node.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The light's color. The default is white. |
| `intensity?: number` | A factor that scales the color, in three.js's units unless the options name another unit. The default is 1. |

## `LightShadowOptions`

Interface `LightShadowOptions`.

The shadows of a point or spot light. A spot light draws its casters' depth into a tile of the shadow atlas, a view from the light that holds its cone. A point light draws into six tiles, one for each face of a cube around it.

| Member | Description |
| --- | --- |
| `bias?: number` | How far each receiving surface moves toward the light before its shadow test, in meters, at least 0. One texel of the light's tile at the surface's distance caps it. A surface takes this times the tangent of its angle to the light, up to twice it. Raise it when surfaces show stripes of shadow on themselves. The default is 0.01. |
| `normalBias?: number` | How far each receiving surface moves along its normal before its shadow test, in meters, at least 0. One texel of the light's tile at the surface's distance caps it. A surface takes this times the sine of its angle to the light. The default is 0.02. |

## `PointLight`

Class `PointLight`, which extends `Light`.

Light from a point in every direction, which fades with distance and ends at its range.

| Member | Description |
| --- | --- |
| `setRange(range: number): void` | Sets the distance in meters where the light ends, above 0. |
| `setDecay(decay: number): void` | Sets how fast the light fades with distance, at least 0: 2 is the physical rate. |
| `setCastShadows(cast: boolean): void` | Makes the light cast shadows, or stop. The default is false. Point lights cast them where the quality preset's `pointLightShadows` is on, and each takes six tiles of `shadowTiles`. |
| `setShadow(shadow: LightShadowOptions): void` | Changes how the light's shadows draw. Settings that `shadow` leaves out keep their values. |

## `PointLightOptions`

Interface `PointLightOptions`, which extends `LightOptions`.

Options for `scene.createPointLight`.

| Member | Description |
| --- | --- |
| `intensityUnit?: 'lumen'` | The unit of the intensity and of `setIntensity`: `'lumen'`, the light's whole output, such as 800 for a 60 W bulb. The engine divides it by 4π for a point light, and by π for a spot light at any cone angle, as three.js's `power` and Filament do. Without it, the intensity is in candela, three.js's unit. |
| `range: number` | The distance in meters where the light ends, above 0. Every point light needs one, because the engine finds the lights near each surface by their ranges. |
| `decay?: number` | How fast the light fades with distance, at least 0. The default, 2, is the physical rate. |
| `castShadows?: boolean` | True makes the light cast shadows, like `setCastShadows(true)`. The default is false. Point lights cast them where the quality preset's `pointLightShadows` is on, as on High and Ultra. |
| `shadow?: LightShadowOptions` | How the light's shadows draw, like `setShadow`. Each setting has a default. |

## `SpotLight`

Class `SpotLight`, which extends `Light`.

Light from a point in a cone, which fades with distance and ends at its range. The cone points along the light's -Z axis, which `setDirection`, `lookAt` and the light's parents turn.

| Member | Description |
| --- | --- |
| `setRange(range: number): void` | Sets the distance in meters where the light ends, above 0. |
| `setDecay(decay: number): void` | Sets how fast the light fades with distance, at least 0: 2 is the physical rate. |
| `setAngle(angle: number): void` | Sets the angle in radians from the light's direction to the edge of its cone: up to π/2. |
| `setPenumbra(penumbra: number): void` | Sets the part of the cone, from 0 to 1, over which the light fades out toward the edge. |
| `setDirection(x: number, y: number, z: number): void` | Turns the light so that its light travels along (x, y, z), relative to its parent. |
| `setCastShadows(cast: boolean): void` | Makes the light cast shadows, or stop. The default is false. The quality preset's `shadowTiles` caps the lights that cast them at once: the lights that look largest from the camera cast them first. |
| `setShadow(shadow: LightShadowOptions): void` | Changes how the light's shadows draw. Settings that `shadow` leaves out keep their values. |

## `SpotLightOptions`

Interface `SpotLightOptions`, which extends `PointLightOptions`.

Options for `scene.createSpotLight`.

| Member | Description |
| --- | --- |
| `direction?: Vec3` | The direction the light travels, relative to the parent. The default, (0, -1, 0), points straight down. It sets the light's rotation, so it wins over `rotation`. |
| `target?: Vec3` | A point the light turns toward. It wins over `direction`. |
| `angle?: number` | The angle in radians from the light's direction to the edge of its cone, above 0 and at most π/2. The default is π/3. |
| `penumbra?: number` | The part of the cone, from 0 to 1, over which the light fades out toward the edge. The default, 0, gives a sharp edge. |
| `castShadows?: boolean` | True makes the light cast shadows, like `setCastShadows(true)`. The default is false. The quality preset's `shadowTiles` caps the lights that cast them at once. |
| `shadow?: LightShadowOptions` | How the light's shadows draw, like `setShadow`. Each setting has a default. |
