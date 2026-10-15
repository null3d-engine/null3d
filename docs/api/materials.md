---
id: api/materials
title: Materials
status: experimental
since: "0.1"
summary: "standard, unlit, shader, shadowCatcher; every option."
---

# Materials

> Roadmap step 0.1, first released in null3D 0.1.0. Step 0.2 adds typed uniforms, custom material textures, `destroy`, the specular and index of refraction values, transmission, decals, the weighted blending, the clear coat and sheen layers, and the shadow catcher. The API is experimental, so it can still change between versions. `materials.shader` takes no standard texture maps. Coding agents must not use the parts that are not built.

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

## The materials

| Factory | How it looks |
| --- | --- |
| `materials.standard(options)` | Lit by the scene's lights with glTF's metallic-roughness model and the formulas of three.js's `MeshStandardMaterial` |
| `materials.unlit(options)` | Its color as it is, whatever the lights, like three.js's `MeshBasicMaterial`. The exposure and the tone mapping still apply to it. |
| `materials.shader(options)` | A standard material whose WGSL changes its look before the engine lights it, or moves its vertices |
| `materials.shadowCatcher(options)` | Only the shadows that fall on it, as three.js's `ShadowMaterial` |
| `materials.decal(options)` | A standard material that a box projects onto the surfaces inside it, like three.js's `DecalGeometry` ([Decals](#decals)) |

Without lights, a standard material draws black, apart from its emissive color. [Lights](lights.md) explains how light colors and intensities shade it.

## Shadow catchers

`materials.shadowCatcher({ color, opacity })` draws a surface that shows only the shadows that fall on it, as three.js's `ShadowMaterial`. It shows its `color` where the main directional light's shadow falls, and nothing at all where the light reaches it. The shadows of point and spot lights do not show on it. The mesh must receive shadows with `setReceiveShadows(true)`, as three.js's `receiveShadow` must be set.

The default color is black and the default opacity is 1. The material blends, so it draws in the transparent pass after the opaque objects, and the scene's fog leaves it alone. It takes no texture maps. Its shadows are the main directional light's, so a scene needs a directional light that casts shadows.

```ts
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
const ground = scene.createMesh({
  mesh: geometry.plane({ width: 20, height: 20 }),
  material: materials.shadowCatcher({ opacity: 0.6 }),
  position: [0, 0.01, 0],
  rotation: FLAT,
});
ground.setReceiveShadows(true);
```

Put the catcher a little above the surface it lies on, so its shadows show over that surface. [Shadows](../concepts/shadows.md) explains the light's shadow settings.

## Standard values

| Option | Range | Default | What it does |
| --- | --- | --- | --- |
| `color` | A [color](#color) | White | The base color: the color of diffuse light, and of a metal's reflections |
| `opacity` | 0 to 1 | 1 | How opaque the surface is. The `mask` alpha mode tests it, and the `blend` alpha mode blends with it |
| `alphaCutoff` | 0 to 1 | 0.5 | With the `mask` alpha mode, the alpha below which the surface draws nothing |
| `metalness` | 0 to 1 | 0 | 0 is a surface such as paint or plastic, and 1 is a metal |
| `roughness` | 0 to 1 | 1 | 0 is a mirror finish with a small, sharp highlight, and 1 is fully matte |
| `emissive` | An sRGB color | Black | Light that the surface gives off itself, whatever the lights |
| `emissiveIntensity` | 0 or more | 1 | The factor of the emissive color |
| `normalScale` | Two numbers | `[1, 1]` | How strongly the normal map bends normals along u and v |
| `aoMapIntensity` | 0 to 1 | 1 | How much the occlusion map darkens ambient light |
| `lightMapIntensity` | 0 or more | 1 | The factor of the light map's light |
| `ior` | 1 or more | 1.5 | The index of refraction of the non-metallic part. It sets how much light the surface reflects head on |
| `specularIntensity` | 0 to 1 | 1 | The strength of the non-metallic part's specular reflection, at every angle |
| `specularColor` | A [color](#color), or linear components of 0 or more | White | Tints the non-metallic part's specular reflection head on |
| `envIntensity` | 0 or more | 1 | The factor of the scene environment's light on the surface, as three.js's `envMapIntensity` |
| `transmission` | 0 to 1 | 0 | How much of the light behind the surface passes through it, for glass and clear water. See "Transmission" |
| `thickness` | 0 or more | 0 | The thickness of the volume under a surface that lets light through, in the mesh's own units |
| `attenuationColor` | A [color](#color) | White | The color that white light takes inside the volume over `attenuationDistance` |
| `attenuationDistance` | Above 0 | `Infinity` | The distance in world units over which light inside the volume takes `attenuationColor` |
| `clearcoat` | 0 to 1 | 0 | How much of a thin, shiny coat covers the surface, as on car paint or varnish. See "Clear coat and sheen" |
| `clearcoatRoughness` | 0 to 1 | 0 | How rough the coat is |
| `clearcoatNormalScale` | Two numbers | `[1, 1]` | How strongly the coat normal map bends the coat's normals along u and v |
| `sheenColor` | A [color](#color) | Black | The color of the soft glow of cloth and velvet at grazing angles. Black gives none |
| `sheenRoughness` | 0 to 1 | 1 | How wide the sheen spreads |
| `uvTransform` | An offset, a repeat and a rotation | None | Where the maps sit on the texture coordinates |

The values have the meaning and the defaults of three.js's `MeshStandardMaterial`. `ior`, `specularIntensity`, `specularColor`, the four transmission values and the five layer values have those of three.js's `MeshPhysicalMaterial`, as the next sections explain. A metal takes its color from what it reflects. Without an environment, a smooth metal shows little more than its highlights, so give the scene one with [`scene.setEnvironment`](scene.md#the-environment). three.js uses `scene.environmentIntensity` in place of `envMapIntensity` under a scene environment. The engine multiplies the two.

## Specular reflection and index of refraction

A surface reflects some light like a mirror, blurred by its roughness. This is its specular reflection. A metal's reflection takes its base color. A non-metal's reflection is white, and weak when you look at the surface head on: 4% of the light with the defaults. It grows to all the light at grazing angles. Three values change the non-metallic part, as glTF's `KHR_materials_ior` and `KHR_materials_specular` extensions do. The engine draws them with the formulas of three.js's `MeshPhysicalMaterial`, in the standard material's own lighting and shaders.

| Value | Head on | At grazing angles |
| --- | --- | --- |
| `ior` | Reflects `((ior - 1) / (ior + 1))^2` of the light: 4% at 1.5, as for glass and plastic, 11% at 2, and none at 1 | No change |
| `specularColor` | Multiplies the reflection, up to all the light. Components above 1 raise it past what `ior` gives | No change: the reflection stays white |
| `specularIntensity` | Multiplies the reflection | Multiplies it too, so 0 leaves only diffuse light |

Light that the surface reflects does not reach its diffuse color, so a stronger reflection darkens the diffuse part. Metals ignore the three values, and a material with a `metalness` between 0 and 1 blends both parts. The defaults draw exactly as a material without them.

```ts
// sketch.ts
// Paint that reflects more than plastic does, and cloth that reflects little.
const paint = materials.standard({ color: '#8a1020', roughness: 0.25, ior: 1.8 });
const cloth = materials.standard({ color: '#4a5a70', roughness: 0.8, specularIntensity: 0.3 });
```

## Transmission

A surface with `transmission` lets the light behind it through, as three.js's `MeshPhysicalMaterial` does. Use it for glass, ice, gems and clear water. The `blend` alpha mode only mixes the surface's color over what lies behind it. Light that passes through a surface bends, blurs and takes the color of the volume under it:

| Value | What it does |
| --- | --- |
| `transmission` | How much light passes through. That share of the surface's diffuse light becomes the light from behind it, times the base color. The surface's reflections stay, so glass still shows its highlights and the environment |
| `ior` | How far the light bends where it enters the volume. Glass is 1.5, water 1.33 |
| `thickness` | How deep the volume is. The light leaves it this far along the bent direction, so a thicker volume shows what lies behind it farther away. 0 is a thin wall, such as a window pane, which bends nothing |
| `roughness` | How much the light from behind blurs: none at 0, and very blurred at 1. An `ior` of 1 blurs nothing |
| `attenuationColor`, `attenuationDistance` | The color of the volume. White light takes `attenuationColor` after `attenuationDistance` inside it, and a deeper color farther in. The default absorbs nothing |

```ts
// sketch.ts: a smooth glass ball, a frosted one, and a ball of blue tinted glass.
const glass = materials.standard({ transmission: 1, roughness: 0, thickness: 1.4 });
const frosted = materials.standard({ transmission: 1, roughness: 0.4, thickness: 1.4 });
const tinted = materials.standard({
  transmission: 1, roughness: 0.05, thickness: 1.4,
  attenuationColor: '#3d9be0', attenuationDistance: 0.8,
});
```

Give `transmission` when you create the material, even as 0, to change it later with `set`. The option picks the shader that samples what lies behind the surface. A material created without it lets no light through.

### How it draws

After the camera's view draws its opaque objects, the engine copies their colors into a texture with a chain of smaller, blurred copies. Surfaces that let light through then draw with the blended objects, farthest first. Each one samples the copy where its bent light ray leaves the volume, at a blur that its roughness picks. three.js draws its transmission the same way.

- Only opaque objects show through. Another surface that lets light through, or a blended one, does not show through glass in front of it.
- The volume is a model, not a ray through the real shape. A ball with `thickness` set to its diameter looks right through its middle. three.js uses the same model.
- `thickness` is in the mesh's own units, and the object's scale multiplies it.
- Such a surface takes the `opaque` or `blend` alpha mode. `mask` and `hash` throw E1217.
- Views other than the camera's, such as [scene passes](render.md#scene-passes) and [reflection passes](render.md#reflection-passes), have no copy. There the surface shows the environment's light along the bent ray.
- `transmissionMap` and `thicknessMap` are not built yet. The values apply to the whole surface.

### Cost of transmission

Nothing of it runs, and none of its code or shaders download, until the first surface that lets light through draws. Then each frame copies the camera's opaque colors once and makes the blurred copies. The camera's opaque and see-through objects then draw in two render passes instead of one. The shaders of such surfaces load on their first use. To load them before the first frame instead, list `'transmission'` in `createEngine`'s `preload` option.

## Clear coat and sheen

Two layers can lie over the standard material's surface, as three.js's `MeshPhysicalMaterial` and glTF's `KHR_materials_clearcoat` and `KHR_materials_sheen` extensions draw them:

- A **clear coat** is a thin, clear, shiny film, such as the lacquer of car paint, varnish on wood, or water on a stone. It has highlights and a reflection of its own, at its own roughness. Where it reflects light, it dims what lies under it. So a rough red paint under a smooth coat shows a sharp reflection over a soft color.
- A **sheen** is the soft glow that cloth, velvet and fuzz take at grazing angles, where the light catches the tips of their fibers. Its color tints the glow. Light that the sheen reflects does not reach the surface under it.

| Value | What it does |
| --- | --- |
| `clearcoat` | How much of the coat covers the surface, from none at 0 to all at 1 |
| `clearcoatRoughness` | How rough the coat is. 0 is a mirror finish |
| `clearcoatNormalScale` | How strongly `clearcoatNormalMap` bends the coat's normals. Without a coat normal map, the coat lies smooth over the mesh, whatever the `normalMap` does to the surface under it |
| `sheenColor` | The color of the sheen. Black, the default, gives no sheen |
| `sheenRoughness` | How wide the sheen spreads, from a narrow rim at 0 to a soft glow across the surface at 1 |

```ts
// sketch.ts: car paint, a wet stone and red velvet, in an environment's light.
scene.setEnvironment(await assets.builtinEnvironment('room'));
const paint = materials.standard({
  color: '#a3131b', metalness: 0.5, roughness: 0.5,
  clearcoat: 1, clearcoatRoughness: 0.03,
});
const wetStone = materials.standard({
  color: '#4a4844', roughness: 0.9, clearcoat: 0.8, clearcoatRoughness: 0.05,
});
const velvet = materials.standard({
  color: '#4a0613', roughness: 0.9, sheenColor: '#ff7a8f', sheenRoughness: 0.4,
});
```

Give any of the five values, or a layer map, when you create the material, to change the layers later with `set`. The option picks the shader that lights the layers. A material created without them has no layers, and pays nothing for them. A coat of 0 and a black sheen draw exactly as no layers.

### Maps of the layers

| Option | Channels | What it does |
| --- | --- | --- |
| `clearcoatMap` | R, linear | Multiplies `clearcoat` |
| `clearcoatRoughnessMap` | G, linear | Multiplies `clearcoatRoughness` |
| `clearcoatNormalMap` | RGB, linear | Bends the coat's normals in tangent space, scaled by `clearcoatNormalScale` |
| `sheenColorMap` | RGB, sRGB | Multiplies `sheenColor` |
| `sheenRoughnessMap` | A | Multiplies `sheenRoughness` |

The layers' maps take the places of the light map and the specular maps. So a material with a clear coat or a sheen takes no `lightMap`, `specularIntensityMap` or `specularColorMap`. Development builds throw E1217 for them, and production builds draw the material without them. Its `specularIntensity` and `specularColor` values still apply. Give `clearcoatMap` and `clearcoatRoughnessMap` as one texture, with the coat in red and its roughness in green, and `sheenColorMap` and `sheenRoughnessMap` as one texture, with the roughness in alpha. glTF packs them this way, and two textures for a pair throw E1217. An sRGB texture keeps its alpha linear, so one sRGB texture holds the sheen's color and roughness.

### How the layers draw

The engine uses the formulas of three.js's `MeshPhysicalMaterial`:

- The coat is a second GGX highlight, which reflects 4% of the light head on and all of it at grazing angles. It reflects the scene's environment at its own roughness, and the occlusion map and ambient occlusion darken that reflection.
- The sheen is the Charlie highlight of cloth (Estevez and Kulla), lit by each light, and by the ambient light and the environment. How much light the sheen keeps from the surface under it comes from three.js's curve fit of the sheen's reflectance, which needs no lookup table. At grazing angles the fit gives a little less than the exact value, so the surface under a strong sheen shows slightly brighter there than the extension's reference. three.js draws the same.
- Emitted light lies under the coat too, so a coat dims a glowing surface where it reflects.

### Cost of the layers

The layers' shaders load the first time you create a material with layers. To load them before the first frame instead, list `'coat_sheen'` in `createEngine`'s `preload` option. A layered material costs each of its pixels, per light, one more highlight for the coat and one for the sheen, and one more environment read for the coat. A layer that a material does not use costs almost nothing. Materials without layers draw as before, with no new texture and no change to their shaders.
## Decals

A decal material projects a standard material onto every opaque surface inside a box, as three.js's `DecalGeometry` places a decal. Use decals for scorch marks, mud, puddles, road paint, moss, cracks and posters. Give the material to a mesh of `geometry.box()`: the object's position, rotation and scale place the box.

```ts
// sketch.ts: a scorch mark on the ground, and cracks on a wall. The maps come from textures.
const box = geometry.box();
const scorch = materials.decal({ map: scorchColors, normalMap: scorchBumps, roughness: 0.95 });
// Turned so that the box's z axis points up, out of the ground: the decal looks down onto it.
const down: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
scene.createMesh({ mesh: box, material: scorch, position: [2, 0, 1], rotation: down, scale: [3, 3, 1] });
// A wall that faces +z takes a box that is not turned.
const cracks = materials.decal({ map: crackColors, normalMap: crackBumps });
scene.createMesh({ mesh: box, material: cracks, position: [0, 1.5, -2], scale: [2, 2, 0.5] });
```

The box's z axis is the decal's direction: it points out of the surfaces that the decal marks. The maps lie across the box's x and y sides, with u along x and v along y, as `DecalGeometry` lays them. The box's z size sets how far into and out of a surface the decal reaches, so a deep box marks a bumpy or curved surface all over.

A decal takes the standard material's values and maps. They light it as they light any surface, at the place where the decal lies:

| Values | What they do |
| --- | --- |
| `map`, `color`, `opacity` | The decal's color. The map's alpha times the opacity sets how much of the decal covers the surface |
| `metalnessRoughnessMap`, `metalness`, `roughness` | How the decal reflects light. A puddle is smooth, and scorch is rough |
| `normalMap`, `normalScale` | Bumps of the decal, such as the edges of a crack or the grain of moss |
| `aoMap`, `aoMapIntensity`, `emissive`, `emissiveMap`, `emissiveIntensity` | Occlusion and light of the decal's own, such as glowing paint |
| `angleFade` | The angles from the decal's direction at which it starts to fade and past which it shows nothing, in radians. The default, 60 and 80 degrees, keeps a decal on the ground from smearing up a wall |
| `edgeFade` | The share of the box's depth, from 0 to 1, over which the decal fades toward each end along z. The default is 0.2 |

A batch of boxes with one decal material draws in one draw. With `colors: true`, each row's color tints its decal, and the row's alpha fades it, as for bullet holes that fade with time.

### Objects that show no decals

`scene.setDecalLayers(mask)` sets the layers whose objects decals mark. An object that is also on a layer outside the mask shows no decals, so a character on a layer of its own walks through mud and puddles clean.

```ts
const PEOPLE = 1 << 1;
scene.setDecalLayers(~PEOPLE);  // decals mark every layer but the people's
const walker = scene.createMesh({ mesh: body, material: coat, layers: 1 | PEOPLE });
```

Such objects draw a second time after the decals, over their own pixels. That costs one more draw of them in each frame that shows decals, so keep the layers that decals skip to the objects that need it. The mask is the same for every decal.

### How decals draw

After the camera's view draws its opaque objects, the decals draw in a pass of their own. For each pixel of its box, a decal reads the scene's depth there and finds the surface that the pixel shows. It lights its own material at that surface, with the scene's lights, shadows, ambient occlusion, environment and fog. Then it covers the surface as far as its alpha says.

- Decals mark opaque surfaces only. Blended surfaces and surfaces that let light through draw after the decals.
- A decal covers the surface below it with its own color. It cannot only darken or smooth the surface and keep the surface's own map. So give a puddle a dark color and a low roughness of its own.
- Under a decal, the surface's normal comes from the scene's depth. A curved mesh of few triangles shows its flat faces there.
- Decals of one render order draw in the order you made them. `setRenderOrder` puts one decal over another.
- Only the camera's view shows decals. [Scene passes](render.md#scene-passes) and [reflection passes](render.md#reflection-passes) show none.
- A decal casts no shadow. Raycasts and pointer events hit its box, as they hit any mesh. Put decals on a layer of their own, and leave that layer out of the raycast's `layers`.

### Cost of decals

Nothing of it runs, and none of its shaders download, until the first decal material. Then each frame culls the decals on the engine's workers and draws them in one render pass, with one draw for each run of decals that share their maps. Each pixel that a decal covers reads five depths and lights the surface once more. A decal's shaders load on first use. To load them before the first frame instead, list `'decals'` in `createEngine`'s `preload` option.

## Texture maps

Maps are textures that vary a material across a surface. `assets.loadTexture` and the `textures` calls make them, as [Textures](textures.md) explains. Give color maps the `srgb` color space and data maps the `linear` one.

```ts
// sketch.ts
const [color, packed, bumps] = await Promise.all([
  assets.loadTexture('/brick-color.png'),
  assets.loadTexture('/brick-orm.png', { colorSpace: 'linear' }),
  assets.loadTexture('/brick-normal.png', { colorSpace: 'linear' }),
]);
const brick = materials.standard({
  map: color,
  metalnessRoughnessMap: packed,
  aoMap: packed,
  normalMap: bumps,
  uvTransform: { repeat: [4, 2] },
});
```

| Option | Material | Channels | What it does |
| --- | --- | --- | --- |
| `map` | Both | RGBA, sRGB | Multiplies `color`, and its alpha multiplies `opacity` |
| `metalnessRoughnessMap` | Standard | G and B, linear | Green multiplies `roughness`, and blue multiplies `metalness`, as glTF packs them |
| `normalMap` | Standard | RGB, linear | Bends normals in tangent space, scaled by `normalScale` |
| `aoMap` | Standard | R, linear | Darkens ambient light, by `aoMapIntensity` |
| `emissiveMap` | Standard | RGB, sRGB | Multiplies `emissive` times `emissiveIntensity` |
| `lightMap` | Standard | RGB | Adds baked light to the ambient light, times `lightMapIntensity` |
| `specularIntensityMap` | Standard | A, linear | Its alpha multiplies `specularIntensity` |
| `specularColorMap` | Standard | RGB, sRGB | Multiplies `specularColor` |
| `clearcoatMap`, `clearcoatRoughnessMap`, `clearcoatNormalMap`, `sheenColorMap`, `sheenRoughnessMap` | Standard | See "Maps of the layers" | The maps of the clear coat and the sheen, in place of the light map and the specular maps |

The maps of a material are fixed when you create it. A mesh needs texture coordinates to show them, and a mesh without them draws the material without its maps. A map reads the set of coordinates that its texture's `uvSet` names. Light maps usually use the second set, so load them with `uvSet: 1`. A mesh without a second set gives its first set to such a map.

A normal map takes its frame from the mesh's tangents when the mesh has them, as `geometry.fromArrays` with `computeTangents` makes them. Otherwise the shader finds the frame from how the positions and the coordinates change between pixels, as three.js does.

Until a map's image reaches the GPU, the material draws as without that map.

On WebGL2, the maps of one material share at most six textures on the GPU. Maps with the same size, format and sampling count once, so a material rarely reaches the limit. [Texture arrays](textures.md#texture-arrays) says which maps a material drops past it.

## Texture coordinate transform

`uvTransform` places every map of a material on the texture coordinates: `offset`, `repeat` and `rotation` in radians. They act as three.js's texture `offset`, `repeat` and `rotation` with the default `center`. A transform that leaves a value out takes its default. `set` changes the transform at any time.

## Color

`color`, `emissive` and `specularColor` take an sRGB color, as three.js does. That is a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three linear components from 0 to 1. The engine converts the color to linear once, when the call receives it. Any other value, such as the name `'red'`, throws E1204. The linear components of `specularColor` may also exceed 1, as glTF allows.

## Changing a material

`set(options)` changes a material's values at any time, and every object that uses the material changes with it. It changes only the options that you pass. The others keep their values, so `set({ roughness: 0.5 })` keeps the color. A standard material's `set` takes every value in the table above, and an unlit material's `set` takes `color`, `opacity`, `alphaCutoff` and `uvTransform`.

`set` checks every value before it changes any, so a call that throws changes nothing. It converts a color without allocating, and it reads each number by its name, so a `set` in every frame allocates nothing. Keep one options object for each material that changes, and change its values in place. The browser boxes a number read where the objects that give that value come in more than four shapes, that is four sets of keys. So give a value that changes every frame from a few kinds of objects at most. `bun run bench:allocation --setters` checks a standard material's `set` in every frame. To change one object alone, give it another material with `mesh.setMaterial(material)`.

## Destroying a material

`material.destroy()` frees a material that the sketch no longer needs, as three.js's `material.dispose()` does. From the next frame, objects and instance batches that still use it draw nothing, until `setMaterial` gives them another material. Once no object or batch uses it, its place in the engine's table of materials goes to the next material that you create. When the last material of a custom material's WGSL goes, the engine also frees that WGSL's pipelines.

`destroy` leaves the material's textures, which other materials may share. Destroy them apart with `texture.destroy()`. Calls on a destroyed material, and calls that pass it, such as `createMesh`, throw [E1101](../errors/E1101.md). Destroying a material changes which objects draw, so the next frame rebuilds the engine's draw tables, as creating one does.

## Options fixed at creation

These options are fixed when you create the material. Most of them choose the material's shader or its pipeline, and a change would compile a new pipeline, which can make a frame late. Make one material for each combination instead.

| Option | Materials | Default | What it does |
| --- | --- | --- | --- |
| `doubleSided` | Both | false | Draws both faces of each triangle. A back face lights as if it faced the camera, as with three.js's `side: DoubleSide` |
| `vertexColors` | Both | false | Multiplies the base color by the mesh's vertex colors, on meshes that have them. [Geometry](geometry.md) makes meshes with colors |
| `flatShading` | Standard | false | Lights each triangle with the normal of its face, so the mesh looks faceted |
| `alphaMode` | Both | `'opaque'` | How the material uses its alpha: `'opaque'`, `'mask'`, `'hash'` or `'blend'`. See "Alpha modes" |
| `alphaToCoverage` | Both | true | With the `mask` alpha mode, smooths the cut edges with MSAA, as three.js's `alphaToCoverage` does. `false` gives the hard cut edges of three.js's `alphaTest`. See "Alpha to coverage" |
| `blending` | Both | `'normal'` | With the `blend` alpha mode, how the surface meets what lies behind it: `'normal'`, `'additive'`, `'multiply'` or `'weighted'`. See "Blending" |
| `depthWrite` | Both | true | False writes no depth, so the surface hides nothing that draws after it |
| `depthTest` | Both | true | False draws the surface whatever lies in front of it. It then writes no depth either, as in three.js's WebGL renderer |
| `depthBias` | Both | No bias | Moves the surface's depth, as three.js's polygon offset does. See "Depth bias" |
| `forceSinglePass` | Both | false | With the `blend` alpha mode and `doubleSided`, draws both faces in one draw, as three.js's `forceSinglePass` does. See "Double-sided blended surfaces" |
| `transmission` | Standard | None | Given at all, even as 0, lets light through the surface, and `set` can then change its value. See "Transmission" |
| The layer values and maps | Standard | None | Any of them, even a coat of 0, gives the material a clear coat and a sheen, and `set` can then change their values. See "Clear coat and sheen" |
| `fog` | Both | true | Takes the scene's fog. With `false`, the material keeps its color at every distance, as with three.js's `fog: false`. [Scene](scene.md#fog) sets the fog |

A material with `vertexColors` draws a mesh without colors in its base color alone. The kind of material, standard or unlit, is fixed too.

## Alpha modes

A surface's alpha is its `opacity`, times the alpha of its base color map. With `vertexColors`, the alpha of the mesh's vertex colors multiplies it too. `alphaMode` says how the material uses the alpha:

| Mode | What it draws | three.js |
| --- | --- | --- |
| `'opaque'` | The whole surface, opaque. The alpha has no effect | The default material |
| `'mask'` | Nothing where the alpha is below `alphaCutoff`, and the rest opaque | `alphaTest: alphaCutoff` |
| `'hash'` | Each point of the surface opaque or not at all, so the alpha sets how much of the surface draws | `alphaHash: true` |
| `'blend'` | The surface blended over what lies behind it, as far as the alpha says | `transparent: true` |

A masked surface has hard edges, and it hides what lies behind it as an opaque one does, so its objects draw in any order. Use it for leaves, fences and cut-out shapes. Only masked and hashed materials draw with the shader that drops fragments, so opaque ones keep the GPU's early depth test.

A hashed surface draws a share of its points that its alpha sets: half of them at an alpha of 0.5. A hash of each point's place on the mesh picks the points, as three.js's `alphaHash` picks them. So the pattern moves with the object and does not crawl as the camera moves. The hash uses integer math, so every GPU draws the same pattern. three.js's pattern differs from GPU to GPU, so the two engines' patterns differ, but each draws the same share of the surface. Hashed objects draw in any order, as masked ones do. They suit fades and see-through surfaces that cross each other, where blending would need a sort. The pattern is noisy up close. `alphaCutoff` has no effect in this mode.

A blended surface lets what lies behind it show through. Blended objects draw after the opaque ones, farthest first, so each one blends over the objects behind it. A call to `mesh.setRenderOrder(order)` draws an object before or after the others, whatever its depth. The rows of an instance batch sort one by one. The page [Materials and pipelines](../concepts/materials.md#the-transparent-pass) explains the sort. It also says where the sort cannot help.

A blended material writes depth, as three.js's transparent materials do. Give particles, glows and other surfaces that cross `depthWrite: false`, so they never hide each other.

```ts
// sketch.ts: leaves whose vertex alpha cuts their shape.
const leaves = materials.standard({ color: '#5bc27a', vertexColors: true, alphaMode: 'mask', alphaCutoff: 0.4 });
// Later: a lower cutoff grows the leaves, at no cost.
leaves.set({ alphaCutoff: 0.2 });
```

### Alpha to coverage

A masked surface's cut edges are as smooth as its outer edges, as `alphaToCoverage` is on by default. The alpha fades from nothing at `alphaCutoff` to full over about one pixel, as three.js's `alphaToCoverage` makes it fade. MSAA then draws the surface on that share of each edge pixel's samples. Foliage and fences lose their stair steps, and their objects still draw in any order.

This is the best technique for cut-out shapes, so it is the default, as in Filament. three.js's `alphaTest` alone cuts hard edges: give `alphaToCoverage: false` for that look. The option needs MSAA, the default anti-aliasing. With FXAA or no anti-aliasing, as on the Low preset, the mask cuts as without it. Custom materials take neither `alphaToCoverage` nor the `hash` alpha mode, and throw E1217 for them. On WebGPU, where the scene's colors have no alpha channel, the shader sets the covered samples itself, with the same look. The first such material loads the shader builds of alpha to coverage, and the first hashed material those of the hash. To load them before the first frame instead, list `'coverage'` and `'hash'` in `createEngine`'s `preload` option.

```ts
// sketch.ts: grass cards whose cut edges MSAA smooths, and a fence with hard pixel edges.
const grass = materials.standard({ map: grassTexture, alphaMode: 'mask', alphaCutoff: 0.5 });
const fence = materials.standard({ map: fenceTexture, alphaMode: 'mask', alphaToCoverage: false });
```

## Double-sided blended surfaces

A blended surface with `doubleSided: true` draws in two draws, as three.js draws it. Its back faces draw first, then its front faces. So the near side of a glass box or a sphere always covers its far side, whatever the order of the mesh's triangles. Neighbors that share the mesh and the material draw together: all their back faces, then all their front faces.

`forceSinglePass: true` draws both faces in one draw, as three.js's `forceSinglePass` does. The triangles then cover each other in the mesh's order. Use it for flat surfaces, such as leaves and planes of glass, whose two faces never overlap on screen: it saves one draw per object. The second draw costs about as much as the first, so it is the speed setting for scenes with many double-sided blended objects. Solid double-sided materials always draw once.

```ts
// sketch.ts: a glass globe that shows its far side, and a flat pane that needs one draw.
const globe = materials.standard({ color: '#a8d8ff', opacity: 0.3, alphaMode: 'blend', doubleSided: true });
const pane = materials.standard({ color: '#a8d8ff', opacity: 0.3, alphaMode: 'blend', doubleSided: true, forceSinglePass: true });
```

## Blending

`blending` says how a blended surface meets what lies behind it. It has an effect with the `blend` alpha mode only.

| Blending | What it does | Use it for |
| --- | --- | --- |
| `'normal'` | Covers what lies behind, as far as the alpha says | Glass, fading objects, smoke |
| `'additive'` | Adds the surface's light to what lies behind, times the alpha | Glows, fire, sparks, lasers |
| `'multiply'` | Tints what lies behind by the surface's color, as far as the alpha says | Stains, shadows painted on, tinted film |
| `'weighted'` | Covers what lies behind as `'normal'` does, but blends with the other weighted surfaces in any order | Smoke, dust, clouds of particles, many panes of glass that cross |

The engine blends colors multiplied by their alpha, as three.js does with `premultipliedAlpha: true`. Textures loaded with `premultipliedAlpha: true` blend correctly too.

The engine blends in linear color, before the tone mapping, as three.js's `WebGPURenderer` does. three.js's `WebGLRenderer` tone maps each surface and encodes it as sRGB first, and then blends it on the canvas. So a see-through surface over a different color looks a little lighter in null3D than in a `WebGLRenderer` port, and an additive glow a little weaker. The [8-bit path](../concepts/color-management.md#the-8-bit-path) of some devices tone maps and encodes each surface first too, so there the engine blends as `WebGLRenderer` does.

```ts
// sketch.ts: a pane of glass and a glow that never hides what it crosses.
const glass = materials.standard({ color: '#a8d8ff', opacity: 0.3, roughness: 0.1, alphaMode: 'blend' });
const glow = materials.unlit({ color: '#ffb040', alphaMode: 'blend', blending: 'additive', depthWrite: false });
```

### Weighted blending

Blended objects draw farthest first, and the sort orders whole objects, or the rows of a batch. Surfaces that cross, a large surface around a small one, and puffs of smoke inside each other have no right order. The sort then puts some of them in the wrong order, and they pop as the camera moves. Additive and multiply blending give the same result in any order, so only normal blending needs the sort.

`blending: 'weighted'` blends such surfaces without a sort. The engine uses weighted blended order-independent transparency (McGuire and Bavoil, 2013), as three.js's `OITPassNode` does. Each weighted surface adds its color and its coverage into two targets, in any order, and near surfaces weigh more than far ones. A full-screen step then blends the average color over the scene, as far as the surfaces cover it.

```ts
// sketch.ts: smoke puffs that cross each other, and panes of glass that cross, without popping.
const smoke = materials.unlit({ color: '#9a9590', opacity: 0.35, alphaMode: 'blend', blending: 'weighted', depthWrite: false });
const glass = materials.standard({ color: '#a8d8ff', opacity: 0.3, roughness: 0.1, alphaMode: 'blend', blending: 'weighted', doubleSided: true });
```

- The result is an average. Where a dark and a bright surface overlap at a similar depth, both show. The nearest surface shows most. Where an exact order exists, a sorted blend shows it.
- Weighted surfaces draw as one layer after the camera's other blended surfaces and its surfaces that let light through. They show where nothing nearer wrote depth.
- A weighted surface writes no depth, and both faces of a double-sided one draw in one draw.
- The layer draws at one sample per pixel, so MSAA does not smooth the edges of weighted surfaces. Soft surfaces, such as smoke, look the same. FXAA smooths the edges as it smooths the rest.
- Views other than the camera's, such as [scene passes](render.md#scene-passes) and [reflection passes](render.md#reflection-passes), draw weighted surfaces farthest first, as `'normal'` ones. So do WebGL2 devices that cannot draw into 16-bit float targets, and frames before the layer's shaders have loaded.
- Materials with `transmission`, custom materials and lines do not take the `weighted` blending. They throw E1217.

### Cost of weighted blending

The layer costs nothing until the first weighted surface draws, and its shaders download only then. Each frame then draws the camera's weighted surfaces into two targets of the render size, 10 bytes per pixel together. A full-screen step blends them over the scene. With MSAA, the layer first copies one sample of each pixel's depth. The camera's other blended objects and the weighted layer draw in separate render passes. To load the layer's shaders before the first frame, list `'weighted'` in `createEngine`'s `preload` option.

## Depth bias

`depthBias: { constant, slopeScale }` moves a surface's depth before the depth test. A decal that lies on a wall has the wall's depth, so without a bias the two fight pixel by pixel. Where the depths are exactly equal, no surface is defined to win, and the winner may differ between GPU paths ([The depth prepass](../concepts/quality-presets.md#the-depth-prepass)). A bias toward the camera makes the decal win.

| Field | three.js | What it does |
| --- | --- | --- |
| `constant` | `polygonOffsetUnits` | Steps of the depth buffer's smallest difference. A fraction rounds to the nearest whole number |
| `slopeScale` | `polygonOffsetFactor` | A factor of how steeply the surface's depth changes across the screen. It moves surfaces seen at a grazing angle further |

Negative values pull the surface toward the camera, and positive values push it away, as in three.js. The engine draws with reversed depth, and it turns the signs for you. Both fields default to 0.

```ts
// sketch.ts: a poster on a wall, as three.js's polygonOffsetFactor: -4, polygonOffsetUnits: -4.
const poster = materials.standard({ color: '#e8554e', depthBias: { constant: -4, slopeScale: -4 } });
```

## Custom materials

`materials.shader(options)` takes every option of `materials.standard` but the texture maps, and a `wgsl` option: WGSL that the null3D Vite plugin compiled. The WGSL declares a surface function, which starts from the look that the standard options make:

```ts
const rings = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = mix(s.baseColor, vec3f(1.0), step(0.5, fract(input.uv.y * 6.0)));
    return s;
}
`;
const red = materials.shader({ wgsl: rings, color: '#e04040', roughness: 0.5 });
red.set({ roughness: 0.2 });
```

The WGSL can declare uniforms as the fields of `struct Uniforms`. The `uniforms` option gives their first values, and `set` changes them with the standard values:

```ts
const tinted = /* wgsl */ `
struct Uniforms { tint: vec3f, strength: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = mix(s.baseColor, material.tint, material.strength);
    return s;
}
`;
const paint = materials.shader({ wgsl: tinted, uniforms: { tint: '#ff6a00', strength: 0.5 } });
paint.set({ strength: 0.8, roughness: 0.3 });
```

TypeScript reads the uniforms' names and types from the WGSL. The `uniforms` option and `set` take only the names that `struct Uniforms` declares. Each name takes a value of its kind, and a misspelled name fails the type check. [Typed uniforms](../guides/custom-shaders.md#typed-uniforms) covers tagged literals and `.wgsl` files.

The WGSL can sample up to 6 textures of its own. It declares each one as `var name: texture_2d<f32>;`, and samples it with the sampler `nameSampler`, which the engine declares. The `textures` option gives the textures by name, and they are fixed when the material is created:

```ts
const masked = /* wgsl */ `
var mask: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.alpha *= textureSample(mask, maskSampler, input.uv).g;
    return s;
}
`;
const leaf = await assets.loadTexture('/textures/leaf-mask.png', { colorSpace: 'linear' });
const leaves = materials.shader({ wgsl: masked, alphaMode: 'mask', textures: { mask: leaf } });
```

A texture samples as white until its image is on the GPU. [Textures](../shaders/surface-functions.md#textures) on the Surface functions page gives the rules.

A surface function can set a clear coat and a sheen too, such as a coat where a stone is wet. The WGSL sets the surface's `clearcoat`, `clearcoatRoughness`, `clearcoatNormal`, `sheenColor` or `sheenRoughness`. Only WGSL that names one of them has the shaders that light the layers. The layer options of such a material give `defaultSurface` its values, and WGSL that never names them throws E1217 when you give it a layer option. [Layers](../shaders/surface-functions.md#clear-coat-and-sheen) on the Surface functions page shows the WGSL.

### Values per row of a batch

The WGSL reads values of each draw through `frame`, `camera` and `object` ([Built-in values](../shaders/builtins.md)). On the rows of an instance batch made with `values: true`, `object.values` holds the row's four numbers from the batch's `values` array. So one material can sway each blade of grass in its own phase, and tint each one:

```ts
const sway = /* wgsl */ `
fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(sin(frame.time + object.values.x) * 0.2 * input.uv.y, 0.0, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor *= mix(vec3f(0.3, 0.6, 0.1), vec3f(0.8, 0.7, 0.2), object.values.y);
    return s;
}
`;
const grass = materials.shader({ wgsl: sway, doubleSided: true });
```

A batch made with `colors: true` tints each row by its color in every material, as vertex colors do: `defaultSurface` takes it in `input.vertexColor`. [Instances and batching](../concepts/instances.md#per-row-values) shows a whole sketch.

A material with a vertex offset moves its shadows too: its casters draw with the offset, so the shadows of swaying grass sway with it. Such casters draw again in every frame that a shadow map draws, as moving objects do.

### Mirrors, polished floors and water

A custom material can reflect a [reflection pass](render.md#reflection-passes). Its surface function reads the pass's texture where the surface shows on the screen, and sets the surface's `reflection`. The engine lights that color as the light from the mirror direction. The material's Fresnel, metalness and specular values weigh it as they weigh the environment's reflection. [Surface functions](../shaders/surface-functions.md#reflections) shows the WGSL, and [Custom passes](../guides/custom-passes.md#a-water-recipe) a water recipe. Standard materials take no reflection in this version: give a polished floor a custom material with the floor's values.

With `alphaMode: 'mask'`, the pixels where the surface function's `alpha` falls below `alphaCutoff` draw nothing. Materials made from the same WGSL share one shader, and each has its own uniforms. A mesh needs texture coordinates to draw with a custom material. WGSL as plain text, which the plugin did not compile, throws E1215. So does a whole shader that is not a [full shader](../guides/custom-shaders.md#full-shaders) of a material. A uniform or a texture that the WGSL does not declare, or a value of the wrong kind, throws E1216. The WGSL can also move the mesh's vertices with a vertex offset. [Surface functions](../shaders/surface-functions.md) describes the WGSL.

## Ranges

`opacity`, `alphaCutoff`, `metalness`, `roughness`, `aoMapIntensity`, `transmission`, `clearcoat`, `clearcoatRoughness`, `sheenRoughness` and `edgeFade` go from 0 to 1, and `emissiveIntensity`, `lightMapIntensity` and `thickness` take 0 or more. `attenuationDistance` takes more than 0. The numbers of `normalScale` and `uvTransform` must be finite. When a factory or `set` gets a value outside its range, development builds throw E1108. An `alphaMode` or a `blending` that the engine does not know throws E1217. So does the `weighted` blending on a custom material or a material with `transmission`. A depth bias that is not a finite number throws E1203. The `opaque` alpha mode ignores the opacity.

## Limits

One engine holds up to 1,024 materials at once. One more throws E1501. A material lasts until `destroy`, or as long as the engine. Create materials once in the setup and share them, and never create one per object or per frame.

## Related pages

- [Scene](scene.md): creating meshes with a material.
- [Objects and transforms](objects.md): `setMaterial` on a mesh.
- [Lights](lights.md): what lights a standard material.
- [Surface functions](../shaders/surface-functions.md): the WGSL of a custom material.
- [Math helpers](math.md#colors): sRGB and linear colors.

## API reference

[The API reference](reference/materials.md) lists every export of this page with its type and description. The engine's doc comments make it.
