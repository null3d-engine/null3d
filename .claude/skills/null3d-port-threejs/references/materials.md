# Porting materials and textures

Engine docs: `porting/threejs-materials`, `api/materials`, `api/textures`, `concepts/color-management`, `shaders/surface-functions`.

Versions: `materials.standard` takes `color`, `opacity`, `metalness`, `roughness`, `emissive` and `emissiveIntensity` now, and shades as three.js's `MeshStandardMaterial` does. `materials.unlit` takes `color` and `opacity`. Both take `doubleSided`, `vertexColors` and `fog`, and the standard material takes `flatShading`. The engine stores `opacity` but draws every material opaque. The other options below come later in 0.1 unless a row gives another version, and so do `materials.shader` and surface functions. The texture options of `assets.loadTexture` in section 7 exist now, but no material can use a texture yet.

## Contents

1. MeshStandardMaterial
2. MeshPhysicalMaterial
3. MeshBasicMaterial
4. MeshLambertMaterial and MeshPhongMaterial
5. MeshToonMaterial and MeshMatcapMaterial
6. Other three.js materials
7. Texture settings
8. Recipes: toon, matcap, clipping plane, alpha map (later in 0.1)
9. Checking material parity

## 1. MeshStandardMaterial

`MeshStandardMaterial` maps to `materials.standard`. Both follow the glTF metallic-roughness model with the same formulas, so values carry over.

| three.js | null3D | Notes |
| --- | --- | --- |
| `color` | `color` | Hex values are sRGB in both |
| `map` | `map` (later in 0.1) | Must be sRGB (`colorSpace: 'srgb'`) |
| `roughness`, `metalness` | `roughness`, `metalness` | Same meaning (perceptual roughness) and the same defaults |
| `roughnessMap`, `metalnessMap` | `metalnessRoughnessMap` (later in 0.1) | One texture: roughness in G, metalness in B, as glTF packs them. If the original uses two textures, pack them offline with `bunx @null3d/cli assets pack-orm` (0.2; the same texture can hold AO in R) |
| `normalMap`, `normalScale` | `normalMap`, `normalScale: [x, y]` (later in 0.1) | Tangent-space only; object-space normal maps are not supported |
| `normalMapType: ObjectSpaceNormalMap` | Not supported | Convert to tangent space offline |
| `aoMap`, `aoMapIntensity` | `aoMap`, `aoMapIntensity` (later in 0.1) | three.js reads AO from the R channel; so does null3D |
| `lightMap`, `lightMapIntensity` | `lightMap`, `lightMapIntensity` (later in 0.1) | Usually on the second UV set: the texture option `uvSet: 1` |
| `emissive`, `emissiveIntensity` | Same names | `emissive` is an sRGB color, as in three.js |
| `emissiveMap` | `emissiveMap` (later in 0.1) | Must be sRGB |
| `envMap`, `envMapIntensity` | Scene environment, `envIntensity` (0.2) | Per-material environment maps are not supported; one scene environment lights everything |
| `envMapRotation` | `scene.setEnvironment(env, { rotation })` (0.2) | |
| `bumpMap`, `bumpScale` | A normal map made offline: `bunx @null3d/cli assets normal-from-bump` (0.2) | |
| `displacementMap`, `displacementScale`, `displacementBias` | A `vertexOffset` function (later in 0.1; section 8 of `references/shaders.md`) | Enlarge bounds with `setBounds` |
| `alphaMap` | A surface function, or alpha packed into `map` offline (later in 0.1) | three.js reads the alpha map's G channel (recipe in section 8) |
| `transparent: true`, `opacity` | `alphaMode: 'blend'` (later in 0.1), `opacity` | `opacity` is stored now, and draws once blending comes |
| `alphaTest` | `alphaMode: 'mask'`, `alphaCutoff` (later in 0.1) | |
| `alphaHash` | `alphaMode: 'mask'` (later in 0.1) | Hashed transparency is not supported |
| `side: DoubleSide` | `doubleSided: true` | Fixed when the material is created. A back face lights as if it faced the camera, as in three.js |
| `side: BackSide` | Flip the geometry | Not a material option: in `geometry.fromArrays`, reverse each triangle's indices and negate the normals |
| `depthWrite`, `depthTest` | Same names (later in 0.1) | |
| `polygonOffset`, `polygonOffsetFactor`, `polygonOffsetUnits` | `depthBias: { constant, slopeScale }` (later in 0.1) | Keep the three.js intent; the engine converts signs for reversed depth |
| `blending: NormalBlending / AdditiveBlending / MultiplyBlending` | `blending: 'normal' / 'additive' / 'multiply'` (later in 0.1) | Subtractive and custom blending are not supported |
| `vertexColors`, `flatShading` | Same names | Fixed when the material is created: make one material for each combination. `vertexColors` needs a mesh with colors |
| `wireframe` | `debug.view('wireframe')` (later in 0.1), or `scene.createLines({ fromEdges })` (0.2) | |
| `fog: false` | Same name | |
| `toneMapped: false` | Not in 1.0 | Draw the objects in a declared pass after post-processing (0.2) |
| `dithering` | Always on in the final pass | |
| `clippingPlanes`, `clipShadows` | A surface function (later in 0.1; section 8) | |
| `shadowSide`, `precision`, `premultipliedAlpha` | Not needed | To store a texture's colors multiplied by alpha: `loadTexture(url, { premultipliedAlpha: true })` |

## 2. MeshPhysicalMaterial

`materials.standard` covers the base layer. The extensions are planned for after 1.0. Until then, these workarounds apply once their options exist:

| three.js property | Workaround | Visual cost |
| --- | --- | --- |
| `clearcoat`, `clearcoatRoughness` | Lower `roughness`; raise `envIntensity` (0.2) slightly | The second highlight is lost |
| `transmission`, `thickness`, `ior`, `attenuationColor` | `alphaMode: 'blend'`, low `opacity`, tint with `color`, higher `envIntensity` (0.2) | No refraction or thickness color |
| `sheen`, `sheenColor`, `sheenRoughness` | Surface function adding a fresnel rim to `emissive` | Approximate |
| `iridescence` | Surface function tinting by view angle | Approximate |
| `anisotropy` | Not available | Brushed-metal streaks are lost |
| `specularIntensity`, `specularColor` | Adjust `roughness` and `metalness` | Approximate |
| `dispersion` | Not available | |

Tell the user which of these a scene relies on before porting it. Glass and car-paint showcases depend on them heavily.

## 3. MeshBasicMaterial

`materials.unlit`: `color`, `opacity`, `vertexColors`, `doubleSided` and `fog` now; `map`, `alphaMode` and `alphaCutoff` later in 0.1. Its `envMap` and `reflectivity` (fake reflections) are not supported; use `materials.standard` with high metalness and low roughness for a reflective look.

## 4. MeshLambertMaterial and MeshPhongMaterial

Both become `materials.standard` with `metalness: 0`. The standard material adds a faint highlight, and keeps energy as `MeshStandardMaterial` does. So small differences are expected: accept them after a parity check, or tune.

- Lambert: `roughness: 1`. Emissive carries over, and maps later in 0.1.
- Phong: start from `roughness = (2 / (shininess + 2)) ** 0.25`. That converts Blinn-Phong shininess to a GGX roughness through the common Beckmann approximation; treat it as a starting point and tune with parity images. Typical values: shininess 30 becomes about 0.49, shininess 100 about 0.37.
- Phong `specular` color has no direct equivalent in a metalness workflow. Gray specular maps to roughness only; strongly colored specular needs a surface function.
- `specularMap` (Phong) can become a roughness map: bright specular means low roughness. Convert offline.

## 5. MeshToonMaterial and MeshMatcapMaterial

Both become surface-function recipes (section 8), later in 0.1. Toon shading needs light-band steps; the recipe reads the main light direction from the engine's lighting helpers. Matcap looks up a texture by view-space normal and ignores scene lights, as three.js's matcap does.

## 6. Other three.js materials

| three.js | null3D |
| --- | --- |
| `MeshNormalMaterial` | `debug.view('normals')` (later in 0.1) for debugging; a surface function that outputs the normal as color for a styled look |
| `MeshDepthMaterial`, `MeshDistanceMaterial` | `debug.view('depth')` (later in 0.1); custom shadow materials are not needed |
| `ShadowMaterial` | `materials.shadowCatcher({ opacity })` (0.2) |
| `PointsMaterial` | Options of `scene.createPoints`: `size`, `sizeAttenuation`, `texture`, `colors` (0.2) |
| `LineBasicMaterial`, `LineDashedMaterial`, `LineMaterial` | Options of `scene.createLines`: `width`, `widthUnits`, `dashed`, `colors` (0.2) |
| `SpriteMaterial` | Options of `scene.createSprites`: `texture` or `atlas`, `sizeMode`, `rotation` (0.2) |
| `ShaderMaterial`, `RawShaderMaterial` | `materials.shader` (later in 0.1) in WGSL (`references/shaders.md`) |
| `NodeMaterial` and TSL materials | `materials.shader` (later in 0.1) with a surface function (`references/shaders.md`) |

## 7. Texture settings

| three.js | null3D `loadTexture` option |
| --- | --- |
| `colorSpace = SRGBColorSpace` (older: `encoding = sRGBEncoding`) | `colorSpace: 'srgb'` |
| No color space (data textures) | `colorSpace: 'linear'` |
| `flipY` (TextureLoader default true) | `flipY: true`; glTF textures always use `false` |
| `wrapS`, `wrapT` | `wrap: 'repeat' | 'clamp' | 'mirror'`, or `[u, v]` |
| `repeat`, `offset`, `rotation` | The material's `uvTransform: { repeat, offset, rotation }` (later in 0.1) |
| `center` | Bake into `offset`: rotating about center c equals rotating about the origin, then offsetting by c minus the rotated c |
| `anisotropy` | `anisotropy`, from 1 to 16 |
| `magFilter`, `minFilter` (`NearestFilter`) | `filter: 'nearest'` |
| `generateMipmaps` | `mipmaps` |
| `channel` | `uvSet` |
| `premultiplyAlpha` | `premultipliedAlpha` |
| `needsUpdate = true` after changing pixels | `texture.update(bitmap)`, or `texture.update(data)` for a texture from `textures.fromData` |

Texture formats: `loadTexture` decodes PNG, JPEG and WebP files, and AVIF files where the browser supports them. KTX2 files load later in 0.1. Convert PNG and JPEG textures to KTX2 with `bunx @null3d/cli assets optimize` (0.2). Use UASTC for normal maps and important color maps, and ETC1S where download size matters most. HDR environment files become prefiltered KTX2 with `bunx @null3d/cli assets env` (0.2).

## 8. Recipes (later in 0.1)

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

Matcap:

```ts
const matcap = materials.shader({
  textures: { matcap: await assets.loadTexture('/tex/matcap-clay.ktx2', { colorSpace: 'srgb' }) },
  wgsl: /* wgsl */ `
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

Alpha map (three.js reads the G channel):

```ts
const leaf = materials.shader({
  alphaMode: 'mask', alphaCutoff: 0.5,
  textures: { alphaTex: await assets.loadTexture('/tex/leaf-alpha.ktx2', { colorSpace: 'linear' }) },
  wgsl: /* wgsl */ `
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
