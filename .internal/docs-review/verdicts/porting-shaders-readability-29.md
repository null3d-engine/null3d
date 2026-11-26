# porting-shaders-readability-29

## Finding as given

- page: porting/verification
- anchor: ## Compare performance, lines 144-157
- category: technical-details-block
- severity: low
- claim: The reason requestAnimationFrame overcounts, the WebGPURenderer counting code and the fenceSync method matter only to a reader who times three.js by hand. They sit between the measure table and the note about unoptimized originals.
- evidence: verification.md lines 144-159.
- proposedEdit: Keep one sentence: "Count the three.js frames that drew and the frames that the GPU finished, and compare with the lower rate." Move the reason, the code block and the WebGL fence method into a technical details block, "Technical details: counting three.js frames".

Verdict: partly

## Evidence

- docs/porting/verification.md:127 says `bench` builds and measures the null3D app only. docs/cli/null3d.md:347 confirms that `bench` measures the engine on your page. No tool times the three.js app. So every reader who follows "Compare performance" times three.js by hand. "Only a reader who times three.js by hand" is every reader of this section, not a small group.
- docs/porting/verification.md:137: the frame-time row of the measure table says the three.js figure is "The intervals between frames that drew, counted as below". The table points at this text, so the counting rule is part of the main method.
- docs/porting/verification.md:144: the reason is two short sentences. It is what tells the reader that a plain requestAnimationFrame count gives a false, too-high three.js rate, which would make the port look worse than it is. If it is hidden, the kept sentence becomes an order with no cause, and a reader who skips the block can still count rAF callbacks and think that is good enough.
- stats.json lists no long paragraphs on this page, so this is not a length fix.
- The code block (lines 146-155) and the WebGL fence method (line 157) are dense, backend-specific how-to. They fit a details block. With the block closed, the kept text still makes sense, and the table's "counted as below" still points at a real sentence.

## Corrected claim

The code sample and the WebGL fence method are implementer detail that can go into a collapsible block. The reason for the rule is not niche: every reader of this section must time three.js by hand, because `bench` measures only the null3D app. The two-sentence reason must stay in the main text.

## Corrected edit

Keep line 144 in the main text, with its reason and its rule: "A `requestAnimationFrame` callback keeps firing while the GPU falls behind. `WebGPURenderer` can also return from a render with nothing drawn while its pipelines build. So count the three.js frames that drew and the frames that the GPU finished, and compare with the lower rate." Change its closing colon to a full stop. Then move the code block (lines 146-155) and the `gl.fenceSync` sentence (line 157) into one block:

<details>
<summary>Technical details: counting three.js frames</summary>

(the existing code block, unchanged)

With `WebGLRenderer`, place a fence with `gl.fenceSync` after each render. Count the frame as finished when a later frame finds the fence signaled.

</details>

Leave line 159 (the unoptimized-original note) after the block, in the main text.
