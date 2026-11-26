# concepts-2-readability-19

## Finding as given

- page: concepts/quality-presets
- anchor: ## Dynamic resolution, bullets 256-264 and paragraph 287
- category: duplication
- severity: medium
- claim: Nine dense bullets mix the main rule (down 0.05 after one bad second, up after 5 good seconds) with edge rules: the 2% quarter test, Safari timers, display-rate tracking, and 30 s trials up to 80 s. Line 287 (176 words) repeats the two-step final pass, GSR 1 and sharpening, which post-processing.md 58-72 already owns.
- evidence: Line 287 '...the second scales the image up to the canvas with GSR 1, an edge-aware upscaler. [The post-processing chain](post-processing.md#below-the-whole-canvass-render-scale) describes both steps'.
- proposedEdit: Keep four bullets: what it watches, when it steps down, when it steps up, and when it does not step. Move the quarter-second rule, Safari, the display-rate fall and the trial rules into <details><summary>Technical details: how the controller judges a second</summary>. Cut 287 to three sentences: minRenderScale 1 keeps the whole canvas; hold mode draws at maxRenderScale; below 1 the final pass runs in two steps (link).

Verdict: partly

## Evidence

- Bullets (docs/concepts/quality-presets.md:256-264) say what the finding says: 95% rule plus the 2% quarter test (257), Safari timer callbacks (258, 261), the display-rate fall (259), the 30 s trial doubling up to 80 s (263). The main rule is also in the Mermaid diagram at 243-250. Splitting the bullets into a short main list plus a details block holds.
- The display-rate fall in bullet 259 is also stated in plain words at 308 ("When the browser lowers the rate of its frames to save battery ... The target falls with it, as long as the GPU keeps up"). This supports moving it into the block.
- Line 287 duplication holds for the two-step description: post-processing.md:60-63 gives the FXAA step, the GSR 1 step and the sharpen rule ("The two steps also draw at the whole canvas's scale while the sketch sets `sharpen`"), and 67-70 give the two costs.
- It does not hold for the 8-bit sentences in 287: "Some GPU paths draw the scene's color in 8 bits: WebGPU's compatibility mode, and WebGL2 devices that cannot draw multisampled float targets. There, with MSAA, a lowest scale below 1 adds the final pass ... At a lowest scale of 1, the scene's render pass writes straight to the canvas." A search of docs/ finds this rule only on this page (not in post-processing.md, backends.md or guides/phones.md). The proposed three-sentence cut deletes it. That loses a correct, unique cost of a lowest scale below 1, against the rule to move dense detail into a block rather than cut it.
- Small points: the stats file puts this 176-word paragraph at line 280; in the generated page it is at 287. Same paragraph. The phrase "which the pass at the whole canvas's scale always did" reads as change history and should go with the cut. The summary "how the controller judges a second" does not fit the trial rule; a wider label is better.

## Corrected claim

The bullets mix the main rule with edge rules, and the display-rate bullet repeats line 308. Line 287 repeats the two-step final pass and the sharpen rule from post-processing.md:58-72, but it also holds the only statement of the 8-bit MSAA cost, which no other page gives.

## Corrected edit

Bullets: keep four main bullets (what it watches; over budget = under 95% of the target for a second, then down 0.05 and a one-second wait; 5 s at the target with time to spare, then up 0.05; no step at 57-59 fps, in the first 2 s, after a pause or during uploads). Move the benchmark-report sentence, the 2% quarter test, the GPU-two-frames-late test, the Safari timer notes, the display-rate fall and the trial rules into:

<details>
<summary>Technical details: how the controller judges frames and trials a rise</summary>

...those rules as a short list...

</details>

Line 287: keep "A `minRenderScale` of 1 keeps the whole canvas. Hold mode draws at `maxRenderScale`, so tests draw the same image on every run. Below a scale of 1, the final pass runs in two steps, and [the post-processing chain](post-processing.md#below-the-whole-canvass-render-scale) gives both steps, the effect of `sharpen` and the two costs that a lowest scale of 1 avoids." Do not cut the 8-bit rule: move it into a second block after the paragraph, for example <details><summary>Technical details: the 8-bit GPU paths</summary> with the three 8-bit sentences, or add it to the cost list in post-processing.md:67-70 and link there. Drop "which the pass at the whole canvas's scale always did".
