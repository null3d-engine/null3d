# guides-1-readability-20

## Finding as given

- page: guides/custom-shaders
- anchor: line 187, under ### Where a custom effect's and a tone curve's builds go
- category: structure
- severity: medium
- claim: The paragraph on WGSL arrays and the WebGL2 rewrite follows the E1424 deploy note inside the H3 about effect build files. A reader who asks whether arrays work will not look there.
- evidence: line 185 'Deploy every file that the build writes.' then line 187 'You can use arrays in every form that WGSL allows.'
- proposedEdit: Move it to '## What the plugin compiles' after line 164. Keep the first sentence in the main text; put the out-parameter and element-by-element rewrite in <details><summary>Technical details: arrays in the WebGL2 build</summary>.
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/guides/custom-shaders.md:177 opens "### Where a custom effect's and a tone curve's builds go". Lines 179-185 talk only about effect and curve build files and their deployment (E1424). Line 187 then starts the arrays paragraph. It is about every WGSL shader and its WebGL2 build, not about effect files. Line 189 is the next H2, "## Shader errors". So the paragraph sits under a heading that does not describe it, as the finding says.
- docs/guides/custom-shaders.md:154-164 in "## What the plugin compiles" already explain that each shader builds twice, that the WebGL2 build is GLSL, and that both builds follow the portable WGSL rules. A note on how the WebGL2 build treats arrays fits right after line 164.
- stats.json lists this paragraph as long (85 words, 5 sentences). The first sentence answers the reader's question alone ("arrays work in every form"). The rest (Android GPUs, the extra out parameter, element-by-element fill, the WebGPU build left as written) is correct implementer detail that the main text does not need. A details block fits the new block rule: no heading inside, and the main text still makes sense with it closed.
- The page is hand-written, so no generator source is involved.
- I looked for a reason to refute. The rules page, docs/shaders/wgsl-rules.md:49-57 ("## Code that WebGL2 cannot run"), describes similar WebGL2 rewrites, such as struct splitting at line 55, but it does not mention the array rewrite. So the topic is not already handled where a reader would look. The proposed edit breaks no writing rule and no website contract.

## Note (optional, not a correction)

The struct-splitting paragraph at docs/shaders/wgsl-rules.md:55 is a close match for this detail. The writer could also add a one-line link from the moved text to that section, or put the details block there. The proposed move to "What the plugin compiles" is still right.
