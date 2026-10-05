---
id: guides/content-pages
title: 3D scenes on content pages
status: experimental
since: "0.1"
summary: "Product and marketing pages: the fallback page, a load deadline, pausing off screen, scroll-driven cameras, second visits and crashes."
---

# 3D scenes on content pages

> Ships in null3D 0.1. The API is experimental, so it can still change between versions.

On a product page or a marketing page, the visitor came for the page. The 3D scene supports it. So the page must work without the scene, show its content on time, and spend nothing on a scene that nobody can see.

A game or a full-screen app is different, because there the scene is the product. Each section says where its advice changes for such pages.

## Build the fallback page first

Every failure leads to the same page: the content, with a poster image in place of the canvas. Four things lead there:

- JavaScript is off.
- `createEngine` rejects, for example because the browser is Safari before 18 (E1306), lacks WebAssembly SIMD (E1303) or has no usable GPU path (E1301).
- `engine.onFailure` reports a failure after the start, such as a GPU the engine could not get back (E1302).
- The page crashed on its last visit (see [After a crash](#after-a-crash)).

Build this page before the scene. Search engines and link previews see it too.

```html
<figure class="hero">
  <img class="poster" src="/poster.webp" alt="The chair in oak, seen from the front" />
  <canvas class="scene" aria-hidden="true"></canvas>
</figure>
<noscript><style>.scene { display: none; }</style></noscript>
```

```ts
// page.ts
const report = (data: object) => navigator.sendBeacon('/analytics', JSON.stringify(data));
const fallBack = (reason: string) => {
  document.documentElement.classList.add('no-scene'); // CSS hides the canvas and keeps the poster
  report({ scene: false, reason });
};
try {
  const engine = await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });
  engine.onFailure((error) => fallBack(error.code));
  report({ scene: true, tier: engine.capabilities.tier });
} catch (error) {
  fallBack((error as { code?: string }).code ?? 'start');
}
```

Report success as well as failure, once per page load. A count of failures alone cannot tell 2% from 40%.

## Set a load deadline

Decide how long a visitor waits for the scene, and count it from the moment the page began to load. `performance.now()` counts from there. The page moves through three states:

| State | What the visitor sees |
| --- | --- |
| Waiting | The page, with the poster in the scene's place |
| Late | The deadline passed: the page as it is, with the poster, while the scene keeps loading behind it |
| Ready | `engine.firstFrame` resolved: the canvas replaces the poster in one transition |

- Keep the waiting state short. Largest Contentful Paint, the time until the largest content appears, should come within 2.5 seconds. Measure your own cold load on a slow connection before you pick a deadline.
- Never hide the page's text while the scene loads. Where a rule must hide content, put it inside `@media (scripting: enabled)`, so a page without JavaScript still shows everything.
- Show no loading indicator for the first half second or so. A fast load then never flashes one.
- Never let a progress value move back. Keep the largest value shown so far.
- Reveal the canvas only when `engine.firstFrame` resolves. Before that, it shows nothing.
- Chromium browsers report `navigator.connection.saveData`. When it is true, go straight to the late state.

```ts
// page.ts
const DEADLINE_MS = 2000;
const root = document.documentElement;
setTimeout(() => {
  if (!root.classList.contains('ready')) root.classList.add('late');
}, Math.max(0, DEADLINE_MS - performance.now()));
await engine.firstFrame;
root.classList.add('ready'); // CSS fades the canvas in over the poster
```

For a game, the late state has no page content to show. There it changes the message, and opens the menus and settings that do not need the scene.

## Mark a decorative canvas

A scene that only decorates gets `aria-hidden="true"`, so screen readers skip it. It takes no keyboard focus. Give it `pointer-events: none` when it does not react to the pointer, so clicks reach the page. [Accessibility](accessibility.md) covers a canvas the visitor operates.

## Bring the scene to rest for reduced motion

When the visitor's system asks for less motion, a decorative scene stops moving. It shows a still, composed view. Once at rest, it can pause the engine and save battery:

```ts
// sketch.ts
let spin = preferences.reducedMotion ? 0 : 0.4;
page.post('motion', spin > 0);
preferences.onChange(() => {
  spin = preferences.reducedMotion ? 0 : 0.4;
  page.post('motion', spin > 0);
});
```

```ts
// page.ts
engine.onSketchMessage((type, moving) => {
  if (type === 'motion') engine.setPaused(!moving);
});
```

## Pause when the scene is off screen

A scene below the fold, or scrolled past, still costs power while it runs. Pause it while no part of it is on screen:

```ts
// page.ts
const onScreen = new IntersectionObserver(([entry]) => engine.setPaused(!entry?.isIntersecting));
onScreen.observe(canvas);
```

When the page also has a pause button, or pauses for reduced motion, combine the reasons, and pause while any of them holds. The first frame after a pause counts no time, so the scene resumes where it stopped.

## Drive the camera from the scroll position

The page reads the scroll position, and the sketch moves the camera. Send the position only when it changes, at most once per animation frame:

```ts
// page.ts
let queued = false;
const sendScroll = () => {
  queued = false;
  const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const progress = window.scrollY / range;
  engine.postToSketch('scroll', Math.min(1, Math.max(0, progress)));
};
window.addEventListener('scroll', () => {
  if (!queued) requestAnimationFrame(sendScroll);
  queued = true;
}, { passive: true });
sendScroll(); // the position the browser restored
```

The sketch eases toward the position. Its easing factor depends on the frame's time step, so the motion looks the same at 60 and at 144 frames per second. It jumps to the first position it receives, so a page that opens scrolled down never shows a camera flight. It then posts `placed`, and the page reveals the canvas only after both `placed` and `engine.firstFrame`:

```ts
// sketch.ts
let target = 0;
let current = 0;
let placed = false;
page.onMessage((type, value) => {
  if (type !== 'scroll') return;
  target = value as number;
  if (!placed) {
    current = target;
    placed = true;
    page.post('placed');
  }
});
return {
  onUpdate(dt) {
    // Closes 99.9% of the gap in one second, at any frame rate.
    const k = preferences.reducedMotion ? 1 : 1 - Math.pow(0.001, dt);
    current += (target - current) * k;
    if (Math.abs(target - current) < 0.0001) current = target;
    placeCamera(current);
  },
};
```

## Second visits and navigation

| Lifetime | What keeps it | How |
| --- | --- | --- |
| Between visits | The HTTP cache | Hosts that let browsers keep the hashed build files: [Hosting](../getting-started/hosting.md) |
| Between visits | Data the sketch generates | An IndexedDB cache in the sketch worker, as below |
| Views of a single-page app | The running engine | `engine.detach()` and `engine.attach(element)`: [Architecture](../concepts/architecture.md) |
| Back and forward | The browser's back/forward cache | Listen for `pagehide`, never `unload`, and do not send `Cache-Control: no-store` on the page |

Browsers decide whether they can keep a page with a running engine in the back/forward cache. Build the page so that a full reload works too.

A sketch that generates data, such as a terrain or a scatter of objects, can store the result in IndexedDB. Workers have IndexedDB. Follow these rules:

- Store numbers and typed arrays only. They come back exactly as they went in. Never store engine objects.
- Key each entry by the build. In a production build, `import.meta.url` names the sketch's file with a hash of its content, so a new deploy never reads old data.
- Run the same code on a hit and a miss after the lookup, so the two cannot differ.
- Write after the page reports its first frame, and never inside `onUpdate`. Storing large arrays takes time on the sketch's thread.
- Treat a failed or slow database as a miss. Give the open a time limit, such as 1.5 seconds.
- Skip the cache in development, where the file name has no hash.

```ts
// sketch.ts: readEntry and writeEntry wrap IndexedDB. readEntry resolves to undefined on a
// miss, on an error, and after its time limit.
const pending: [string, unknown][] = [];
page.onMessage((type) => {
  if (type === 'shown') for (const [id, value] of pending.splice(0)) void writeEntry(id, value);
});

async function cached<T>(key: string, generate: () => T): Promise<T> {
  if (import.meta.env.DEV) return generate();
  const id = `${import.meta.url}:${key}`;
  const found = (await readEntry(id)) as T | undefined;
  const value = found ?? generate();
  if (found === undefined) pending.push([id, value]);
  return value;
}
```

```ts
// page.ts
await engine.firstFrame;
engine.postToSketch('shown');
```

## After a crash

A phone can close a tab that uses too much memory, with no warning and no event. On the next visit, only a marker left behind shows it happened. Write the marker before the start, and clear it once the scene has run for a few seconds:

```ts
// page.ts
const MARKER = 'scene-start';
const WEEK_MS = 7 * 24 * 3600 * 1000;
const read = () => { try { return Number(localStorage.getItem(MARKER)); } catch { return 0; } };
const write = (value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(MARKER);
    else localStorage.setItem(MARKER, value);
  } catch {}
};
if (Date.now() - read() < WEEK_MS) fallBack('crashed'); // the last start never finished
else {
  write(String(Date.now()));
  addEventListener('pagehide', () => write(null));
  // ... createEngine, then:
  await engine.firstFrame;
  setTimeout(() => write(null), 5000);
}
```

Wrap every storage access, because private browsing can make it throw. A second tab of the same page can leave a marker behind too, so let a marker expire. For a game, show a message after a crash and offer a normal start, instead of the fallback page.

The engine keeps a note of its own for each sketch. After a start that crashed the tab, the next start runs one quality preset lower, and `engine.mode.crashedStarts` gives the count ([Quality presets](../concepts/quality-presets.md#starts-that-crashed-the-tab)).

## Related pages

- [Accessibility](accessibility.md): the canvas, the keyboard and motion.
- [Hosting and cross-origin isolation](../getting-started/hosting.md): headers and caching.
- [Performance guide](performance.md): measuring the scene.
