---
id: api/materials
title: Materials
status: experimental
since: "0.1"
summary: "standard, unlit, shader, shadowCatcher; every option."
---

# Materials

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Textures, transparency, `materials.shader`, `materials.shadowCatcher`, and every option besides `color` and `opacity`, such as `metalness` and `roughness`, are not built yet, so coding agents must not use them.

A material sets how the surfaces of the objects that use it look. `materials.standard` makes a lit material, and `materials.unlit` makes one that ignores lights. Create materials in the setup, and share each one between the objects that look alike.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, page }) => {
  // A camera and lights, as on the Scene page, go here.
  const paint = materials.standard({ color: '#e8554e' });
  const lamp = materials.unlit({ color: '#ffd35c' });
  const car = scene.createMesh({ mesh: geometry.box({ width: 2, height: 1, depth: 4 }), material: paint });
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
| `materials.standard(options)` | Lit by the scene's lights, with the formula of three.js's `MeshLambertMaterial`: soft light with no highlights |
| `materials.unlit(options)` | Its color as it is, whatever the lights, like three.js's `MeshBasicMaterial` |

Without lights, a standard material draws black. [Lights](lights.md) explains how light colors and intensities shade it.

## Color

`color` takes an sRGB color, as three.js does: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three components from 0 to 1. The default is white. The engine converts the color to linear once, when the call receives it. Any other value, such as the name `'red'`, throws E1204.

## Changing a material

`set(options)` changes a material at any time, and every object that uses the material changes with it. It takes the options of the factory, and it changes only the options that you pass. The others keep their values, so `set({ opacity: 0.5 })` keeps the color.

Converting a new color allocates a little, as a light's `setColor` does, so do not change the color in every frame. The kind of material, standard or unlit, is fixed when you create it. To change one object alone, give it another material with `mesh.setMaterial(material)`.

## Opacity

`opacity` goes from 0 to 1, and the default is 1. When a factory or `set` gets a value outside that range, development builds throw E1108. This version stores the opacity, but it draws every material opaque.

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

A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three sRGB components from 0 to 1.

### `Material`

Class `Material`.

A material: how the surfaces of the objects that use it look.

| Member | Description |
| --- | --- |
| `set(options: MaterialOptions): void` | Changes the options that it gets and keeps the values of the others. Every object that uses the material changes with it. Converting a new color allocates. |

### `MaterialOptions`

Interface `MaterialOptions`.

Options every material takes.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The base color: a hex string, a number, or three sRGB components from 0 to 1. |
| `opacity?: number` | How opaque the surface is, from 0 to 1. The default is 1. This version stores the value but draws every material opaque. |

### `Materials`

Class `Materials`.

Material factories. The standard material shades diffuse light only, as three.js's `MeshLambertMaterial` does. Metalness and roughness are planned for null3D 0.1.

| Member | Description |
| --- | --- |
| `standard(options: MaterialOptions = {}): Material` | A lit material. |
| `unlit(options: MaterialOptions = {}): Material` | A material that ignores lights and shows its color as it is, like three.js's `MeshBasicMaterial`. |

<!-- null3d:api:end -->
