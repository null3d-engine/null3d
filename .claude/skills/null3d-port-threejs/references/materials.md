# Porting materials and textures

Engine docs: `porting/threejs-materials`, `api/materials`, `api/textures`, `concepts/color-management`, `shaders/surface-functions`.

## Contents

1. MeshStandardMaterial
2. MeshPhysicalMaterial
3. MeshBasicMaterial
4. MeshLambertMaterial and MeshPhongMaterial
5. MeshToonMaterial and MeshMatcapMaterial
6. Other three.js materials
7. Texture settings
8. Recipes: toon, matcap, clipping plane, alpha map
9. Checking material parity

## 1. MeshStandardMaterial

`MeshStandardMaterial` maps to `materials.standard`. Both follow the glTF metallic-roughness model, so values carry over.

| three.js | null3d | Notes |
| --- | --- | --- |
| `color` | `color` | Hex values are sRGB in both |
| `map` | `map` | Must be sRGB (`colorSpace: 'srgb'`) |
| `roughness`, `metalness` | `roughness`, `metalness` | Same meaning (perceptual roughness) |
| `roughnessMap`, `metalnessMap` | `metalnessRoughnessMap` | One texture: roughness in G, metalness in B, as glTF packs them. If the original uses two textures, pack them offline with `bunx @null3d/cli assets pack-orm` (the same texture can hold AO in R) |
| `normalMap`, `normalScale` | `normalMap`, `normalScale: [x, y]` | Tangent-space only; object-space normal maps are not supported |
| `normalMapType: ObjectSpaceNormalMap` | Not supported | Convert to tangent space offline |
| `aoMap`, `aoMapIntensity` | `aoMap`, `aoMapIntensity` | three.js reads AO from the R channel; so does null3d |
| `lightMap`, `lightMapIntensity` | `lightMap`, `lightMapIntensity` | Usually on the second UV set: `uvSet: 1` |
| `emissive`, `emissiveMap`, `emissiveIntensity` | Same names | |
| `envMap`, `envMapIntensity` | Scene environment, `envIntensity` | Per-material environment maps are not supported; one scene environment lights everything |
| `envMapRotation` | `scene.setEnvironment(env, { rotation })` (0.2) | |
| `bumpMap`, `bumpScale` | A normal map made offline: `bunx @null3d/cli assets normal-from-bump` (0.2) | |
| `displacementMap`, `displacementScale`, `displacementBias` | A `vertexOffset` function (section 8 of `references/shaders.md`) | Enlarge bounds with `setBounds` |
| `alphaMap` | A surface function, or alpha packed into `map` offline | three.js reads the alpha map's G channel (recipe in section 8) |
| `transparent: true`, `opacity` | `alphaMode: 'blend'`, `opacity` | |
| `alphaTest` | `alphaMode: 'mask'`, `alphaCutoff` | |
| `alphaHash` | `alphaMode: 'mask'` | Hashed transparency is not supported |
| `side: DoubleSide` | `doubleSided: true` | |
| `side: BackSide` | Flip the geometry | Not a material option |
| `depthWrite`, `depthTest` | Same names | |
| `polygonOffset`, `polygonOffsetFactor`, `polygonOffsetUnits` | `depthBias: { constant, slopeScale }` | Keep the three.js intent; the engine converts signs for reversed depth |
| `blending: NormalBlending / AdditiveBlending / MultiplyBlending` | `blending: 'normal' / 'additive' / 'multiply'` | Subtractive and custom blending are not supported |
| `vertexColors`, `flatShading` | Same names | |
| `wireframe` | `debug.view('wireframe')`, or `scene.createLines({ fromEdges })` (0.2) | |
| `fog: false` | `fog: false` | |
| `toneMapped: false` | Not in 1.0 | Draw the objects in a declared pass after post-processing (0.2) |
| `dithering` | Always on in the final pass | |
| `clippingPlanes`, `clipShadows` | A surface function (section 8) | |
| `shadowSide`, `precision`, `premultipliedAlpha` | Not needed | Textures stored premultiplied: `loadTexture(url, { premultipliedAlpha: true })` |

## 2. MeshPhysicalMaterial

`materials.standard` covers the base layer. The extensions are planned for after 1.0. Until then:

| three.js property | Workaround | Visual cost |
| --- | --- | --- |
| `clearcoat`, `clearcoatRoughness` | Lower `roughness`; raise `envIntensity` slightly | The second highlight is lost |
| `transmission`, `thickness`, `ior`, `attenuationColor` | `alphaMode: 'blend'`, low `opacity`, tint with `color`, higher `envIntensity` | No refraction or thickness color |
| `sheen`, `sheenColor`, `sheenRoughness` | Surface function adding a fresnel rim to `emissive` | Approximate |
| `iridescence` | Surface function tinting by view angle | Approximate |
| `anisotropy` | Not available | Brushed-metal streaks are lost |
| `specularIntensity`, `specularColor` | Adjust `roughness` and `metalness` | Approximate |
| `dispersion` | Not available | |

Tell the user which of these a scene relies on before porting it. Glass and car-paint showcases depend on them heavily.

## 3. MeshBasicMaterial

`materials.unlit`: `color`, `map`, `opacity` with `alphaMode`, `alphaCutoff`, `vertexColors`, `doubleSided`, `fog`. Its `envMap` and `reflectivity` (fake reflections) are not supported; use `materials.standard` with high metalness and low roughness for a reflective look.

## 4. MeshLambertMaterial and MeshPhongMaterial

Both become `materials.standard` with `metalness: 0`. Small differences are expected; accept them after a parity check, or tune.

- Lambert: `roughness: 1`. Emissive and maps carry over.
- Phong: start from `roughness = (2 / (shininess + 2)) ** 0.25`. That converts Blinn-Phong shininess to a GGX roughness through the common Beckmann approximation; treat it as a starting point and tune with parity images. Typical values: shininess 30 becomes about 0.49, shininess 100 about 0.37.
- Phong `specular` color has no direct equivalent in a metalness workflow. Gray specular maps to roughness only; strongly colored specular needs a surface function.
- `specularMap` (Phong) can become a roughness map: bright specular means low roughness. Convert offline.

## 5. MeshToonMaterial and MeshMatcapMaterial

Both become surface-function recipes (section 8). Toon shading needs light-band steps; the recipe reads the main light direction from the engine's lighting helpers. Matcap looks up a texture by view-space normal and ignores scene lights, as three.js's matcap does.

## 6. Other three.js materials

| three.js | null3d |
| --- | --- |
| `MeshNormalMaterial` | `debug.view('normals')` for debugging; a surface function that outputs the normal as color for a styled look |
| `MeshDepthMaterial`, `MeshDistanceMaterial` | `debug.view('depth')`; custom shadow materials are not needed |
| `ShadowMaterial` | `materials.shadowCatcher({ opacity })` (0.2) |
| `PointsMaterial` | Options of `scene.createPoints`: `size`, `sizeAttenuation`, `texture`, `colors` (0.2) |
| `LineBasicMaterial`, `LineDashedMaterial`, `LineMaterial` | Options of `scene.createLines`: `width`, `widthUnits`, `dashed`, `colors` (0.2) |
| `SpriteMaterial` | Options of `scene.createSprites`: `texture` or `atlas`, `sizeMode`, `rotation` (0.2) |
| `ShaderMaterial`, `RawShaderMaterial` | `materials.shader` in WGSL (`references/shaders.md`) |
| `NodeMaterial` and TSL materials | `materials.shader` with a surface function (`references/shaders.md`) |

## 7. Texture settings

| three.js | null3d `loadTexture` option |
| --- | --- |
| `colorSpace = SRGBColorSpace` (older: `encoding = sRGBEncoding`) | `colorSpace: 'srgb'` |
| No color space (data textures) | `colorSpace: 'linear'` |
| `flipY` (TextureLoader default true) | `flipY: true`; glTF textures always use `false` |
| `wrapS`, `wrapT` | `wrap: 'repeat' | 'clamp' | 'mirror'`, or `[u, v]` |
| `repeat`, `offset`, `rotation` | The material's `uvTransform: { repeat, offset, rotation }` |
| `center` | Bake into `offset`: rotating about center c equals rotating about the origin, then offsetting by c minus the rotated c |
| `anisotropy` | `anisotropy` (capped by the preset) |
| `magFilter`, `minFilter` (`NearestFilter`) | `filter: 'nearest'` |
| `generateMipmaps` | `mipmaps` |
| `channel` | `uvSet` |
| `premultiplyAlpha` | `premultipliedAlpha` |
| `needsUpdate = true` after changing pixels | `texture.update(bitmap)` |

Texture formats: convert PNG and JPEG textures to KTX2 with `bunx @null3d/cli assets optimize`. Use UASTC for normal maps and important color maps, and ETC1S where download size matters most. HDR environment files become prefiltered KTX2 with `bunx @null3d/cli assets env`.

## 8. Recipes

Toon shading with three bands:

```ts
const toon = materials.shader({
  uniforms: { bands: 3, shadowColor: '#303050' },
  surface: /* wgsl */ `
    #import null3d::lighting::{mainLightDirection}
    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let ndl = max(dot(input.worldNormal, -mainLightDirection()), 0.0);
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
  surface: /* wgsl */ `
    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let n = normalize((camera.view * vec4f(input.worldNormal, 0.0)).xyz);
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
  surface: /* wgsl */ `
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
  surface: /* wgsl */ `
    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      s.alpha = s.alpha * textureSample(alphaTex, alphaTexSampler, input.uv).g;
      return s;
    }`,
});
```

## 9. Checking material parity

1. Compare with post-processing off and tone mapping matched (`toneMapping: 'none'` if the original has none).
2. Compare one material type at a time, on a simple lit test view: a sphere and a plane under the scene's lights.
3. Read the diff image. Uniformly brighter or darker usually means color space, exposure or light units. Different highlight size means roughness mapping. Missing detail means a missing map, or a map with the wrong color space.
4. Record accepted differences in the report, with the reason.
