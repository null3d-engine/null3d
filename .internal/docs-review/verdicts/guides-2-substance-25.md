# guides-2-substance-25

## The finding as given

- page: guides/lens-kit, guides/screens
- anchor: lens-kit ## Use it line 35 createLensKit(ctx, ...); screens ## Make a screen line 34 createScreen(ctx, ...)
- category: missing-prerequisite
- severity: low
- claim: Both pages pass a ctx that no line defines. Other guides destructure the setup's context. The screens example then shows return { onUpdate() {...} } with no setup around it.
- evidence: examples/addons/screens/index.ts:161 (createScreen(ctx: SketchContext, ...)); examples/addons/lens-kit/index.ts.
- proposedEdit: Show the setup once: export default defineSketch((ctx) => { const lens = createLensKit(ctx, {...}); ... }); or add 'ctx is the context that the setup function receives.'

Verdict: survives

## Evidence

- docs/guides/lens-kit.md:32-48: the code block imports createLensKit and calls createLensKit(ctx, ...). No line defines ctx, and no sentence says what it is.
- docs/guides/screens.md:31-48: the same for createScreen(ctx, ...). Lines 53-61 show `return { onUpdate() {...} };` with no function around it. Line 50 says "draw runs in the setup", but the code never shows the setup.
- Neither page links to the Sketch API page (docs/api/sketch.md). Their "Related pages" lists (lens-kit.md, end of page) and the screens page have no link that explains the context. So the gap is not handled elsewhere.
- Source: examples/addons/lens-kit/index.ts:52 `createLensKit(ctx: SketchContext, look)` and examples/addons/screens/index.ts:161 `createScreen(ctx: SketchContext, options)`. The first argument is the full sketch context, not a part of it.
- Other guides show the setup frame: docs/guides/audio.md:33 `export default defineSketch((ctx) => {`, and physics.md:51, multiple-views.md:23, video-textures.md:55 and others use `defineSketch(({ ... }) => {`.
- Severity low is fair. A reader who has done the getting-started pages can guess what ctx is. The lone `return { onUpdate }` block is the bigger gap.

## Corrected edit (preferred form)

Use the first option. On the screens page it also fixes the lone return block. Join the two blocks into one setup:

```ts
import { defineSketch } from '@null3d/engine';
import { createScreen } from './addons/screens';

export default defineSketch((ctx) => {
  const screen = createScreen(ctx, { /* as now */ });
  screen.mesh.setPosition(0, 1.4, -3);

  return {
    onUpdate() {
      paintTheReading(screen.context);
      screen.mark({ x: 24, y: 150, width: 464, height: 90 });
      screen.flush();
    },
  };
});
```

On the lens-kit page, wrap the "Use it" block the same way: `export default defineSketch((ctx) => { const lens = createLensKit(ctx, {...}); ... });`.

Note: docs/guides/car-paint.md:36 has the same gap (`createCarPaint(ctx, ...)` with no ctx defined). It falls outside this finding's pages, but the same fix applies.
