# guides-2-substance-16

## The finding as given

- page: guides/loading-screens
- anchor: file lines 23, 57, 59, 61, 69, 134, 145, 153, 159, 172, 174, 194, 200, 202, 215
- category: long-paragraph
- severity: medium
- claim: 15 paragraphs run over the limit. Line 172 (164 words) mixes the before-play rule with five device figures. Line 202 (182 words) mixes the first-use rule with shader file sizes ('at most 128 KB after Brotli', 'more than 32 KB'). Line 215 (175 words) mixes the preload rule with WebGPU pipeline detail.
- evidence: stats.json guides/loading-screens longParagraphs (body lines 16-208; file lines are 7 higher).
- proposedEdit: Keep the rule in the main text. Move line 172's times into <details><summary>Technical details: what the check before play costs</summary>, line 202's sizes into 'Technical details: the shader files of a feature', and line 215's WebGPU and skinned-mesh detail into 'Technical details: what preload builds before the first frame'.

Verdict: partly

## Evidence

- stats.json lists 15 long paragraphs at body lines 16..208. Plus 7 they match the 15 file lines in the anchor. The count holds.
- The word counts of lines 202 and 215 are swapped. stats.json gives body line 195 (file 202) 175 words and body line 208 (file 215) 182 words. The finding says 182 for 202 and 175 for 215.
- Line 172 does mix the before-play rule with device figures (iPad about 1 s and 2 s, MacBook 0.49 s and 1.18 s, Galaxy S24+ 0.23 to 0.43 s). The MacBook pair is already in guides/start-time.md line 57, so a block is fine, but cutting it here and linking start-time is also valid. The sentence "A phone starts at Low, which has no lighter preset, so the engine skips the check" is a rule, not a figure. It must stay in the main text. "During play, the first frame shows as soon as the GPU has drawn it" also stays.
- Line 202: the sizes (128 KB after Brotli, WebGL2 larger, many over 32 KB) appear on no other page, so a block keeps them. A block of sizes alone removes about 40 words. The paragraph still holds three separate rules: the pair file, the glTF early start, and the model's shader list from `assets optimize`. It stays over the limit. It needs a paragraph break as well, for example before "The engine starts the download as soon as...".
- Line 215: the WebGPU and skinned-mesh sentences are implementer detail, and a block suits them. But the sentence "To build those too before the loading screen goes, create the objects in the setup and await scene.warmUp()" is the action a reader takes. It must stay in the main text, after the block, or the main text loses the fix. The 70 ms Mac figure can go into the same block. The E1421 sentence stays in the main text.
- The proposed edit covers 3 of the 15 paragraphs. It says nothing about the other 12 (file lines 23, 57, 59, 61, 69, 134, 145, 153, 159, 174, 194, 200). Line 134 (144 words, 10 sentences) is the next worst and is mostly device figures (Galaxy S25, iPhone 17, Tab A9 Plus), which start-time.md#pipelines-on-phones already gives. It suits the same treatment. Lines 59, 61 and 200 are over only by sentence count (68 to 75 words, 5 sentences) and need no change.

## Corrected claim

15 paragraphs run over the limit. Line 172 (164 words) mixes the before-play rule with device timings. Line 202 (175 words) mixes the first-use rule with shader file sizes and three separate download rules. Line 215 (182 words) mixes the preload rule with WebGPU and skinned-mesh pipeline detail. Line 134 (144 words) is mostly device timings that start-time.md already gives.

## Corrected edit

- Line 172: keep the first three sentences, the "During play" sentence and the phone-at-Low rule in the main text. Move the iPad, MacBook and Galaxy S24+ timings into `<details><summary>Technical details: what the check before play costs</summary>`. Keep the Quality presets link in the main text.
- Line 202: move the file-size sentences into `<details><summary>Technical details: the shader files of a feature</summary>`. Then break the rest into two paragraphs: the pair file, and when the download starts (glTF and the model's shader list).
- Line 215: keep the download and first-frame rule, "the engine downloads nothing", the warm-up advice and E1421 in the main text. Move the 70 ms figure and the WebGL2, WebGPU and skinned-mesh sentences into `<details><summary>Technical details: what preload builds before the first frame</summary>`, placed before the warm-up advice.
- Line 134: keep the first two sentences and the Repeat visits link in the main text. Move the phone and MacBook counts and timings into a block, or cut them and keep the link to start-time.md#pipelines-on-phones.
- Lines 23, 57, 145, 153, 159, 174 and 194: break each at its topic change. Lines 59, 61, 69 and 200 need no change.
