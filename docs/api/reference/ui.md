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
| `bind(id: string, element: HTMLElement): () => void` | Binds `element` to the label that the sketch tracks under `id` with `ui.trackLabel`. The engine then moves the element's center over the label's place on the canvas, in each frame on screen, through its CSS `transform`. It sets the element's `position` to `absolute` at the top left of its container, so put the element in a container that covers the canvas. It hides the element with `visibility: hidden` while the label's object is hidden, outside the camera's near and far planes, or not tracked. Binding another element to an id replaces the first. Returns a function that unbinds the element, which then stays where it is. |

## `LabelOptions`

Interface `LabelOptions`.

Options for `ui.trackLabel`.

| Member | Description |
| --- | --- |
| `offset?: Vec3Like` | Where the label sits relative to the object, in the object's own space, so the offset turns and scales with it. The default is the object's origin, `[0, 0, 0]`. |

## `Ui`

Class `Ui`.

HTML labels that follow scene objects. The sketch tracks a label on an object under an id, and the page binds an HTML element to the same id with `engine.labels.bind`. The engine then moves the element over the object in each frame on screen, with no message per frame.

| Member | Description |
| --- | --- |
| `trackLabel(object: Object3D, id: string, options?: LabelOptions): void` | Tracks a label on `object` under `id`, from this frame on: the element that the page binds to the same id with `engine.labels.bind` then follows the object. Tracking an id again moves its label to the new object and offset. A label stops when the sketch untracks it or destroys its object. The engine holds the number of labels that `createEngine`'s `maxLabels` option gives, 4,096 by default, and one more fails with E1219. |
| `untrackLabel(id: string): void` | Stops the label with `id`, which the page then hides. An id that is not tracked does nothing. |
