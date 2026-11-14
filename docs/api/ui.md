---
id: api/ui
title: UI overlays and labels
status: experimental
since: "0.2"
summary: "ui.trackLabel in the sketch; engine.labels.bind on the page."
---

# UI overlays and labels

> Roadmap step 0.2, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

A label is an HTML element that follows a scene object, such as a name tag or a health bar above a unit. The sketch tracks a label on an object under an id, and the page binds an element to the same id. The engine then moves the element over the object in every frame on screen. No message goes between the sketch and the page per frame.

A label is flat on the screen by default. Give it `transform: 'world'` and the element becomes a plane of the scene. It turns and scales with its object, so text on a turning panel leans with it. Give it `transform: 'billboard'` and the plane always faces the camera.

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

The `transform` option says how the element sits:

- `'screen'` keeps the element flat on the screen at the label's place, always the same size. This is the default.
- `'world'` makes the element a plane of the scene that turns and scales with the object.
- `'billboard'` makes the element a plane of the scene that always faces the camera. Give it `rotation` to turn the element's content in its own plane, in radians.

A plane is a child of its object in effect: the offset places it, and it takes the object's turn and scale. [Labels as planes of the scene](#labels-as-planes-of-the-scene) describes what a page does for them.

The engine holds 4,096 labels at once by default, and 256 labels that are planes of the scene. Set the first number with `createEngine`'s `maxLabels` option, and the second with `maxLabels3d`. A label flat on the screen takes 48 bytes of the memory that the engine's threads share, and a plane takes 156 bytes. One label more than the engine holds fails with E1219, and so does an id that is not a string with at least one character.

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

## Labels as planes of the scene

A label whose `transform` is `'world'` or `'billboard'` puts its element in the scene itself. The browser then draws the element with the camera's perspective. The engine writes only numbers: the element's world matrix, and the camera of the frame on screen.

```ts
// sketch.ts: a card that turns with its panel, and a title that always faces the camera.
ui.trackLabel(panel, 'card', { transform: 'world', offset: [0, 1.4, 0] });
ui.trackLabel(crown, 'title', { transform: 'billboard', rotation: 0.1 });
```

The scene's units are the element's CSS pixels for these labels, as they are for three.js's `CSS3DRenderer`. An element 160 pixels wide is 160 units wide, so the scene around it needs units of the same size.

The browser scales the element with the perspective, and keeps its text sharp. The element covers about `w × focal ÷ d` pixels of the canvas, where `w` is its width and `d` its distance. The focal length is half the canvas height in pixels, divided by the tangent of half the vertical field of view.

What the page does for such a label:

- The engine moves the element into a container of its own, inside the element's parent. The container covers its parent and holds the camera's view. Put the element in a container that covers the canvas, as for any label.
- The engine sets the element's `user-select` to `none`, and leaves the pointer to your CSS. Give the element `pointer-events: auto` when it takes clicks, as three.js's `CSS3DRenderer` does. Keep its `transform-origin` at its center.
- The engine writes the element's `transform` only when its matrix changes. Its size, its text and its style stay yours.
- The element hides with `visibility: hidden` for the reasons listed above. The engine tests the label's anchor, so the whole element hides at once.

## Which frame the labels follow

The engine draws a frame on one thread while the sketch computes the next one on another. A label placed from the sketch's current camera would run ahead of the image during a fast camera move.

So the sketch places every label with the camera of each frame, as part of the frame's work. The thread that draws keeps the places of the frame it shows, and the page moves the elements to them. Each element therefore sits over its object in the frame on screen, in every thread mode. Where the page itself draws, it moves the elements right after it draws each frame, in the same update of the page.

The page writes a screen label's element only when the label moved by half a CSS pixel or more, or when it shows or hides. It writes a 3D element's transform only when its matrix changed. It reads every label before it writes any style, so the browser runs no layout between them. While no element is bound, the labels cost the page nothing.

## Compared with three.js

Labels take the place of three.js's `CSS2DRenderer` and `CSS2DObject`, of `CSS3DRenderer` with `CSS3DObject` and `CSS3DSprite`, and of drei's `<Html>`.

- An element's center sits where `CSS2DRenderer` puts a `CSS2DObject`'s center by default, to within a thousandth of a pixel.
- A label with `transform: 'world'` takes a `CSS3DObject`'s matrix, and `'billboard'` takes a `CSS3DSprite`'s, with its `rotation2D` as `rotation`.
- The offset works like a `CSS2DObject`'s or `CSS3DObject`'s position under its parent.
- `CSS2DRenderer` and `CSS3DRenderer` hide an element with `display: none`; null3D uses `visibility: hidden`, which keeps the page's layout as it is.
- null3D does not set `z-index` from the distance to the camera. Elements stack in the order of the page. `CSS2DObject`'s `center` has no counterpart: move the content inside the element with CSS.
- null3D hides a plane whose anchor lies behind the camera, or outside the near and far planes. three.js's `CSS3DRenderer` draws such an element anyway.
- `CSS3DRenderer` writes every element's style in every frame. null3D writes an element's transform only when its matrix changes.

## Related pages

- [UI, HTML overlays and labels](../guides/ui-overlays.md): HTML UI around the canvas, and labels in a full app.
- [Cameras](cameras.md): `worldToScreen` places a single point on the canvas.
- [Engine](engine.md): `createEngine` and its label options.
- [Sketch](sketch.md): the sketch's context, which holds `ui`.
- [The picking demo](https://github.com/null3d-engine/null3d/tree/main/examples/picking): labels on shapes that turn, which a click selects.
- [The 3D labels demo](https://github.com/null3d-engine/null3d/tree/main/examples/css3d-labels): cards that turn with a ring, and a title that faces the camera.

## API reference

[The API reference](reference/ui.md) lists every export of this page with its type and description. The engine's doc comments make it.
