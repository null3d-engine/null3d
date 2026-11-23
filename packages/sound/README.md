# Sound for null3D

`@null3d/sound` plays sound that follows a null3D scene. The sketch makes the sounds and moves
them as it moves its objects: a waterfall at a place, wind in both ears, the engines of a street of
cars, or thunder. The page plays them with the browser's audio. A mixer on the browser's audio
thread drives every voice from a table that the sketch writes, so no frame sends a message.

## Use

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';
import { createSound } from '@null3d/sound';

export default defineSketch((ctx) => {
  const camera = ctx.scene.createPerspectiveCamera({ position: [0, 1.6, 6], target: [0, 1, 0] });
  ctx.scene.setActiveCamera(camera);
  const sound = createSound(ctx, { listener: camera });
  const fall = sound.loop({ file: '/sounds/waterfall.mp3', near: 4, far: 120 });
  fall.setPosition(-20, 2, -30);
  return {
    onLateUpdate() {
      sound.update();
    },
  };
});
```

```ts
// page.ts
import { connectSound } from '@null3d/sound/page';

const sound = connectSound(engine, { startOnInput: true });
```

A browser starts a page's audio only in answer to the user, so the sound starts on the first press,
click, tap or key, or when the page calls `sound.start()` from its own button.

The docs page `api/sound` in the engine's docs lists every call, and the guide `guides/audio` shows
beds, sources at places, groups of many sources and events.

## License

MIT or Apache-2.0, at your choice.
