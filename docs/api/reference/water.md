---
id: api/reference/water
title: "Water (@null3d/water): API reference"
status: generated
since: "0.3"
summary: "Every export of the Water (@null3d/water) API, from the engine's doc comments."
---

# Water (@null3d/water): API reference

> [Water (@null3d/water)](../water.md) explains these exports. The engine's doc comments make this page.

## `BedDepth`

```ts
type BedDepth = (x: number, z: number) => number;
```

The depth of a bed at a point, in meters below the water's surface. A shape gives one where its bed does not follow the profile that the shape's width and depth describe.

## `createOcean`

```ts
function createOcean(ctx: SketchContext, options: OceanOptions): Ocean
```

Makes a sea of waves in a scene: the transform's passes, the material that reads them, and the reflection that mirrors the sky and the far shore. The sea's mesh follows the camera, and the surface moves its vertices and lights its slopes from the transform's heights.

## `createUnderwater`

```ts
function createUnderwater({ post }: SketchContext, camera: PerspectiveCamera, water: Water, options: UnderwaterOptions = {}): Underwater
```

Makes the view from under the water whose surface the `water` object draws, for `camera`. The waterline follows the same long waves as the surface, and the effect fades the light at the same current, so a camera that dips under the water sees the world through it.

## `createWater`

```ts
function createWater(ctx: SketchContext, options: WaterOptions): Water
```

Makes the water that a scene draws, and the reflection pass that mirrors the scene in it. The bodies come from one description: a river that follows a line, or a lake that fills an outline. The surface reads the copy of the opaque scene's depth, or the bed that the shapes describe, so its shores fade against the bed, and the reflection redraws as often as the quality preset affords.

## `FlowAt`

```ts
type FlowAt = (x: number, z: number) => WaterPoint;
```

The current at a point, as a velocity in meters a second: its x and z components. A river gives one where its current does not follow its middle line.

## `foamMap`

```ts
function foamMap({ textures }: SketchContext, obstacles: readonly FoamObstacle[], options: FoamMapOptions): FoamMap
```

Makes the map of the foam around `obstacles`, over the `origin` and `size` area that the water covers. The water samples it as its `foam` map, and the surface breaks it into flecks that drift downstream.

## `FoamMap`

Interface `FoamMap`.

A map of the foam around things that break the water's surface, such as stones.

| Member | Description |
| --- | --- |
| `texture: Texture` | The map. Its red channel holds how near each point lies to something that breaks the surface, from 1 at the thing's edge to 0 a little way off. |
| `origin: readonly [x: number, z: number]` | The world point that the map's first texel covers, as [x, z] in meters. |
| `size: readonly [x: number, z: number]` | The world size that the map covers, as [x, z] in meters. |

## `FoamMapOptions`

Interface `FoamMapOptions`.

Options of `foamMap`.

| Member | Description |
| --- | --- |
| `readonly origin: readonly [x: number, z: number]` | The world point that the map's first texel covers, as [x, z] in meters. |
| `readonly size: readonly [x: number, z: number]` | The world area that the map covers, as [x, z] in meters. |
| `readonly width?: number` | The map's texels along x. It is 1024 by default. |
| `readonly height?: number` | The map's texels along z. It is 224 by default. |
| `readonly reach?: number` | How far the foam reaches around an obstacle, in meters. It is 0.35 by default. |
| `readonly trail?: number` | How far downstream, toward +x, the foam trails behind an obstacle, in meters. It is 1.6 by default, and 0 leaves a ring. |

## `FoamObstacle`

Interface `FoamObstacle`.

Something that breaks the water's surface: its middle and its radius at the surface.

| Member | Description |
| --- | --- |
| `readonly x: number` | The x of the obstacle's middle, in meters. |
| `readonly z: number` | The z of the obstacle's middle, in meters. |
| `readonly r: number` | The obstacle's radius at the water's surface, in meters. |

## `LakeDepth`

```ts
type LakeDepth = number | ((x: number, z: number, fromShore: number) => number);
```

The depth of a lake's bed, in meters below the surface: the deepest point, or a function of the point and its distance from the shore.

## `LakeShape`

Interface `LakeShape`.

A lake: the water that fills the area inside an outline.

| Member | Description |
| --- | --- |
| `kind: 'lake'` | The kind of water body. |
| `shore: readonly WaterPoint[]` | The shore's outline, as at least three points in order around the lake, in meters. |
| `depth?: LakeDepth` | The depth of the bed, in meters below the surface: the deepest point, or a function of the point and its distance from the shore. It is 2 by default. |
| `shoreWidth?: number` | How far from the shore the bed reaches the depth of a lake that gives one number, in meters, from 0.01. It is 2 by default. |
| `bed?: BedDepth` | The depth of the bed at any point, in meters, where it does not follow the shore and the shore width. The surface reads it as its bed when `createWater` is told `bed: 'shape'`. |
| `mesh?: MeshDetail` | The mesh's detail for this body, in place of the one that `createWater` gives. |

## `MeshDetail`

Interface `MeshDetail`.

How fine a mesh is: the meters along a river, the sections across it, and a lake's grid cell.

| Member | Description |
| --- | --- |
| `step?: number` | The most meters between two cross sections along a river. It is 2 by default. |
| `across?: number` | The sections across a river's width. It is 16 by default. |
| `cell?: number` | The meters between two lines of a lake's grid. It is 2 by default. |
| `reach?: number` | How far past a river's half width its mesh reaches, as a factor, from 1. It is 1.36 by default, which covers the band where the shore fades. A bed that the water reads itself ends the surface, so a sheet of exactly the half width takes 1. |

## `Ocean`

Interface `Ocean`.

The sea that `createOcean` made.

| Member | Description |
| --- | --- |
| `readonly level: number` | The height of the sea's surface, in meters. |
| `readonly bands: readonly OceanBand[]` | The bands of the sea, in the order that they sum. |
| `readonly reflectionEvery: number` | The frames between two draws of the reflection now. |
| `update(): void` | Moves the sea's mesh about the camera. The reflection pass carries its own cadence. Call once in each frame, after the camera moves and before the engine draws. |
| `heightAt(x: number, z: number): number` | The height of the sea at a world place, in meters, as the bands sum at the sketch time. It runs the bands' transforms on this thread, and transforms again only when the sketch time moves, so several reads in a frame share one transform. |
| `destroy(): void` | Removes the surface, the transform's passes, the reflection and the material. |

## `OCEAN_BANDS`

```ts
const OCEAN_BANDS: readonly OceanBand[]
```

The bands that the sea holds when a page names none: a long swell, a wind sea and the chop on top.

## `OceanBand`

Interface `OceanBand`.

One band of the ocean: a tile of sea of its own, whose waves run at its own scale.

| Member | Description |
| --- | --- |
| `readonly tile: number` | The metres that one tile covers each way. |
| `readonly height: number` | The significant wave height of the band, in meters: about four times its own spread. |
| `readonly wind: number` | The wind's speed in meters a second. |
| `readonly direction: number` | The wind's heading in radians, where 0 blows toward +x and pi/2 toward +z. |
| `readonly seed: number` | The seed of the band's random waves, so the same seed draws the same sea. |

## `OceanMaterialOptions`

```ts
type OceanMaterialOptions = { wireframe?: boolean | undefined; transmission?: number | undefined; castsStill?: boolean | undefined; swayDistance?: number | undefined; flatShading?: boolean | undefined; lightMapOffset?: readonly [number, number] | undefined; lightMapRepeat?: readonly [number, number] | undefined; lightMapDecode?: 'srgb' | 'rgbm' | undefined; lightMapDirection?: Texture | undefined; contactShadows?: boolean | undefined; metalness?: number | undefined; roughness?: number | undefined; emissive?: ColorInput | undefined; emissiveIntensity?: number | undefined; normalScale?: readonly [number, number] | undefined; bumpScale?: number | undefined; displacementScale?: number | undefined; displacementBias?: number | undefined; aoMapIntensity?: number | undefined; lightMapIntensity?: number | undefined; ior?: number | undefined; specularIntensity?: number | undefined; specularColor?: ColorInput | undefined; envIntensity?: number | undefined; uvTransform?: UvTransform | undefined; mapUvTransforms?: Partial<Record<'lightMap' | 'transmissionMap' | 'thicknessMap' | 'map' | 'metalnessRoughnessMap' | 'normalMap' | 'bumpMap' | 'displacementMap' | 'aoMap' | 'emissiveMap' | 'specularIntensityMap' | 'specularColorMap' | 'diffuseTransmissionMap' | 'diffuseTransmissionColorMap' | 'clearcoatMap' | 'clearcoatRoughnessMap' | 'clearcoatNormalMap' | 'sheenColorMap' | 'sheenRoughnessMap' | 'iridescenceMap' | 'iridescenceThicknessMap' | 'anisotropyMap', UvTransform>> | undefined; thickness?: number | undefined; attenuationColor?: ColorInput | undefined; attenuationDistance?: number | undefined; dispersion?: number | undefined; diffuseTransmission?: number | undefined; diffuseTransmissionColor?: ColorInput | undefined; subsurfaceRadius?: number | undefined; subsurfaceColor?: ColorInput | undefined; clearcoat?: number | undefined; clearcoatRoughness?: number | undefined; clearcoatNormalScale?: readonly [number, number] | undefined; sheenColor?: ColorInput | undefined; sheenRoughness?: number | undefined; iridescence?: number | undefined; iridescenceIor?: number | undefined; iridescenceThicknessRange?: readonly [number, number] | undefined; anisotropy?: number | undefined; anisotropyRotation?: number | undefined; color?: ColorInput | undefined; opacity?: number | undefined; alphaCutoff?: number | undefined; doubleSided?: boolean | undefined; vertexColors?: boolean | undefined; fog?: boolean | undefined; toneMapped?: boolean | undefined; alphaMode?: AlphaMode | undefined; alphaToCoverage?: boolean | undefined; forceSinglePass?: boolean | undefined; blending?: Blending | undefined; depthWrite?: boolean | undefined; depthTest?: boolean | undefined; colorWrite?: boolean | undefined; depthBias?: DepthBias | undefined; };
```

The standard material values that the ocean's surface takes.

## `OceanOptions`

Interface `OceanOptions`.

Options of `createOcean`.

| Member | Description |
| --- | --- |
| `readonly camera: Camera` | The camera that the sea's mesh follows. It stays about the camera in every frame. |
| `readonly level?: number` | The height of the sea's surface, in meters. It is 0 by default. |
| `readonly bands?: readonly OceanBand[]` | The bands of the sea, from two to three, each with the meters of its tile, its significant wave height, and the wind that shapes it. The default bands are a long swell, a wind sea and chop. |
| `readonly reach?: number` | How far past the camera the mesh reaches, in meters. It is 3000 by default. |
| `readonly segments?: number` | The mesh's segments each way. It is 256 by default. |
| `readonly foam?: number` | The height at which foam breaks on a crest, in meters. It is 1.1 by default. |
| `readonly softness?: number` | The meters of the gap to the bed over which the water fades at a shore. It is 0.12 by default. |
| `readonly reflectionEvery?: Partial<Record<QualityPreset, number>>` | The frames between two draws of the reflection at each preset, which replaces the add-on's own cadence for the presets that it names. |
| `readonly layers?: number` | The layers that the reflection pass draws, as a 32-bit mask. It is the camera's by default. |
| `readonly reflectionScale?: 1 \| 0.5 \| 0.25` | The reflection's size as a share of the render size each way: 1, 0.5 or 0.25. It is the render size by default. |
| `readonly material?: OceanMaterialOptions` | The standard material values, such as the water's tint and its thickness. |

## `RiverDepth`

```ts
type RiverDepth = number | readonly number[] | ((x: number, z: number, along: number) => number);
```

The depth of a river's bed under its middle line, in meters below the surface: one number for the whole river, one number for each point of the middle line, or a function of the point and the distance along the river from its first point.

## `RiverShape`

Interface `RiverShape`.

A river: the water that follows a line, with a width and a depth along it.

| Member | Description |
| --- | --- |
| `kind: 'river'` | The kind of water body. |
| `middle: readonly WaterPoint[]` | Points along the river's middle, from its source to its mouth, in meters: at least two. The water runs in the direction that the points give. |
| `halfWidth: number \| readonly number[]` | The half width at each point of the middle line, in meters, from 0.01: one number for the whole river, or one for each point. The bed rises to the surface a third of the half width beyond the edge that it gives. |
| `depth?: RiverDepth` | The depth of the bed under the middle line, in meters. It is 1 by default. |
| `speed?: number` | How fast the current runs downstream, in meters a second. The ripples and the caustics drift with it. It is 0.35 by default, and 0 stills the water. A `current` function replaces it. |
| `current?: FlowAt` | The current at any point, as a velocity in meters a second, where it does not follow the middle line. The surface carries its waves, its foam and its caustics with it. |
| `bed?: BedDepth` | The depth of the bed at any point, in meters, where it does not follow the shape's width and depth. The surface reads it as its bed when `createWater` is told `bed: 'shape'`. |
| `mesh?: MeshDetail` | The mesh's detail for this body, in place of the one that `createWater` gives. |

## `Underwater`

Interface `Underwater`.

The view from under the water, which the scene drives in each frame.

| Member | Description |
| --- | --- |
| `update(t: number, air: readonly [red: number, green: number, blue: number], caustics: readonly [red: number, green: number, blue: number]): void` | Turns the effect on while the camera is under the water's surface at the sketch time `t`, and fits it to the frame's light. |
| `destroy(): void` | Removes the effect, if it draws. |

## `UnderwaterOptions`

Interface `UnderwaterOptions`.

Options of `createUnderwater`.

| Member | Description |
| --- | --- |
| `readonly density?: number` | How much of the light the water swallows for each meter along the view. It is 0.07. |
| `readonly color?: readonly [red: number, green: number, blue: number]` | The water's own color, as a share of the air's color at the horizon in each channel. It is `[0.22, 0.42, 0.4]`, the green of clear water. |
| `readonly ready?: number` | How near above the surface the camera comes before the effect is added. It is 0.6 m. |
| `readonly release?: number` | How far above the surface the camera goes before the effect is removed. It is 1 m. |

## `Water`

Interface `Water`.

Water that `createWater` made.

| Member | Description |
| --- | --- |
| `readonly level: number` | The height of the water's surface, in meters. |
| `readonly waveAmplitude: number` | The height of the long waves and of the wind's lift, as a factor of their base height. |
| `readonly bodies: readonly WaterBody[]` | The bodies of water that the surface draws, in the order that the shapes give. |
| `readonly reflectionEvery: number` | The frames between two draws of the reflection now. |
| `update(): void` | Keeps the sketch's frame loop, as every sketch calls it. The reflection pass carries its own cadence, so this call changes nothing. |
| `surfaceHeight(x: number, z: number, t: number): number` | The height of the water's surface at a point and a sketch time, in meters, as its long waves move it. It uses the current of the body that the point lies over. Where two bodies meet, it follows the surface there, which lies flat and mixes the river's waves into the lake's. |
| `currentAt(x: number, z: number, out: [x: number, z: number]): void` | The current of the body that a point lies over, as a velocity in meters a second, written into `out`. It is zero for still water and outside every body. Where a river runs into a lake, the lake owns the water inside its shore. |
| `setCaustics(light: readonly [x: number, y: number, z: number]): void` | Sets the light that the ripples focus on the bed, as a linear color. |
| `destroy(): void` | Removes the surface, its reflection pass and its material. |

## `waterBody`

```ts
function waterBody(shape: WaterShape): WaterBody
```

Resolves a shape into the water body that the add-on draws: its bounds, the depth of its bed at a point, and the current there.

## `WaterBody`

Interface `WaterBody`.

A water body that a shape resolved to: its bounds, the depth of its bed at a point and the current there. The add-on builds its surface from this, and a scene reads it to place what floats.

| Member | Description |
| --- | --- |
| `readonly kind: 'river' \| 'lake'` | The kind of water body that the shape describes. |
| `readonly minX: number` | The least x that the water reaches, in meters. |
| `readonly maxX: number` | The greatest x that the water reaches, in meters. |
| `readonly minZ: number` | The least z that the water reaches, in meters. |
| `readonly maxZ: number` | The greatest z that the water reaches, in meters. |
| `depthAt(x: number, z: number): number` | The depth of the bed below the water's surface at a point, in meters, and 0 outside the water. |
| `contains(x: number, z: number): boolean` | True when the point lies over the water, where its depth is above 0. |
| `currentAt(x: number, z: number, out: [x: number, z: number]): void` | The current at a point, as a velocity in meters a second, written into `out`. It is zero for still water. A river carries its current along its middle line, or along the `current` function that it gives. |

## `WaterMaterialOptions`

```ts
type WaterMaterialOptions = { wireframe?: boolean | undefined; transmission?: number | undefined; castsStill?: boolean | undefined; swayDistance?: number | undefined; flatShading?: boolean | undefined; lightMapOffset?: readonly [number, number] | undefined; lightMapRepeat?: readonly [number, number] | undefined; lightMapDecode?: 'srgb' | 'rgbm' | undefined; lightMapDirection?: Texture | undefined; contactShadows?: boolean | undefined; metalness?: number | undefined; roughness?: number | undefined; emissive?: ColorInput | undefined; emissiveIntensity?: number | undefined; normalScale?: readonly [number, number] | undefined; bumpScale?: number | undefined; displacementScale?: number | undefined; displacementBias?: number | undefined; aoMapIntensity?: number | undefined; lightMapIntensity?: number | undefined; ior?: number | undefined; specularIntensity?: number | undefined; specularColor?: ColorInput | undefined; envIntensity?: number | undefined; uvTransform?: UvTransform | undefined; mapUvTransforms?: Partial<Record<'lightMap' | 'transmissionMap' | 'thicknessMap' | 'map' | 'metalnessRoughnessMap' | 'normalMap' | 'bumpMap' | 'displacementMap' | 'aoMap' | 'emissiveMap' | 'specularIntensityMap' | 'specularColorMap' | 'diffuseTransmissionMap' | 'diffuseTransmissionColorMap' | 'clearcoatMap' | 'clearcoatRoughnessMap' | 'clearcoatNormalMap' | 'sheenColorMap' | 'sheenRoughnessMap' | 'iridescenceMap' | 'iridescenceThicknessMap' | 'anisotropyMap', UvTransform>> | undefined; thickness?: number | undefined; attenuationColor?: ColorInput | undefined; attenuationDistance?: number | undefined; dispersion?: number | undefined; diffuseTransmission?: number | undefined; diffuseTransmissionColor?: ColorInput | undefined; subsurfaceRadius?: number | undefined; subsurfaceColor?: ColorInput | undefined; clearcoat?: number | undefined; clearcoatRoughness?: number | undefined; clearcoatNormalScale?: readonly [number, number] | undefined; sheenColor?: ColorInput | undefined; sheenRoughness?: number | undefined; iridescence?: number | undefined; iridescenceIor?: number | undefined; iridescenceThicknessRange?: readonly [number, number] | undefined; anisotropy?: number | undefined; anisotropyRotation?: number | undefined; color?: ColorInput | undefined; opacity?: number | undefined; alphaCutoff?: number | undefined; doubleSided?: boolean | undefined; vertexColors?: boolean | undefined; fog?: boolean | undefined; toneMapped?: boolean | undefined; alphaMode?: AlphaMode | undefined; alphaToCoverage?: boolean | undefined; forceSinglePass?: boolean | undefined; blending?: Blending | undefined; depthWrite?: boolean | undefined; depthTest?: boolean | undefined; colorWrite?: boolean | undefined; depthBias?: DepthBias | undefined; };
```

The standard material values that the water's surface takes.

## `WaterOptions`

Interface `WaterOptions`.

Options of `createWater`.

| Member | Description |
| --- | --- |
| `readonly shapes: WaterShape \| readonly WaterShape[]` | The water's body or bodies: a river, a lake, or several of them that share one surface material and one reflection. |
| `readonly level?: number` | The height of the water's surface, in meters. It is 0 by default. |
| `readonly foam?: FoamMap` | A map of foam around the things that break the surface. Without one the water foams only where it thins at a shore. |
| `readonly ripple?: number` | The water's ripples, as a factor of their base height, from 0. It is 1 by default. |
| `readonly waveAmplitude?: number` | The height of the long waves and of the wind's lift, as a factor of their base height, from 0. It is 1 by default. The fine ripples keep the strength that `ripple` gives them, so a small value gives a nearly flat surface that still ripples. |
| `readonly softness?: number` | The meters of the gap to the bed over which the water fades at a shore. It is 0.12 by default. |
| `readonly colorAlongView?: number` | The share of the water's color at a low view, from 0 to 1, that reads the whole way the view runs through the water, as a wide sea's does: a low view then shows no sharp outline of the bed in the distance. A view from above keeps the depth. At 0, the default, it reads the depth at every view. |
| `readonly reflectionEvery?: Partial<Record<QualityPreset, number>>` | The frames between two draws of the reflection at each preset, which replaces the add-on's own cadence for the presets that it names. The frame-budget governor may still double it while frames take too long. It is 2 on Low and Medium and 1 on High and Ultra. |
| `readonly reflectionFollowsBudget?: boolean` | False keeps the frame-budget governor from raising the frames between two draws of the reflection. Between draws the water shows the reflection of an older camera, so on a moving camera a raised count reads as a reflection that lags behind what it mirrors. The default, true, lets the governor trade that for time. |
| `readonly layers?: number` | The layers that the reflection pass draws, as a 32-bit mask. It is the camera's layers by default. Give the layer of the objects that the water mirrors to leave out the things that lie on or under its surface. |
| `readonly reflectionScale?: 1 \| 0.5 \| 0.25` | The reflection's size as a share of the render size each way: 1, 0.5 or 0.25. It is the render size by default. A smaller share softens the reflection and costs less. |
| `readonly mesh?: MeshDetail` | How fine the surface's mesh is, for the bodies that give no detail of their own. |
| `readonly bed?: 'scene' \| 'shape'` | Where the surface reads the depth of the bed: `'scene'`, the copy of the opaque scene's depth behind each pixel, or `'shape'`, the depth that each shape describes, carried in the mesh's vertex colors. It is `'scene'` by default. `'shape'` suits a bed that the scene states rather than draws, or one whose drawn shape differs from the depth that the water should read. |
| `readonly material?: WaterMaterialOptions` | The standard material values, such as the volume's tint and its thickness. |
| `readonly wind?: WaterWind` | The wind field that lifts the surface's short waves and carries their crests. A page gives the wind add-on's field here, and the surface reads it once for each vertex. |

## `WaterPoint`

```ts
type WaterPoint = readonly [x: number, z: number];
```

A point on the ground plane, in meters: its x and its z.

## `WaterShape`

```ts
type WaterShape = RiverShape | LakeShape;
```

The shape of one water body: a river or a lake.

## `WaterWind`

Interface `WaterWind`.

The wind that a water surface reads: a plain field texture and its box, so that a page connects the wind add-on to the water without either add-on importing the other.

| Member | Description |
| --- | --- |
| `readonly texture: Texture` | The field's texture, whose newest state its layer names. |
| `readonly size: number` | The field's box across the ground, in meters, or 0 for the steady field everywhere. |
| `readonly air: { readonly base: readonly number[]; readonly gust: readonly number[]; readonly swirl: readonly number[]; readonly sent: readonly number[]; }` | The air's steady settings, as the sampling function reads them: base, gust, swirl and the gust that a page sent, whose born time changes when a page sends another. |

## `waveHeight`

```ts
function waveHeight(x: number, z: number, t: number, level: number, current: readonly [x: number, z: number], ripple: number, waveAmplitude = 1): number
```

The height of a water surface at a point and a sketch time, in meters, as its long waves move it. A `current` carries the whole set downstream, with each wave's direction turned into the current's frame; still water keeps the authored directions and each wave's own speed. `ripple` scales them, and `waveAmplitude` scales the surface's height above the level.
