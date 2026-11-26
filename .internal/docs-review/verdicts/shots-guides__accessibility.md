# Shot and demo-link verdicts: guides/accessibility

## Shots

### canvas-accessibility-tree: reject

- The demo page makes the canvas with no role and no label. `runDemo` in examples/index.ts creates a bare canvas element. No code in examples/ sets `role` or `aria-label` on it. So Chrome's accessibility pane on the glTF models demo shows an unlabeled canvas. That is the opposite of the alt text.
- The listed source file examples/gltf-model/sketch.ts has no markup in it. The canvas comes from examples/index.ts.
- The picture adds little even if it were correct. The section is a table of three markup choices, and text shows markup better than a screenshot of a developer tools pane.
- No corrected source. The shot only becomes possible if the demo page first labels its canvas, which is a code change outside these docs.

## Demo links

### keyboard actions for pointer actions -> input/: keep, with narrower link text

- The code is right: the input demo has no `code` field, so its folder is `input/`.
- The sketch defines an action map. W, A, S, D, the arrow keys and the gamepad's left stick all press the same walk moves. That shows how one action takes several inputs.
- It does not show a keyboard way for a pointer action. The camera turns by drag, or by the gamepad's right stick, but no key turns it. No demo calls the orbit controls' key listening.
- Word the link as "an action map that gives one move several keys", not as an example of keyboard parity.

## Concepts said to have no demo

- aria-live status updates: partly shown by the deterministic simulation demo (`replay/`). Its page part has a status line with `aria-live="polite"` that says "3 of 8 orbs" as the user plays. It differs from the page's example: the page computes the text itself, not from sketch messages, and during a replay the line changes many times a second. Do not link it as a model.
- reduced motion through preferences: confirmed. No demo sketch reads the reduced-motion preference. Only the orbit controls' auto-rotate checks it, and no demo turns auto-rotate on.
- pause button with setPaused: confirmed. No demo calls it. The plant wind demo's Hold button stills the wind only; the frames keep running.
- progress bar markup: confirmed. The demos' shared loading overlay uses `role="status"` with a hidden live line, and hides its bar from screen readers. It has no `role="progressbar"`.
- text contrast over the scene: confirmed. No demo is about readable text over a moving scene.
