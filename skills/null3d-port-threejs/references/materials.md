# Porting materials and textures

Engine docs: `porting/threejs-materials`, `api/materials`, `api/textures`, `concepts/color-management`, `shaders/surface-functions`.

Versions: every `materials.standard` option in section 1 is built, unless its row gives a version, and the material shades as three.js's `MeshStandardMaterial` does. `materials.unlit` takes `color`, `opacity`, `map` and `uvTransform`. Both take `doubleSided`, `vertexColors`, `fog`, `alphaMode`, `alphaCutoff`, `blending`, `depthWrite`, `depthTest` and `depthBias`, and the standard material also takes `flatShading`. Both take `alphaToCoverage`, `forceSinglePass` and the `hash` alpha mode (0.2) too. Custom materials (`materials.shader`) are built: surface functions, vertex offsets, uniforms and full shaders. They take every standard option but the texture maps. Textures in custom materials (0.2) are built, so the alpha map recipe works. The matcap recipe also needs `camera.view`, which comes later in 0.2.

## Contents

1. MeshStandardMaterial
2. MeshPhysicalMaterial
3. MeshBasicMaterial
4. MeshLambertMaterial and MeshPhongMaterial
5. MeshToonMaterial and MeshMatcapMaterial
6. Other three.js materials
7. Texture settings
8. Recipes: toon, clipping plane, matcap and alpha map
9. Checking material parity

## 1. MeshStandardMaterial

`MeshStandardMaterial` maps to `materials.standard`. Both follow the glTF metallic-roughness model with the same formulas, so values carry over.

| three.js | null3D | Notes |
| --- | --- | --- |
| `color` | `color` | Hex values are sRGB in both |
| `map` | `map` | Must be sRGB (`colorSpace: 'srgb'`). Its alpha multiplies `opacity` |
| `roughness`, `metalness` | `roughness`, `metalness` | Same meaning (perceptual roughness) and the same defaults |
| `roughnessMap`, `metalnessMap` | `metalnessRoughnessMap` | One texture: roughness in G, metalness in B, as glTF packs them. If the original uses two textures, pack them offline with `bunx @null3d/cli assets pack-orm` (0.2; the same texture can hold AO in R) |
| `normalMap`, `normalScale` | `normalMap`, `normalScale: [x, y]` | Tangent space only. The frame comes from the mesh's tangents where it has them, else from the pixels around it, as in three.js |
| `normalMapType: ObjectSpaceNormalMap` | Not supported | Convert to tangent space offline |
| `aoMap`, `aoMapIntensity` | `aoMap`, `aoMapIntensity` | three.js reads AO from the R channel; so does null3D |
| `lightMap`, `lightMapIntensity` | `lightMap`, `lightMapIntensity` | Usually on the second UV set: the texture option `uvSet: 1` |
| `emissive`, `emissiveIntensity` | Same names | `emissive` is an sRGB color, as in three.js |
| `emissiveMap` | `emissiveMap` | Must be sRGB |
| `envMap`, `envMapIntensity` | `scene.setEnvironment(env)`, `envIntensity` (0.2) | Per-material environment maps are not supported; one scene environment lights everything. `envIntensity` multiplies the scene's `intensity`, where three.js uses `scene.environmentIntensity` in place of `envMapIntensity` under a scene environment |
| `envMapRotation` | `scene.setEnvironment(env, { rotation })` (0.2) | The scene's rotation; materials share it |
| `scene.environment` from `PMREMGenerator` | `scene.setEnvironment(await assets.loadEnvironment(url))` (0.2) | `loadEnvironment` takes the `.hdr` or `.exr` file that `HDRLoader` or `EXRLoader` loaded, and filters it on the GPU. Prefiltering it offline with `bunx @null3d/cli assets env` skips that work at load. `RoomEnvironment` is `await assets.builtinEnvironment('room')`, which the GPU makes with no file. Reflections match three.js's PMREM, roughness by roughness |
| `bumpMap`, `bumpScale` | A normal map made offline: `bunx @null3d/cli assets normal-from-bump` (0.2) | |
| `displacementMap`, `displacementScale`, `displacementBias` | A `vertexOffset` function: procedural now, from a height texture in 0.2 (section 8 of `references/shaders.md`) | Enlarge bounds with `setBounds` |
| `alphaMap` | Alpha packed into `map`'s alpha offline, or a surface function that samples the alpha map (0.2) | three.js reads the alpha map's G channel (recipe in section 8) |
| `transparent: true`, `opacity` | `alphaMode: 'blend'`, `opacity` | Blended objects draw after the opaque ones, farthest first; an instance batch's rows sort one by one |
| `alphaTest` | `alphaMode: 'mask'`, `alphaCutoff` | Pass the `alphaTest` value as `alphaCutoff`, whose default is 0.5, as in glTF. The cut edges are smoothed by default (0.2); add `alphaToCoverage: false` only when the port needs three.js's hard edges |
| `alphaToCoverage` with `alphaTest` | `alphaMode: 'mask'`, `alphaCutoff` (0.2) | On by default: the cut edges fade over one pixel and MSAA smooths them, as in three.js. Without MSAA it is a plain mask. Without `alphaTest`, three.js turns raw alpha into coverage: use `alphaMode: 'hash'` |
| `alphaHash` | `alphaMode: 'hash'` (0.2) | three.js's hash on the mesh's own positions, so the alpha sets the share of the surface that draws. `alphaCutoff` has no effect |
| `side: DoubleSide` | `doubleSided: true` | Fixed when the material is created. A back face lights as if it faced the camera, as in three.js. With `alphaMode: 'blend'` the back faces draw first, then the front faces, as in three.js (0.2) |
| `forceSinglePass` | Same name (0.2) | With `alphaMode: 'blend'` and `doubleSided`, one draw for both faces, in the mesh's triangle order |
| `side: BackSide` | Flip the geometry | Not a material option: in `geometry.fromArrays`, reverse each triangle's indices and negate the normals |
| `depthWrite`, `depthTest` | Same names | Fixed when the material is created. `depthTest: false` writes no depth either, as in three.js's WebGL renderer |
| `polygonOffset`, `polygonOffsetFactor`, `polygonOffsetUnits` | `depthBias: { constant, slopeScale }` | Keep the three.js intent; the engine converts signs for reversed depth |
| `blending: NormalBlending / AdditiveBlending / MultiplyBlending` | `blending: 'normal' / 'additive' / 'multiply'` with `alphaMode: 'blend'` | Subtractive and custom blending are not supported. three.js blends an opaque material with additive or multiply blending too; null3D needs `alphaMode: 'blend'` |
| `vertexColors`, `flatShading` | Same names | Fixed when the material is created: make one material for each combination. `vertexColors` needs a mesh with colors |
| `wireframe` | `debug.view('wireframe')` for debugging, or `scene.createLines({ positions, mode: 'segments' })` (0.2) with two points for each edge of the mesh | |
| `fog: false` | Same name | |
| `toneMapped: false` | Not in 1.0 | Draw the objects in a declared pass after post-processing (0.2) |
| `dithering` | Always on in the final pass | |
| `clippingPlanes`, `clipShadows` | A surface function with `alphaMode: 'mask'` (section 8) | Shadows keep the whole mesh |
| `shadowSide`, `precision`, `premultipliedAlpha` | Not needed | To store a texture's colors multiplied by alpha: `loadTexture(url, { premultipliedAlpha: true })` |

## 2. MeshPhysicalMaterial

`materials.standard` covers the base layer, and takes the index of refraction and specular options of `MeshPhysicalMaterial` (0.2) with the same names and formulas:

| three.js | null3D | Notes |
| --- | --- | --- |
| `ior` | `ior` | 1 or more; the default 1.5 reflects 4% head on, as `MeshStandardMaterial` does |
| `reflectivity` | `ior` | Convert: `ior = (1 + 0.4 * reflectivity) / (1 - 0.4 * reflectivity)`, as three.js does |
| `specularIntensity`, `specularIntensityMap` | Same names | The map's alpha multiplies the intensity; load it linear |
| `specularColor`, `specularColorMap` | Same names | The map is sRGB. Linear components above 1 carry over |

glTF files with `KHR_materials_ior` and `KHR_materials_specular` load into these options. The other extensions are planned for after 1.0. Until then, these workarounds apply once their options exist:

| three.js property | Workaround | Visual cost |
| --- | --- | --- |
| `clearcoat`, `clearcoatRoughness` | Lower `roughness`; raise `envIntensity` (0.2) slightly | The second highlight is lost |
| `transmission`, `thickness`, `attenuationColor` | `alphaMode: 'blend'`, low `opacity`, tint with `color`, higher `envIntensity` (0.2). Keep `ior` | No refraction or thickness color |
| `sheen`, `sheenColor`, `sheenRoughness` | Surface function adding a fresnel rim to `emissive` | Approximate |
| `iridescence` | Surface function tinting by view angle | Approximate |
| `anisotropy` | Not available | Brushed-metal streaks are lost |
| `dispersion` | Not available | |

Tell the user which of these a scene relies on before porting it. Glass and car-paint showcases depend on them heavily.

## 3. MeshBasicMaterial

`materials.unlit`: `color`, `opacity`, `map`, `uvTransform`, `vertexColors`, `doubleSided`, `fog`, `alphaMode`, `alphaCutoff`, `blending` and the depth options now. Its `envMap` and `reflectivity` (fake reflections) are not supported; use `materials.standard` with high metalness and low roughness for a reflective look.

## 4. MeshLambertMaterial and MeshPhongMaterial

Both become `materials.standard` with `metalness: 0`. The standard material adds a faint highlight, and keeps energy as `MeshStandardMaterial` does. So small differences are expected: accept them after a parity check, or tune.

- Lambert: `roughness: 1`. Emissive and maps carry over.
- Phong: start from `roughness = (2 / (shininess + 2)) ** 0.25`. That converts Blinn-Phong shininess to a GGX roughness through the common Beckmann approximation; treat it as a starting point and tune with parity images. Typical values: shininess 30 becomes about 0.49, shininess 100 about 0.37.
- Phong `specular` color has no direct equivalent in a metalness workflow. Gray specular maps to roughness only; strongly colored specular needs a surface function.
- `specularMap` (Phong) can become a roughness map: bright specular means low roughness. Convert offline.

## 5. MeshToonMaterial and MeshMatcapMaterial

Both become surface-function recipes (section 8). Toon shading needs light-band steps. Surface functions cannot read the scene's lights yet, so the recipe takes the light's direction as a uniform. Matcap looks up a texture by view-space normal and ignores scene lights, as three.js's matcap does. It needs textures in custom materials (0.2, built) and the camera's view matrix, which comes later in 0.2.

## 6. Other three.js materials

| three.js | null3D |
| --- | --- |
| `MeshNormalMaterial` | `debug.view('normals')` for debugging (world-space normals; three.js shows view-space ones); a surface function that outputs the normal as color for a styled look |
| `MeshDepthMaterial`, `MeshDistanceMaterial` | `debug.view('depth')` for debugging; custom shadow materials are not needed |
| `ShadowMaterial` | `materials.shadowCatcher({ opacity })` (0.2) |
| `PointsMaterial` | Options of `scene.createPoints`: `size` (with `sizeAttenuation`, world units: three.js's size times `tan(fov / 2)`; without it, CSS pixels), `sizeAttenuation`, `map`, `color`, `opacity`, `colors` for `vertexColors`, `alphaMode` (`'opaque'` by default; `'blend'` for `transparent`, `'mask'` with `alphaCutoff` for `alphaTest`), `blending` (0.2). Points do not vanish at the screen's edge as WebGL points do. Docs `api/points` |
| `LineBasicMaterial`, `LineDashedMaterial`, `LineMaterial` | Options of `scene.createLines`: `width` (1 for a one-pixel line), `worldUnits`, `dashed` with `dashSize`, `gapSize`, `dashScale` and `dashOffset`, `colors` (0.2). Docs `api/lines` |
| `SpriteMaterial` | Options of `scene.createSprites`: `map`, `atlas`, `color`, `opacity`, `sizeAttenuation` (sizes in CSS pixels when false), `alphaMode` (`'blend'` by default), `blending`; `rotation` is the batch's `rotations` array, one per sprite (0.2) |
| `ShaderMaterial`, `RawShaderMaterial` | `materials.shader` in WGSL: a surface function, or a full shader (`references/shaders.md`) |
| `NodeMaterial` and TSL materials | `materials.shader` with a surface function (`references/shaders.md`) |

## 7. Texture settings

| three.js | null3D `loadTexture` option |
| --- | --- |
| `colorSpace = SRGBColorSpace` (older: `encoding = sRGBEncoding`) | `colorSpace: 'srgb'` |
| No color space (data textures) | `colorSpace: 'linear'` |
| `flipY` (TextureLoader default true) | `flipY: true`; glTF textures always use `false` |
| `wrapS`, `wrapT` | `wrap: 'repeat' | 'clamp' | 'mirror'`, or `[u, v]` |
| `repeat`, `offset`, `rotation` | The material's `uvTransform: { repeat, offset, rotation }`. Every map of the material shares it, where three.js keeps one per texture |
| `center` | Bake into `offset`: rotating about center c equals rotating about the origin, then offsetting by c minus the rotated c |
| `anisotropy` | `anisotropy`, from 1 to 16 |
| `magFilter`, `minFilter` (`NearestFilter`) | `filter: 'nearest'` |
| `generateMipmaps` | `mipmaps` |
| `channel` | `uvSet` |
| `premultiplyAlpha` | `premultipliedAlpha` |
| `needsUpdate = true` after changing pixels | `texture.update(bitmap)`, or `texture.update(data)` for a texture from `textures.fromData` |

Texture formats: `loadTexture` decodes PNG, JPEG, WebP and AVIF files. It also loads KTX2 files of ETC1S or UASTC data, in the device's compressed format. KTX2 files of UASTC HDR data (0.2) load too, as with three.js's `KTX2Loader`. They become `bc6h-rgb-ufloat` where the device has BC formats, and `rgb9e5ufloat` elsewhere. three.js uses ASTC HDR or half floats there. They stay linear, so keep tone mapping on. glTF textures in `EXT_texture_webp` and `EXT_texture_avif` (0.2) load with no setup. Convert PNG and JPEG textures to KTX2 with `basisu -mipmap`, or with `bunx @null3d/cli assets optimize` (0.2). Use UASTC for normal maps and important color maps, and ETC1S where download size matters most. HDR environment files load as they are with `assets.loadEnvironment`, or as prefiltered KTX2 from `bunx @null3d/cli assets env` (0.2).

## 8. Recipes

The toon, clipping and alpha map recipes work now. The matcap recipe waits for `camera.view` (later in 0.2).

Toon shading with three bands:

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
      s.baseColor = vec3f(0.0);      // lighting off; emissive carries the look
      s.roughness = 1.0;
      return s;
    }`,
});
```

Matcap, which waits for `camera.view` (later in 0.2):

```ts
const matcap = materials.shader({
  textures: { matcap: await assets.loadTexture('/tex/matcap-clay.ktx2', { colorSpace: 'srgb' }) },
  wgsl: /* wgsl */ `
    var matcap: texture_2d<f32>;

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let n = normalize((camera.view * vec4f(input.normal, 0.0)).xyz);
      let uv = n.xy * vec2f(0.5, -0.5) + 0.5;     // y flipped: WebGPU texture space starts at the top
      s.emissive = textureSample(matcap, matcapSampler, uv).rgb;
      s.baseColor = vec3f(0.0);
      return s;
    }`,
});
```

Clipping plane (section views):

```ts
const clipped = materials.shader({
  alphaMode: 'mask', alphaCutoff: 0.5,
  uniforms: { plane: [0, -1, 0, 1.2] },          // normal xyz, constant w, as in THREE.Plane
  wgsl: /* wgsl */ `
    struct Uniforms { plane: vec4f }

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let d = dot(material.plane.xyz, input.worldPosition) + material.plane.w;
      s.alpha = select(1.0, 0.0, d < 0.0);                    // three.js clips where the distance is negative
      return s;
    }`,
});
```

Alpha map (0.2). three.js reads the G channel:

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

## 9. Checking material parity

1. Compare with post-processing off and tone mapping matched. null3D defaults to ACES, so a three.js side with `NoToneMapping` needs `post.set({ toneMapping: 'none' })` on the null3D side.
2. Compare one material type at a time, on a simple lit test view: a sphere and a plane under the scene's lights.
3. Read the diff image. Uniformly brighter or darker usually means color space, exposure or light units. Different highlight size means roughness mapping. Missing detail means a missing map, or a map with the wrong color space.
4. Record accepted differences in the report, with the reason.
