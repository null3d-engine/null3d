# Verdict on api-2-readability-11

## The finding as given

- page: api/post
- anchor: intro line 13 and ## Related pages lines 489-490
- category: scan-order, severity: medium
- claim: The intro names twelve effects in one sentence. Nothing shows at a glance which effect is on by default, which quality setting gates it, or which needs HDR color. The only demo links are in Related pages, after 480 lines.
- evidence: line 13 'They are the tone mapping, the exposure, automatic exposure, bloom, ...'; lines 489-490 hold the post-effects and camera-lens demo links.
- proposedEdit: After line 13, add a table: effect | post.set key | default | gating quality setting | needs HDR. Put https://github.com/null3d-engine/null3d/tree/main/examples/post-effects under the intro. Put https://github.com/null3d-engine/null3d/tree/main/examples/camera-lens under '## Depth of field', after its example.

Verdict: partly

## Evidence

- Line 13 does list twelve effects in one sentence. This part is true.
- "Which effect is on by default" is weak. Each section's settings table already gives the default in its first row, and every effect is "Off" (lines 95, 130, 162, 204, 247, 288, 322, 353, 384, 408). Only the tone mapping (`'agx-punchy'`, line 28) and the exposure (1, line 29) are active by default. A "default" column would say "Off" in ten of twelve rows, so it adds little.
- The quality and HDR claims hold for this page. The facts are only in bullets deep inside each section: automatic exposure (lines 110-111), bloom (140, 143), ambient occlusion (172-173), screen-space reflections (215-216), depth of field (260-261), grading and vignette (370, 394), custom effects (460). No single place on the page shows them together.
- Other pages cover part of it. The chain page has "Effects on devices without HDR color" (docs/concepts/post-processing.md:402-409), and the page links it once, at line 143 under Bloom. The quality preset tables (docs/concepts/quality-preset-tables.md:65-69) show `aoScale`, `dofSamples` and `ssrScale` per preset. These lower the cost of the issue but do not give an overview on this page, so the finding is not refuted.
- The "needs HDR" column as proposed is not exact. Ambient occlusion and screen-space reflections do not say "needs HDR color". They say they stay off on a WebGL2 device without float render targets (lines 173, 216). They also do not move the engine to HDR color in compatibility mode, as bloom, depth of field and automatic exposure do. Outlines, grading, the vignette and the final pass draw on every path (line 370, line 394, post-processing.md:354). The page does not say which path sharpening needs.
- Only some quality settings gate an effect: `aoScale`, `ssrScale` and `dofSamples` turn their effect off at 0. `exposureMeter` picks the meter and `bloomSize` sets the glow's detail. Neither one turns its effect off.
- Demo links: both are at lines 489-490, below line 479. In examples/demos.ts, post-effects has `code: 'post-effects/'` (line 657). camera-lens has no code value (lines 550-560), so its link uses the folder name. Both URLs in the edit follow the website contract. No writing rule in AGENTS.md is against moving them up. This part holds.

## Corrected claim

The intro lists twelve effects in one sentence. The page never shows in one place which effects a quality preset turns off, or which ones need HDR color or float render targets. Each fact is in a bullet inside its own section. The defaults are already easy to find, because every effect's table starts with "Off". The two demo links are only in Related pages, at the end.

## Corrected edit

After line 13, add a short table with no "default" column. Put one sentence above it: "Every effect is off until `post.set` turns it on. The tone mapping (AgX punchy) and an exposure of 1 always apply." Use the columns effect | `post.set` key | quality setting that can turn it off | on devices without HDR color:

| Effect | Key | Quality setting that turns it off | Without HDR color |
| --- | --- | --- | --- |
| Automatic exposure | `autoExposure` | None (`exposureMeter` picks the meter) | Stays off |
| Bloom | `bloom` | None (`bloomSize` sets the detail) | Stays off |
| Ambient occlusion | `ao` | `aoScale` 0: Low, Medium | Stays off with no float targets |
| Screen-space reflections | `ssr` | `ssrScale` 0: Low | Stays off with no float targets |
| Depth of field | `dof` | `dofSamples` 0: Low | Stays off |
| Outlines | `outline` | None | Draws |
| Color grading | `lut`, `grading` | None | Draws |
| Vignette | `vignette` | None | Draws |
| Sharpening | `sharpen` | None (adds nothing below a render scale of 1) | Check the source before you fill in this cell |
| Custom effects and tone curves | `post.addEffect`, `toneMapping` | None | Stay off |

Link the last column's heading to ../concepts/post-processing.md#effects-on-devices-without-hdr-color. Link the quality column's heading to ../concepts/quality-presets.md. Put the post-effects demo link under the intro, and the camera-lens link after the depth of field example, as the finding proposes. Keep both links in Related pages too.
