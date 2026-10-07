---
id: api/ui
title: UI overlays and labels
status: experimental
since: "0.2"
summary: "ui.trackLabel in the sketch; engine.labels.bind on the page."
---

# UI overlays and labels

> Ships in null3D 0.2. The API is experimental, so it can still change between versions.

A label is an HTML element that follows a scene object, such as a name tag or a health bar above a unit. The sketch tracks a label on an object under an id, and the page binds an element to the same id. The engine then moves the element over the object in every frame on screen. No message goes between the sketch and the page per frame.

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, ui, time }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 3, 8], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1] });
  const unit = scene.createMesh({ mesh: geometry.box(), material: materials.standard({ color: '#4a8cff' }), dynamic: true });
  // The label sits 1 unit above the box's center.
  ui.trackLabel(unit, 'unit-1', { offset: [0, 1, 0] });
  return {
    onUpdate() {
      unit.setPosition(Math.sin(time.now) * 3, 0, 0);
    },
  };
});
```

```ts
// page.ts
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas')!;
const layer = document.querySelector<HTMLElement>('#labels')!;
const engine = await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });

const tag = document.createElement('div');
tag.className = 'tag';
tag.textContent = 'Unit 1';
layer.append(tag);
engine.labels.bind('unit-1', tag);
```

```html
<div style="position: relative">
  <canvas style="width: 100%; height: 480px; display: block"></canvas>
  <!-- The labels' layer covers the canvas, and lets clicks through to it. -->
  <div id="labels" style="position: absolute; inset: 0; overflow: hidden; pointer-events: none"></div>
</div>
```

## Labels in the sketch

`ui.trackLabel(object, id, options)` tracks a label on `object` from this frame on. The label's place is the object's world matrix applied to `offset`. So the offset is in the object's own space: it turns and scales with the object, as a child of the object would. The default offset is the object's origin.

- Tracking an id again moves its label to the new object and offset.
- `ui.untrackLabel(id)` stops the label, and the page hides its element. An id that is not tracked does nothing.
- A label stops by itself when the sketch destroys its object.

The engine holds 4,096 labels at once by default. `createEngine`'s `maxLabels` option sets another number, from 1 to 65,536. Each label takes 48 bytes of the memory that the engine's threads share. One label more than the engine holds fails with E1219, and so does an id that is not a string with at least one character.

## Elements on the page

`engine.labels.bind(id, element)` binds an element to the label with the same id. The sketch can track the label before or after the bind. The element stays hidden until the label's first frame reaches the screen. The code that moves the elements downloads with the first bind, so a page without labels never downloads it.

The engine places the element's center over the label, through its CSS `transform`. It also sets the element's `position` to `absolute` at the top left of its container. So put the elements in a container that covers the canvas exactly, as the example above does. Give the container `pointer-events: none`, so the canvas still gets the pointer.

The engine sets `visibility: hidden` on the element while:

- the label's object, or one of its parents, is hidden with `setVisible(false)`;
- the active camera draws none of the object's layers;
- the label lies nearer than the camera's near plane or farther than its far plane, which includes every point behind a perspective camera;
- the sketch does not track the label.

A label off the canvas's edge keeps its place, so the container's `overflow: hidden` clips it.

`bind` returns a function that unbinds the element. The element then stays where it is, and you can remove it. Binding another element to the same id replaces the first.

## Which frame the labels follow

The engine draws a frame on one thread while the sketch computes the next one on another. A label placed from the sketch's current camera would run ahead of the image during a fast camera move.

So the sketch places every label with the camera of each frame, as part of the frame's work. The thread that draws keeps the places of the frame it shows, and the page moves the elements to them. Each element therefore sits over its object in the frame on screen, in every thread mode. Where the page itself draws, it moves the elements right after it draws each frame, in the same update of the page.

The page writes an element's style only when the label moved by half a CSS pixel or more, or when it shows or hides. It reads every label before it writes any style, so the browser runs no layout between them. While no element is bound, the labels cost the page nothing.

## Compared with three.js

Labels take the place of three.js's `CSS2DRenderer` and `CSS2DObject`, and of drei's `<Html>`.

- An element's center sits where `CSS2DRenderer` puts a `CSS2DObject`'s center by default, to within a thousandth of a pixel.
- The offset works like a `CSS2DObject`'s position under its parent.
- `CSS2DRenderer` hides an element with `display: none`; null3D uses `visibility: hidden`, which keeps the page's layout as it is.
- null3D does not set `z-index` from the distance to the camera. Elements stack in the order of the page. `CSS2DObject`'s `center` and `rotation2D` have no counterpart: move or turn the content inside the element with CSS.
- `CSS3DRenderer`, which turns elements with the scene, has no counterpart.

## Related pages

- [UI, HTML overlays and labels](../guides/ui-overlays.md): HTML UI around the canvas, and labels in a full app.
- [Cameras](cameras.md): `worldToScreen` places a single point on the canvas.
- [Engine](engine.md): `createEngine` and its `maxLabels` option.
- [Sketch](sketch.md): the sketch's context, which holds `ui`.
- [The picking demo](https://github.com/null3d-engine/null3d/tree/main/examples/picking): labels on shapes that turn, which a click selects.

## API reference

<!-- null3d:api:start -->

### `EngineLabels`

Interface `EngineLabels`.

The page's labels, as `engine.labels` gives them.

| Member | Description |
| --- | --- |
| `bind(id: string, element: HTMLElement): () => void` | Binds `element` to the label that the sketch tracks under `id` with `ui.trackLabel`. The engine then moves the element's center over the label's place on the canvas, in each frame on screen, through its CSS `transform`. It sets the element's `position` to `absolute` at the top left of its container, so put the element in a container that covers the canvas. It hides the element with `visibility: hidden` while the label's object is hidden, outside the camera's near and far planes, or not tracked. Binding another element to an id replaces the first. Returns a function that unbinds the element, which then stays where it is. |

### `LabelOptions`

Interface `LabelOptions`.

Options for `ui.trackLabel`.

| Member | Description |
| --- | --- |
| `offset?: Vec3Like` | Where the label sits relative to the object, in the object's own space, so the offset turns and scales with it. The default is the object's origin, `[0, 0, 0]`. |

### `Ui`

Class `Ui`.

HTML labels that follow scene objects. The sketch tracks a label on an object under an id, and the page binds an HTML element to the same id with `engine.labels.bind`. The engine then moves the element over the object in each frame on screen, with no message per frame.

| Member | Description |
| --- | --- |
| `trackLabel(object: Object3D, id: string, options?: LabelOptions): void` | Tracks a label on `object` under `id`, from this frame on: the element that the page binds to the same id with `engine.labels.bind` then follows the object. Tracking an id again moves its label to the new object and offset. A label stops when the sketch untracks it or destroys its object. The engine holds the number of labels that `createEngine`'s `maxLabels` option gives, 4,096 by default, and one more fails with E1219. |
| `untrackLabel(id: string): void` | Stops the label with `id`, which the page then hides. An id that is not tracked does nothing. |

<!-- null3d:api:end -->
