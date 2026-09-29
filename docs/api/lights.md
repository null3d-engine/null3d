---
id: api/lights
title: Lights
status: planned
since: "0.1"
summary: "Directional, point, spot, hemisphere and ambient lights; shadow options."
---

<!-- null3d:placeholder -->

# Lights

> Planned for null3D 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists the APIs the engine has now. The rest of the page is not written yet.

This page will cover: Directional, point, spot, hemisphere and ambient lights; shadow options.

## API reference

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
