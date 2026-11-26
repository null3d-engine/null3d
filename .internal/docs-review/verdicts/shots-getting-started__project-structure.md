# Shot and demo-link verdicts: getting-started/project-structure

## Shots

### template-empty: keep
No reference image exists for the templates, so a scripted shot is right. The steps work: `create` takes a name and `--template`, and `shot` takes `--time` and `--out` (a .png) and starts the project's own Vite server. The empty sketch has a cube that turns, a directional light and an ambient light, as the alt text says. Note: the first `shot` run downloads Chrome for Testing.

### template-product: keep
Same steps, same reasoning. The product sketch has the turntable, the shadow-casting light, the Neutral tone curve and the materials that the row names. With no input, the orbit controls leave the camera where the sketch puts it, so the frame is stable.

### template-game: keep, with corrected steps and alt text
The steps cannot show the score. `shot` saves the engine's held frame, which is the canvas pixels only. The score is an HTML element over the canvas (`#score` in index.html, set by page.ts), so it never appears in the image. `--page /` is already the default, so it changes nothing. A still also cannot show a follow camera.
Corrected: run the same steps as template-empty with `--template game` and no `--page`. Alt text: "The game template: a player on a field among gems and rocks, seen from behind and above." Drop "score" from the alt text and from what the shot shows. If the score must show, a full browser-window screenshot is needed, and `shot` cannot take one.

### hook-flag: reject
"Manual" is only for the browser's own developer tools. An agent session in Claude Code is not that. A picture of terminal text is also a weak choice: the hook's message is plain text, and a code block shows it better (copyable, searchable, and it stays true to the version).
Alternative: under "## The agent files", add a short text example of the flag. Make it by running the hook the way the agent does, in a new project after `bun install`: pipe `{"tool_name":"Edit","tool_input":{"file_path":"src/sketch.ts","old_string":"\t\t\tangle += dt * 0.8;","new_string":"\t\t\tangle += dt * 0.8;\n\t\t\tconst v = new Float32Array(3);"}}` into `node .agent/agent-hook.mjs edit`, and quote the `additionalContext` text it prints. The hook's own test does the same call (packages/cli/src/agent-hook.test.ts, "flags an allocation in onUpdate"). This could sit in a `<details>` block.

## Demo links

### showroom/ for "product viewer template": reject, use gltf-model/ instead
The code exists in demos.ts, but the demo is a cinematic car configurator: a tablet changes the paint, then the car drives out into a wet street. It does not match the template's turntable, orbit and shadow-catcher setup. The glTF models demo (no code value, so `gltf-model/`) is a close match: a product on a turntable in a studio, a soft key light with its shadow, the neutral tone curve "as product viewers do", and orbit controls from the shared demo helper. It is also the natural next step from the template: load your own model. Link: https://github.com/null3d-engine/null3d/tree/main/examples/gltf-model

### input/ for "game template input": keep
The demo has no code value, so `input/` is the right form, and the folder exists. Its sketch maps keys and a gamepad to named actions and has a follow camera, which matches the game template's player controls. It has no touch drag, which the template has; the link text should say "keys and a gamepad".

## Concepts said to have no demo
- The agent hook: confirmed. It is project tooling; no demo runs it.
- AGENTS.md: confirmed. No demo shows it.
- Package pins: confirmed. No demo shows them.
