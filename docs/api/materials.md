---
id: api/materials
title: Materials
status: planned
since: "0.1"
summary: "standard, unlit, shader, shadowCatcher; every option."
---

<!-- null3d:placeholder -->

# Materials

> Planned for null3D 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists the APIs the engine has now. The rest of the page is not written yet.

This page will cover: standard, unlit, shader, shadowCatcher; every option.

## API reference

### `ColorInput`

```ts
type ColorInput = string | number | readonly [number, number, number];
```

A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three linear components from 0 to 1, such as `[1, 0.26, 0.05]`. Hex values are sRGB, as on the web and in three.js, and the engine converts them to linear values.

### `Material`

Class `Material`.

A material: how the surfaces of the objects that use it look.

| Member | Description |
| --- | --- |
| `set(options: MaterialOptions): void` | Changes the material's values; cheap at any time. |

### `MaterialOptions`

Interface `MaterialOptions`.

Options every material takes.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The base color: a hex string or a number in sRGB, or three linear components from 0 to 1. |
| `opacity?: number` | How opaque the surface is, from 0 to 1. The default is 1. This version stores the value but draws every material opaque. |

### `Materials`

Class `Materials`.

Material factories. The standard material shades diffuse light only, as three.js's `MeshLambertMaterial` does. Metalness and roughness are planned for null3D 0.1.

| Member | Description |
| --- | --- |
| `standard(options: MaterialOptions = {}): Material` | A lit material. |
| `unlit(options: MaterialOptions = {}): Material` | A material that ignores lights and shows its color unlit, like three.js's `MeshBasicMaterial`. The exposure and the tone mapping still apply to it, as three.js applies them to that material. |
