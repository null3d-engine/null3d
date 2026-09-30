---
id: api/materials
title: Materials
status: experimental
since: "0.1"
summary: "standard, unlit, shader, shadowCatcher; every option."
---

# Materials

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Texture maps, transparency, `materials.shader` and `materials.shadowCatcher` are not built yet, so coding agents must not use them.

A material sets how the surfaces of the objects that use it look. `materials.standard` makes a lit material, and `materials.unlit` makes one that ignores lights. Create materials in the setup, and share each one between the objects that look alike.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, page }) => {
  // A camera and lights, as on the Scene page, go here.
  const paint = materials.standard({ color: '#e8554e', roughness: 0.35 });
  const chrome = materials.standard({ color: '#d8dce4', metalness: 1, roughness: 0.2 });
  const lamp = materials.unlit({ color: '#ffd35c' });
  const car = scene.createMesh({ mesh: geometry.box({ width: 2, height: 1, depth: 4 }), material: paint });
  scene.createMesh({ mesh: geometry.box({ width: 2.1, height: 0.2, depth: 0.2 }), material: chrome, parent: car, position: [0, -0.3, 2] });
  scene.createMesh({ mesh: geometry.sphere({ radius: 0.2 }), material: lamp, parent: car, position: [0, 0.6, 2] });

  // The page picks a color: every object that uses the material changes.
  page.onMessage((type, data) => {
    if (type === 'paint') paint.set({ color: data as string });
  });
});
```

## The two materials

| Factory | How it looks |
| --- | --- |
| `materials.standard(options)` | Lit by the scene's lights with glTF's metallic-roughness model and the formulas of three.js's `MeshStandardMaterial` |
| `materials.unlit(options)` | Its color as it is, whatever the lights, like three.js's `MeshBasicMaterial`. The exposure and the tone mapping still apply to it. |

Without lights, a standard material draws black, apart from its emissive color. [Lights](lights.md) explains how light colors and intensities shade it.

## Standard values

| Option | Range | Default | What it does |
| --- | --- | --- | --- |
| `color` | A [color](#color) | White | The base color: the color of diffuse light, and of a metal's reflections |
| `opacity` | 0 to 1 | 1 | How opaque the surface is |
| `metalness` | 0 to 1 | 0 | 0 is a surface such as paint or plastic, and 1 is a metal |
| `roughness` | 0 to 1 | 1 | 0 is a mirror finish with a small, sharp highlight, and 1 is fully matte |
| `emissive` | A [color](#color) | Black | Light that the surface gives off itself, whatever the lights |
| `emissiveIntensity` | 0 or more | 1 | The factor of the emissive color |

The values have the meaning and the defaults of three.js's `MeshStandardMaterial`. A metal takes its color from what it reflects. The scene has no environment map yet, so a smooth metal shows little more than its highlights.

## Color

`color` and `emissive` take a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three components from 0 to 1. Hex values are sRGB, as three.js reads them, and the engine converts them to linear once, when the call receives them. Three components are linear, as three.js's `Color.setRGB` reads them. Any other value, such as the name `'red'`, throws E1204. [Color management](../concepts/color-management.md) covers both color spaces.

## Changing a material

`set(options)` changes a material's values at any time, and every object that uses the material changes with it. It changes only the options that you pass. The others keep their values, so `set({ roughness: 0.5 })` keeps the color. A standard material's `set` takes every value in the table above, and an unlit material's `set` takes `color` and `opacity`.

`set` checks every value before it changes any, so a call that throws changes nothing. Converting a new color allocates a little, as a light's `setColor` does, so do not change a color in every frame. To change one object alone, give it another material with `mesh.setMaterial(material)`.

## Options fixed at creation

These options choose the material's shader or its pipeline, so they are fixed when you create the material. A change would compile a new pipeline, which can make a frame late. Make one material for each combination instead.

| Option | Materials | Default | What it does |
| --- | --- | --- | --- |
| `doubleSided` | Both | false | Draws both faces of each triangle. A back face lights as if it faced the camera, as with three.js's `side: DoubleSide` |
| `vertexColors` | Both | false | Multiplies the base color by the mesh's vertex colors, on meshes that have them. [Geometry](geometry.md) makes meshes with colors |
| `flatShading` | Standard | false | Lights each triangle with the normal of its face, so the mesh looks faceted |

A material with `vertexColors` draws a mesh without colors in its base color alone. The kind of material, standard or unlit, is fixed too.

## Ranges

`opacity`, `metalness` and `roughness` go from 0 to 1, and `emissiveIntensity` takes 0 or more. When a factory or `set` gets a value outside its range, development builds throw E1108. This version stores the opacity, but it draws every material opaque.

## Limits

One engine holds up to 1,024 materials, and a material lasts as long as the engine. One more throws E1501. Create materials once in the setup and share them, and never create one per object or per frame.

## Related pages

- [Scene](scene.md): creating meshes with a material.
- [Objects and transforms](objects.md): `setMaterial` on a mesh.
- [Lights](lights.md): what lights a standard material.
- [Math helpers](math.md#colors): sRGB and linear colors.

## API reference

<!-- null3d:api:start -->

### `ColorInput`

```ts
type ColorInput = string | number | readonly [number, number, number];
```

A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three linear components from 0 to 1, such as `[1, 0.26, 0.05]`. Hex values are sRGB, as on the web and in three.js, and the engine converts them to linear values. The color helpers, such as `color.fromHsl`, give linear components.

### `Material`

Class `Material`.

A material: how the surfaces of the objects that use it look. `Values` are the options that `set` changes.

| Member | Description |
| --- | --- |
| `set(options: Values): void` | Changes the values that it gets and keeps the others. Every object that uses the material changes with it. Converting a new color allocates. |

### `MaterialFeatures`

Interface `MaterialFeatures`.

The options that choose how a material's shader and pipeline draw it. They are fixed when the material is created, because a change would compile a new pipeline.

| Member | Description |
| --- | --- |
| `doubleSided?: boolean` | Draws both faces of each triangle. Back faces light as if they faced the camera. The default is false. |
| `vertexColors?: boolean` | Multiplies the base color by the mesh's vertex colors, on meshes that have them. The default is false. |

### `MaterialOptions`

Interface `MaterialOptions`.

Options every material takes.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The base color: a hex string or a number in sRGB, or three linear components from 0 to 1. |
| `opacity?: number` | How opaque the surface is, from 0 to 1. The default is 1. This version stores the value but draws every material opaque. |

### `Materials`

Class `Materials`.

Material factories. The standard material follows glTF's metallic-roughness model and shades with the formulas of three.js's `MeshStandardMaterial`. The unlit material shows its color as three.js's `MeshBasicMaterial` does.

| Member | Description |
| --- | --- |
| `standard(options: StandardOptions = {}): Material<StandardValues>` | A lit material with glTF's metallic-roughness model, like three.js's `MeshStandardMaterial`. |
| `unlit(options: UnlitOptions = {}): Material` | A material that ignores lights and shows its color unlit, like three.js's `MeshBasicMaterial`. The exposure and the tone mapping still apply to it, as three.js applies them to that material. |

### `StandardOptions`

Interface `StandardOptions`, which extends `StandardValues`, `MaterialFeatures`.

Options of `materials.standard`.

| Member | Description |
| --- | --- |
| `flatShading?: boolean` | Lights each triangle with one normal, the normal of its face, so the mesh looks faceted. It is fixed when the material is created. The default is false. |

### `StandardValues`

Interface `StandardValues`, which extends `MaterialOptions`.

The values of a standard material, which `set` changes at any time.

| Member | Description |
| --- | --- |
| `metalness?: number` | How much the surface acts like a metal, from 0 to 1. The default is 0. |
| `roughness?: number` | How rough the surface is, from 0 (a mirror) to 1 (fully matte). The default is 1. |
| `emissive?: ColorInput` | The color the surface gives off without any light, in the forms that `color` takes. The default is black, which gives off nothing. |
| `emissiveIntensity?: number` | The factor of the emissive color: 0 or more. The default is 1. |

### `UnlitOptions`

Interface `UnlitOptions`, which extends `MaterialOptions`, `MaterialFeatures`.

Options of `materials.unlit`.

<!-- null3d:api:end -->
