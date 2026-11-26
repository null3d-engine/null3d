---
id: porting/threejs-materials
title: Porting materials and textures
status: experimental
since: "0.3"
summary: "Parameter-by-parameter conversion; color spaces; approximations."
---

# Porting materials and textures

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

Most three.js materials map to `materials.standard`, which follows the same glTF metallic-roughness model and the same formulas. So the values of a `MeshStandardMaterial` or a `MeshPhysicalMaterial` carry over. Lambert, Phong and Toon materials have no direct equivalent, so they become a standard material with converted values, or a surface function.

This page goes through each three.js material, then the texture settings, then four recipes. [Materials](../api/materials.md) describes every option, and [Color management](../concepts/color-management.md) explains the color spaces.

## MeshStandardMaterial

`MeshStandardMaterial` maps to `materials.standard`:

| three.js | null3D | Notes |
| --- | --- | --- |
| `color` | `color` | Hex values are sRGB in both engines. |
| `map` | `map` | Load it in the sRGB color space (`colorSpace: 'srgb'`). Its alpha multiplies `opacity`. |
| `roughness`, `metalness` | `roughness`, `metalness` | The same meaning and the same defaults. |
| `roughnessMap`, `metalnessMap` | `metalnessRoughnessMap` | One texture, with roughness in green and metalness in blue, as glTF packs them. Pack two textures into one with `bunx @null3d/cli assets pack-orm`. |
| `normalMap`, `normalScale` | `normalMap`, `normalScale: [x, y]` | Tangent space only. The frame comes from the mesh's tangents, or from the pixels around it, as in three.js. |
| `normalMapType: ObjectSpaceNormalMap` | No equivalent | Convert the map to tangent space offline. |
| `aoMap`, `aoMapIntensity` | `aoMap`, `aoMapIntensity` | Both engines read occlusion from the red channel. |
| `lightMap`, `lightMapIntensity` | `lightMap`, `lightMapIntensity` | Usually on the second texture coordinates: give the texture `uvSet: 1`. The texture's `offset` and `repeat` become `lightMapOffset` and `lightMapRepeat`. |
| `emissive`, `emissiveIntensity`, `emissiveMap` | The same names | `emissive` is an sRGB color, and `emissiveMap` is an sRGB texture. |
| `envMap`, `envMapIntensity` | `scene.setEnvironment(env)` and `envIntensity` | One scene environment lights every material. A material takes no environment map of its own. |
| `envMapRotation` | `scene.setEnvironment(env, { rotation })` | The scene's rotation, which every material shares. |
| `bumpMap`, `bumpScale` | The same names | three.js's formula, so the look is the same. Load the map in the linear color space. |
| `displacementMap`, `displacementScale`, `displacementBias` | The same names | Shadows, the depth prepass and the culling bounds follow the moved vertices. Without a normal or bump map, the engine also bends the normals by the map's slope. |
| `alphaMap` | Alpha in the alpha channel of `map`, or a surface function | three.js reads the alpha map's green channel. The recipe below samples it. |
| `transparent: true`, `opacity` | `alphaMode: 'blend'`, `opacity` | Blended objects draw after the opaque ones, farthest first. |
| `alphaTest` | `alphaMode: 'mask'`, `alphaCutoff` | Pass the `alphaTest` value as `alphaCutoff`. The cut edges are smooth by default. `alphaToCoverage: false` gives hard edges. |
| `alphaHash` | `alphaMode: 'hash'` | The alpha sets the share of the surface that draws. The noise pattern differs from three.js's. |
| `side: DoubleSide` | `doubleSided: true` | Fixed when you create the material. |
| `side: BackSide` | Flip the geometry | Reverse each triangle's indices and negate the normals in `geometry.fromArrays`. |
| `depthWrite`, `depthTest`, `colorWrite` | The same names | Fixed when you create the material. |
| `polygonOffset` and its factor and units | `depthBias: { constant, slopeScale }` | Keep the three.js values. The engine converts the signs for its reversed depth. |
| `blending` | `blending: 'normal'`, `'additive'` or `'multiply'`, with `alphaMode: 'blend'` | Subtractive and custom blending have no equivalent. |
| `vertexColors`, `flatShading`, `wireframe`, `fog` | The same names | Fixed when you create the material. `wireframeLinewidth` has no effect. |
| `toneMapped: false` | `toneMapped: false` | The material keeps its color as the display shows it. |
| `clippingPlanes` | A surface function with `alphaMode: 'mask'` | The recipe below cuts a mesh at a plane. Its shadow is cut at the plane too, as three.js does with `clipShadows: true`. three.js's default is `clipShadows: false`: for it, also declare `fn coverage(input: SurfaceInput) -> f32` and return `1.0`, so the whole shadow stays. |
| `dithering`, `precision`, `shadowSide` | Nothing | The final pass always dithers. |

The engine blends in linear color, as three.js's `WebGPURenderer` does. `WebGLRenderer` blends after tone mapping, so see-through surfaces look a little lighter in null3D.

## MeshPhysicalMaterial

`materials.standard` takes the physical options with the same names and formulas. Give a layer's option when you create the material, even as 0, to change it later.

| three.js | null3D | Notes |
| --- | --- | --- |
| `ior`, `reflectivity` | `ior` | Convert `reflectivity` with `ior = (1 + 0.4 * r) / (1 - 0.4 * r)`, as three.js does. |
| `specularIntensity`, `specularColor` and their maps | The same names | The color map is sRGB, and the intensity map is linear. |
| `transmission`, `thickness`, `attenuationColor`, `attenuationDistance`, `dispersion` | The same names | Only opaque objects show through a transmissive surface. |
| `transmissionMap`, `thicknessMap` | The same names | Red multiplies the transmission, and green the thickness. |
| `clearcoat`, `clearcoatRoughness`, `clearcoatNormalScale` and their maps | The same names | `clearcoatMap` and `clearcoatRoughnessMap` must be one texture: the coat in red and its roughness in green. |
| `sheen`, `sheenColor`, `sheenRoughness` and their maps | `sheenColor` times `sheen`, and the other names | There is no `sheen` option, so multiply it into `sheenColor`. The two maps must be one texture. |
| `iridescence`, `iridescenceIOR`, `iridescenceThicknessRange` and their maps | `iridescence`, `iridescenceIor`, `iridescenceThicknessRange` | The same thin-film formulas. |
| `anisotropy`, `anisotropyRotation`, `anisotropyMap` | The same names | The same lobe, with the direction from the mesh's tangents. |

A material with a clear coat or a sheen takes no `lightMap`, `specularIntensityMap`, `specularColorMap` or `diffuseTransmission`. The layers' maps take their places. Bake the light map into the base color, or split the object across two materials.

glTF files with the matching `KHR_materials_*` extensions load into these options, as they do in three.js's `GLTFLoader`.

## MeshBasicMaterial

`MeshBasicMaterial` maps to `materials.unlit`, which takes `color`, `opacity`, `map`, `uvTransform`, `vertexColors`, `doubleSided`, `fog`, the alpha modes, `blending` and the depth options. Its `envMap` and `reflectivity` have no equivalent. For a reflective look, use `materials.standard` with a high metalness and a low roughness.

## MeshLambertMaterial and MeshPhongMaterial

Both become `materials.standard` with `metalness: 0`. The standard material keeps energy as `MeshStandardMaterial` does, so the look changes a little. Check the result with parity images, and tune.

- Lambert: give `roughness: 1`. The emissive values and the maps carry over.
- Phong: start from `roughness = (2 / (shininess + 2)) ** 0.25`. A shininess of 30 gives 0.5, and 100 gives about 0.37.
- A Phong `specular` color has no equivalent in the metalness model. Gray specular maps to roughness alone. Strongly colored specular needs a surface function.
- A Phong `specularMap` can become a roughness map, where bright specular means low roughness. Convert it offline.

## MeshToonMaterial and MeshMatcapMaterial

Both become custom materials, as the recipes below show. A surface function cannot read the scene's lights, so the toon recipe takes the light's direction as a uniform. For a toon look that follows every light and its shadows, step the light in a lobe function instead. The engine calls `fn lobe(input: LobeInput) -> vec3f` for the main directional light and for each point and spot light. It gets the light's direction and its shadowed irradiance, and its color adds to that light's specular ([Surface functions](../shaders/surface-functions.md#a-materials-own-lobe)). The base lighting stays beside it, so set `s.baseColor` to black and `s.roughness` to 1, as the toon recipe does. The engine calls no lobe for the fill directional lights and the area lights, so the bands do not follow them. The matcap recipe looks up a texture by the normal in view space. It is an unlit function, so it ignores the scene's lights, as three.js's matcap does.

## Other materials

| three.js | null3D |
| --- | --- |
| `MeshNormalMaterial` | `debug.view('normals')` while you debug, which shows world-space normals. A surface function can write the normal as a color. |
| `MeshDepthMaterial`, `MeshDistanceMaterial` | `debug.view('depth')` while you debug. Shadows need no custom depth material. |
| `ShadowMaterial` | `materials.shadowCatcher({ opacity })` |
| `PointsMaterial` | The options of `scene.createPoints`, such as `size`, `sizeAttenuation`, `map` and `colors` ([Points](../api/points.md)) |
| `LineBasicMaterial`, `LineDashedMaterial`, `LineMaterial` | The options of `scene.createLines`, such as `width`, `worldUnits` and `dashed` ([Lines](../api/lines.md)) |
| `SpriteMaterial` | The options of `scene.createSprites` ([Sprites](../api/sprites.md)) |
| `ShaderMaterial`, `RawShaderMaterial`, node materials | `materials.shader` in WGSL ([Porting shaders](threejs-shaders.md)) |
| `DecalGeometry` with a `polygonOffset` material | A box mesh with `materials.decal({ map, normalMap })`. The box's place, rotation and scale replace the decal's. |
| `Reflector`, `Water` | A reflection pass with `render.addPass({ kind: 'reflection' })`, and a custom material that reads it ([Materials](../api/materials.md#mirrors-polished-floors-and-water)) |

`scene.overrideMaterial = material` draws the whole main pass with one material, as in three.js. Sprites, points, lines and particles keep their own materials, and the shadow maps keep each object's material. Set it to `null` to draw each object's own material again.

## Texture settings

`assets.loadTexture` takes the settings that a three.js texture keeps as properties:

| three.js | null3D |
| --- | --- |
| `colorSpace = SRGBColorSpace` | `colorSpace: 'srgb'` |
| No color space, for data textures | `colorSpace: 'linear'` |
| `flipY` | `flipY`. glTF textures always use `false`. |
| `wrapS`, `wrapT` | `wrap: 'repeat'`, `'clamp'` or `'mirror'`, or a pair `[u, v]` |
| `repeat`, `offset`, `rotation` | The material's `uvTransform: { repeat, offset, rotation }`, for every map. `mapUvTransforms` gives one map its own. |
| `center` | Bake it into `offset`. |
| `anisotropy` | `anisotropy`, from 1 to 16 |
| `magFilter`, `minFilter` with `NearestFilter` | `filter: 'nearest'` |
| `generateMipmaps` | `mipmaps` |
| `channel` | `uvSet` |
| `premultiplyAlpha` | `premultipliedAlpha` |
| `needsUpdate = true` after a change of pixels | `texture.update(bitmap)` |

`loadTexture` decodes PNG, JPEG, WebP and AVIF files, and KTX2 files in the device's compressed format. Convert large textures to KTX2 with `bunx @null3d/cli assets optimize`. Materials sample 2D textures and texture arrays, not cube maps. A cube map can be the scene's background, and the scene's environment lights every material.

## Color spaces

The engine works in linear color and encodes sRGB once, in the final pass. Load color textures (`map`, `emissiveMap`, `specularColorMap`, `sheenColorMap`) as sRGB. Load data textures (normal, roughness, metalness, occlusion, bump and height maps) as linear. A wrong color space is the most common cause of a port that looks too dark or too washed out.

null3D tone maps with punchy AgX by default. A three.js app with `NoToneMapping` needs `post.set({ toneMapping: 'none' })` to match ([Color management](../concepts/color-management.md#exposure-and-tone-mapping)).

## Recipes

Toon shading with three bands. The light's direction is a uniform, because a surface function cannot read the scene's lights:

```ts
const toon = materials.shader({
  uniforms: { bands: 3, shadowColor: '#303050', lightDirection: [-0.5, -1, -0.3] },
  wgsl: /* wgsl */ `
    struct Uniforms { bands: f32, shadowColor: vec3f, lightDirection: vec3f }

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let ndl = max(dot(input.normal, -normalize(material.lightDirection)), 0.0);
      let band = floor(ndl * material.bands) / max(material.bands - 1.0, 1.0);
      s.emissive = mix(material.shadowColor, s.baseColor, band);
      s.baseColor = vec3f(0.0);
      s.roughness = 1.0;
      return s;
    }`,
});
```

Matcap, with the camera's view matrix:

```ts
const matcap = materials.shader({
  textures: { matcap: await assets.loadTexture('/tex/matcap-clay.ktx2', { colorSpace: 'srgb' }) },
  wgsl: /* wgsl */ `
    var matcap: texture_2d<f32>;

    fn unlit(input: SurfaceInput) -> vec4f {
      let n = normalize((camera.view * vec4f(input.normal, 0.0)).xyz);
      let uv = n.xy * vec2f(0.5, -0.5) + 0.5;
      return vec4f(textureSample(matcap, matcapSampler, uv).rgb, 1.0);
    }`,
});
```

A clipping plane, for section views. The plane is a normal and a constant, as in `THREE.Plane`:

```ts
const clipped = materials.shader({
  alphaMode: 'mask', alphaCutoff: 0.5,
  uniforms: { plane: [0, -1, 0, 1.2] },
  wgsl: /* wgsl */ `
    struct Uniforms { plane: vec4f }

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let d = dot(material.plane.xyz, input.worldPosition) + material.plane.w;
      s.alpha = select(1.0, 0.0, d < 0.0);
      return s;
    }`,
});
```

An alpha map, read from the green channel as three.js reads it:

```ts
const leaf = materials.shader({
  alphaMode: 'mask', alphaCutoff: 0.5,
  textures: { alphaTex: await assets.loadTexture('/tex/leaf-alpha.ktx2', { colorSpace: 'linear' }) },
  wgsl: /* wgsl */ `
    var alphaTex: texture_2d<f32>;

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      s.alpha = s.alpha * textureSample(alphaTex, alphaTexSampler, input.uv).g;
      return s;
    }`,
});
```

A custom material takes every standard option but the texture maps. It takes up to 6 textures of its own, which its WGSL samples.

## Check the result

1. Turn post-processing off, and match the tone mapping on both sides.
2. Compare one material type at a time, on a sphere and a plane under the scene's lights.
3. Read the diff image. A surface that is brighter or darker everywhere points to a color space, the exposure or the light units. A highlight of another size points to the roughness. Missing detail points to a missing map, or a map in the wrong color space.
4. Expect two small differences. Highlights on small curved shapes are a little brighter and narrower, because the engine uses Filament's specular anti-aliasing. Grazing reflections on strong normal maps are darker, because the engine fades reflections that point below the surface.

[Verifying a port](verification.md) shows how to compare whole views with image tests.

## Related pages

- [Materials](../api/materials.md)
- [Textures](../api/textures.md)
- [Color management](../concepts/color-management.md)
- [Surface functions](../shaders/surface-functions.md)
- [Porting shaders](threejs-shaders.md)
- [The three.js to null3D mapping](threejs-mapping.md)
