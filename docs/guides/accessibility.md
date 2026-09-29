---
id: guides/accessibility
title: Accessibility
status: planned
since: "0.1"
summary: "What the canvas tells assistive technology; keyboard use; reduced motion; pausing; loading and errors."
---

# Accessibility

> Planned for null3D 0.1. No release has these APIs yet, so coding agents must not use them.

A screen reader sees a canvas as one element. It cannot see the objects drawn inside it. So the HTML around the canvas carries the meaning, and the sketch sends that HTML what it needs through messages.

## Tell assistive technology what the canvas is

| The canvas shows | Mark it up |
| --- | --- |
| Decoration behind the page's content | `aria-hidden="true"` on the canvas, so screen readers skip it |
| One picture, such as a product view | `role="img"` and an `aria-label` that says what it shows. Update the label when the view changes a lot. |
| Something the user operates, such as a configurator or a game | An `aria-label` on the canvas, and the same controls in HTML next to it: buttons, sliders and lists |

Keep text in HTML, not drawn into the scene. Screen readers, translation tools and search engines read HTML. This covers headings, prices, labels on objects and the state of a configurator.

For state that changes while the user works, add an element with `aria-live="polite"`. The page updates its text from the sketch's messages, and a screen reader reads each change:

```ts
// sketch.ts
page.post('selected', { name: 'Oak finish' });
```

```ts
// page.ts
const status = document.querySelector('#status')!; // <p id="status" aria-live="polite"></p>
engine.onSketchMessage((type, data) => {
  if (type === 'selected') status.textContent = `${(data as { name: string }).name} selected`;
});
```

## Keyboard

The engine reads key presses from the whole window. It leaves them to the page while a text field, text area, drop-down list or editable element has focus.

- Give every pointer action a keyboard way to do it, such as arrow keys to turn a model, and tell users which keys work.
- Never trap focus. The Tab key must always move on to the rest of the page.
- A canvas the user operates can take focus with `tabindex="0"`. Give it a visible focus outline.

## Motion

Some users get dizzy or sick from motion on screen, so their system asks every page for less of it. In the sketch, `preferences.reducedMotion` is true while it does. `preferences.onChange` calls a handler at the start of the first frame after the setting changes:

```ts
export default defineSketch(({ scene, geometry, materials, preferences }) => {
  const model = scene.createMesh({ mesh: geometry.box(), material: materials.standard(), dynamic: true });
  let spin = preferences.reducedMotion ? 0 : 0.5;
  preferences.onChange(() => {
    spin = preferences.reducedMotion ? 0 : 0.5;
  });
  return {
    onUpdate(dt) {
      model.rotateY(dt * spin);
    },
  };
});
```

When the user asks for less motion:

- Bring motion that only decorates to rest. Idle spins, camera sway, drifting particles and parallax stop.
- Keep motion that the user drives, such as turning a model by dragging, and motion that carries meaning.
- Replace long camera flights with a cut or a short fade.

Whatever the setting, never flash more than three times in one second. Fast flashes can cause seizures.

The page's own CSS animations follow the same setting through `@media (prefers-reduced-motion: reduce)`.

## Pausing

Motion that starts by itself and lasts more than five seconds needs a way to stop it when other content shares the page. The call `engine.setPaused(true)` stops the sketch's frames, and `setPaused(false)` resumes them. Put a pause button next to a scene that moves on its own.

## Loading and errors

- Give the loading indicator `role="progressbar"` and set `aria-valuenow` from the load progress. Never let the value move back.
- Remove the indicator when `engine.firstFrame` resolves, so the user never waits in front of a blank canvas.
- `createEngine` rejects when the browser cannot run the engine. Show text that says so, and what the user can still do, or an image with a text alternative.

## Text over the scene

HTML text over a moving scene must stay readable. Keep a contrast ratio of at least 4.5 to 1 against every color the scene can show behind it. A solid or blurred backing behind the text keeps that ratio as the scene moves.

## Related pages

- [Architecture: threads and the frame](../concepts/architecture.md): what runs on the page and what runs in the sketch worker.
- [Performance guide](performance.md): pausing and measuring.
