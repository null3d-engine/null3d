---
id: api/reference/ui
title: "UI overlays and labels: API reference"
status: generated
since: "0.2"
summary: "Every export of the UI overlays and labels API, from the engine's doc comments."
---

# UI overlays and labels: API reference

> [UI overlays and labels](../ui.md) explains these exports. The engine's doc comments make this page.

## `EngineLabels`

Interface `EngineLabels`.

The page's labels, as `engine.labels` gives them.

| Member | Description |
| --- | --- |
| `bind(id: string, element: HTMLElement): () => void` | Binds `element` to the label that the sketch tracks under `id` with `ui.trackLabel`. The engine then moves the element's center over the label's place on the canvas, in each frame on screen, through its CSS `transform`. It sets the element's `position` to `absolute` at the top left of its container, so put the element in a container that covers the canvas. It hides the element with `visibility: hidden` while the label's object is hidden, outside the camera's near and far planes, or not tracked. Binding another element to an id replaces the first. Returns a function that unbinds the element, which then stays where it is. A label that the sketch tracks with `transform: 'world'` or `'billboard'` is a plane of the scene: the engine moves the element into a container of its own inside the element's parent, and turns it with the scene's perspective, as three.js's `CSS3DRenderer` does. Leave the element's `transform-origin` at its center, and size the element in CSS pixels, which are the scene's units at the distance where the view is one pixel per unit. |

## `LabelOptions`

Interface `LabelOptions`.

Options for `ui.trackLabel`.

| Member | Description |
| --- | --- |
| `offset?: Vec3Like` | Where the label sits relative to the object, in the object's own space, so the offset turns and scales with it. The default is the object's origin, `[0, 0, 0]`. |
| `transform?: LabelTransform` | How the element sits in the scene. The default is `'screen'`. |
| `rotation?: number` | The element's turn in its own plane, in radians, for `'billboard'`. It turns the content of the element, as three.js's `CSS3DSprite` `rotation2D` does. |

## `LabelTransform`

```ts
type LabelTransform = 'screen' | 'world' | 'billboard';
```

How a label's element sits in the scene. - `'screen'` keeps the element flat on the screen at the label's place, always the same size, as three.js's `CSS2DRenderer` does. - `'world'` makes the element a plane of the scene: it turns and scales with the object, as three.js's `CSS3DObject` does. - `'billboard'` makes the element a plane of the scene that always faces the camera, as three.js's `CSS3DSprite` does.

## `Ui`

Class `Ui`.

HTML labels that follow scene objects. The sketch tracks a label on an object under an id, and the page binds an HTML element to the same id with `engine.labels.bind`. The engine then moves the element over the object in each frame on screen, with no message per frame.

| Member | Description |
| --- | --- |
| `trackLabel(object: Object3D, id: string, options?: LabelOptions): void` | Tracks a label on `object` under `id`, from this frame on: the element that the page binds to the same id with `engine.labels.bind` then follows the object. Tracking an id again moves its label to the new object, offset and transform. A label stops when the sketch untracks it or destroys its object. The engine holds the number of labels that `createEngine`'s `maxLabels` option gives, 4,096 by default, and one more fails with E1219. A label whose transform is not `'screen'` takes a slot in the engine's 3D labels instead, which `maxLabels3d` holds. |
| `untrackLabel(id: string): void` | Stops the label with `id`, which the page then hides. An id that is not tracked does nothing. |
