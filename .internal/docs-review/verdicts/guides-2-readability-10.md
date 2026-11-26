# Verdict for guides-2-readability-10

## The finding as given

- Page: guides/loading-screens
- Anchor: lines 122-134, 147, 172, 174, 202, 215
- Category: technical-details-block, severity medium
- Claim: The short rules (check before play hides the change but makes the viewer wait; list features in preload to fetch nothing during play) are buried in device timings and the layout of the shader files.
- Evidence: line 172 "An 11-inch iPad Pro measured this with the check before play... On a Galaxy S24+, the first frame showed after 0.23 to 0.43 seconds."; line 202 "Each such file takes at most 128 KB after Brotli. A WebGL2 file is larger than its WebGPU twin..."
- Proposed edit: Line 172: keep the first three sentences and the phone sentence; move the iPad, MacBook Pro and Galaxy timings and line 174's iPad timing into `<details><summary>Technical details: what the check costs on each device</summary>`. Line 134: replace the showcase figures with a link to start-time.md#pipelines-on-phones, or a block "Technical details: pipeline builds of larger scenes on phones". Line 202: move file sizes, paired-feature files and the glTF early start into `<details><summary>Technical details: how the first-use shader files are split</summary>`. Line 215: keep the first sentence and the E1421 sentence; move first-draw behavior and the 70 ms figure into `<details><summary>Technical details: what a preload list builds before the first frame</summary>`.

Verdict: partly

## Evidence

- The two rules are not buried. Each is stated in its own short lead-in, right before its code sample: line 161 "A page that would rather hide that change asks for the check before play:" and line 204 "A game that must fetch nothing while it plays lists its features in `createEngine`:". The cost of the check is said in sentence 3 of line 172 ("The viewer waits for them: the check takes most of the start on a tablet."). What holds is narrower: the paragraphs after the code samples (lines 172, 202, 215) and line 134 are long, and device timings fill them. stats.json confirms these are long (172: 164 words, 12 sentences; 202: 175 words, 11 sentences; 215: 182 words, 11 sentences; 134: 144 words, 10 sentences). The stats file numbers these lines 7 lower (165, 195, 208, 127).
- Line 134: the showcase figures duplicate the table under "Pipelines on phones" in docs/guides/start-time.md (lines 250-260), and line 134 already links there ("A fast start gives each figure"). So cutting the figures to the existing link is right. A block is not needed, because the linked page holds the same data.
- Line 172: the device timings are support detail, so a block is right. But the proposal would also move "During play, the first frame shows as soon as the GPU has drawn it." That sentence is the contrast that makes the trade-off clear, so it must stay in the main text. The closing link to quality-presets.md#the-preset-check must stay outside the block too.
- Line 174: if line 174's iPad timing goes into the line 172 block, a repeat-visit figure would show before the text explains repeat visits. Put one block after line 174 for all the timings of both paragraphs, or give line 174 its own one-line block.
- Line 202: the proposal moves "the paired-feature files" into the block. But line 215 stays in the main text and says "The list also loads the file of each pair or group of listed features whose shaders need them together." With the block closed, that sentence would point at something the main text never explained. This breaks the rule that the main text must make sense with every block closed. Keep one short sentence about paired files in the main text. The file sizes (the 128 KB limit is real: tools/lib/size-report.ts:1157) and the glTF early start can go into the block.
- Line 215: "keep the first sentence and the E1421 sentence" would also take out two sentences that a reader needs: "When the sketch turns a listed feature on during play, the engine downloads nothing." (the guarantee the section exists for) and the advice to create the objects in the setup and `await scene.warmUp()`. Only the per-GPU-path first-draw detail (WebGL2 draws at once, WebGPU can take a frame, skinned meshes wait) and the 70 ms figure belong in the block.
- Line 147 is in the anchor, but the proposal does not change it. It is two sentences and is the evidence for the stored list, so leaving it as it is is fine.
- Lines 122-132 (the warm-up table) are in the anchor, but the proposal does not change them. That is acceptable: a table of three rows is not a paragraph problem.

## Corrected claim

The rules are stated as short lead-ins before the code samples. But the paragraphs that follow them (lines 172, 174, 202, 215) and line 134 are long and filled with device timings and the layout of the shader files. This makes the page harder to scan. Line 134's figures also duplicate the table under "Pipelines on phones" in A fast start.

## Corrected edit

- Line 134: keep the first three sentences and "On a phone they take most of the start." Cut the device figures, keep the two sentences about Safari reuse and Chrome's small Android cache, and keep the existing link to start-time.md#pipelines-on-phones. Use no block, because the linked page has the data.
- Lines 172 and 174: keep in line 172 sentences 1-3, "During play, the first frame shows as soon as the GPU has drawn it.", the phone sentence, and the Quality presets link. Keep line 174 without its iPad sentence. After line 174, add one block, `<details><summary>Technical details: what the check costs on each device</summary>`, that holds the iPad, MacBook Pro and Galaxy S24+ timings of the first visit, and the iPad timing of the repeat visit.
- Line 202: keep "Each feature has a file for each GPU path and each device's settings." and one short sentence: "Shaders that need two such features sit in a file of their own, which a page downloads only when it uses both." Keep the `assets optimize` sentences and the last two sentences. Move the 128 KB limit, the WebGL2 and WebGPU size comparison, the download start time and the glTF early start into `<details><summary>Technical details: how the first-use shader files are split</summary>`.
- Line 215: keep the first two sentences, the pair-or-group sentence, "When the sketch turns a listed feature on during play, the engine downloads nothing.", the advice to create the objects in the setup and await `scene.warmUp()`, and the E1421 sentence. Move "Their shaders compile before the first frame, as far as the files alone allow", the 70 ms figure, and the WebGL2, WebGPU and skinned-mesh first-draw detail into `<details><summary>Technical details: what a preload list builds before the first frame</summary>`.
