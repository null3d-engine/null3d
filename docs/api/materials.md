---
id: api/materials
title: Materials
status: experimental
since: "0.1"
summary: "standard, unlit, shader, shadowCatcher; every option."
---

# Materials

> Ships in null3D 0.1, with typed uniforms, custom material textures, `destroy`, and the specular and index of refraction values in 0.2. The API is experimental, so it can still change between versions. `materials.shadowCatcher` is not built yet, and `materials.shader` takes no standard texture maps. Coding agents must not use the parts that are not built.

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

Without lights, a standard material draws black, apart from its emissive color. [Lights](lights.md) explains how light colors and intensities shade it.

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
| `uvTransform` | An offset, a repeat and a rotation | None | Where the maps sit on the texture coordinates |

The values have the meaning and the defaults of three.js's `MeshStandardMaterial`. `ior`, `specularIntensity` and `specularColor` have those of three.js's `MeshPhysicalMaterial`, as the next section explains. A metal takes its color from what it reflects. Without an environment, a smooth metal shows little more than its highlights, so give the scene one with [`scene.setEnvironment`](scene.md#the-environment). three.js uses `scene.environmentIntensity` in place of `envMapIntensity` under a scene environment. The engine multiplies the two.

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

`set` checks every value before it changes any, so a call that throws changes nothing. Converting a new color allocates a little, as a light's `setColor` does, so do not change a color in every frame. To change one object alone, give it another material with `mesh.setMaterial(material)`.

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
| `alphaMode` | Both | `'opaque'` | How the material uses its alpha: `'opaque'`, `'mask'` or `'blend'`. See "Alpha modes" |
| `blending` | Both | `'normal'` | With the `blend` alpha mode, how the surface meets what lies behind it: `'normal'`, `'additive'` or `'multiply'`. See "Blending" |
| `depthWrite` | Both | true | False writes no depth, so the surface hides nothing that draws after it |
| `depthTest` | Both | true | False draws the surface whatever lies in front of it. It then writes no depth either, as in three.js's WebGL renderer |
| `depthBias` | Both | No bias | Moves the surface's depth, as three.js's polygon offset does. See "Depth bias" |
| `fog` | Both | true | Takes the scene's fog. With `false`, the material keeps its color at every distance, as with three.js's `fog: false`. [Scene](scene.md#fog) sets the fog |

A material with `vertexColors` draws a mesh without colors in its base color alone. The kind of material, standard or unlit, is fixed too.

## Alpha modes

A surface's alpha is its `opacity`, times the alpha of its base color map. With `vertexColors`, the alpha of the mesh's vertex colors multiplies it too. `alphaMode` says how the material uses the alpha:

| Mode | What it draws | three.js |
| --- | --- | --- |
| `'opaque'` | The whole surface, opaque. The alpha has no effect | The default material |
| `'mask'` | Nothing where the alpha is below `alphaCutoff`, and the rest opaque | `alphaTest: alphaCutoff` |
| `'blend'` | The surface blended over what lies behind it, as far as the alpha says | `transparent: true` |

A masked surface has hard edges, and it hides what lies behind it as an opaque one does, so its objects draw in any order. Use it for leaves, fences and cut-out shapes. Only masked materials draw with the shader that drops fragments, so opaque ones keep the GPU's early depth test.

A blended surface lets what lies behind it show through. Blended objects draw after the opaque ones, farthest first, so each one blends over the objects behind it. A call to `mesh.setRenderOrder(order)` draws an object before or after the others, whatever its depth. The rows of an instance batch sort one by one. The page [Materials and pipelines](../concepts/materials.md#the-transparent-pass) explains the sort. It also says where the sort cannot help.

A blended material writes depth, as three.js's transparent materials do. Give particles, glows and other surfaces that cross `depthWrite: false`, so they never hide each other.

```ts
// sketch.ts: leaves whose vertex alpha cuts their shape.
const leaves = materials.standard({ color: '#5bc27a', vertexColors: true, alphaMode: 'mask', alphaCutoff: 0.4 });
// Later: a lower cutoff grows the leaves, at no cost.
leaves.set({ alphaCutoff: 0.2 });
```

## Blending

`blending` says how a blended surface meets what lies behind it. It has an effect with the `blend` alpha mode only.

| Blending | What it does | Use it for |
| --- | --- | --- |
| `'normal'` | Covers what lies behind, as far as the alpha says | Glass, fading objects, smoke |
| `'additive'` | Adds the surface's light to what lies behind, times the alpha | Glows, fire, sparks, lasers |
| `'multiply'` | Tints what lies behind by the surface's color, as far as the alpha says | Stains, shadows painted on, tinted film |

The engine blends colors multiplied by their alpha, as three.js does with `premultipliedAlpha: true`. The results match three.js's own blending, and textures loaded with `premultipliedAlpha: true` blend correctly too.

```ts
// sketch.ts: a pane of glass and a glow that never hides what it crosses.
const glass = materials.standard({ color: '#a8d8ff', opacity: 0.3, roughness: 0.1, alphaMode: 'blend' });
const glow = materials.unlit({ color: '#ffb040', alphaMode: 'blend', blending: 'additive', depthWrite: false });
```

## Depth bias

`depthBias: { constant, slopeScale }` moves a surface's depth before the depth test. A decal that lies on a wall has the wall's depth, so without a bias the two fight pixel by pixel. A bias toward the camera makes the decal win.

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

With `alphaMode: 'mask'`, the pixels where the surface function's `alpha` falls below `alphaCutoff` draw nothing. Materials made from the same WGSL share one shader, and each has its own uniforms. A mesh needs texture coordinates to draw with a custom material. WGSL as plain text, which the plugin did not compile, throws E1215. So does a whole shader that is not a [full shader](../guides/custom-shaders.md#full-shaders) of a material. A uniform or a texture that the WGSL does not declare, or a value of the wrong kind, throws E1216. The WGSL can also move the mesh's vertices with a vertex offset. [Surface functions](../shaders/surface-functions.md) describes the WGSL.

## Ranges

`opacity`, `alphaCutoff`, `metalness`, `roughness` and `aoMapIntensity` go from 0 to 1, and `emissiveIntensity` and `lightMapIntensity` take 0 or more. The numbers of `normalScale` and `uvTransform` must be finite. When a factory or `set` gets a value outside its range, development builds throw E1108. An `alphaMode` or a `blending` that the engine does not know throws E1217, and a depth bias that is not a finite number throws E1203. The `opaque` alpha mode ignores the opacity.

## Limits

One engine holds up to 1,024 materials at once. One more throws E1501. A material lasts until `destroy`, or as long as the engine. Create materials once in the setup and share them, and never create one per object or per frame.

## Related pages

- [Scene](scene.md): creating meshes with a material.
- [Objects and transforms](objects.md): `setMaterial` on a mesh.
- [Lights](lights.md): what lights a standard material.
- [Surface functions](../shaders/surface-functions.md): the WGSL of a custom material.
- [Math helpers](math.md#colors): sRGB and linear colors.

## API reference

<!-- null3d:api:start -->

### `AlphaMode`

```ts
type AlphaMode = 'opaque' | 'mask' | 'blend';
```

How a material uses its alpha: its opacity, times its base color map's alpha, and times its mesh's vertex alpha with `vertexColors`. The `opaque` mode ignores the alpha. The `mask` mode draws nothing where the alpha falls below `alphaCutoff`, and draws the rest opaque, as three.js's `alphaTest` does. The `blend` mode blends the surface over what lies behind it, as three.js's `transparent: true` does. Blended objects draw after the opaque ones, farthest first.

### `Blending`

```ts
type Blending = 'normal' | 'additive' | 'multiply';
```

How a blended surface meets what lies behind it. The `normal` blending covers it as far as the alpha says. The `additive` blending adds the surface's light, for glows and fire. The `multiply` blending tints it, for stains and tinted glass.

### `ColorInput`

```ts
type ColorInput = string | number | readonly [number, number, number];
```

A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three linear components from 0 to 1, such as `[1, 0.26, 0.05]`. Hex values are sRGB, as on the web and in three.js, and the engine converts them to linear values. The color helpers, such as `color.fromHsl`, give linear components.

### `CompiledWgsl`

Interface `CompiledWgsl`.

WGSL that the null3D Vite plugin compiled: a template literal that a `wgsl` block comment tags, or a `.wgsl` file that a module imports. TypeScript sees a tagged literal as a string, and the plugin puts the compiled WGSL in its place.

| Member | Description |
| --- | --- |
| `readonly kind: 'material' \| 'effect' \| 'toneCurve' \| 'shader'` | `'material'` for the functions of a custom material, `'effect'` for a custom effect, `'toneCurve'` for a custom tone curve, and `'shader'` for a whole shader. |

### `DepthBias`

Interface `DepthBias`.

A depth bias, as three.js's polygon offset gives. It moves a surface's depth, so a decal on a wall wins the depth test and does not fight with the wall. Negative values pull the surface toward the camera, as in three.js.

| Member | Description |
| --- | --- |
| `constant?: number` | Steps of the depth buffer's smallest difference, as three.js's `polygonOffsetUnits`. A fraction rounds to the nearest whole number, as WebGPU takes it. The default is 0. |
| `slopeScale?: number` | A factor of how steeply the surface's depth changes across the screen, as three.js's `polygonOffsetFactor`. The default is 0. |

### `Material`

Class `Material`.

A material: how the surfaces of the objects that use it look. `Values` are the options that `set` changes.

| Member | Description |
| --- | --- |
| `set(options: Values): void` | Changes the values that it gets and keeps the others. Every object that uses the material changes with it. Converting a new color allocates. Throws E1101 once the material is destroyed. |
| `destroy(): void` | Destroys the material, like three.js's `material.dispose()`. Objects and instance batches that still use it draw nothing until `setMaterial` gives them another material. Once no object uses it, its place in the engine's table of materials goes to the next material. When the last material of a custom material's WGSL goes, the engine frees that WGSL's pipelines. The material's textures stay, so destroy them apart. Later calls on the material, and calls that pass it, throw E1101. |

### `MaterialFeatures`

Interface `MaterialFeatures`.

The options that choose how a material's shader and pipeline draw it. They are fixed when the material is created, as most of them would need a new pipeline.

| Member | Description |
| --- | --- |
| `doubleSided?: boolean` | Draws both faces of each triangle. Back faces light as if they faced the camera. The default is false. |
| `vertexColors?: boolean` | Multiplies the base color by the mesh's vertex colors, and the alpha by their alpha, on meshes that have them. The default is false. |
| `fog?: boolean` | Takes the scene's fog. False keeps the material's color at every distance. The default is true. |
| `alphaMode?: AlphaMode` | How the material uses its alpha. The default is `opaque`. |
| `blending?: Blending` | With the `blend` alpha mode, how the surface meets what lies behind it. The default is `normal`. |
| `depthWrite?: boolean` | False to write no depth, so the surface hides nothing behind it. The default is true. |
| `depthTest?: boolean` | False to draw the surface whatever lies in front of it. It then writes no depth either, as in three.js's WebGL renderer. The default is true. |
| `depthBias?: DepthBias` | Moves the surface's depth, as three.js's polygon offset does. The default is no bias. |

### `MaterialOptions`

Interface `MaterialOptions`.

Options every material takes.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The base color: a hex string or a number in sRGB, or three linear components from 0 to 1. |
| `opacity?: number` | How opaque the surface is, from 0 to 1. The default is 1. It is part of the alpha, which the `mask` alpha mode tests and the `blend` alpha mode blends with. The `opaque` alpha mode ignores it. |
| `alphaCutoff?: number` | With the `mask` alpha mode, the alpha below which the surface draws nothing, from 0 to 1. The default is 0.5, as in glTF. |

### `Materials`

Class `Materials`.

Material factories. The standard material follows glTF's metallic-roughness model and shades with the formulas of three.js's `MeshStandardMaterial`. The unlit material shows its color as three.js's `MeshBasicMaterial` does.

| Member | Description |
| --- | --- |
| `standard(options: StandardOptions = {}): Material<StandardValues>` | A lit material with glTF's metallic-roughness model, like three.js's `MeshStandardMaterial`. |
| `unlit(options: UnlitOptions = {}): Material<UnlitValues>` | A material that ignores lights and shows its color unlit, like three.js's `MeshBasicMaterial`. The exposure and the tone mapping still apply to it, as three.js applies them to that material. |
| `shader<const Wgsl extends string \| CompiledWgsl>(options: ShaderOptions<Wgsl>): Material<ShaderValues<Wgsl>>` | A custom material: the standard material with a surface function in WGSL, which changes how each pixel of the surface looks before the engine lights it, or a full shader of your own. It takes every option of `materials.standard` but the texture maps, the first values of the uniforms that its WGSL declares, and the textures that its WGSL samples. `set` changes the standard values and the uniforms. Meshes need texture coordinates to draw with a surface function, and the attributes that a full shader reads. Throws E1215 for WGSL that the null3D Vite plugin did not compile, and for a whole shader whose `@vertex` entry point takes no `InstanceIn`. Throws E1216 for a uniform or a texture that the WGSL does not declare, for a value of the wrong kind, and for a uniform named as a standard value, such as `color`. When TypeScript can see the WGSL, a wrong name or a value of the wrong kind also fails the type check. |

### `ShaderOptions`

Interface `ShaderOptions`, which extends `StandardBaseOptions`.

Options of `materials.shader`: the material's WGSL, the first values of its uniforms, and the textures that its WGSL samples. It also takes every option of `materials.standard` but the texture maps. `defaultSurface` applies the standard values. Custom materials take no standard maps, so the values of maps have no effect on them. `Wgsl` is the type of the material's WGSL. It gives the names and types of the uniforms, and the names of the textures.

| Member | Description |
| --- | --- |
| `wgsl: Wgsl` | The material's WGSL, compiled by the null3D Vite plugin. It declares `fn surface(input: SurfaceInput) -> Surface`, which the engine calls for each pixel, and which can start from `defaultSurface(input)`. The engine lights the surface that it returns. It can declare `struct Uniforms`, whose fields the surface function reads from `material`, and `fn vertexOffset`, which moves the mesh's vertices. A full shader has a `@vertex` entry point that takes an `InstanceIn`, and a `@fragment` one, instead. Materials made from the same WGSL share their shader. |
| `uniforms?: NoInfer<[keyof UniformValues<Wgsl>] extends [never] ? { readonly [name: string]: never; } : UniformValues<Wgsl>>` | The first value of each uniform, by name. A uniform without one starts at 0. When TypeScript can see the WGSL's uniforms, a name that the WGSL does not declare fails the type check, and WGSL without uniforms takes none. |
| `textures?: NoInfer<TextureValues<Wgsl>>` | The texture of each `var name: texture_2d<f32>;` that the WGSL declares, by name. The WGSL samples it as `textureSample(name, nameSampler, uv)`, with the sampler of the texture's `wrap` and `filter` options. A texture samples as white until its image is on the GPU, and a declared texture without one stays white. The textures are fixed when the material is created. When TypeScript can see the WGSL, a name that it does not declare fails the type check. |

### `ShaderValues`

```ts
type ShaderValues<Wgsl = string | CompiledWgsl> = [Wgsl] extends [unknown] ? Omit<StandardValues, 'uvTransform'> & UniformValues<Wgsl> : never;
```

The values of a custom material, which `set` changes at any time: the standard values but the texture coordinate transform of maps, and the uniforms that its WGSL's `struct Uniforms` declares, by name. `Wgsl` is the type of the material's WGSL, which gives the uniforms' names and types, as `WgslUniforms` says.

### `StandardBaseOptions`

Interface `StandardBaseOptions`, which extends `StandardValues`, `MaterialFeatures`.

The options of `materials.standard` besides its texture maps. Custom materials take them too.

| Member | Description |
| --- | --- |
| `flatShading?: boolean` | Lights each triangle with one normal, the normal of its face, so the mesh looks faceted. It is fixed when the material is created. The default is false. |

### `StandardMaps`

Interface `StandardMaps`.

The texture maps of a standard material. They are fixed when the material is created, because each set of maps draws with a pipeline of its own. A map reads the texture coordinates that its texture's `uvSet` names, through the material's `uvTransform`. Meshes need texture coordinates to show maps, and the material draws without a map until its texture's image is on the GPU.

| Member | Description |
| --- | --- |
| `map?: Texture` | The base color map, in sRGB. Its color multiplies `color`. |
| `metalnessRoughnessMap?: Texture` | Roughness in green and metalness in blue, as glTF packs them, in linear color. They multiply `roughness` and `metalness`. |
| `normalMap?: Texture` | Normals in tangent space, in linear color, which `normalScale` scales. |
| `aoMap?: Texture` | Ambient occlusion in red, in linear color, which darkens ambient light. |
| `emissiveMap?: Texture` | The emissive color map, in sRGB. Its color multiplies `emissive`. |
| `lightMap?: Texture` | Baked light, added to the ambient light. Light maps usually use the second coordinates. |
| `specularIntensityMap?: Texture` | The specular intensity in alpha, in linear color. Its alpha multiplies `specularIntensity`. |
| `specularColorMap?: Texture` | The specular color, in sRGB. Its color multiplies `specularColor`. |

### `StandardOptions`

Interface `StandardOptions`, which extends `StandardBaseOptions`, `StandardMaps`.

Options of `materials.standard`.

### `StandardValues`

Interface `StandardValues`, which extends `MaterialOptions`.

The values of a standard material, which `set` changes at any time.

| Member | Description |
| --- | --- |
| `metalness?: number` | How much the surface acts like a metal, from 0 to 1. The default is 0. |
| `roughness?: number` | How rough the surface is, from 0 (a mirror) to 1 (fully matte). The default is 1. |
| `emissive?: ColorInput` | The color the surface gives off without any light, in the forms that `color` takes. The default is black, which gives off nothing. |
| `emissiveIntensity?: number` | The factor of the emissive color: 0 or more. The default is 1. |
| `normalScale?: readonly [number, number]` | How strongly the normal map bends normals along u and along v. The default is `[1, 1]`, and negative values flip a direction. |
| `aoMapIntensity?: number` | How much the occlusion map darkens ambient light, from 0 to 1. The default is 1. |
| `lightMapIntensity?: number` | The factor of the light map's light: 0 or more. The default is 1. |
| `ior?: number` | The index of refraction of the surface's non-metallic part, 1 or more, as three.js's `MeshPhysicalMaterial.ior`. It sets how much light the surface reflects when seen head on: `((ior - 1) / (ior + 1))^2`. The default is 1.5, which reflects 4%, as glTF's metallic-roughness model does. |
| `specularIntensity?: number` | The strength of the specular reflection of the surface's non-metallic part, from 0 to 1, as three.js's `specularIntensity`. It scales the reflection at every angle, so 0 leaves only diffuse light. Metals ignore it. The default is 1. |
| `specularColor?: ColorInput` | The color that tints the specular reflection of the surface's non-metallic part when seen head on, as three.js's `specularColor`. At grazing angles the reflection stays white, and metals ignore it. It takes the forms that `color` takes, and its three linear components may also exceed 1, as glTF allows, to reflect more than the index of refraction gives, up to all the light. The default is white. |
| `envIntensity?: number` | The factor of the scene environment's light on the surface, 0 or more, as three.js's `envMapIntensity`. It multiplies the intensity that `scene.setEnvironment` gives. The default is 1. |
| `uvTransform?: UvTransform` | Where the maps sit on the texture coordinates. The default leaves them as they are. |

### `TextureValues`

```ts
type TextureValues<Wgsl> = string extends WgslTextures<Wgsl> ? { readonly [name: string]: Texture | undefined; } : [WgslTextures<Wgsl>] extends [never] ? { readonly [name: string]: never; } : { readonly [Name in WgslTextures<Wgsl>]?: Texture; };
```

The textures of a custom material by name, each optional, which the `textures` option takes. A name that the WGSL does not declare fails the type check. WGSL whose textures TypeScript cannot see takes any name, and the engine checks the names when it runs.

### `UniformType`

```ts
type UniformType = 'f32' | 'i32' | 'u32' | 'vec2f' | 'vec3f' | 'vec4f';
```

A type that a uniform of custom WGSL can have, as a field of its `struct Uniforms`.

### `UniformValue`

```ts
type UniformValue = number | string | readonly number[];
```

The value of a uniform whose type TypeScript cannot see. An `f32`, `i32` or `u32` uniform takes a number, and a `vec2f`, `vec3f` or `vec4f` uniform takes an array of 2, 3 or 4 numbers. A `vec3f` uniform also takes an sRGB color as `color` takes it, which the engine converts to linear.

### `UniformValueByType`

Interface `UniformValueByType`.

The value that a uniform of each type takes. An `f32`, `i32` or `u32` uniform takes a number, and `i32` and `u32` take whole numbers. A `vec2f` or `vec4f` uniform takes 2 or 4 numbers. A `vec3f` uniform takes 3 numbers, or an sRGB color as `color` takes it, which the engine converts to linear.

| Member | Description |
| --- | --- |
| `f32: number` | A number. |
| `i32: number` | A whole number. |
| `u32: number` | A whole number, 0 or more. |
| `vec2f: readonly [number, number]` | Two numbers. |
| `vec3f: ColorInput` | Three numbers, or a color. |
| `vec4f: readonly [number, number, number, number]` | Four numbers. |

### `UniformValues`

```ts
type UniformValues<Wgsl> = WgslUniforms<Wgsl> extends infer Uniforms extends { readonly [name: string]: UniformType; } ? string extends keyof Uniforms ? { readonly [name: string]: UniformValue | undefined; } : { readonly [Name in keyof Uniforms]?: UniformValueByType[Uniforms[Name]]; } : never;
```

The values of WGSL's uniforms by name, each optional and of the kind that its type takes. The `uniforms` option and `set` of a custom material take them. A name that the WGSL does not declare fails the type check. WGSL whose uniforms TypeScript cannot see takes any name, and the engine checks the names when it runs.

### `UnlitOptions`

Interface `UnlitOptions`, which extends `UnlitValues`, `MaterialFeatures`.

Options of `materials.unlit`.

| Member | Description |
| --- | --- |
| `map?: Texture` | A color map, in sRGB, whose color multiplies `color`. It is fixed when the material is created, and meshes need texture coordinates to show it. |

### `UnlitValues`

Interface `UnlitValues`, which extends `MaterialOptions`.

The values of an unlit material, which `set` changes at any time.

| Member | Description |
| --- | --- |
| `uvTransform?: UvTransform` | Where the map sits on the texture coordinates. The default leaves it as it is. |

### `UvTransform`

Interface `UvTransform`.

Where a material's maps sit on the texture coordinates, as three.js's texture `offset`, `repeat` and `rotation` place a texture, with its `center` at the coordinates' origin. A transform that leaves a value out takes its default.

| Member | Description |
| --- | --- |
| `offset?: readonly [number, number]` | The shift along u and v. The default is `[0, 0]`. |
| `repeat?: readonly [number, number]` | How many times the maps repeat along u and v. The default is `[1, 1]`. |
| `rotation?: number` | The turn in radians, about the coordinates' origin. The default is 0. |

### `WgslTextures`

```ts
type WgslTextures<Wgsl> = [Wgsl] extends [string] ? TextTextures<Wgsl, never> : CompiledTextures<Wgsl>;
```

The names of the textures that WGSL declares as `var name: texture_2d<f32>;`, as one union, such as `'detail' | 'noise'`. TypeScript sees them in a template literal that a `wgsl` block comment tags. It sees them in a `.wgsl` file once the null3D Vite plugin has written the file's declaration. WGSL whose textures TypeScript cannot see gives `string`, which takes any name.

### `WgslUniforms`

```ts
type WgslUniforms<Wgsl> = [Wgsl] extends [string] ? TextUniforms<Wgsl> : CompiledUniforms<Wgsl>;
```

The uniforms that WGSL declares as the fields of its `struct Uniforms`, each name with its type, such as `{ tint: 'vec3f'; width: 'f32' }`. TypeScript sees them in a template literal that a `wgsl` block comment tags. It sees them in a `.wgsl` file once the null3D Vite plugin has written the file's declaration. WGSL whose uniforms TypeScript cannot see, such as text in a `string` variable, gives a record that takes any name.

<!-- null3d:api:end -->
