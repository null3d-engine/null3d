---
id: api/materials
title: Materials
status: experimental
since: "0.1"
summary: "standard, unlit, shader, shadowCatcher; every option."
---

# Materials

> Roadmap step 0.1, first released in null3D 0.1.0. Step 0.2 adds typed uniforms, custom material textures, `destroy`, the specular and index of refraction values, transmission, light through thin surfaces and under the surface, decals, the weighted blending, the clear coat and sheen layers, the shadow catcher, bump maps, displacement maps, parallax and wireframes. The API is experimental, so it can still change between versions. `materials.shader` takes no standard texture maps. Coding agents must not use the parts that are not built.

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
| `bumpScale` | A number | 1 | How strongly the bump map bends normals. Negative values turn bumps into dents |
| `displacementScale` | A number | 1 | How far the displacement map's white moves a vertex, in the mesh's units |
| `displacementBias` | A number | 0 | How far the displacement map moves every vertex, added to its height's share |
| `aoMapIntensity` | 0 to 1 | 1 | How much the occlusion map darkens ambient light |
| `lightMapIntensity` | 0 or more | 1 | The factor of the light map's light |
| `lightMapOffset` | Two numbers | `[0, 0]` | Where the light map's texture coordinates start. It is fixed when the material is created |
| `lightMapRepeat` | Two numbers | `[1, 1]` | How the light map's texture coordinates stretch. It is fixed when the material is created |
| `lightMapDecode` | `srgb` or `rgbm` | `srgb` | How the engine reads the light map's texels. `rgbm` decodes Needle's light maps. It is fixed when the material is created |
| `ior` | 1 or more | 1.5 | The index of refraction of the non-metallic part. It sets how much light the surface reflects head on |
| `specularIntensity` | 0 to 1 | 1 | The strength of the non-metallic part's specular reflection, at every angle |
| `specularColor` | A [color](#color), or linear components of 0 or more | White | Tints the non-metallic part's specular reflection head on |
| `envIntensity` | 0 or more | 1 | The factor of the scene environment's light on the surface, as three.js's `envMapIntensity` |
| `transmission` | 0 to 1 | 0 | How much of the light behind the surface passes through it, for glass and clear water. See "Transmission" |
| `thickness` | 0 or more | 0 | The thickness of the volume under a surface that lets light through, in the mesh's own units |
| `attenuationColor` | A [color](#color) | White | The color that white light takes inside the volume over `attenuationDistance` |
| `attenuationDistance` | Above 0 | `Infinity` | The distance in world units over which light inside the volume takes `attenuationColor` |
| `diffuseTransmission` | 0 to 1 | 0 | How much of the surface's diffuse light passes through to its other side, for leaves, petals and ears. See "Light through thin surfaces" |
| `diffuseTransmissionColor` | A [color](#color) | White | Tints the light that passes through to the other side |
| `subsurfaceRadius` | 0 or more, in metres | 0 | How far light spreads under the surface, for skin, wax, jade and marble. See "Light under the surface" |
| `subsurfaceColor` | A [color](#color) | White | Each color channel's share of `subsurfaceRadius` |
| `clearcoat` | 0 to 1 | 0 | How much of a thin, shiny coat covers the surface, as on car paint or varnish. See "Clear coat and sheen" |
| `clearcoatRoughness` | 0 to 1 | 0 | How rough the coat is |
| `clearcoatNormalScale` | Two numbers | `[1, 1]` | How strongly the coat normal map bends the coat's normals along u and v |
| `sheenColor` | A [color](#color) | Black | The color of the soft glow of cloth and velvet at grazing angles. Black gives none |
| `sheenRoughness` | 0 to 1 | 1 | How wide the sheen spreads |
| `iridescence` | 0 to 1 | 0 | How much a thin film above the surface tints its reflection, as on a soap bubble or a beetle's shell. See "Iridescence and anisotropy" |
| `iridescenceIor` | 1 or more | 1.3 | The thin film's index of refraction |
| `iridescenceThicknessRange` | Two thicknesses in nanometers | `[100, 400]` | The film's thinnest and thickest parts, which its map mixes between |
| `anisotropy` | 0 to 1 | 0 | How far the specular reflection stretches along one direction, as on brushed metal. See "Iridescence and anisotropy" |
| `anisotropyRotation` | Radians | 0 | The direction along which the reflection stretches |
| `uvTransform` | An offset, a repeat and a rotation | None | Where every map sits on the texture coordinates |
| `mapUvTransforms` | A transform for a map, by the map's option name | None | Where one map sits, where it differs from the others |

The values have the meaning and the defaults of three.js's `MeshStandardMaterial`. `ior`, `specularIntensity`, `specularColor`, the four transmission values and the ten layer values have those of three.js's `MeshPhysicalMaterial`, as the next sections explain. three.js has no diffuse transmission, so its two values take the names and defaults of glTF's `KHR_materials_diffuse_transmission`. A metal takes its color from what it reflects. Without an environment, a smooth metal shows little more than its highlights, so give the scene one with [`scene.setEnvironment`](scene.md#the-environment). three.js uses `scene.environmentIntensity` in place of `envMapIntensity` under a scene environment. The engine multiplies the two.

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
| `transmissionMap` | The same share, per texel, in red. Its red multiplies `transmission`. A material with it takes no `specularIntensityMap`, since the two share a slot |
| `ior` | How far the light bends where it enters the volume. Glass is 1.5, water 1.33 |
| `thickness` | How deep the volume is. The light leaves it this far along the bent direction, so a thicker volume shows what lies behind it farther away. 0 is a thin wall, such as a window pane, which bends nothing |
| `thicknessMap` | The thickness, per texel, in green. Its green multiplies `thickness`. A material with it takes no `specularColorMap`, since the two share a slot |
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
- The copy keeps the opaque objects' depth too. A bent ray can land on an opaque object in front of the surface, such as a flower on the bank of a stream. The surface then shows what lies straight behind it instead. three.js shows the flower's color in the water there.
- The volume is a model, not a ray through the real shape. A ball with `thickness` set to its diameter looks right through its middle. three.js uses the same model.
- `thickness` is in the mesh's own units, and the object's scale multiplies it.
- Such a surface takes the `opaque` or `blend` alpha mode. `mask` and `hash` throw E1217.
- Views other than the camera's, such as [scene passes](render.md#scene-passes) and [reflection passes](render.md#reflection-passes), have no copy. There the surface shows the environment's light along the bent ray.
- A material with `transmissionMap` or `thicknessMap` takes no `specularIntensityMap` and no `specularColorMap`, because the two families of map read the same slots. Development builds throw E1217 for a material that asks for both. A layered material keeps the two maps beside a clear coat, a sheen, iridescence or anisotropy, as long as no layer map fills the slot that one of them takes: the transmission map shares the specular intensity map's slot with `clearcoatNormalMap` and `iridescenceThicknessMap`, and the thickness map shares the specular color map's slot with the sheen's maps and `anisotropyMap`. A development build throws E1217 for each such clash.

### Cost of transmission

Nothing of it runs, and none of its code or shaders download, until the first surface that lets light through draws. Then each frame copies the camera's opaque colors once and makes the blurred copies. The camera's opaque and see-through objects then draw in two render passes instead of one. The shaders of such surfaces load on their first use. To load them before the first frame instead, list `'transmission'` in `createEngine`'s `preload` option.

## Light through thin surfaces

A surface with `diffuseTransmission` lets the light that reaches its back through to its front, as glTF's `KHR_materials_diffuse_transmission` describes. A leaf, a petal, a lampshade or an ear then glows where the sun or a lamp shines behind it. The light from behind spreads out evenly, as the diffuse light does, so the surface does not show what lies behind it. For glass and water, which do, use `transmission`.

| Value | What it does |
| --- | --- |
| `diffuseTransmission` | The share of the surface's diffuse light that passes through to the other side. The front keeps the rest, and the specular reflection stays. 0 lets nothing through, and 1 lets all the diffuse light through, as a sheet of paper does |
| `diffuseTransmissionColor` | Tints the light that passes through. The base color does not tint it, so give a leaf its green here |
| `thickness`, `attenuationColor`, `attenuationDistance` | A volume under the surface, which takes the volume's color over its thickness, as for transmission |

```ts
// sketch.ts: leaves that glow yellow green against a low sun, and a red lampshade.
const leaves = materials.standard({
  color: '#3f7a2a', roughness: 0.6, doubleSided: true, alphaMode: 'mask', map: leafTexture,
  diffuseTransmission: 0.7, diffuseTransmissionColor: '#c8e070',
});
const shade = materials.standard({
  color: '#f4e6d0', doubleSided: true,
  diffuseTransmission: 0.5, diffuseTransmissionColor: '#ff9a5c',
});
```

Give `diffuseTransmission` when you create the material, even as 0, to change it later with `set`. The option picks the shaders that light the back. A material created without it lets no light through to its other side.

- Shadows fall on the light from behind. A leaf in the shade of another leaf shows no sun through it.
- The sun, the lamps, the ambient and hemisphere lights and the scene's environment all shine through from the surface's far side.
- Thin surfaces such as leaves and paper usually draw both faces, so give them `doubleSided`. A closed mesh, such as an ear or a candle, lets the light through the face that the light reaches. Give it a `thickness` with `attenuationColor` and `attenuationDistance` to tint the light by how deep it goes.
- A surface with both `transmission` and `diffuseTransmission` lets light through by transmission alone.
- `diffuseTransmissionMap` and `diffuseTransmissionColorMap` vary the two values across the surface. They take the places of the specular maps, which such a material does not take. See "Texture maps".
- A material with a clear coat, a sheen, iridescence or anisotropy, or with the `weighted` blending, takes no `diffuseTransmission`. Development builds throw E1217 for it. A glTF file's layers win over its diffuse transmission.

### Cost of light through thin surfaces

Nothing of it runs, and none of its shaders download, until the first material with `diffuseTransmission` exists. Its shaders then load on first use. To load them before the first frame instead, list `'translucency'` in `createEngine`'s `preload` option. Each pixel of such a surface adds one product per light, and one more reading of the ambient light and the environment, from behind. The sun's shadow lookup runs on both faces of such a surface, where other surfaces skip it on the side away from the sun.

## Light under the surface

Light that enters skin, wax or marble leaves it a little way from where it entered, redder the further it went. A material with `subsurfaceRadius` draws that: the subsurface blur spreads the surface's diffuse light over the radius. The edges of its shadows, the light at the side of a nose and the detail of its maps then go soft. Its highlights stay sharp, since only the diffuse light spreads.

| Value | Meaning |
| --- | --- |
| `subsurfaceRadius` | How far light spreads under the surface, in world units taken as metres. Skin takes about 0.01, wax about 0.02, and marble a few millimetres |
| `subsurfaceColor` | How far each channel spreads, as a share of the radius: its linear red, green and blue. Skin's red spreads furthest, about `[1, 0.4, 0.25]`. White spreads every channel as far |

```ts
const skin = materials.standard({
  color: '#e0b49c', roughness: 0.45,
  subsurfaceRadius: 0.012, subsurfaceColor: [1, 0.4, 0.25],
});
const wax = materials.standard({
  color: '#f3e3c8', roughness: 0.4,
  subsurfaceRadius: 0.025, subsurfaceColor: [1, 0.55, 0.32],
  diffuseTransmission: 0.35, diffuseTransmissionColor: '#ffb070',
});
```

Give `subsurfaceRadius` when you create the material, even as 0, to change it later with `set`. A material created without it draws no blur. With `diffuseTransmission` too, light from behind glows through the surface's thin parts, as through an ear or a candle's rim. The blur spreads that light as well.

- The blur draws on the High and Ultra quality presets, where the quality setting `subsurfaceSamples` gives it 17 or 25 taps. Low and Medium give it 0. So do WebGL2 and WebGPU's compatibility mode, which run Medium at most. There the material draws as without a radius. `quality.set({ subsurfaceSamples: 11 })` turns it on wherever the engine draws HDR color.
- It draws on the HDR path only. Compatibility mode with MSAA starts on the 8-bit path. A `subsurfaceSamples` setting above 0 that the page or the sketch gives moves it to HDR color with FXAA, as bloom does. A preset's taps alone do not move it. `engine.capabilities.hdr` says which path the engine started on.
- Materials that blend or let light through by `transmission`, custom materials and instance batches take no blur. Development builds throw E1217 for `subsurfaceRadius` on `materials.shader`.
- A blur narrower than a pixel draws nothing, so distant objects cost nothing more.
- The glTF loader reads the draft `KHR_materials_volume_scatter`: each channel spreads `attenuationDistance` times its `multiscatterColor`. See [Assets](assets.md).

### Cost of light under the surface

Nothing of it runs, and none of its shaders download, while no material has `subsurfaceRadius` or the quality setting gives it no taps. Its shaders then load on first use. To load them before the first frame, list `'subsurface'` in `createEngine`'s `preload` option. While it draws, the objects with a radius draw a second time, in a skin pass that shades their diffuse light into a target of their own. Two full-screen steps then blur it across and down. Each reads its taps only at skin pixels whose blur covers a pixel or more, and every other pixel reads one texel. The targets take 36 bytes per pixel of the render size.

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

Give any of these values, or a layer map, when you create the material, to change the layers later with `set`. The option picks the shader that lights the layers. A material created without them has no layers, and pays nothing for them. A coat of 0 and a black sheen draw exactly as no layers.

### Maps of the layers

| Option | Channels | What it does |
| --- | --- | --- |
| `clearcoatMap` | R, linear | Multiplies `clearcoat` |
| `clearcoatRoughnessMap` | G, linear | Multiplies `clearcoatRoughness` |
| `clearcoatNormalMap` | RGB, linear | Bends the coat's normals in tangent space, scaled by `clearcoatNormalScale` |
| `sheenColorMap` | RGB, sRGB | Multiplies `sheenColor` |
| `sheenRoughnessMap` | A | Multiplies `sheenRoughness` |

The layers' maps take the places of the light map and the specular maps. So a material with a clear coat, a sheen, iridescence or anisotropy takes no `lightMap`, `specularIntensityMap` or `specularColorMap`, and no `diffuseTransmission`. Development builds throw E1217 for them, and production builds draw the material without them. Its `specularIntensity` and `specularColor` values still apply. Give `clearcoatMap` and `clearcoatRoughnessMap` as one texture, with the coat in red and its roughness in green, and `sheenColorMap` and `sheenRoughnessMap` as one texture, with the roughness in alpha. glTF packs them this way, and two textures for a pair throw E1217. An sRGB texture keeps its alpha linear, so one sRGB texture holds the sheen's color and roughness.

A material with `transmission` keeps its `transmissionMap` and `thicknessMap` in the two specular slots beside the layers, if no layer map fills the slot that one of them takes. The transmission map shares the specular intensity map's slot with `clearcoatNormalMap` and `iridescenceThicknessMap`, and the thickness map shares the specular color map's slot with `sheenColorMap`, `sheenRoughnessMap` and `anisotropyMap`. A development build throws E1217 for a material that asks for two maps of one slot.

### How the layers draw

The engine uses the formulas of three.js's `MeshPhysicalMaterial`:

- The coat is a second GGX highlight, which reflects 4% of the light head on and all of it at grazing angles. It reflects the scene's environment at its own roughness, and the occlusion map and ambient occlusion darken that reflection.
- The sheen is the Charlie highlight of cloth (Estevez and Kulla), lit by each light, and by the ambient light and the environment. How much light the sheen keeps from the surface under it comes from three.js's curve fit of the sheen's reflectance, which needs no lookup table. At grazing angles the fit gives a little less than the exact value, so the surface under a strong sheen shows slightly brighter there than the extension's reference. three.js draws the same.
- Emitted light lies under the coat too, so a coat dims a glowing surface where it reflects.

### Cost of the layers

The layers' shaders load the first time you create a material with layers. To load them before the first frame instead, list `'coat_sheen'` in `createEngine`'s `preload` option. A layered material costs each of its pixels, per light, one more highlight for the coat and one for the sheen, and one more environment read for the coat. A layer that a material does not use costs almost nothing. Materials without layers draw as before, with no new texture and no change to their shaders.

## Iridescence and anisotropy

Two more effects sit in the same shaders as the clear coat and the sheen, and a material takes them with the same options:

- **Iridescence** is the color that a thin film adds to a reflection, as on a soap bubble, an oil slick, a beetle's shell or a pearl. The film reflects each wavelength by its own phase, so the color depends on the film's thickness and on the angle you see it from. The engine uses the formulas of three.js's `MeshPhysicalMaterial`, after Belcour and Barla.
- **Anisotropy** stretches the surface's highlight along one direction, as the grain of brushed metal spreads it across the grooves instead of around them. The engine uses the anisotropic GGX lobe of three.js's `MeshPhysicalMaterial`, after Filament.

| Value | What it does |
| --- | --- |
| `iridescence` | How much of the film's color shows, from none at 0 to all at 1 |
| `iridescenceIor` | The film's index of refraction. A value near 2 shows the colors most strongly, and 1 leaves the reflection as it was |
| `iridescenceThicknessRange` | The film's least and greatest thickness, in nanometers. Thinner films show blue and violet, and thicker ones show red and green |
| `anisotropy` | How far the highlight stretches, from a round lobe at 0 to a line at 1 |
| `anisotropyRotation` | The direction along which it stretches, in radians from the surface's tangent |

```ts
// sketch.ts: a beetle's shell and a brushed disc, in an environment's light.
scene.setEnvironment(await assets.builtinEnvironment('room'));
const shell = materials.standard({
  color: '#0d3a24', metalness: 1, roughness: 0.22,
  iridescence: 1, iridescenceIor: 1.9, iridescenceThicknessRange: [180, 620],
});
const brushed = materials.standard({
  color: '#c9ced8', metalness: 1, roughness: 0.28,
  anisotropy: 0.85, anisotropyMap: grainMap,
});
```

Give any of these values, or a map, when you create the material, to change the values later with `set`. The option picks the shaders that light the layers above the surface, which load on first use.

### Maps of iridescence and anisotropy

| Option | Channels | What it does |
| --- | --- | --- |
| `iridescenceMap` | R, linear | Multiplies `iridescence` |
| `iridescenceThicknessMap` | G, linear | Mixes `iridescenceThicknessRange` between its two values |
| `anisotropyMap` | RG direction, B strength, linear | Red and green give the direction in the tangent plane, and blue multiplies `anisotropy` |

A material with these maps takes no `lightMap` and no specular maps, since the maps take their places. A material takes the maps of a clear coat and a sheen, or the maps of iridescence and the anisotropy: the coat's and the sheen's maps fill every place. Development builds throw E1217 for a material that asks for both families. Production builds keep the coat's and the sheen's maps and draw the others' values alone. The glTF loader keeps the coat's and the sheen's maps and notes the others. A material with `transmission` keeps its `transmissionMap` and `thicknessMap` beside these maps where the slot of one stays free: `iridescenceThicknessMap` fills the transmission map's slot and `anisotropyMap` fills the thickness map's, so a material takes one of each pair.

A material with `anisotropy` needs a map, because the direction it stretches along comes from the surface's tangent frame, which the shader builds from the texture coordinates. Three.js builds that frame from the coordinates too. A material with anisotropy and no map throws E1217.

### How the film and the stretch draw

- The film's Fresnel term takes the place of the surface's own where `iridescence` applies. So the highlight and the reflection both take the film's colors, and a metal shows them over its base color.
- The film does not change the shape of the highlight, the diffuse light or the light that passes through the surface.
- The stretched lobe changes how each light's highlight spreads. The reflection of the environment about the surface bends away from the normal across the stretched direction, as three.js bends it, so brushed metal shows a long reflection rather than a dot.
- Rectangles and tubes of light shade the surface without the stretch, as three.js's rectangle lights do.

### Cost of iridescence and anisotropy

These effects add nothing to a material without them. They run in the shaders of the layers above the surface, which load the first time you create a material with a clear coat, a sheen, iridescence or anisotropy. To load them before the first frame, list `'coat_sheen'` in `createEngine`'s `preload` option. A film costs one short series of cosines per pixel, and a stretched lobe costs a few more terms per light.

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
| `bumpMap` | Standard | R, linear | Bends normals by the change of its heights, scaled by `bumpScale`. See "Relief" |
| `displacementMap` | Standard | R, linear | Moves each vertex along its normal, by `displacementScale` and `displacementBias`. See "Relief" |
| `aoMap` | Standard | R, linear | Darkens ambient light, by `aoMapIntensity` |
| `emissiveMap` | Standard | RGB, sRGB | Multiplies `emissive` times `emissiveIntensity` |
| `lightMap` | Standard | RGB | Adds baked light to the ambient light, times `lightMapIntensity` |
| `lightMapDirection` | Standard with `lightMap` | RGB, linear | The direction of the light at each texel of a directional light map, which bends the light with the normal. It is fixed when the material is created |
| `specularIntensityMap` | Standard | A, linear | Its alpha multiplies `specularIntensity` |
| `specularColorMap` | Standard | RGB, sRGB | Multiplies `specularColor` |
| `diffuseTransmissionMap` | Standard with `diffuseTransmission` | A, linear | Its alpha multiplies `diffuseTransmission` |
| `diffuseTransmissionColorMap` | Standard with `diffuseTransmission` | RGB, sRGB | Multiplies `diffuseTransmissionColor` |
| `transmissionMap` | Standard with `transmission` | R, linear | Its red multiplies `transmission`, in the place of the specular intensity map |
| `thicknessMap` | Standard with `transmission` | G, linear | Its green multiplies `thickness`, in the place of the specular color map |
| `clearcoatMap`, `clearcoatRoughnessMap`, `clearcoatNormalMap`, `sheenColorMap`, `sheenRoughnessMap` | Standard | See "Maps of the layers" | The maps of the clear coat and the sheen, in place of the light map and the specular maps |
| `iridescenceMap`, `iridescenceThicknessMap`, `anisotropyMap` | Standard | See "Maps of iridescence and anisotropy" | The maps of the thin film and the stretched lobe, in the same places |

A material with `diffuseTransmission` takes the two diffuse transmission maps in the places of the specular maps, and takes no specular maps. A material without it, or with a clear coat, a sheen, iridescence or anisotropy, takes no diffuse transmission maps. Development builds throw E1217 for either.

A material with `transmission` may take `transmissionMap` and `thicknessMap` in the places of the specular maps, and then takes no specular maps. A layered material keeps them beside its layers, unless a layer map fills the slot that one of them takes. Development builds throw E1217 for a material that asks for two maps of one slot, and for the two maps without `transmission`.

The maps of a material are fixed when you create it. A mesh needs texture coordinates to show them, and a mesh without them draws the material without its maps. A map reads the set of coordinates that its texture's `uvSet` names. Light maps usually use the second set, so load them with `uvSet: 1`. A mesh without a second set gives its first set to such a map.

A light map adds baked light to the ambient light. A bake often places its light map on each mesh with its own scale and offset, which `lightMapOffset` and `lightMapRepeat` give; the other maps keep their coordinates. A directional light map also stores the light's direction at each texel: give its `lightMapDirection` and the material's normal map bends the baked light, so relief faces the light of the bake and turns away from it. `assets.loadLightMap` reads a directional map from a [baked light file](../guides/baked-light-data.md). A material made from a model for Needle's viewer takes that model's light maps with their RGBM decode.

A normal map takes its frame from the mesh's tangents when the mesh has them, as `geometry.fromArrays` with `computeTangents` makes them. Otherwise the shader finds the frame from how the positions and the coordinates change between pixels, as three.js does.

Until a map's image reaches the GPU, the material draws as without that map.

On WebGL2, the maps of one material share at most six textures on the GPU. Maps with the same size, format and sampling count once, so a material rarely reaches the limit. [Texture arrays](textures.md#texture-arrays) says which maps a material drops past it.

## Relief

Three maps give a surface relief. Each reads heights from its red channel, in the `linear` color space. They follow three.js's options of the same names.

```ts
// sketch.ts
const [color, normal, height] = await Promise.all([
  assets.loadTexture('/rock-color.png'),
  assets.loadTexture('/rock-normal.png', { colorSpace: 'linear' }),
  assets.loadTexture('/rock-height.png', { colorSpace: 'linear' }),
]);
const rock = materials.standard({
  map: color,
  normalMap: normal,
  displacementMap: height,
  displacementScale: 0.4,
  displacementBias: -0.2,
});
scene.createMesh({ mesh: geometry.sphere({ radius: 1, widthSegments: 128, heightSegments: 64 }), material: rock });
```

| Option | What it does | Cost |
| --- | --- | --- |
| `bumpMap` | Bends the normals by the change of its heights from one pixel to the next, times `bumpScale`, as three.js's bump map does. The shape stays flat | Three texture reads per pixel |
| `displacementMap` | Moves each vertex along its normal by its height times `displacementScale`, plus `displacementBias`, in the mesh's units. The shape changes | One texture read per vertex in each pass that draws it, and three per pixel where it bends the normals |
| `parallax: true` | With a displacement map, shifts where each pixel reads the maps, so relief finer than the vertices hides and shows the surface behind it as the view turns | 8 to 32 texture reads per pixel, more at grazing views |

A bump map gives fine relief to a flat surface, such as the grain of stone. Its bend depends on the surface's size on the screen, as in three.js. A normal map wins over a bump map, so a material draws one or the other.

A displacement map changes the shape itself, so its silhouette and its shadows move too. The vertex shader reads the map at its full size, so the mesh needs about as many vertices as the detail it should show. `geometry.plane` and `geometry.sphere` take segment counts for this. The map moves vertices after skinning and morph targets, as in three.js.

- Without a normal map or a bump map, the displacement map's slope also bends the normals, so the light follows the moved surface. three.js keeps the mesh's normals there, so a port of such a material looks less flat in null3D.
- With a normal map, the normal map bends the normals, as in three.js. A normal map made from the same heights already holds their slope.
- Shadows and the depth prepass follow the moved vertices. Culling grows each object's bounds by the farthest that the material has moved a vertex, so no `setBounds` call is needed.
- Raycasts, outlines and debug views see the mesh before it moves, as three.js's raycasts do.

`parallax` adds the detail that the vertices cannot hold, such as the joints between bricks or cobbles. Silhouettes and shadows keep the vertices' shape. It takes only opaque and masked surfaces: the `blend` alpha mode and `transmission` with `parallax` throw E1217. The quality preset's `parallax` setting turns it off on Low, where such materials draw with their displacement alone.

A page without relief pays nothing for it. The first material with a bump map loads the shader builds of bump maps, and the first with a displacement map those of displacement and parallax. To load them before the first frame instead, list `'bump'` and `'displacement'` in `createEngine`'s `preload` option.

## Texture coordinate transform

`uvTransform` places every map of a material on the texture coordinates: `offset`, `repeat` and `rotation` in radians. They act as three.js's texture `offset`, `repeat` and `rotation` with the default `center`. A transform that leaves a value out takes its default. `set` changes the transform at any time. `mapUvTransforms` places one map by its option name, such as `emissiveMap`, where it differs from the others. A map without one keeps the transform that `uvTransform` gives it. A glTF file keeps a transform for each of its textures, so the loader places each map with its own.

## Color

`color`, `emissive` and `specularColor` take an sRGB color, as three.js does. That is a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three linear components from 0 to 1. The engine converts the color to linear once, when the call receives it. Any other value, such as the name `'red'`, throws E1204. The linear components of `specularColor` may also exceed 1, as glTF allows.

## Changing a material

`set(options)` changes a material's values at any time, and every object that uses the material changes with it. It changes only the options that you pass. The others keep their values, so `set({ roughness: 0.5 })` keeps the color. A standard material's `set` takes every value in the table above, and an unlit material's `set` takes `color`, `opacity`, `alphaCutoff`, `uvTransform` and `mapUvTransforms`.

`set` is for setup, and for several values at once. It reads each number from the options object that you pass. The browser boxes a read where it cannot keep a field's number unboxed. That happens in an object whose fields hold other kinds of value too, and in one of more than a few shapes. Change the values that a frame changes with `setUniform(name, value)`, which takes the value itself. `material.setUniform('roughness', 0.5 + 0.1 * Math.sin(t))` allocates nothing from a small step of your own, as the other setters do. It takes a number, as `roughness` and `emissiveIntensity` do, or a color, as `color` and `sheenColor` do. Give a color in an array that you change in place. A value that takes more than one number, as `uvTransform`, `normalScale`, `clearcoatNormalScale`, `angleFade`, `ior` and `attenuationDistance` do, goes through `set`. A custom material's `setUniform` changes one of its WGSL uniforms too, by the name in its `struct Uniforms`. `bun run bench:allocation --setters` checks `setUniform` in every frame and `set` at setup.

`set` checks every value before it changes any, so a call that throws changes nothing. It converts a color without allocating, and it reads each number by its name. Keep one options object for each material that changes. To change one object alone, give it another material with `mesh.setMaterial(material)`.

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
| `diffuseTransmission` | Standard | None | Given at all, even as 0, lets light through to the surface's other side, and `set` can then change its value. See "Light through thin surfaces" |
| `subsurfaceRadius` | Standard | None | Given at all, even as 0, spreads the surface's light under it, and `set` can then change its value. See "Light under the surface" |
| The layer values and maps | Standard | None | Any of them gives the material its layers above the surface, even a coat of 0, and `set` can then change their values. See "Clear coat and sheen" and "Iridescence and anisotropy" |
| `fog` | Both | true | Takes the scene's fog. With `false`, the material keeps its color at every distance, as with three.js's `fog: false`. [Scene](scene.md#fog) sets the fog |
| `toneMapped` | Both | true | With `false`, keeps the color as the display shows it, as with three.js's `toneMapped: false`: the tone curve leaves it alone. The 8-bit path decides that in the material's own shader. The HDR path reads a mask of these surfaces in its final pass and skips the curve where one draws. The vignette and the sRGB encoding still apply, and the exposure scales the material's colors, so the color shows brighter than the same color tone mapped. A blended surface keeps the curve on the HDR path, since a blended pixel mixes two surfaces. [Color management](../concepts/color-management.md) explains the two paths |
| `contactShadows` | Standard | true | Takes the main directional light's contact shadows. With `false`, the surface takes none and keeps the shadow map's shadows. Use it on grass, leaf cards and other thin surfaces that crowd together or sway, where contact shadows make them dark and grainy and flicker as they move. [Shadows](../concepts/shadows.md#grass-and-other-thin-surfaces) explains why |
| `wireframe` | Both | false | Draws the edges of each triangle as lines one pixel wide, with the material's own shading, as three.js's `wireframe` does. See "Wireframe" |
| `parallax` | Standard | false | With a `displacementMap`, adds parallax occlusion mapping. See "Relief" |
| `sceneInputs` | Custom | None | The scene inputs that the material's WGSL reads, which fix its shader. `['sceneDepth']` binds the copy of the opaque scene's depth. See "The scene behind a surface" |

A material with `vertexColors` draws a mesh without colors in its base color alone. The kind of material, standard or unlit, is fixed too.

### Wireframe

A material with `wireframe: true` draws each triangle's three edges as lines, as three.js does. An edge that two triangles share draws twice. The engine keeps an edge list for each mesh from the first wireframe on, which takes twice the GPU memory of the mesh's triangle indices. Its shadows draw lines too. Flat shading and bump maps have no effect, as in three.js, because lines have no faces. Lines are one pixel wide on every GPU path. For wide lines, or for a mesh's outline edges alone, use [Lines](lines.md).

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

A material can add its own specular lobe for the main directional light with `fn lobe(input: LobeInput) -> vec3f`. The engine adds the color it returns to that light's specular. Point, spot and area lights draw with the base lobe only. [Surface functions](../shaders/surface-functions.md#a-materials-own-lobe) describes the lobe input.

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

The WGSL can also declare a texture array, `var name: texture_2d_array<f32>;`, and pick its layer in the shader, so one array serves a set of facade or window images. The `textures` option then gives a texture of several layers, such as one that `textures.fromData({ width, height, depth: 6, data })` makes. [Textures](../shaders/surface-functions.md#textures) on the Surface functions page gives the rules.

A texture samples as white until its image is on the GPU.

### The scene behind a surface

A surface function can read the depth of the opaque scene behind it. This gives water its shallow color near a shore and its deep color farther out, and foam where a rock nearly touches the surface. Call `sceneDistance(uv)` for the distance in front of the camera of the surface behind the point at the screen's place `uv`, or `sceneDepth(uv)` for its depth value. Declare the input in the `sceneInputs` option:

```ts
const water = /* wgsl */ `
struct Uniforms { shallow: vec3f, deep: vec3f, foam: vec3f }

/// The distance in front of the camera of a depth value, as sceneDistance converts the copy's.
fn distance_of(depth: f32) -> f32 {
    let near = engine_frame.camera_range.x;
    let far = engine_frame.camera_range.y;
    if engine_frame.camera_position.w > 0.5 {
        return near * far / (near + depth * (far - near));
    }
    return far - depth * (far - near);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let uv = input.fragCoord.xy / frame.resolution;
    // The water's depth along the view ray: the gap to the surface behind the sheet.
    let gap = max(sceneDistance(uv) - distance_of(input.fragCoord.z), 0.0);
    s.baseColor = mix(material.shallow, material.deep, smoothstep(0.05, 1.5, gap));
    s.baseColor = mix(s.baseColor, material.foam, 1.0 - smoothstep(0.0, 0.12, gap));
    s.alpha = smoothstep(0.0, 0.12, gap);
    return s;
}
`;
const sheet = materials.shader({
    wgsl: water,
    sceneInputs: ['sceneDepth'],
    alphaMode: 'blend',
    depthWrite: false,
    uniforms: { shallow: '#8fe0d2', deep: '#0b4a63', foam: '#f2fbff' },
});
```

- `sceneDepth(uv)` gives the scene's depth with 1 at the camera's near plane and 0 at its far plane, and 0 where nothing drew.
- `sceneDistance(uv)` gives the distance in front of the camera of that surface, in world units.
- The water's depth is the gap between the sheet and the surface behind it. Convert the sheet's own depth, `input.fragCoord.z`, to a distance with `engine_frame.camera_range`, and subtract it from `sceneDistance(uv)`. A shore that fades over that gap ends softly against the bank instead of on the sheet's edge.
- `input.fragCoord` counts pixels from the top left of the render target on both GPU paths, so `input.fragCoord.xy / frame.resolution` is the `uv` of the point.
- The engine copies the opaque scene's depth after the opaque pass and before the transparent pass. A blended surface therefore reads the surfaces behind it.
- A surface in the opaque pass reads 0, the far plane, because the copy comes later. A surface in a scene pass or a reflection pass reads 0 too, because its view makes no copy.
- The copy is made while a material that declares the input draws, whatever the quality preset says. It costs one full-screen pass and one texture of four bytes for each pixel.
- On WebGL2 the copy holds the depth that the device stores. Where the device draws `reversed-gl` depth, `sceneDistance` is less precise. The engine draws `reversed` depth where the browser has `EXT_clip_control`.
- A material that reads the scene's depth takes up to seven textures of its own: its maps' group gives up one slot, so that the copy of the depth fits the fragment stage beside the maps under WebGPU's limit of 16 sampled textures. A material that declares eight textures beside the depth is refused, and development builds throw E1217 and name how many to drop.
- The declaration and the WGSL must agree. Development builds throw E1217 for a declaration that the WGSL never uses, and for WGSL that reads the depth without the declaration. They throw it for a scene input that custom materials do not read yet too.

[Surface functions](../shaders/surface-functions.md#the-scenes-depth) shows the helpers among the WGSL.

A surface function can set a clear coat and a sheen too, such as a coat where a stone is wet. The WGSL sets the surface's `clearcoat`, `clearcoatRoughness`, `clearcoatNormal`, `sheenColor`, `sheenRoughness`, `iridescence`, `iridescenceIor` or `iridescenceThickness`. Only WGSL that names one of them has the shaders that light the layers. The layer options of such a material give `defaultSurface` its values, and WGSL that never names them throws E1217 when you give it a layer option. [Layers](../shaders/surface-functions.md#clear-coat-and-sheen) on the Surface functions page shows the WGSL.

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

`opacity`, `alphaCutoff`, `metalness`, `roughness`, `aoMapIntensity`, `transmission`, `diffuseTransmission`, `clearcoat`, `clearcoatRoughness`, `sheenRoughness` and `edgeFade` go from 0 to 1, and `emissiveIntensity`, `lightMapIntensity`, `thickness` and `subsurfaceRadius` take 0 or more. `attenuationDistance` takes more than 0. The two angles of `angleFade` go from 0 to π, the first no larger than the second. The numbers of `normalScale`, `clearcoatNormalScale`, `uvTransform`, `mapUvTransforms`, `bumpScale`, `displacementScale` and `displacementBias` must be finite. When a factory or `set` gets a value outside its range, development builds throw E1108. An `alphaMode` or a `blending` that the engine does not know throws E1217. So does the `weighted` blending on a custom material or a material with `transmission`. A depth bias that is not a finite number throws E1203. The `opaque` alpha mode ignores the opacity.

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
