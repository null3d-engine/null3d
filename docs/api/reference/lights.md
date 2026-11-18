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

Light from one direction, like sunlight. It travels along the light's -Z axis, which `setDirection`, `lookAt` and the light's parents turn. Its position does not matter. Up to four directional lights light surfaces at once. The first one created casts the shadows, when `castShadows` is on, and up to three more light as fill and rim lights, without shadows. A fifth directional light gives no light.

| Member | Description |
| --- | --- |
| `setDirection(x: number, y: number, z: number): void` | Turns the light so that its light travels along (x, y, z), relative to its parent. |
| `setCastShadows(cast: boolean): void` | Makes the light cast shadows, or stop. The default is false. The first directional light created casts them. |
| `setHeroShadow(hero: Object3D \| null, tileSize?: 1024 \| 2048 \| 4096): void` | Gives `hero` its own shadow map, or takes it away with `null`. The map is a tile of the shadow atlas, fitted tightly to the object along the light, so its shadow keeps far finer texels than the cascades give it. Surfaces near the object read that tile in place of the cascades. The object casts shadows; its light is this light. `tileSize` gives the tile's texels on each side, 1,024, 2,048 or 4,096. Leaving it out keeps the light's value, which starts as the quality preset's `heroTileSize`. |
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
| `distance?: number \| 'auto'` | The distance from the camera in meters, along its view, out to which shadows fall, above 0, or `'auto'`, the default. `'auto'` follows the farthest visible receiver: the engine finds the farthest surface that receives shadows in the camera's view each frame and rounds it up on a ladder of 1.25 times per step, so shadows in a small scene get much finer texels. A number fixes the distance. The engine finds the receiver on the CPU, in the frame that it draws. The camera's far plane ends the shadows sooner, and they fade out over the last tenth of the distance. |
| `contactDistance?: number` | How far contact shadows reach from each surface toward the light, in meters, at least 0. They are short shadows found in the camera's depth, which show where small objects touch the ground: stones, feet, wheels, crates. 0 turns them off for this light. The quality preset's `contactShadowSteps` decides whether they draw. The default is 0.3. |
| `hero?: Object3D \| null` | An object whose shadow the light draws into a tile of its own, at a much finer scale than the cascades, or `null` for none. The tile fits the object's bounds along the light, and surfaces near the object read it in place of the coarser cascades, so a car, a character or a product keeps a sharp shadow. The object must cast shadows. The tile takes a layer of the shadow atlas, which the point and spot lights share, and every layer of the atlas takes the tile's size. The default is none. |
| `heroTileSize?: 1024 \| 2048 \| 4096` | Texels on each side of the hero's tile: 1,024, 2,048 or 4,096. The default is the quality preset's `heroTileSize`. The tile's texels are finer as the number grows. A larger object needs a larger number to keep the ratio of its shadow's detail to the cascades'. The atlas holds the tile, so a larger number takes more memory for every tile of the atlas, and a hero that moves draws the larger tile again in every frame. |
| `intensity?: number` | How much of the light's shadow it draws, from 0 for none to 1, the default, for all of it. The shader mixes each shadow lookup toward full light by the rest, as three.js's `LightShadow.intensity` does. |

## `HemisphereLight`

Class `HemisphereLight`, which extends `Light`.

Light from the sky above and the ground below, which fades from one color to the other with the way a surface faces. The sky lies along the light's +Y axis. `setColor` sets the sky color.

| Member | Description |
| --- | --- |
| `setGroundColor(color: ColorInput): void` | Sets the ground color. It allocates nothing. |

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

A light: a scene object that lights the objects around it. Each kind of light has a class of its own. Setters allocate nothing, colors included, so `onUpdate` can animate lights.

| Member | Description |
| --- | --- |
| `setColor(color: ColorInput): void` | Sets the color. It allocates nothing, so a sketch can change the color in every frame. |
| `setIntensity(intensity: number): void` | Sets the factor that scales the color, in the unit that the light was created with. |
| `destroy(): void` | Removes the light at the next frame. Its children become roots. |

## `LightImagePixels`

Interface `LightImagePixels`.

Pixels of a picture that a light shows, for `RectAreaLight.setImage` and `SpotLight.setMap`: rows from the top, four sRGB bytes per pixel. A spot light's map also takes an engine texture. The engine keeps the picture's detail up to 512 texels a side, and a larger picture is resampled down to that.

| Member | Description |
| --- | --- |
| `width: number` | The width in pixels. |
| `height: number` | The height in pixels. |
| `data: Uint8Array \| Uint8ClampedArray` | The pixels' red, green, blue and alpha, in sRGB. Alpha is ignored. |

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
| `intensity?: number` | How much of the light's shadow it draws, from 0 for none to 1, the default, for all of it. The shader mixes each shadow lookup toward full light by the rest, as three.js's `LightShadow.intensity` does. |

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

## `RectAreaLight`

Class `RectAreaLight`, which extends `Light`.

Light from a rectangle of even brightness, such as a window, a screen or a studio panel. Its light leaves the side that its -Z axis points to, and ends at its range. Surfaces show its whole shape in their highlights, and soft light near it, as three.js's `RectAreaLight` gives. Its intensity is the rectangle's brightness in nits, three.js's unit. It casts no shadows.

| Member | Description |
| --- | --- |
| `setRange(range: number): void` | Sets the distance in meters from the light's middle where its light ends, above 0. |
| `setSize(width: number, height: number): void` | Sets the width along the light's X axis and the height along its Y axis, in meters. |
| `setDirection(x: number, y: number, z: number): void` | Turns the light so that its light leaves along (x, y, z), relative to its parent. |
| `setImage(image: LightImagePixels \| null): void` | Shows a picture over the light's area, such as a shop window or a screen, or `null` to go back to one color. The color and intensity tint it. The light gives out its intensity times the picture's average color, so a mostly dark picture lights little around it. The picture's top row lies along the light's +Y axis, and it reads the right way round from the lit side. The engine keeps the picture's detail up to 512 texels a side, so shiny surfaces show it sharp and rough ones blurred. Up to 32 lights show pictures at once. A new picture allocates and takes up to a few tens of milliseconds, so set it at setup or now and then, not in every frame. |
| `destroy(): void` | Removes the light at the next frame, and frees its picture's place. |

## `RectAreaLightOptions`

Interface `RectAreaLightOptions`, which extends `LightOptions`.

Options for `scene.createRectAreaLight`.

| Member | Description |
| --- | --- |
| `width?: number` | The width in meters, along the light's X axis, above 0. The default is 1. The light's scale does not change it. |
| `height?: number` | The height in meters, along the light's Y axis, above 0. The default is 1. |
| `range: number` | The distance in meters from the light's middle where its light ends, above 0. Every area light needs one, because the engine finds the lights near each surface by their ranges. |
| `direction?: Vec3` | The direction the light leaves the rectangle in, relative to the parent: its -Z axis. The default, (0, -1, 0), points straight down. It sets the light's rotation, so it wins over `rotation`. |
| `target?: Vec3` | A point the light faces. It wins over `direction`. |
| `image?: LightImagePixels` | A picture that the light shows over its area, such as a shop window or a screen, as `setImage` takes it. Without it, the light has one color. |

## `SpotLight`

Class `SpotLight`, which extends `Light`.

Light from a point in a cone, which fades with distance and ends at its range. The cone points along the light's -Z axis, which `setDirection`, `lookAt` and the light's parents turn.

| Member | Description |
| --- | --- |
| `setRange(range: number): void` | Sets the distance in meters where the light ends, above 0. |
| `setDecay(decay: number): void` | Sets how fast the light fades with distance, at least 0: 2 is the physical rate. |
| `setAngle(angle: number): void` | Sets the angle in radians from the light's direction to the edge of its cone: up to π/2. |
| `setPenumbra(penumbra: number): void` | Sets the part of the cone, from 0 to 1, over which the light fades out toward the edge. |
| `setMap(map: LightImagePixels \| Texture \| null): void` | Projects a picture over the light's cone, such as a window frame, a gobo pattern or a projected photograph, or `null` to go back to one color. The color and intensity tint it. The picture fills the square around the cone: a circle in its middle lands on the cone's edge, where the light ends. The picture's top row lies along the world's up, as three.js aims a spot light's map. The engine keeps the picture's detail up to 512 texels a side, so a small gobo costs less memory than a detailed photograph. Give sRGB pixels, or a texture that the engine copies once: a texture larger than 512 texels a side is reduced, and one that changes every frame, such as a video's or a render pass's, throws E1112, because the copy would show a single frame. A surface far from the light shows the picture blurred. Up to 32 lights show pictures at once, and rectangle and spot lights share those places. A new picture takes up to a few tens of milliseconds, so set it at setup or now and then, not in every frame. |
| `destroy(): void` | Removes the light at the next frame, and frees its picture's place. |
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
| `map?: LightImagePixels \| Texture` | A picture that the light projects over its cone, such as a window frame, a gobo pattern or a projected photograph, as `setMap` takes it: sRGB pixels, or a texture. The color and intensity tint it. Without it, the light has one color in the cone. |
| `castShadows?: boolean` | True makes the light cast shadows, like `setCastShadows(true)`. The default is false. The quality preset's `shadowTiles` caps the lights that cast them at once. |
| `shadow?: LightShadowOptions` | How the light's shadows draw, like `setShadow`. Each setting has a default. |

## `TubeLight`

Class `TubeLight`, which extends `Light`.

Light from a glowing tube, such as a neon or fluorescent tube, in every direction around it, out to its range. The tube runs along the light's -Z axis. Its intensity is the tube's brightness in nits, as for a rectangle light. It casts no shadows.

| Member | Description |
| --- | --- |
| `setRange(range: number): void` | Sets the distance in meters from the tube's middle where its light ends, above 0. |
| `setSize(length: number, radius: number): void` | Sets the tube's length along the light's -Z axis and its radius, in meters. |
| `setDirection(x: number, y: number, z: number): void` | Turns the tube so that it runs along (x, y, z), relative to its parent. |

## `TubeLightOptions`

Interface `TubeLightOptions`, which extends `LightOptions`.

Options for `scene.createTubeLight`.

| Member | Description |
| --- | --- |
| `length?: number` | The tube's length in meters, along the light's -Z axis, above 0. The default is 1. The light's scale does not change it. |
| `radius?: number` | The tube's radius in meters, above 0. The default is 0.025, a thin neon tube. |
| `range: number` | The distance in meters from the tube's middle where its light ends, above 0. Every area light needs one, because the engine finds the lights near each surface by their ranges. |
| `direction?: Vec3` | The direction the tube runs along, relative to the parent: its -Z axis. The default, (0, -1, 0), stands the tube upright. It sets the light's rotation, so it wins over `rotation`. |
| `target?: Vec3` | A point the tube points toward. It wins over `direction`. |
