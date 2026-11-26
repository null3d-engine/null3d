# api-3-substance-20

## The finding as given

- page: api/scene
- anchor: lines 246, 296, 298, 341, 488, 518 and 22 more
- category: long-paragraph
- severity: medium
- claim: 28 paragraphs pass the limit. The worst hold implementer detail the main text does not need: how a sky layer reaches the environment map (296), fill timing (298), browser boxing of fractions (549), and error lists at the end of each section (248, 341, 412, 452, 488, 514).
- evidence: stats.json api/scene long paragraphs at 64, 68, 81, 108, 110, 151, 170, 199, 201, 235, 239, 245, 289, 291, 312, 314, 316, 334, 340, 368, 405, 443, 481, 505, 511, 542, 572, 576.
- proposedEdit: Move 296 and the second half of 298 into `<details><summary>Technical details: how a sky layer lights the scene</summary>`. Put each section's development-build errors in a small table or closed block. Split 246 into loading, per-frame changes and orthographic cameras. Split 518 into a list of returned values.
- generatedSource: "" (docs/api/scene.md is hand-written)

Verdict: partly

## Evidence

- Line numbers. The finding uses lines of the generated page. stats.json lines are 7 lower (the front matter). So page 246 = stats 239, 296 = 289, 298 = 291, 341 = 334, 412 = 405, 488 = 481, 518 = 511, 549 = 542. These all are long paragraphs. The count of 28 is right.
- Three of the six "error list" paragraphs are not long. Page 248, 452 and 514 would be stats 241, 445 and 507. stats.json has no entry at those lines. They are short error paragraphs. Only 341, 412 and 488 are long, and in 341 and 488 the errors sit inside a longer paragraph about behavior.
- Page 296 is not all implementer detail. Its first sentence says that a sky layer shows in reflections and lights the ground. A user needs that fact. Its last sentence ("None of this is the add-on's work") is also for the user. Only the middle (the second shader build that fills the cube faces, the pass that sums the map onto nine coefficients, the asynchronous read back) is mechanism.
- If all of 296 goes into a closed block, page 298 breaks. Its first words, "A fill spreads over some twenty frames", use "fill" and "the map", which only 296 explains. That fails the rule that the main text must make sense with every block closed.
- The claim names 549 (the browser boxing fractions, page line 549) but the edit gives no change for it.
- 246: the split is right, but its last sentence ("The color set before an environment or a cube map shows until its texels are on the GPU") is about loading. It goes with the loading part, not with the orthographic camera.
- 246, 341 and 549 also name `bun run bench:allocation ...`. That is a command of the engine repository, not something an engine user runs. It fits inside the technical-details blocks.
- 518: it lists the returned values (sky, main light, fog color and glow, ambient light, sky intensity, exposure) in one sentence, then the options, then night behavior. A list of returned values plus a short paragraph on options is a real gain.

## Corrected claim

28 paragraphs pass the limit. The worst mix user facts with implementer detail: the mechanism by which a sky layer reaches the environment map (middle of 296), fill timing (second half of 298), browser boxing of fractions (549), and development-build errors inside long paragraphs (341, 412, 488). The error paragraphs at 248, 452 and 514 are short and need no change.

## Corrected edit

- 296: keep the first sentence (the layer shows in reflections and lights the ground) and the last sentence in the main text. Move the middle sentences into `<details><summary>Technical details: how a sky layer lights the scene</summary>`.
- 298: keep in the main text that the map captures a moving layer every `refresh` seconds, that 0 suits a still layer and costs one capture per change, and that the scene keeps the core sky's light until the first capture lands. Move "some twenty frames, one stage a frame", "20 stage draws a second" and the "frame or two" lag into the same block as 296.
- 549: keep the sentence on the third argument and `emptyTimeOfDay()`. Move the sentence on the browser boxing fractions and the bench command into a technical-details block.
- 341, 412, 488: put the development-build errors in their own paragraph or a closed block after the behavior text. Leave 248, 452 and 514 as they are.
- 246: split into (a) loading: the shader download, the loading-screen link, and the color that shows until the texels are on the GPU; (b) per-frame changes: each call sets every option, allocates nothing, so a sketch can move the sun every frame (bench command into a block); (c) drawing: behind every object, exposure and tone mapping, and the orthographic camera.
- 518: a list of the returned values, then a short paragraph on `heading` and `noonElevation` and the night sky.
