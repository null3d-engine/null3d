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

1. The fallback page: the content with a poster image in the canvas's place, and a `<noscript>` rule that hides the canvas. It is also what search engines and link previews see. Show the poster as an `<img>`, never by drawing into the canvas. The engine moves the canvas to a worker, and a browser cannot move a canvas that has a context.
2. The failure path: `try` around `createEngine`, and `engine.onFailure`. Both switch the page to the fallback.
3. The load deadline and the three states: waiting, late, ready. Reveal the canvas when `engine.firstFrame` resolves.
4. The scene itself: the first view in the setup, the rest in later stages (`references/performance.md`, section 11).
5. Pausing: off screen, under reduced motion, and a pause button for motion that lasts longer than five seconds.
6. Second visits: HTTP caching, `assets.cache` for generated data (`references/performance.md`, section 12), `detach` and `attach` in single-page apps.
7. The crash marker.

## 3. Rules

### Loading

- Never hide the page's text while the scene loads, and lock no scrolling. Hide content only inside `@media (scripting: enabled)`.
- Count the deadline from the start of navigation (`performance.now()`), and measure a cold load on a slow connection before you pick it. Largest Contentful Paint should come within 2.5 seconds. Start the timer in the page's first script, not in a component that waits for hydration.
- Go straight to late when `navigator.connection.saveData` is true, or when its `effectiveType` is `'slow-2g'`, `'2g'` or `'3g'`. Only Chromium browsers report them, so the timer still guarantees the deadline.
- Skip the waiting state where it cannot help. That is when the page opens scrolled down (back, forward, a reload partway down), or a detached engine attaches again. It is also when the crash marker refuses the scene.
- No loading indicator in the first half second. Progress never moves back, and never comes from elapsed time: a bar driven by a clock stalls near its end. For a wait of seconds, a sketch of the scene that fills in one part per loading step says more than a spinner.
- Under reduced motion, the loading states change at once, with no fades, staggers or moving dots. The deadline stays the same.
- Reveal the canvas after `engine.firstFrame`, never on a message the sketch sends from setup.
- Report success and failure once per page load, with `error.code` or `engine.capabilities.tier`. In a single-page app, keep the flag that says so at module level, so a return to the view does not report again.
- Never call the loading wait "hold": in null3D, hold mode is the fixed-frame mode of image tests.

### Scroll and layout

- Scroll-driven cameras: the page sends the scroll progress at most once per animation frame, and only when it changes. The sketch eases with `k = 1 - Math.pow(0.001, dt)` and jumps to the first value it receives. Reveal after the sketch confirms the first value.
- Read layout, such as heights, offsets and computed styles, in a `ResizeObserver` callback, and keep the numbers. Each scroll then reads only `scrollY`. The observer also sees font loads, translations that reflow text, and breakpoints.
- Keep each section's scroll position in one place: a CSS custom property on the section. CSS places the section by it, and code reads it back on resize. A copy of the number in code goes stale at the first edit. Check the positions in your longest language.
- Shape the camera's path as a curve plus named corrections, each a smoothstep over a range of scroll progress. Moving the curve's points to fix one moment moves every other moment too.
- On a route change in a single-page app, restore the saved position on back and forward. Jump to an anchor when the address has one, and go to the top otherwise. Scroll with `behavior: 'instant'`, and put `scroll-behavior: smooth` only inside `@media (prefers-reduced-motion: no-preference)`. A smooth reset that runs while the new page swaps in stops partway down.
- The field of view is vertical, so a canvas taller than wide shows less from side to side. Widen it with `camera.setFov` when `ctx.engine.viewport` turns portrait.
- Give text panels over an interactive scene `pointer-events: auto`. A panel with `pointer-events: none` passes taps to the scene, so a tap on its text selects an object.
- Labels that `engine.labels.bind` places need the same content as an HTML list, with its own heading, in the fallback page.

### Motion and power

- Pause with `engine.setPaused` while an `IntersectionObserver` sees no part of the canvas. Combine every pause reason, and pause while any holds.
- Under `preferences.reducedMotion`, a decorative scene shows a still view. It can post a message so the page pauses the engine. Shader motion that reads `frame.time` keeps going until then (`references/shaders.md`, section 2).
- A decorative scene passes `powerPreference: 'low-power'` to `createEngine`. The engine asks for the high-performance GPU by default, which wakes the faster GPU of a laptop that has two, and drains its battery. Keep the default where the scene is the page's subject.

### Lifetime and failures

- Cache generated data as `references/performance.md` section 12 says.
- Listen for `pagehide`, never `unload`, and never send `Cache-Control: no-store` on the page. Browsers decide whether they can keep a page with a running engine in the back/forward cache, so a reload must work too.
- In a single-page app, call `engine.detach()` when the visitor leaves the view, and `engine.attach(container)` on return. A kept engine holds its memory and GPU buffers. So `destroy` it after about 3 minutes on phones and tablets, and after about 30 on desktops. The engine told the two apart by `engine.report.coarsePointer` when it chose the preset, so use the same fact. Each mount adds its handlers, and removes them with the function that each `on...` call returns.
- Crash marker: write a time stamp to `localStorage` before `createEngine`, clear it a few seconds after the first frame and on `pagehide`. A marker younger than a week on the next load means the last start never finished: show the fallback. Wrap every storage access in `try`. The engine keeps a note of its own: after a start that crashed the tab, it starts one quality preset lower, and `engine.mode.crashedStarts` counts such starts.
- Check the marker, and the connection, before `createEngine`, so a refused device never downloads the engine's WebAssembly. A static import of the engine still downloads its start code. Import it dynamically after the check to save that too, and confirm in the network panel.

## 4. Checks before you finish

- The page reads fully with JavaScript off, and with the engine failing to start. Point `sketch` at a missing file to force the failure.
- With a fresh time stamp written to the marker by hand, the page shows the fallback and downloads none of the engine's WebAssembly.
- A cold load on Chrome's Slow 4G profile shows the text at once and moves to late at the deadline.
- The scene stops when scrolled out of view, and under reduced motion.
- The canvas's markup matches its purpose (section 1). The loading indicator has `role="progressbar"`, an `aria-label` and a live `aria-valuenow`, and nothing hidden takes keyboard focus.
- The framing works on a phone held both ways, and in a tall, narrow window.
- A second visit loads from the HTTP cache: the build files under `assets/` come back from the browser's cache. It is faster than the first, and after a deploy the cache holds no entries of the old build.
