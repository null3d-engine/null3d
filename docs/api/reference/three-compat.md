---
id: api/reference/three-compat
title: "three.js compatibility (@null3d/three-compat): API reference"
status: generated
since: "0.3"
summary: "Every export of the three.js compatibility (@null3d/three-compat) API, from the engine's doc comments."
---

# three.js compatibility (@null3d/three-compat): API reference

> [three.js compatibility (@null3d/three-compat)](../three-compat.md) explains these exports. The engine's doc comments make this page.

## `cineon`

```ts
const cineon: ToneCurve
```

Cineon's tone curve, with three.js's `CineonToneMapping` formula, the filmic operator of Jim Hejl and Richard Burgess-Dawson. Give it to `post.set({ toneMapping })` where the three.js scene sets `CineonToneMapping`.

## `createOutlinePass`

```ts
function createOutlinePass(ctx: SketchContext, options: OutlinePassOptions = {}): OutlinePass
```

Draws an outline with three.js's `OutlinePass` look: a soft edge around the meshes that `mesh.setOutlined(true)` marks, its glow, and its pulse. Settings turn it on, and the core draws the mask that it reads. The edge is soft, and the core's crisp line is off. A scene that also wants the crisp line sets `post.set({ outline: { width } })` after this call.

## `OutlinePass`

Interface `OutlinePass`.

An outline that `createOutlinePass` made. A call to `set` changes its settings from the next frame on.

| Member | Description |
| --- | --- |
| `set(options: OutlinePassOptions): void` | Changes the settings from the next frame on. It throws for a number outside its range, and throws for a color that the engine does not take. |

## `OutlinePassOptions`

Interface `OutlinePassOptions`.

The settings of an outline, with three.js's `OutlinePass` names and defaults. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The color of the edge around the parts that nothing hides, as `visibleEdgeColor` is. A hex string is sRGB; an array of three numbers is linear. It is white by default. |
| `hiddenColor?: ColorInput` | The color of the edge around the parts that other objects hide, as `hiddenEdgeColor` is. It is `[0.1, 0.04, 0.02]` in linear color by default, which is three.js's dark brown. |
| `strength?: number` | The edge's brightness, as `edgeStrength` is: 0 or more, and 3 by default. |
| `thickness?: number` | The gaussian blur's radius at half the render size, as `edgeThickness` is: above 0, and 1 by default. A wider radius softens the edge over more pixels. |
| `glow?: number` | How much of the wider, quarter-size blur joins the edge, as `edgeGlow` is: 0 or more, and 0 by default. A glow is a soft halo that spreads past the edge. |
| `pulsePeriod?: number` | The seconds that the pulse takes to rise and fall, as `pulsePeriod` is, or 0 for none, which is the default. The pulse fades the edge to a quarter of its strength and back. |

## `reinhard`

```ts
const reinhard: ToneCurve
```

Reinhard's tone curve, with three.js's `ReinhardToneMapping` formula. Give it to `post.set({ toneMapping })` where the three.js scene sets `ReinhardToneMapping`.
