---
id: api/reference/materials
title: "Materials: API reference"
status: generated
since: "0.1"
summary: "Every export of the Materials API, from the engine's doc comments."
---

# Materials: API reference

> [Materials](../materials.md) explains these exports. The engine's doc comments make this page.

## `AlphaMode`

```ts
type AlphaMode = 'opaque' | 'mask' | 'hash' | 'blend';
```

How a material uses its alpha: its opacity, times its base color map's alpha, and times its mesh's vertex alpha with `vertexColors`. The `opaque` mode ignores the alpha. The `mask` mode draws nothing where the alpha falls below `alphaCutoff`, and draws the rest opaque, as three.js's `alphaTest` does. The `hash` mode draws each point of the surface opaque or not at all, by a pattern that stays on the mesh. The alpha then sets how much of the surface draws, as three.js's `alphaHash` does. The `blend` mode blends the surface over what lies behind it, as three.js's `transparent: true` does. Blended objects draw after the opaque ones, farthest first.

## `Blending`

```ts
type Blending = 'normal' | 'additive' | 'multiply';
```

How a blended surface meets what lies behind it. The `normal` blending covers it as far as the alpha says. The `additive` blending adds the surface's light, for glows and fire. The `multiply` blending tints it, for stains and tinted glass.

## `ColorInput`

```ts
type ColorInput = string | number | readonly [number, number, number];
```

A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three linear components from 0 to 1, such as `[1, 0.26, 0.05]`. Hex values are sRGB, as on the web and in three.js, and the engine converts them to linear values. The color helpers, such as `color.fromHsl`, give linear components.

## `CompiledWgsl`

Interface `CompiledWgsl`.

WGSL that the null3D Vite plugin compiled: a template literal that a `wgsl` block comment tags, or a `.wgsl` file that a module imports. TypeScript sees a tagged literal as a string, and the plugin puts the compiled WGSL in its place.

| Member | Description |
| --- | --- |
| `readonly kind: 'material' \| 'effect' \| 'toneCurve' \| 'shader'` | `'material'` for the functions of a custom material, `'effect'` for a custom effect, `'toneCurve'` for a custom tone curve, and `'shader'` for a whole shader. |

## `DepthBias`

Interface `DepthBias`.

A depth bias, as three.js's polygon offset gives. It moves a surface's depth, so a decal on a wall wins the depth test and does not fight with the wall. Negative values pull the surface toward the camera, as in three.js.

| Member | Description |
| --- | --- |
| `constant?: number` | Steps of the depth buffer's smallest difference, as three.js's `polygonOffsetUnits`. A fraction rounds to the nearest whole number, as WebGPU takes it. The default is 0. |
| `slopeScale?: number` | A factor of how steeply the surface's depth changes across the screen, as three.js's `polygonOffsetFactor`. The default is 0. |

## `Material`

Class `Material`.

A material: how the surfaces of the objects that use it look. `Values` are the options that `set` changes.

| Member | Description |
| --- | --- |
| `set(options: Values): void` | Changes the values that it gets and keeps the others. Every object that uses the material changes with it. Converting a new color allocates. Throws E1101 once the material is destroyed. |
| `destroy(): void` | Destroys the material, like three.js's `material.dispose()`. Objects and instance batches that still use it draw nothing until `setMaterial` gives them another material. Once no object uses it, its place in the engine's table of materials goes to the next material. When the last material of a custom material's WGSL goes, the engine frees that WGSL's pipelines. The material's textures stay, so destroy them apart. Later calls on the material, and calls that pass it, throw E1101. |

## `MaterialFeatures`

Interface `MaterialFeatures`.

The options that choose how a material's shader and pipeline draw it. They are fixed when the material is created, as most of them would need a new pipeline.

| Member | Description |
| --- | --- |
| `doubleSided?: boolean` | Draws both faces of each triangle. Back faces light as if they faced the camera. The default is false. |
| `vertexColors?: boolean` | Multiplies the base color by the mesh's vertex colors, and the alpha by their alpha, on meshes that have them. The default is false. |
| `fog?: boolean` | Takes the scene's fog. False keeps the material's color at every distance. The default is true. |
| `alphaMode?: AlphaMode` | How the material uses its alpha. The default is `opaque`. |
| `alphaToCoverage?: boolean` | With the `mask` alpha mode, smooths the cut edges with MSAA, as three.js's `alphaToCoverage` does: the alpha fades over about one pixel above `alphaCutoff`, and covers that share of the pixel. Without MSAA the mask cuts as without it. False gives three.js's hard cut edges of `alphaTest`. Custom materials do not take it. The default is true. |
| `forceSinglePass?: boolean` | With the `blend` alpha mode and `doubleSided`, draws both faces in one draw, in the mesh's order, as three.js's `forceSinglePass` does. By default such a surface draws its back faces first and then its front faces, so its near side always covers its far side. The default is false. |
| `blending?: Blending` | With the `blend` alpha mode, how the surface meets what lies behind it. The default is `normal`. |
| `depthWrite?: boolean` | False to write no depth, so the surface hides nothing behind it. The default is true. |
| `depthTest?: boolean` | False to draw the surface whatever lies in front of it. It then writes no depth either, as in three.js's WebGL renderer. The default is true. |
| `depthBias?: DepthBias` | Moves the surface's depth, as three.js's polygon offset does. The default is no bias. |

## `MaterialOptions`

Interface `MaterialOptions`.

Options every material takes.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The base color: a hex string or a number in sRGB, or three linear components from 0 to 1. |
| `opacity?: number` | How opaque the surface is, from 0 to 1. The default is 1. It is part of the alpha, which the `mask` alpha mode tests and the `blend` alpha mode blends with. The `opaque` alpha mode ignores it. |
| `alphaCutoff?: number` | With the `mask` alpha mode, the alpha below which the surface draws nothing, from 0 to 1. The default is 0.5, as in glTF. |

## `Materials`

Class `Materials`.

Material factories. The standard material follows glTF's metallic-roughness model and shades with the formulas of three.js's `MeshStandardMaterial`. The unlit material shows its color as three.js's `MeshBasicMaterial` does.

| Member | Description |
| --- | --- |
| `standard(options: StandardOptions = {}): Material<StandardValues>` | A lit material with glTF's metallic-roughness model, like three.js's `MeshStandardMaterial`. |
| `unlit(options: UnlitOptions = {}): Material<UnlitValues>` | A material that ignores lights and shows its color unlit, like three.js's `MeshBasicMaterial`. The exposure and the tone mapping still apply to it, as three.js applies them to that material. |
| `shader<const Wgsl extends string \| CompiledWgsl>(options: ShaderOptions<Wgsl>): Material<ShaderValues<Wgsl>>` | A custom material: the standard material with a surface function in WGSL, which changes how each pixel of the surface looks before the engine lights it, or a full shader of your own. It takes every option of `materials.standard` but the texture maps, the first values of the uniforms that its WGSL declares, and the textures that its WGSL samples. `set` changes the standard values and the uniforms. Meshes need texture coordinates to draw with a surface function, and the attributes that a full shader reads. Throws E1215 for WGSL that the null3D Vite plugin did not compile, and for a whole shader whose `@vertex` entry point takes no `InstanceIn`. Throws E1216 for a uniform or a texture that the WGSL does not declare, for a value of the wrong kind, and for a uniform named as a standard value, such as `color`. Throws E1217 for the `hash` alpha mode and for `alphaToCoverage`, which custom materials do not take, and for `transmission` where the WGSL never sets the surface's `transmission`: only WGSL that sets it has the builds that let light through. When TypeScript can see the WGSL, a wrong name or a value of the wrong kind also fails the type check. |

## `ShaderOptions`

Interface `ShaderOptions`, which extends `StandardBaseOptions`.

Options of `materials.shader`: the material's WGSL, the first values of its uniforms, and the textures that its WGSL samples. It also takes every option of `materials.standard` but the texture maps. `defaultSurface` applies the standard values. Custom materials take no standard maps, so the values of maps have no effect on them. `Wgsl` is the type of the material's WGSL. It gives the names and types of the uniforms, and the names of the textures.

| Member | Description |
| --- | --- |
| `wgsl: Wgsl` | The material's WGSL, compiled by the null3D Vite plugin. It declares `fn surface(input: SurfaceInput) -> Surface`, which the engine calls for each pixel, and which can start from `defaultSurface(input)`. The engine lights the surface that it returns. It can declare `struct Uniforms`, whose fields the surface function reads from `material`, and `fn vertexOffset`, which moves the mesh's vertices. A full shader has a `@vertex` entry point that takes an `InstanceIn`, and a `@fragment` one, instead. Materials made from the same WGSL share their shader. |
| `uniforms?: NoInfer<[keyof UniformValues<Wgsl>] extends [never] ? { readonly [name: string]: never; } : UniformValues<Wgsl>>` | The first value of each uniform, by name. A uniform without one starts at 0. When TypeScript can see the WGSL's uniforms, a name that the WGSL does not declare fails the type check, and WGSL without uniforms takes none. |
| `textures?: NoInfer<TextureValues<Wgsl>>` | The texture of each `var name: texture_2d<f32>;` that the WGSL declares, by name. The WGSL samples it as `textureSample(name, nameSampler, uv)`, with the sampler of the texture's `wrap` and `filter` options. A texture samples as white until its image is on the GPU, and a declared texture without one stays white. The textures are fixed when the material is created. When TypeScript can see the WGSL, a name that it does not declare fails the type check. |

## `ShaderValues`

```ts
type ShaderValues<Wgsl = string | CompiledWgsl> = [Wgsl] extends [unknown] ? Omit<StandardValues, 'uvTransform'> & UniformValues<Wgsl> : never;
```

The values of a custom material, which `set` changes at any time: the standard values but the texture coordinate transform of maps, and the uniforms that its WGSL's `struct Uniforms` declares, by name. `Wgsl` is the type of the material's WGSL, which gives the uniforms' names and types, as `WgslUniforms` says.

## `StandardBaseOptions`

Interface `StandardBaseOptions`, which extends `StandardValues`, `MaterialFeatures`.

The options of `materials.standard` besides its texture maps. Custom materials take them too.

| Member | Description |
| --- | --- |
| `flatShading?: boolean` | Lights each triangle with one normal, the normal of its face, so the mesh looks faceted. It is fixed when the material is created. The default is false. |

## `StandardMaps`

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

## `StandardOptions`

Interface `StandardOptions`, which extends `StandardBaseOptions`, `StandardMaps`.

Options of `materials.standard`.

## `StandardValues`

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
| `transmission?: number` | How much of the light behind the surface passes through it, from 0 to 1, for glass and clear water, as three.js's `MeshPhysicalMaterial.transmission`. That share of the diffuse light becomes the light from behind, and the reflections stay. Roughness blurs what shows through. Give it when you create the material, even as 0, to change it later. A material created without it lets no light through. Such a material draws after the opaque objects, with the blended ones, and only opaque objects show through it. It takes the `opaque` or `blend` alpha mode. The default is 0. |
| `thickness?: number` | The thickness of the volume under the surface, in the mesh's own units, 0 or more, as three.js's `thickness`. Light that passes through bends by `ior` over this distance, and the volume's color absorbs part of it. 0 is a thin wall, which bends no light. The default is 0. |
| `attenuationColor?: ColorInput` | The color that white light takes after it travels `attenuationDistance` through the volume, as three.js's `attenuationColor`, in the forms that `color` takes. The default is white, which absorbs nothing. |
| `attenuationDistance?: number` | The distance in world units over which light in the volume takes `attenuationColor`, above 0, as three.js's `attenuationDistance`. `Infinity` absorbs nothing. The default is `Infinity`. |

## `TextureValues`

```ts
type TextureValues<Wgsl> = string extends WgslTextures<Wgsl> ? { readonly [name: string]: Texture | undefined; } : [WgslTextures<Wgsl>] extends [never] ? { readonly [name: string]: never; } : { readonly [Name in WgslTextures<Wgsl>]?: Texture; };
```

The textures of a custom material by name, each optional, which the `textures` option takes. A name that the WGSL does not declare fails the type check. WGSL whose textures TypeScript cannot see takes any name, and the engine checks the names when it runs.

## `UniformType`

```ts
type UniformType = 'f32' | 'i32' | 'u32' | 'vec2f' | 'vec3f' | 'vec4f';
```

A type that a uniform of custom WGSL can have, as a field of its `struct Uniforms`.

## `UniformValue`

```ts
type UniformValue = number | string | readonly number[];
```

The value of a uniform whose type TypeScript cannot see. An `f32`, `i32` or `u32` uniform takes a number, and a `vec2f`, `vec3f` or `vec4f` uniform takes an array of 2, 3 or 4 numbers. A `vec3f` uniform also takes an sRGB color as `color` takes it, which the engine converts to linear.

## `UniformValueByType`

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

## `UniformValues`

```ts
type UniformValues<Wgsl> = WgslUniforms<Wgsl> extends infer Uniforms extends { readonly [name: string]: UniformType; } ? string extends keyof Uniforms ? { readonly [name: string]: UniformValue | undefined; } : { readonly [Name in keyof Uniforms]?: UniformValueByType[Uniforms[Name]]; } : never;
```

The values of WGSL's uniforms by name, each optional and of the kind that its type takes. The `uniforms` option and `set` of a custom material take them. A name that the WGSL does not declare fails the type check. WGSL whose uniforms TypeScript cannot see takes any name, and the engine checks the names when it runs.

## `UnlitOptions`

Interface `UnlitOptions`, which extends `UnlitValues`, `MaterialFeatures`.

Options of `materials.unlit`.

| Member | Description |
| --- | --- |
| `map?: Texture` | A color map, in sRGB, whose color multiplies `color`. It is fixed when the material is created, and meshes need texture coordinates to show it. |

## `UnlitValues`

Interface `UnlitValues`, which extends `MaterialOptions`.

The values of an unlit material, which `set` changes at any time.

| Member | Description |
| --- | --- |
| `uvTransform?: UvTransform` | Where the map sits on the texture coordinates. The default leaves it as it is. |

## `UvTransform`

Interface `UvTransform`.

Where a material's maps sit on the texture coordinates, as three.js's texture `offset`, `repeat` and `rotation` place a texture, with its `center` at the coordinates' origin. A transform that leaves a value out takes its default.

| Member | Description |
| --- | --- |
| `offset?: readonly [number, number]` | The shift along u and v. The default is `[0, 0]`. |
| `repeat?: readonly [number, number]` | How many times the maps repeat along u and v. The default is `[1, 1]`. |
| `rotation?: number` | The turn in radians, about the coordinates' origin. The default is 0. |

## `WgslTextures`

```ts
type WgslTextures<Wgsl> = [Wgsl] extends [string] ? TextTextures<Wgsl, never> : CompiledTextures<Wgsl>;
```

The names of the textures that WGSL declares as `var name: texture_2d<f32>;`, as one union, such as `'detail' | 'noise'`. TypeScript sees them in a template literal that a `wgsl` block comment tags. It sees them in a `.wgsl` file once the null3D Vite plugin has written the file's declaration. WGSL whose textures TypeScript cannot see gives `string`, which takes any name.

## `WgslUniforms`

```ts
type WgslUniforms<Wgsl> = [Wgsl] extends [string] ? TextUniforms<Wgsl> : CompiledUniforms<Wgsl>;
```

The uniforms that WGSL declares as the fields of its `struct Uniforms`, each name with its type, such as `{ tint: 'vec3f'; width: 'f32' }`. TypeScript sees them in a template literal that a `wgsl` block comment tags. It sees them in a `.wgsl` file once the null3D Vite plugin has written the file's declaration. WGSL whose uniforms TypeScript cannot see, such as text in a `string` variable, gives a record that takes any name.
