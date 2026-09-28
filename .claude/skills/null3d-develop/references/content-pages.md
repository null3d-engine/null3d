# 3D scenes on content pages

Product pages, marketing pages and landing pages that show a 3D scene next to text. The visitor came for the page. So the page must work without the scene, show its content on time, and stop the scene when nobody can see it. The engine docs page `guides/content-pages` has the full guide with code; this file gives the rules and the order to build in.

## Contents

1. Decide what the scene is for
2. Build order
3. Rules
4. Checks before you finish

## 1. Decide what the scene is for

| The scene | Consequences |
| --- | --- |
| Decorates the page | `aria-hidden="true"`, no focus, `pointer-events: none`; comes to rest under reduced motion; a short load deadline |
| Shows the subject, such as a product | `role="img"` and an `aria-label` that says what it shows; a poster image with the same view as the fallback |
| Is operated by the visitor, such as a configurator | HTML controls next to the canvas as well; state changes in an `aria-live` region; keyboard control (`guides/accessibility`) |
| Is the product, as in a game | Most rules below change: there is no page content to fall back to, so failures and crashes show a message and a retry |

## 2. Build order

1. The fallback page: the content with a poster image in the canvas's place, and a `<noscript>` rule that hides the canvas. It is also what search engines and link previews see.
2. The failure path: `try` around `createEngine`, and `engine.onFailure`. Both switch the page to the fallback.
3. The load deadline and the three states: waiting, late, ready. Reveal the canvas when `engine.firstFrame` resolves.
4. The scene itself.
5. Pausing: off screen, under reduced motion, and a pause button for motion that lasts longer than five seconds.
6. Second visits: HTTP caching, a cache for generated data, `detach` and `attach` in single-page apps.
7. The crash marker.

## 3. Rules

- Never hide the page's text while the scene loads. Hide content only inside `@media (scripting: enabled)`.
- Count the deadline from the start of navigation (`performance.now()`), and measure a cold load on a slow connection before you pick it. Largest Contentful Paint should come within 2.5 seconds.
- No loading indicator in the first half second. Progress never moves back.
- Reveal the canvas after `engine.firstFrame`, never on a message the sketch sends from setup.
- Report success and failure once per page load, with `error.code` or `engine.capabilities.tier`.
- Pause with `engine.setPaused` while an `IntersectionObserver` sees no part of the canvas. Combine every pause reason, and pause while any holds.
- Under `preferences.reducedMotion`, a decorative scene shows a still view. It can post a message so the page pauses the engine.
- Scroll-driven cameras: the page sends the scroll progress at most once per animation frame, and only when it changes. The sketch eases with `k = 1 - Math.pow(0.001, dt)` and jumps to the first value it receives. Reveal after the sketch confirms the first value.
- Cache generated data in IndexedDB from the sketch. Store numbers and typed arrays only, keyed by `import.meta.url` in production builds. Run the same code after a hit or a miss. Write after the page reports its first frame, and skip the cache in development.
- Listen for `pagehide`, never `unload`, and never send `Cache-Control: no-store` on the page. Browsers decide whether they can keep a page with a running engine in the back/forward cache, so a reload must work too.
- Crash marker: write a time stamp to `localStorage` before `createEngine`, clear it a few seconds after the first frame and on `pagehide`. A marker younger than a week on the next load means the last start never finished: show the fallback. Wrap every storage access in `try`.
- Never call the loading wait "hold": in null3d, hold mode is the fixed-frame mode of image tests.

## 4. Checks before you finish

- The page reads fully with JavaScript off, and with the engine failing to start. Point `sketch` at a missing file to force the failure.
- A cold load on Chrome's Slow 4G profile shows the text at once and moves to late at the deadline.
- The scene stops when scrolled out of view, and under reduced motion.
- The canvas's markup matches its purpose (section 1).
- A second visit loads from the HTTP cache: the build files under `assets/` come back from the browser's cache.
