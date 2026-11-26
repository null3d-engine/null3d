# guides-2-substance-21

## Finding as given

- Page: guides/lens-kit
- Anchor: ## Cost, lines 107-116
- Category: unclear. Severity: medium.
- Claim: "The sharpening at the whole canvas's render scale adds the first step of the two-step pass, as any sharpen value does. Below the whole canvas's render scale, effects do not join passes, so each draws one." needs the post-processing page to make sense. "WebGL2 keeps no figure for the whole look, because its cleared frame moves by more than the look there. Its marks stand instead." is unclear. "The add-on's README holds the figure" has no link.
- Evidence: lens-kit.md:107-116; docs/concepts/post-processing.md:217; examples/addons/lens-kit/README.md.
- Proposed edit: Main text: "The grade and the vignette add no pass. The sharpening adds one step to the final pass. At 33 megapixels on an M3 Max the whole look costs about 3 to 4 ms of GPU time, about a tenth of a millisecond per megapixel." Move the pass-joining and WebGL2 notes into `<details><summary>Technical details: how the kit's passes join</summary>`. Link the README at https://github.com/null3d-engine/null3d/tree/main/examples/addons/lens-kit.

Verdict: partly

## Evidence

- The three claims hold. lens-kit.md:107-109 uses "the first step of the two-step pass" and "effects do not join passes" with no explanation and no inline link. Only the Related pages list (line 129) links post-processing. lens-kit.md:114-116 says "its cleared frame moves by more than the look there. Its marks stand instead", which a reader cannot decode without README lines 77-80. The README is named at line 115 with no link, and the page never links the add-on folder (line 27 names it as plain text).
- The finding misses one fault. Line 109 is also inaccurate. post-processing.md:217 and custom-passes.md:216 say effects stop joining while the render scale *can* drop below the whole canvas, and then each effect draws its own pass "at every scale". The default presets allow the drop (post-processing.md:60). The page says "below the whole canvas's render scale", which suggests the joining stops only when the scale is actually lower.
- The proposed edit has two defects:
  1. It drops "on WebGPU and in compatibility mode" from the cost figure (line 113). If the WebGL2 note moves into a closed block, the main text claims 3 to 4 ms for every path. The README table (lines 70-73) holds figures for WebGPU and compatibility mode only. The main text must keep the path qualifier, or it misleads with the block closed.
  2. "The sharpening adds one step to the final pass" is vaguer than the source. post-processing.md:378 says that while sharpening is on, the frame draws the two steps, and "the sharpening therefore adds one full-screen pass". The README (lines 89, 95) measures it at about 1.1 to 1.3 ms, the largest single cost of the look. Say that it adds one full-screen pass.
- The README link is not a demo link, so the website contract's demo format does not cover it. No docs page links an add-on folder yet. The folder URL is still a correct GitHub path and GitHub shows the README there, so the link is acceptable.

## Corrected claim

The Cost section's last two paragraphs use pass-joining terms that only post-processing explains, and the sentence on joining is also inaccurate: effects stop joining while the render scale can drop (the default), not only below the whole canvas. The WebGL2 sentence is unclear, and the README is named without a link.

## Corrected edit

Main text:

"The grade and the vignette run inside the final pass and add no pass of their own. The sharpening adds one full-screen pass, about 1 ms at the size below.

On a MacBook Pro with an M3 Max, at 3840 by 2160 CSS pixels with the pixel ratio held at 2 (33 megapixels), the whole look costs about 3 to 4 ms of GPU time a frame on WebGPU and in compatibility mode. The cost follows the pixels: a megapixel costs about a tenth of a millisecond. The [add-on's README](https://github.com/null3d-engine/null3d/tree/main/examples/addons/lens-kit) gives the figure at each preset and for each mark."

Then:

<details>
<summary>Technical details: how the kit's passes join, and WebGL2</summary>

The sharpening reads display color, so it splits the final pass into two steps at every render scale ([Sharpening](../concepts/post-processing.md#sharpening)). While the render scale can drop below the whole canvas, which the default presets allow, effects do not join passes, so the kit's effect draws a pass of its own ([Below the whole canvas's render scale](../concepts/post-processing.md#below-the-whole-canvass-render-scale)).

WebGL2 has no figure for the whole look. Its whole-frame timer reads about 9 ms and varies by about 1 ms between rounds, which hides the look's own cost. The README gives WebGL2 a figure for each mark instead.

</details>
