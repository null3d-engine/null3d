# porting-shaders-readability-16

## Finding as given

- page: shaders/surface-functions
- anchor: ## Textures, bullets at lines 279 (texture arrays) and 283 (up to 6 textures); errors at lines 310-316
- category: technical-details-block
- severity: medium
- claim: The section has 10 bullets. The WebGL2 texture unit arithmetic (7 units for lighting, at least 16 units, 3 free, E1209) is implementer detail in a 90-word bullet. The 100-word texture array bullet sits 9 lines before its own example.
- evidence: surface-functions.md lines 277-316.
- proposedEdit: Keep "A material samples up to 6 textures. Each takes one of the 32 numbers of the uniforms." Move the unit budget and E1209 into a technical details block after the list. Move the texture array bullet into a short paragraph directly above the facade example. Put the E1216 cases and build errors (lines 310-316) in a technical details block, "Technical details: texture errors".

Verdict: partly

## Evidence

- docs/shaders/surface-functions.md lines 277-286 hold 10 bullets. The count holds.
- Line 283 (up to 6 textures) has 94 words. Line 279 (texture arrays) has 95 words, not 100. The bullets are long, but the figures in the claim are slightly off. These bullets are not in stats.json, which flags only plain paragraphs.
- Line 283 does carry the WebGL2 unit arithmetic (7 units for lighting, at least 16, 3 free, E1209). The E1209 entry in packages/engine/src/errors/codes.ts:154-161 matches: it is a WebGL2-only limit. That is implementer detail and fits a block.
- The facade example intro is at line 288 and its code at line 290. So the array bullet is 9 lines before its example, as claimed.
- Lines 310-316: E1216 cases, then five build errors. The Rules section of the page does not repeat them, so a block keeps them, and nothing is lost. The E1216 cause in codes.ts:184-191 also covers these cases on the error page.
- Line 318, "Full shaders take no textures.", is a short user-facing fact. It must stay outside any block.

## What the proposed edit misses

- Line 285 also explains texture arrays: "A texture array comes from `textures.fromData` with a `depth`, or from a KTX2 file that holds layers". If only line 279 moves, the array facts stay split across the list and the new paragraph. Move that sentence with it.
- Line 278 (`textureGather` fails on WebGL2) is the same kind of WebGL2 detail. It can join the unit budget block, or stay; this is optional.

## Corrected claim

The section has 10 bullets. The 94-word bullet on texture limits mixes a user rule (6 textures, each takes one of the 32 uniform numbers) with WebGL2 texture unit arithmetic and E1209. The 95-word texture array bullet sits 9 lines before its own example, and a second array fact sits in the bullet at line 285.

## Corrected edit

1. Keep in the list: "A material samples up to 6 textures. Each takes one of the 32 numbers of the uniforms, so a material with 2 textures has 30 numbers for its uniforms."
2. After the list, add "Technical details: texture units on WebGL2" with the unit budget (7 units for lighting, at least 16 per stage, 3 free with 6 textures) and the E1209 refusal. Optionally add the `textureGather` note from line 278.
3. Move the texture array bullet (line 279) and the array sentence of line 285 into one short paragraph directly above the facade example. Leave "A texture is 2D, with one layer: an image, a KTX2 file or data with a depth of 1" in the list.
4. Put the E1216 cases and the build errors (lines 310-316) in "Technical details: texture errors". No headings inside. Keep "Full shaders take no textures." outside the block, after it.
