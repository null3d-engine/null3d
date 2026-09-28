---
id: api/materials
title: Materials
status: planned
since: "0.1"
summary: "standard, unlit, shader, shadowCatcher; every option."
---

<!-- sokko3d:placeholder -->

# Materials

> Planned for sokko3d 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists what the engine in this repository has so far, and the rest of the page is not written yet.

This page will cover: standard, unlit, shader, shadowCatcher; every option.

## API reference

This reference is generated from the TSDoc comments in `packages/engine/src`. To change it, edit the comments.

### `ColorInput`

```ts
type ColorInput = string | number | readonly [number, number, number];
```

A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three sRGB components from 0 to 1.

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
| `color?: ColorInput` | The base color: a hex string, a number, or three sRGB components from 0 to 1. |
| `opacity?: number` | How opaque the surface is, from 0 to 1. The default is 1. This version stores the value but draws every material opaque. |

### `Materials`

Class `Materials`.

Material factories. In this version the standard material shades diffuse light only, as three.js's `MeshLambertMaterial` does; metalness and roughness arrive with physically based shading.

| Member | Description |
| --- | --- |
| `standard(options: MaterialOptions = {}): Material` | A lit material. |
| `unlit(options: MaterialOptions = {}): Material` | A material that ignores lights and shows its color as it is, like three.js's `MeshBasicMaterial`. |
