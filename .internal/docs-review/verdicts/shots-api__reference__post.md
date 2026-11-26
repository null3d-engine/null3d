# Shot and demo-link verdicts: api/reference/post

Generated page. Its source is the doc comments in `packages/engine/src/scene/post.ts`, written out by `tools/gen-docs.ts` and `tools/lib/docs.ts`. An image or link under a heading must go in that export's doc comment.

## Shots

### tone-curves: keep, with a corrected source

- The picture helps. The reference test pictures show the bright tile grid. Under `'none'` the bright tiles clip to flat white. Under AgX they roll off toward white and keep their hue. A reader sees what each curve does at a glance, and words alone do not show that.
- The proposed source is wrong in one way. The page's `ToneMapping` type has five values: `'agx' | 'agx-punchy' | 'neutral' | 'aces' | 'none'` (post.ts line 50). `reinhard` and `cineon` are not engine curves. They are the two custom curves that `@null3d/three-compat` adds (`ADDON_TONE_MAPPINGS` in `tests/pages/lib/bright-scene.ts`). Panels for them under `## ToneMapping` would tell a reader they can pass `toneMapping: 'reinhard'`, and `post.set` throws E1213 for that. Drop those two panels. They belong on a porting page, as examples of a custom `ToneCurve`, if anywhere.
- The files exist on every tier (webgpu, compat, webgl2). At full exposure each is `tone-<curve>.png`, 320 x 180. The `-half-exposure` files are the other exposure, so do not use them.
- Corrected source: compose `tests/image/references/chrome-real-gpu/webgpu/tone-agx-punchy.png`, `tone-agx.png`, `tone-neutral.png`, `tone-aces.png` and `tone-none.png` into one labeled strip of five panels, with the default (`agx-punchy`) first. Save it as `docs/images/api/reference/post/tone-curves.webp`. Link it from the `ToneMapping` doc comment in post.ts as `../../images/api/reference/post/tone-curves.webp`.
- Alt text: "Five panels of one grid of bright tiles, under agx-punchy, agx, neutral, aces and none".
- Note: no doc comment in the engine has an image yet. Check that the generator passes a Markdown image through unchanged. The relative path breaks in editor hover text. If that is a problem, put the image on the concept page (`concepts/post-processing`) instead.

## Demo links

| Concept | Code | Verdict | Reason |
| --- | --- | --- | --- |
| post chain (`PostSettings`) | `post-effects/` | keep | The code is in demos.ts. The sketch turns on bloom, ambient occlusion, an outline, depth of field and screen-space reflections, and sets the vignette, sharpening and grading through the lens add-on, which passes them to `post.set`. |
| `AutoExposureSettings` | `auto-exposure/` | keep | The code is in demos.ts. The sketch sets `autoExposure`, and the E key turns adaptation on and off. |
| `SsrSettings` | `wet-street/` | keep | The code is in demos.ts. The sketch sets `ssr: { maxDistance, thickness }`, and its helper raises `ssrScale` so the reflections draw on every preset. |
| `DofSettings` | `camera-lens/` | keep | The demo has no code value, so `camera-lens/` follows the contract, and the folder exists. The sketch sets `dof` with aperture, maxBlur and blades, and racks `focusPoint`. |
| `toneMapped: false` under `ToneMapping` | `tone-mapped/` | drop here | The folder exists and the demo is real. But `toneMapped` is a material option, and this page never mentions it. A reader of the `ToneMapping` type would follow a link about a different setting. Move the link to the materials reference, at the unlit or standard material options. |

## Concepts said to have no demo

All four have a demo.

| Concept | Demo | Evidence |
| --- | --- | --- |
| `GradingSettings` | `post-effects/` | The WARM and COOL grades set white balance, lift, gamma, gain, saturation and split toning. They change every 3 seconds. |
| `SplitToningSettings` | `post-effects/` | Both grades set `splitToning` with shadows, highlights, balance and strength. |
| `VignetteSettings` | `post-effects/` | It sets `vignette: { intensity: 0.9, size: 1.1 }` through the lens add-on, which passes it to `post.set`. |
| `OutlineSettings` | `picking/` | It sets `outline: { color, hiddenColor, width }` and outlines the clicked piece, so it shows both the visible line and the hidden-part line. `post-effects/` and `gizmos/` also use the outline, but with no hidden color. |
