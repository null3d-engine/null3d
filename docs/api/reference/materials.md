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
type Blending = 'normal' | 'additive' | 'multiply' | 'weighted';
```

How a blended surface meets what lies behind it. The `normal` blending covers it as far as the alpha says. The `additive` blending adds the surface's light, for glows and fire. The `multiply` blending tints it, for stains and tinted glass. The `weighted` blending covers it as `normal` does, but blends the surfaces of this blending in any order, by a weighted average, as three.js's `OITPassNode` does. Use it for smoke, dense particles and many overlapping panes, where sorting by object leaves surfaces in the wrong order.

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
| `readonly kind: 'material' \| 'effect' \| 'toneCurve' \| 'skyLayer' \| 'shader'` | `'material'` for the functions of a custom material, `'effect'` for a custom effect, `'toneCurve'` for a custom tone curve, `'skyLayer'` for a sky layer, and `'shader'` for a whole shader. |
| `readonly meshless?: boolean` | True for a draw shader: a custom material's `@vertex` entry point takes the vertex and instance indices and no mesh attribute, and `scene.createVertexDraw` draws it from a vertex count. |

## `DecalOptions`

Interface `DecalOptions`, which extends `DecalValues`, `Omit`.

Options of `materials.decal`: its values and the standard material's maps, which the decal projects along its box. The light map is left out.

## `DecalValues`

Interface `DecalValues`, which extends `Omit`.

The values of a decal material, which `set` changes at any time: the standard material's values that a decal shows, and how the decal fades.

| Member | Description |
| --- | --- |
| `angleFade?: readonly [number, number]` | The angles in radians, from the decal's direction, at which the decal starts to fade and past which it shows nothing. The direction is the +z axis of the decal's box, which points out of the surfaces that it marks. A surface at an angle past the second shows none of the decal, so the decal does not smear along walls and edges. Each angle runs from 0 to π, and the first is at most the second. The default is `[π / 3, 4π / 9]`: 60 and 80 degrees. |
| `edgeFade?: number` | The share of the box's depth, from 0 to 1, over which the decal fades out toward each end of its z axis, so a decal that reaches past a surface's edge fades rather than stops. The default is 0.2. |

## `DepthBias`

Interface `DepthBias`.

A depth bias, as three.js's polygon offset gives. It moves a surface's depth, so a decal on a wall wins the depth test and does not fight with the wall. Negative values pull the surface toward the camera, as in three.js.

| Member | Description |
| --- | --- |
| `constant?: number` | Steps of the depth buffer's smallest difference, as three.js's `polygonOffsetUnits`. A fraction rounds to the nearest whole number, as WebGPU takes it. The default is 0. |
| `slopeScale?: number` | A factor of how steeply the surface's depth changes across the screen, as three.js's `polygonOffsetFactor`. The default is 0. |

## `MapUvTransforms`

```ts
type MapUvTransforms = Partial<Record<Exclude<keyof StandardMaps, 'parallax'>, UvTransform>>;
```

Each map's own transform, by the map's option name, for the maps whose transform differs from the material's. A map without one keeps the transform that `uvTransform` gives it, or the identity. A file keeps one transform for each of its textures, so the loader places each map with its own.

## `Material`

Class `Material`.

A material: how the surfaces of the objects that use it look. `Values` are the options that `set` changes.

| Member | Description |
| --- | --- |
| `set(options: Values): void` | Changes the values that it gets and keeps the others. Every object that uses the material changes with it. Set up a material with it, and with `setUniform` change the values that a frame changes: a value that changes in every frame crosses the `setUniform` call itself, where this call reads it from a field of the options object, and a field that holds a fraction holds a copy of it of its own. Throws E1101 once the material is destroyed. |
| `setUniform<Name extends keyof Values & string>(name: Name, value: NonNullable<Values[Name]>): void` | Changes one value by name, and keeps the others: a number, such as `roughness`, `opacity` or `emissiveIntensity`, or a color, such as `color`, `emissive` or `sheenColor`. It allocates nothing, so a sketch can change a value in every frame. Every object that uses the material changes with it. Throws E1101 once the material is destroyed, and E1216 for a name that it does not take: a value that takes more than one parameter, as the texture transform, the normal scales, the angle fade and the index of refraction do, goes through `set`. |
| `destroy(): void` | Destroys the material, like three.js's `material.dispose()`. Objects and instance batches that still use it draw nothing until `setMaterial` gives them another material. Once no object uses it, its place in the engine's table of materials goes to the next material. When the last material of a custom material's WGSL goes, the engine frees that WGSL's pipelines. The material's textures stay, so destroy them apart. Later calls on the material, and calls that pass it, throw E1101. |

## `MaterialFeatures`

Interface `MaterialFeatures`.

The options that choose how a material's shader and pipeline draw it. They are fixed when the material is created, as most of them would need a new pipeline.

| Member | Description |
| --- | --- |
| `doubleSided?: boolean` | Draws both faces of each triangle. Back faces light as if they faced the camera. The default is false. |
| `vertexColors?: boolean` | Multiplies the base color by the mesh's vertex colors, and the alpha by their alpha, on meshes that have them. The default is false. |
| `fog?: boolean` | Takes the scene's fog. False keeps the material's color at every distance. The default is true. |
| `toneMapped?: boolean` | Keeps the color as the display shows it, as three.js's `toneMapped: false` does. The tone curve leaves it alone: the 8-bit path decides that in the shader of the material's own build, and the HDR path's final pass reads a mask of these surfaces and skips the curve where one draws. A blended surface keeps the curve on the HDR path, since a blended pixel mixes two surfaces. The vignette and the sRGB encoding still apply, and the exposure already scales the material's colors, so the color shows brighter than the same color tone mapped. The default is true. |
| `alphaMode?: AlphaMode` | How the material uses its alpha. The default is `opaque`. |
| `alphaToCoverage?: boolean` | With the `mask` alpha mode, smooths the cut edges with MSAA, as three.js's `alphaToCoverage` does: the alpha fades over about one pixel above `alphaCutoff`, and covers that share of the pixel. Without MSAA the mask cuts as without it. False gives three.js's hard cut edges of `alphaTest`. A custom material takes it where its WGSL sets or reads the surface's `alpha`, and a development build throws E1217 otherwise. The default is true. |
| `forceSinglePass?: boolean` | With the `blend` alpha mode and `doubleSided`, draws both faces in one draw, in the mesh's order, as three.js's `forceSinglePass` does. By default such a surface draws its back faces first and then its front faces, so its near side always covers its far side. The default is false. |
| `blending?: Blending` | With the `blend` alpha mode, how the surface meets what lies behind it. The default is `normal`. |
| `depthWrite?: boolean` | False to write no depth, so the surface hides nothing behind it. The default is true. |
| `depthTest?: boolean` | False to draw the surface whatever lies in front of it. It then writes no depth either, as in three.js's WebGL renderer. The default is true. |
| `colorWrite?: boolean` | False to write no color, so the surface shows nothing itself and hides what lies behind it by the depth it writes, as three.js's `colorWrite: false` does. Its objects draw before the opaque objects that write color, so nothing behind it shows through. With the `mask` or `hash` alpha mode, the parts that the alpha drops write no depth either, so the surface cuts a shape out of the space it holds. A blended surface keeps its place among the blended objects, which `setRenderOrder` orders. The default is true. |
| `depthBias?: DepthBias` | Moves the surface's depth, as three.js's polygon offset does. The default is no bias. |
| `wireframe?: boolean` | Draws the edges of each triangle as lines one pixel wide, with the material's own shading, as three.js's `wireframe` does. Edges that two triangles share draw twice. Its shadows draw lines too. Flat shading and bump maps have no effect on it. The default is false. |

## `MaterialOptions`

Interface `MaterialOptions`.

Options every material takes.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The base color: a hex string or a number in sRGB, or three linear components from 0 to 1. |
| `opacity?: number` | How opaque the surface is, from 0 to 1. The default is 1. It is part of the alpha, which the `mask` alpha mode tests and the `blend` alpha mode blends with. The `opaque` alpha mode ignores it. |
| `alphaCutoff?: number` | The alpha below which a masked surface draws nothing, from 0 to 1, and the cutoff that a blended surface's shadow caster tests where its WGSL declares `coverage`. The default is 0.5, as in glTF. |

## `Materials`

Class `Materials`.

Material factories. The standard material follows glTF's metallic-roughness model and shades with the formulas of three.js's `MeshStandardMaterial`. The unlit material shows its color as three.js's `MeshBasicMaterial` does. The shadow-catcher material shows only the main directional light's shadows, as three.js's `ShadowMaterial`.

| Member | Description |
| --- | --- |
| `standard(options: StandardOptions = {}): Material<StandardValues>` | A lit material with glTF's metallic-roughness model, like three.js's `MeshStandardMaterial`. |
| `decal(options: DecalOptions = {}): Material<DecalValues>` | A decal's material: the standard material, projected onto every opaque surface inside the box of each object that it draws, as three.js's `DecalGeometry` places a decal. Give it to a mesh of `geometry.box()`: the object's position, rotation and scale place the box, and the material's maps stretch over the box's x and y sides, seen along its z axis. The surfaces inside take its color, roughness, metalness, normal map and emissive light, lit by the scene's lights, and blend with them as far as its alpha says. A decal draws after the opaque objects, and marks no blended surface. It casts no shadow. |
| `unlit(options: UnlitOptions = {}): Material<UnlitValues>` | A material that ignores lights and shows its color unlit, like three.js's `MeshBasicMaterial`. The exposure and the tone mapping still apply to it, as three.js applies them to that material. |
| `shadowCatcher(options: ShadowCatcherOptions = {}): Material<ShadowCatcherValues>` | A material that draws only the shadows that fall on it, as three.js's `ShadowMaterial`: its `color` where the main directional light's shadow falls, and nothing where the light reaches it, at `opacity`. The mesh must receive shadows (`setReceiveShadows(true)`), as three.js's `receiveShadow` must be set. Every shadow that falls on the surface comes from the main directional light; point and spot lights cast none onto it. The default color is black, as three.js's. The material blends, so it draws in the transparent pass after the opaque objects, and the scene's fog leaves it alone. It takes no texture maps. |
| `shader<const Wgsl extends string \| CompiledWgsl>(options: ShaderOptions<Wgsl>): Material<ShaderValues<Wgsl>>` | A custom material: the standard material with a surface function in WGSL, which changes how each pixel of the surface looks before the engine lights it, or a full shader of your own. It takes every option of `materials.standard` but the texture maps, the first values of the uniforms that its WGSL declares, and the textures that its WGSL samples, a texture of several layers among them for a declaration of a texture array. `set` changes the standard values and the uniforms. Meshes need texture coordinates to draw with a surface function, and the attributes that a full shader reads. Throws E1215 for WGSL that the null3D Vite plugin did not compile, and for a whole shader whose `@vertex` entry point takes no `InstanceIn`. Throws E1216 for a uniform or a texture that the WGSL does not declare, for a value of the wrong kind, and for a uniform named as a standard value, such as `color`. A development build throws E1217 for the `hash` alpha mode and for `alphaToCoverage` where the WGSL never sets or reads the surface's `alpha`: only WGSL that does has the builds that cut the material's shape, and its shadow caster and motion build test that alpha. It also throws E1217 for `transmission` where the WGSL never sets the surface's `transmission`, and for `diffuseTransmission` where it never names the surface's `diffuseTransmission` or `diffuseTransmissionColor`: only WGSL that does has the builds that let light through. When TypeScript can see the WGSL, a wrong name or a value of the wrong kind also fails the type check. |

## `ShaderOptions`

Interface `ShaderOptions`, which extends `StandardBaseOptions`.

Options of `materials.shader`: the material's WGSL, the first values of its uniforms, and the textures that its WGSL samples. It also takes every option of `materials.standard` but the texture maps. `defaultSurface` applies the standard values. Custom materials take no standard maps, so the values of maps have no effect on them. `Wgsl` is the type of the material's WGSL. It gives the names and types of the uniforms, and the names of the textures.

| Member | Description |
| --- | --- |
| `wgsl: Wgsl` | The material's WGSL, compiled by the null3D Vite plugin. It declares `fn surface(input: SurfaceInput) -> Surface`, which the engine calls for each pixel, and which can start from `defaultSurface(input)`. The engine lights the surface that it returns. It can declare `struct Uniforms`, whose fields the surface function reads from `material`, `fn vertexOffset`, which moves the mesh's vertices, and `fn lobe(input: LobeInput) -> vec3f`, which adds specular for the main light beside the base lobe. A full shader has a `@vertex` entry point that takes an `InstanceIn`, and a `@fragment` one, instead. Materials made from the same WGSL share their shader. |
| `uniforms?: NoInfer<[keyof UniformValues<Wgsl>] extends [never] ? { readonly [name: string]: never; } : UniformValues<Wgsl>>` | The first value of each uniform, by name. A uniform without one starts at 0. When TypeScript can see the WGSL's uniforms, a name that the WGSL does not declare fails the type check, and WGSL without uniforms takes none. |
| `textures?: NoInfer<TextureValues<Wgsl>>` | The texture of each `var name: texture_2d<f32>;` or `var name: texture_2d_array<f32>;` that the WGSL declares, by name. The WGSL samples a 2D texture as `textureSample(name, nameSampler, uv)`, with the sampler of the texture's `wrap` and `filter` options, and a texture array as `textureSample(name, nameSampler, uv, layer)`, where it picks the layer of a texture of several layers. A texture samples as white until its image is on the GPU, and a declared texture without one stays white. The textures are fixed when the material is created. When TypeScript can see the WGSL, a name that it does not declare fails the type check. |
| `sceneInputs?: readonly SceneInput[]` | The scene inputs that the material's surface function reads. Today that is `'sceneDepth'`: the WGSL calls `sceneDepth(uv)` or `sceneDistance(uv)`, and the engine binds the copy of the opaque scene's depth. A material that declares it draws after that copy exists, so it reads it in the transparent pass; a surface that draws earlier reads 0, the far plane. A material that declares it takes at most seven textures of its own: its maps' group gives up one slot, so that the copy fits the fragment stage beside the maps under WebGPU's limit of sixteen sampled textures. The engine checks that the declaration and the WGSL agree. |
| `castsStill?: boolean` | True when the vertex offset follows the view that draws the object and nothing else moves it, as a card that turns toward the camera does. A caster that only shadow passes draw then holds the shadow that the light's layer drew until the light turns, so the far shadow cascades stay cached. Leave it out for an offset that moves with time, such as wind: the shadow of such a caster follows it in every frame, and a far cascade must draw again for each one. |
| `swayDistance?: number` | How far from the camera the vertex offset moves, in meters, for an offset that fades out with distance such as wind. The material's WGSL fades its offset to nothing by this distance, and the engine counts a caster of the material as moving only while its bounding sphere reaches within it, so a far shadow cascade that only the sway reaches keeps the layer it holds. Zero, the default, moves the offset at every distance, as an offset that follows time alone does. |

## `ShaderValues`

```ts
type ShaderValues<Wgsl = string | CompiledWgsl> = [Wgsl] extends [unknown] ? Omit<StandardValues, MapValues> & UniformValues<Wgsl> : never;
```

The values of a custom material, which `set` changes at any time: the standard values but the texture coordinate transform of maps, and the uniforms that its WGSL's `struct Uniforms` declares, by name. `Wgsl` is the type of the material's WGSL, which gives the uniforms' names and types, as `WgslUniforms` says.

## `ShadowCatcherOptions`

Interface `ShadowCatcherOptions`, which extends `ShadowCatcherValues`.

Options of `materials.shadowCatcher`, a material that draws only the shadows that fall on it, as three.js's `ShadowMaterial`.

| Member | Description |
| --- | --- |
| `doubleSided?: boolean` | Draws both faces of each triangle. Back faces light as if they faced the camera. The default is false. |
| `depthWrite?: boolean` | False to write no depth, so the surface hides nothing behind it. The default is true. |

## `ShadowCatcherValues`

Interface `ShadowCatcherValues`, which extends `MaterialOptions`.

The values of a shadow-catcher material, which `set` changes at any time.

## `StandardBaseOptions`

Interface `StandardBaseOptions`, which extends `StandardValues`, `MaterialFeatures`.

The options of `materials.standard` besides its texture maps. Custom materials take them too.

| Member | Description |
| --- | --- |
| `flatShading?: boolean` | Lights each triangle with one normal, the normal of its face, so the mesh looks faceted. It is fixed when the material is created. The default is false. |
| `lightMapOffset?: readonly [number, number]` | Where a light map's texture coordinates start, as three.js's `texture.offset`. A bake places each light map on a mesh with its own scale and offset, apart from the other maps. It takes two numbers, and needs a `lightMap`. The default leaves the coordinates alone. |
| `lightMapRepeat?: readonly [number, number]` | How a light map's texture coordinates stretch, as three.js's `texture.repeat`. It takes two numbers, and needs a `lightMap`. The default is `[1, 1]`. |
| `lightMapDecode?: 'srgb' \| 'rgbm'` | How the engine reads the light map's texels: `srgb` (the default) takes the texture as sRGB color, which the sampler turns linear, or `rgbm` multiplies each texel's color by its alpha times 8 and then decodes it as sRGB, as Needle's viewer reads its light maps. With `rgbm`, give a texture in linear color, whose raw bytes the shader decodes. It needs a `lightMap`. |
| `lightMapDirection?: Texture` | The direction of the light that a directional light map stores at each texel, in linear color: red, green and blue map the direction's x, y and z from -1 to 1. A normal map then bends the light that the bake stored, instead of lighting it evenly. Give the texture that `assets.loadLightMap` returns beside the radiance: the engine reads the direction through the light map's own texture binding, so both must have one size, format and color space, as `loadLightMap` makes them. Needs a `lightMap`. |
| `contactShadows?: boolean` | Takes the main directional light's contact shadows. False leaves them off this surface, which keeps the shadow map's shadows. Set it on thin surfaces that crowd together or sway, such as grass blades and leaf cards: the contact shadows take each blade for a solid wall, so they darken such surfaces and flicker as they move. The surfaces under them keep their contact shadows. It is fixed when the material is created. The default is true. |

## `StandardMaps`

Interface `StandardMaps`.

The texture maps of a standard material. They are fixed when the material is created, because each set of maps draws with a pipeline of its own. A map reads the texture coordinates that its texture's `uvSet` names, through its own transform where `mapUvTransforms` gives it one and the material's `uvTransform` otherwise. Meshes need texture coordinates to show maps, and the material draws without a map until its texture's image is on the GPU.

| Member | Description |
| --- | --- |
| `map?: Texture` | The base color map, in sRGB. Its color multiplies `color`. |
| `metalnessRoughnessMap?: Texture` | Roughness in green and metalness in blue, as glTF packs them, in linear color. They multiply `roughness` and `metalness`. |
| `normalMap?: Texture` | Normals in tangent space, in linear color, which `normalScale` scales. |
| `bumpMap?: Texture` | Heights in red, in linear color, which bend the normals as three.js's bump map does, by `bumpScale`. A normal map wins over it, as in three.js, and so does a wireframe. |
| `displacementMap?: Texture` | Heights in red, in linear color, which move each vertex along its normal by `displacementScale` and `displacementBias`, as three.js's displacement map does. Shadows and the depth prepass follow the moved vertices, and culling grows each object's bounds to hold them. Without a normal or bump map, the map's slope also bends the normals, so the light follows the new shape, which three.js does not do. The vertex shader reads the map at its full size, so the mesh needs vertices about as dense as the detail it should show. Raycasts, outlines and debug views see the mesh before it moves. |
| `parallax?: boolean` | With a `displacementMap`, also shifts where each pixel reads the maps, by parallax occlusion mapping: relief finer than the mesh's vertices hides and shows the surface behind it as the view turns. It costs a dozen or more texture reads per pixel, so the quality presets may turn it off. Only opaque and masked surfaces take it. The default is false. |
| `aoMap?: Texture` | Ambient occlusion in red, in linear color, which darkens ambient light. |
| `emissiveMap?: Texture` | The emissive color map, in sRGB. Its color multiplies `emissive`. |
| `lightMap?: Texture` | Baked light, added to the ambient light. Light maps usually use the second coordinates. |
| `specularIntensityMap?: Texture` | The specular intensity in alpha, in linear color. Its alpha multiplies `specularIntensity`. |
| `specularColorMap?: Texture` | The specular color, in sRGB. Its color multiplies `specularColor`. |
| `diffuseTransmissionMap?: Texture` | The diffuse transmission in alpha, in linear color. Its alpha multiplies `diffuseTransmission`. Only a material created with `diffuseTransmission` takes it, and such a material takes no specular maps. |
| `diffuseTransmissionColorMap?: Texture` | The diffuse transmission color, in sRGB. Its color multiplies `diffuseTransmissionColor`. Only a material created with `diffuseTransmission` takes it, and such a material takes no specular maps. |
| `transmissionMap?: Texture` | The share of the light behind the surface that passes through it, in red, in linear color. Its red multiplies `transmission`. Only a material created with `transmission` takes it. It keeps a row slot of its own and samples the specular intensity map's texture array at its own layer, so a specular intensity map may draw beside it when the two textures share an array. A material with layers keeps it unless a layer map fills that slot: a clear coat's normal map and iridescence's thickness map do. |
| `thicknessMap?: Texture` | The thickness of the volume under the surface, in green, in linear color. Its green multiplies `thickness`. Only a material created with `transmission` takes it. It keeps a row slot of its own and samples the specular color map's texture array at its own layer, so a specular color map may draw beside it when the two textures share an array. A material with layers keeps it unless a layer map fills that slot: the sheen's maps and an anisotropy map do. |
| `clearcoatMap?: Texture` | The clear coat in red, in linear color, which multiplies `clearcoat`. A material with a clear coat or a sheen takes no light map and no specular maps, since its layers' maps take their places. |
| `clearcoatRoughnessMap?: Texture` | The clear coat's roughness in green, in linear color, which multiplies `clearcoatRoughness`. With `clearcoatMap`, it is the same texture, as glTF packs them. |
| `clearcoatNormalMap?: Texture` | The clear coat's normals in tangent space, in linear color, which `clearcoatNormalScale` scales. |
| `sheenColorMap?: Texture` | The sheen color, in sRGB, whose color multiplies `sheenColor`. |
| `sheenRoughnessMap?: Texture` | The sheen's roughness in alpha, which multiplies `sheenRoughness`. With `sheenColorMap`, it is the same texture, as glTF packs them: an sRGB texture keeps its alpha linear. |
| `iridescenceMap?: Texture` | How much of the thin film's reflection shows, in red, in linear color, which multiplies `iridescence`. A material with iridescence or anisotropy takes no light map and no specular maps, since its maps take their places. |
| `iridescenceThicknessMap?: Texture` | The film's thickness in green, in linear color, which mixes `iridescenceThicknessRange`. A material with both iridescence maps takes no light map and no specular maps. |
| `anisotropyMap?: Texture` | The anisotropy's direction in red and green and its strength in blue, in linear color: red and green are a direction in the tangent plane, and blue multiplies `anisotropy`. A material with it takes no light map, no specular maps and no clear coat or sheen map. |

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
| `bumpScale?: number` | How strongly the bump map bends normals, as three.js's `bumpScale`: the change of its red channel from one pixel to the next times this. Negative values turn bumps into dents. The default is 1. |
| `displacementScale?: number` | How far the displacement map's white moves each vertex along its normal, in the mesh's units, as three.js's `displacementScale`. The default is 1. |
| `displacementBias?: number` | How far the displacement map moves every vertex along its normal, added to its texel's share of `displacementScale`, in the mesh's units, as three.js's `displacementBias`. The default is 0. |
| `aoMapIntensity?: number` | How much the occlusion map darkens ambient light, from 0 to 1. The default is 1. |
| `lightMapIntensity?: number` | The factor of the light map's light: 0 or more. The default is 1. |
| `ior?: number` | The index of refraction of the surface's non-metallic part, 1 or more, as three.js's `MeshPhysicalMaterial.ior`. It sets how much light the surface reflects when seen head on: `((ior - 1) / (ior + 1))^2`. The default is 1.5, which reflects 4%, as glTF's metallic-roughness model does. |
| `specularIntensity?: number` | The strength of the specular reflection of the surface's non-metallic part, from 0 to 1, as three.js's `specularIntensity`. It scales the reflection at every angle, so 0 leaves only diffuse light. Metals ignore it. The default is 1. |
| `specularColor?: ColorInput` | The color that tints the specular reflection of the surface's non-metallic part when seen head on, as three.js's `specularColor`. At grazing angles the reflection stays white, and metals ignore it. It takes the forms that `color` takes, and its three linear components may also exceed 1, as glTF allows, to reflect more than the index of refraction gives, up to all the light. The default is white. |
| `envIntensity?: number` | The factor of the scene environment's light on the surface, 0 or more, as three.js's `envMapIntensity`. It multiplies the intensity that `scene.setEnvironment` gives. The default is 1. |
| `uvTransform?: UvTransform` | Where the maps sit on the texture coordinates. The default leaves them as they are. |
| `mapUvTransforms?: MapUvTransforms` | Each map's own transform, for the maps whose transform differs from `uvTransform`. A file keeps one transform for each of its textures, so the loader places each map with its own. |
| `transmission?: number` | How much of the light behind the surface passes through it, from 0 to 1, for glass and clear water, as three.js's `MeshPhysicalMaterial.transmission`. That share of the diffuse light becomes the light from behind, and the reflections stay. Roughness blurs what shows through. Give it when you create the material, even as 0, to change it later. A material created without it lets no light through. Such a material draws after the opaque objects, with the blended ones, and only opaque objects show through it. It takes the `opaque`, `mask` or `blend` alpha mode. A mask decides which pixels draw, and the light from behind fills the pixels that remain, as three.js's `alphaTest` does. The default is 0. |
| `thickness?: number` | The thickness of the volume under the surface, in the mesh's own units, 0 or more, as three.js's `thickness`. Light that passes through bends by `ior` over this distance, and the volume's color absorbs part of it. 0 is a thin wall, which bends no light. The default is 0. |
| `attenuationColor?: ColorInput` | The color that white light takes after it travels `attenuationDistance` through the volume, as three.js's `attenuationColor`, in the forms that `color` takes. The default is white, which absorbs nothing. |
| `attenuationDistance?: number` | The distance in world units over which light in the volume takes `attenuationColor`, above 0, as three.js's `attenuationDistance`. `Infinity` absorbs nothing. The default is `Infinity`. |
| `dispersion?: number` | The strength of the volume's dispersion, 0 or more, as three.js's `MeshPhysicalMaterial.dispersion` and glTF's `KHR_materials_dispersion`: 20 divided by the Abbe number, so a diamond's 0.36 is weak and rutile's 2.04 is strong. The light from behind bends by a slightly different index of refraction for each color, so a prism or a gem separates it into colors at its edges. 0 bends every color alike. It shows only with `transmission`, and the default is 0. |
| `diffuseTransmission?: number` | How much of the surface's diffuse light passes through it to its other side, from 0 to 1, as glTF's `KHR_materials_diffuse_transmission` gives it. Light that reaches the back, such as the sun behind a leaf, a petal or an ear, then shows on the front through `diffuseTransmissionColor`, and the front keeps the rest of its diffuse light. Shadows fall on that light too. Give it when you create the material, even as 0, to change it later. A material created without it lets no light through to its other side. Over `thickness`, the volume's `attenuationColor` tints the light. `transmission` wins where a material has both. The default is 0. |
| `diffuseTransmissionColor?: ColorInput` | The color that tints the light that passes through to the surface's other side, in the forms that `color` takes. The base color does not tint it, as glTF says, so give a leaf its green here. The default is white. |
| `subsurfaceRadius?: number` | How far light spreads under the surface before it leaves it, in world units taken as meters, 0 or more, as in skin, wax or marble. The subsurface blur spreads the surface's diffuse light over this distance, so the edges of its shadows and the detail of its maps soften, and its highlights stay sharp. Skin takes about 0.01. Give it when you create the material, even as 0, to change it later. A material created without it draws no blur. The blur draws on the High and Ultra quality presets, where the quality setting `subsurfaceSamples` gives it taps, on the HDR path. Materials that blend or let light through take none. The default is 0. |
| `subsurfaceColor?: ColorInput` | How far each color channel's light spreads, as a share of `subsurfaceRadius`, in the forms that `color` takes: each linear channel is its share. Skin's red light spreads furthest, so it takes about `[1, 0.4, 0.25]`. The default is white, which spreads every channel as far. |
| `clearcoat?: number` | How much of a clear coat covers the surface, from 0 to 1, as three.js's `MeshPhysicalMaterial.clearcoat`: a thin, shiny layer, as on car paint, varnish or a wet stone, with its own highlights and reflection. It dims what lies below it where it reflects light. Give it, or another option of a clear coat or a sheen, when you create the material, to change it later. The default is 0. |
| `clearcoatRoughness?: number` | How rough the clear coat is, from 0 (a mirror) to 1, as three.js's `clearcoatRoughness`. The default is 0. |
| `clearcoatNormalScale?: readonly [number, number]` | How strongly the coat normal map bends the coat's normals along u and along v, as three.js's `clearcoatNormalScale`. The default is `[1, 1]`, and negative values flip a direction. |
| `sheenColor?: ColorInput` | The color of a sheen, the soft glow at grazing angles of velvet, cloth and fuzz, as three.js's `sheenColor`, in the forms that `color` takes. three.js's `sheen` multiplies it; here the color alone sets the sheen. Black gives none. Give it, or another option of a clear coat or a sheen, when you create the material, to change it later. The default is black. |
| `sheenRoughness?: number` | How rough the sheen is, from 0 to 1, as three.js's `sheenRoughness`: rougher sheens spread wider. The default is 1. |
| `iridescence?: number` | How much a thin film above the surface tints its reflection, from 0 to 1, as three.js's `iridescence`: soap bubbles, oil and beetle shells show the colors of the film's thickness. Give it, or another option of iridescence, when you create the material, to change it later. The default is 0. |
| `iridescenceIor?: number` | The thin film's index of refraction, 1 or more, as three.js's `iridescenceIOR`: 1 makes the film reflect as the surface does, and a value near 2 shows its colors most strongly. The default is 1.3. |
| `iridescenceThicknessRange?: readonly [number, number]` | The thinnest and thickest parts of the film, in nanometers, as three.js's `iridescenceThicknessRange`: the map's green channel mixes between them. The default is `[100, 400]`. |
| `anisotropy?: number` | How far the specular reflection stretches along one direction of the surface, from 0 (round) to 1, as three.js's `anisotropy`: brushed metal shows a highlight across its grooves rather than around. A material with a map takes the stretch's direction from the mesh's tangents or from the map's coordinates; a material without one takes a frame square to the surface. Give it, or `anisotropyRotation`, when you create the material, to change it later. The default is 0. |
| `anisotropyRotation?: number` | The direction along which the reflection stretches, in radians from the surface's tangent, as three.js's `anisotropyRotation`. The default is 0. |

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
| `mapUvTransforms?: MapUvTransforms` | The map's own transform, where a file gives it one, as it does each of its textures. |

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
