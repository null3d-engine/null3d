# Shot and demo-link verdicts: cli/null3d

## Shots

### hold-mode: keep, with a fixed alt text and a better source
- The reference file exists: tests/image/references/chrome-real-gpu/webgpu/demo-hold-mode.png (held at 3 s).
- The alt text is wrong. At 3 s many balls are still in the air, so "at rest" is false. Use: "Glossy balls bouncing in a stone pen, the frame that a hold at 3 seconds draws."
- The reference is only 320 x 180 pixels, because the image tests draw at that size. The section says what `shot` writes, so a real `shot` image is better and larger. From the repository root: `bunx @null3d/cli shot --page "/examples/?demo=hold-mode" --time 3 --out hold-mode.png`. The examples page passes its switches on, so the hold reaches the sketch.

### test-diff: keep, with corrected steps
- The diff image is real: the compare code marks changed pixels in red over a faded copy, and saves `<name>-diff.png`.
- The steps fail as written. No template has a `null3d.json`, so `test` in a new template project runs no image test, and there is no `start` image.
- Corrected steps: `bunx @null3d/cli create shot-demo` (empty template), `bun install`, add `null3d.json` with `{ "tests": [{ "name": "start", "sketch": "src/sketch.ts", "hold": 1.5 }] }`. Run `bunx @null3d/cli test --gpu webgpu --update-references`. Change the cube's color in src/sketch.ts (it is `#4a8cff`) to another color. Run `bunx @null3d/cli test --gpu webgpu`. Put side by side: test-results/null3d/chrome-real-gpu/webgpu/start.png, tests/references/chrome-real-gpu/webgpu/start.png and test-results/null3d/chrome-real-gpu/webgpu/start-diff.png.

### record-button: drop from this page
- The button is real (engine page code, "Save recording", fixed at the bottom left). But it is a plain small button. A picture of it teaches little, and this section is about `shot --replay`, not about the page. The testing guide owns the record workflow.
- The steps are vague ("any dev page"). If the shot moves to the testing guide, use: `bun run dev` at the repository root, open `/examples/?demo=hold-mode&record`, and capture after the first frame.

### inspector-panel: drop from this page
- The `mcp` command runs a headless browser, or drives your own tab. It shows no panel. The section names `?inspect` only to say the bridge needs no switch. A picture of the panel here suggests that `mcp` shows it, which is wrong.
- The panel belongs on the debugging guide, in "The in-page inspector". There the steps work: `bun run dev`, open `/examples/?demo=picking&inspect`, click a piece in the panel's tree, capture.

### impostor-atlas: keep, with corrected steps
- The picture shows exactly what the command writes, so it helps.
- The steps name `<pine.glb>`, and no pine model exists in the repository. The Impostors demo's pine is made in code.
- Corrected steps: `bunx @null3d/cli assets impostor tests/pages/assets/models/asset-card-tree.glb --out <folder> --views 25 --texels 64`, and show `<folder>/asset-card-tree-impostor-color.png`. That model has a crown and a trunk with plain colors and no KTX2 textures, so the bake can read it. Change the alt text to "A five by five grid of one tree seen from 25 directions: the impostor color atlas."

### impostors-view: drop
- The reference exists (webgpu/demo-impostors.png), but at 320 x 180 it is a dark forest against the sun. You cannot tell the near meshes from the far cards, so it does not show what the proposal says.
- A demo view is not about the command. The impostors API page is the place for a view of the cards.

## Demo links

- hold-mode/: keep. No code value, so the folder is the demo's name. Its sketch explains `?hold=3` and the held frame, which is what `shot` and `test` draw.
- impostors/: keep. The demo bakes its atlas with the add-on's `bakeImpostorAtlas`, the same bake as the command. The link text must say the demo bakes in the sketch, not with the command.
- environment/: keep, with care. The demo loads the same venice_sunset_2k.hdr and a studio EXR at run time with `assets.loadEnvironment`. It does not use the KTX2 file that `assets env` writes. The link text must say "shows the light of an HDR and an EXR environment", not "uses assets env".
- aurora/: drop. The link goes to examples/aurora, a sketch that imports the add-on. The add-on itself is examples/addons/aurora, which has no package manifest, so the first gate of `check-addon` fails on it. No demo is an add-on package that the command can check.
- picking/: drop. The demo is about pointer picking and labels. It shows nothing about `mcp`. Any development page works with `mcp`.

## Concepts without a demo

All confirmed: timed scripts, `?record` recordings, bench, upgrade, assets convert, assets pack-orm, assets normal-from-bump, Chrome for Testing.
- `?record`: the Replay demo (replay/) records and replays its own input in page code. It does not use the engine's `?record` file or `shot --replay`.
- normal-from-bump: the Relief demo (relief/) uses bump maps at run time, not a normal map made by the command.
- pack-orm: the glTF model demo's BoomBox has occlusion, roughness and metalness maps from its file, not from the command.
- Add "check-addon" to this list, since the aurora link is dropped.
- Add "mcp" to this list, since the picking link is dropped.
