---
id: api/page
title: Messages between sketch and page
summary: "page.post and page.onMessage in the sketch; engine.postToSketch and engine.onSketchMessage on the page; start data that the setup reads as ctx.data."
---

# Messages between sketch and page

By default the sketch runs in a worker, and the page runs on the browser's main thread. They share no variables, so they talk through messages. The page keeps the HTML, and the sketch keeps the scene.

| Side | Sends with | Receives with |
| --- | --- | --- |
| Sketch | `page.post(name, data, transfer)` | `page.onMessage(handler)` |
| Page | `engine.postToSketch(name, data, transfer)` | `engine.onSketchMessage(handler)`, or the `onSketchMessage` option of `createEngine` |

A message has a name, such as `'color'`, and data, which is optional. A handler gets both. The third argument, `transfer`, is also optional. `page.onMessage` and `engine.onSketchMessage` return a function that removes the handler.

A message can reach the sketch only after its setup has run. To give the setup a state that the page knows at the start, pass it as [start data](#start-data).

## Example: a color picker on the page

The page sends the picked color to the sketch. The sketch paints its box and tells the page when the box is ready.

```ts
// page.ts
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas')!;
const picker = document.querySelector<HTMLInputElement>('#color')!;
const status = document.querySelector('#status')!;

const engine = await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });
engine.onSketchMessage((name, data) => {
  if (name === 'ready') status.textContent = `Showing ${(data as { name: string }).name}`;
});
picker.addEventListener('input', () => engine.postToSketch('color', picker.value));
```

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, page }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 2, 6], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  const paint = materials.standard({ color: '#4a8cff' });
  scene.createMesh({ mesh: geometry.box(), material: paint });

  page.onMessage((name, data) => {
    if (name === 'color') paint.set({ color: data as string });
  });
  page.post('ready', { name: 'the box' }); // waits for the page's first handler
});
```

## What a message can carry

When the sketch runs in a worker, a message goes from one thread to another, and the browser copies its data as `postMessage` does. Numbers, strings, arrays, plain objects and typed arrays all travel. The browser throws an error for data that it cannot copy, such as a function.

Engine objects, such as a mesh or a material, belong to the sketch. To name one in a message, send a name or a number that stands for it.

The optional `transfer` list names objects to move instead of copy, such as the `ArrayBuffer` of a large typed array. The sender cannot use a moved object again.

## When messages arrive

- Messages from one side arrive in the order that side sent them.
- When the sketch runs in a worker, its handlers run as soon as the worker receives the message, between two frames. The sketch's next frame includes any change that a handler makes to the scene.
- Messages also arrive while the engine is paused. Changes to the scene then show when the engine resumes.
- The page can send messages only after `createEngine` resolves, and by then the sketch's setup function has run. Register the sketch's handlers in the setup function. A message that arrives while the sketch has no handler is lost. Pass what the setup needs as [start data](#start-data).

The sketch can send messages from the start of its setup. Until the page registers its first handler, the engine keeps the newest 256 of the sketch's messages. The first handler that `engine.onSketchMessage` registers gets them at once, in order. Later handlers get only the messages that arrive after them.

The `onSketchMessage` option of `createEngine` gets every message as it arrives, from the start of the sketch's setup. With the option, the engine keeps no messages for later handlers. Use the option for progress that the sketch reports while it loads.

## Start data

The `sketchData` option of `createEngine` gives the sketch a state that the page knows before the scene starts. Examples are the section that the page's address names, a saved color mode or a level number. The setup reads it as `ctx.data`, before the first frame. `defineSketch<Data>` gives it a type, and it is `undefined` when the page passes none.

```ts
// page.ts
import { createEngine } from '@null3d/engine';
import type { StartData } from './sketch';

const params = new URLSearchParams(location.search);
const sketchData: StartData = {
  stop: params.get('stop') ?? 'hero', // the section that the address names
  dark: localStorage.getItem('dark') === '1', // a saved color mode
};
const engine = await createEngine({
  canvas: document.querySelector('canvas')!,
  sketch: new URL('./sketch.ts', import.meta.url),
  sketchData,
});
```

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

export interface StartData {
  stop: string;
  dark: boolean;
}

export default defineSketch<StartData>(({ data, scene }) => {
  // data is undefined when the page passes no sketchData, as a sketch test's page does.
  scene.setBackground(data?.dark ? '#05070a' : '#dfe8f0');
  const camera = scene.createPerspectiveCamera({
    position: data?.stop === 'city' ? [12, 30, 40] : [0, 2, 8],
    target: [0, 0, 0],
  });
  scene.setActiveCamera(camera);
});
```

The data must be plain JSON data: objects, arrays, strings, finite numbers, booleans and `null`. Its JSON text may take up to 64 KiB. Any other value, such as a `Date`, a `Map` or a typed array, fails the start with [E1213](../errors/E1213.md), which names where the value sits. A property whose value is `undefined` is left out, as JSON leaves it out. Load larger data in the sketch as a file, with [`ctx.assets`](assets.md).

The sketch gets its own copy of the data on every thread, also when it runs on the page's thread. A change to the copy reaches neither the page nor a recording. A [recording](../guides/testing.md#record-a-session-that-went-wrong) keeps the data, and its replay gives the sketch the recorded data, not the data of the page that plays it.

## A sketch on the page's thread

On a page without cross-origin isolation, the engine runs the sketch on the page's thread (see [Hosting and cross-origin isolation](../getting-started/hosting.md)). So does the `sketchThread: 'main'` option of `createEngine` ([Where the sketch runs](../concepts/architecture.md#where-the-sketch-runs)). A message then reaches the other side during the call that sends it, unless it waits for the page's first handler. The data is not copied, and the `transfer` list moves nothing.

Write message code that works on both threads:

- Do not change an object after you send it.
- Do not use an object again after you send it in a `transfer` list.
- Do not rely on a handler running before or after the call that sends the message returns.

## Hold mode

In hold mode, `createEngine` resolves only after the engine has drawn the held frame. So the page cannot send the sketch a message before that frame. [Start data](#start-data) reaches the setup in hold mode as in a live start, so a held frame shows the state that it names. The sketch's messages from its setup and its held frames reach the page as usual. After the held frame, the sketch's handlers still receive messages, but the sketch runs no more frames. See [Testing your sketch](../guides/testing.md).

A page that reads its start data from its own address draws that state from the command line too. The command opens the page with its query, and the engine adds its switches beside it:

```sh
bunx @null3d/cli shot --page "/?stop=city"
```

## Related pages

- [Page API: createEngine](engine.md): the `onSketchMessage` option and the full signatures of `postToSketch` and `onSketchMessage`.
- [Sketch API: defineSketch and the context](sketch.md): the `page` object in the sketch's context.
- [Architecture: threads and the frame](../concepts/architecture.md): which thread runs what.
- [3D scenes on content pages](../guides/content-pages.md): messages that drive a camera from the scroll position.
- [Messages between page and sketch](https://github.com/null3d-engine/null3d/tree/main/examples/gizmos): the page's buttons send a message, and the sketch acts on it.
- [What a message can carry](https://github.com/null3d-engine/null3d/tree/main/examples/replay): the replay page sends a typed array to the sketch each frame.
