# concepts-1-readability-16

## Finding as given

- page: concepts/lighting
- anchor: ### Cost (under Environment maps), lines 264-284
- category: technical-details-block
- severity: medium
- claim: Ten bullets, two of them over 100 words (sky refresh at 271, WebGL2 texture units at 275), and a device-time table. The one rule a user must follow (load environments while the scene loads) is buried in bullets 267 and 270.
- evidence: lighting.md:264-284
- proposedEdit: Open the section with: 'Load or ask for an environment while the scene loads. A call during play makes one long frame.' Keep the download-size and memory bullets. Move bullet 275 (texture units, the order in which maps drop, E1209) and the table at 277-284 into a block 'Technical details: texture units and measured times'. Bullet 271 goes to the refresh duplication finding.

Verdict: partly

## Evidence

- docs/concepts/lighting.md:264 is the "### Cost" heading. Lines 266-275 hold ten bullets. Line 277 introduces the table, and lines 279-284 hold the table.
- Word counts: line 271 (sky refresh) has 146 words and line 275 (WebGL2 texture units) has 132 words. The other bullets have 17 to 92 words. The claim about length holds.
- The load-time advice sits at the end of bullet 267 ("Load HDR files while the scene loads, as you would ask for the room.") and in bullet 270 ("Ask for the room while the scene loads. A call during play makes one long frame..."). The claim that it is buried holds.
- The proposed opening sentence is wrong for one case. Bullet 272 says "A file's map uploads in the frames after the load, within the frame's upload budget. The scene draws without an environment until its map is on the GPU." The code agrees: packages/engine/src/scene/environment-file.ts reads the KTX2 file, and packages/engine/src/scene/textures.ts (around line 983) uploads its levels through the texture queue, which keeps to the frame's upload budget (textures.ts:5). So a KTX2 file from `bunx @null3d/cli assets env`, the page's own "fast path" (line 229), does not make one long frame. Only an HDR or EXR file (GPU filter in one frame, line 267), the built-in room (line 269-270) and the sky's environment (whole map in the next frame, line 271) do. "Load or ask for an environment while the scene loads. A call during play makes one long frame." would tell readers that the fast path also stalls.
- Bullet 269 points at "the table below". If the table moves into a block, that pointer must change. Bullet 270 already gives the phone cost in frames, so the main text still makes sense with the block closed.
- Bullet 275 holds one rule a custom-material author needs: the engine refuses a material that needs too many texture units, with E1209. That sentence should stay in the main text, with the unit arithmetic and the drop order in the block.

## Corrected claim

The section is dense (ten bullets, two over 100 words) and its load-time rule is buried in bullets 267 and 270. But the rule applies to an HDR or EXR file, the built-in room and the sky's environment, not to a KTX2 file from the asset tool, which uploads within the frame's upload budget over several frames.

## Corrected edit

Open the section with: "Load an HDR file, or ask for the built-in room or the sky's environment, while the scene loads. Each one makes its whole map in one frame, so a call during play makes one long frame. A KTX2 file from the asset tool uploads over several frames and makes no long frame." Keep the download-size and memory bullets. In bullet 275, keep in the main text: "On WebGL2 a material has a limited number of texture units. The engine refuses a custom material that needs more than the lighting leaves, with E1209." Move the rest of bullet 275 (the count of units, what shares them, the order in which maps drop) and the paragraph at 277 with the table at 279-284 into one block, "Technical details: texture units and measured times". Change "which the table below gives" in bullet 269 to "which the technical details below give". Bullet 271 goes to the refresh duplication finding.
