# api-3-readability-13

## The finding as given

```json
{
 "page": "api/scene",
 "anchor": "lines 248, 323, 341, 412, 452, 488, 514, 565, 575, 589-592",
 "category": "structure",
 "severity": "medium",
 "claim": "Most sections end with a sentence like 'Development builds throw E1203 for ..., E1108 for ..., E1213 for ...'. The codes have no links, they make the paragraphs long, and a reader with an error cannot find it by scanning. api/render, api/splats and api/vertex-draws each have an Errors table.",
 "evidence": "line 248 'Development builds throw E1203 for a number that is not finite, and E1108 for a number out of its range. They throw E1213 for blur ...'; line 412 lists E1203, E1108, E1213, E1101 and E1222.",
 "proposedEdit": "Add '## Errors' before Related pages: a table Code | Cause | Builds, one row per cause, each code linked to ../errors/E….md. In each section, replace the code sentences with '[Errors](#errors) lists what this call refuses.' Where a section must keep them close, use <details><summary>Technical details: errors this call throws</summary>. Do the same for E1208 on api/textures (lines 72, 101, 102, 105, 120, 146, 189, 204, 230).",
 "generatedSource": "",
 "id": "api-3-readability-13",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: partly

## Evidence

The scene part holds:

- docs/api/scene.md names 12 error codes about 35 times (E1203 and E1108 seven times each, E1213 five times, E1101 four times). None of them links to its error page: the page has no `errors/` link at all.
- The code sentences make long paragraphs longer. stats.json lists the paragraph at file line 412 (98 words, mostly codes), line 341 (166 words, 12 sentences) and line 488 (185 words, 10 sentences) as long. Line 514 is only codes.
- Ten api pages already end with `## Errors` before Related pages: animation, assets, feature-effects, feature-draws, features, post, sketch, render, splats and vertex-draws. The scene page does not follow that pattern.

What does not hold:

1. The anchor misses line 88 (E1417 from `createInstances`).
2. Not every listed line is the same problem. Line 575 (E1104) is not a throw: the engine skips the change and logs it. It must stay in the text, and a table of throws must not list it. Lines 589-592 are the Limits section. There each code is the result of a stated limit, so those sentences belong where they are. Line 323 (E1501, no free view), line 452 (E1430, past the probe limit) and line 565 (E1224) are short, single facts tied to a limit or a rule. Only the development-build validation lists (lines 248, 341, 412, 452 second half, 488, 514) are the real issue.
3. The proposed table shape does not match the ten pages that already have one. They use `Code | Cause` with one row per code and several causes in one cell (render.md line 470 and after). Those pages do not link their codes. "One row per cause" would give E1108 alone about 15 rows. The table would grow past 30 rows.
4. Putting "[Errors](#errors) lists what this call refuses." in each of about 8 sections repeats the same filler sentence. One pointer is enough.
5. The textures part is refuted. api/textures uses one code, E1208. Line 72 already links it ([E1208](../errors/E1208.md)). Each later mention sits next to its cause and often its fix: line 105 says "Load the file again instead", and line 204 says "the pass alone gives its texels". A one-row table adds nothing, and moving the mentions would split each cause from its fix. Line 230 has no E1208.

## Corrected claim

On api/scene, each section ends with a list of the errors that development builds throw for bad options (lines 248, 341, 412, 452, 488, 514). None of the 12 codes links to its error page, and these lists make three long paragraphs longer. Ten other api pages put errors in an `## Errors` table. The mentions that come from limits (lines 323, 452's first part, 589-592), the logged E1104 (line 575) and E1224 (line 565) belong in the text. api/textures needs no change.

## Corrected edit

On api/scene only: add `## Errors` before Related pages in the same form as render.md: `Code | Cause`, one row per code, with the calls and causes in the cell. Say in the cell when only development builds throw. Link each code to `../errors/<code>.md`. Take the validation sentences out of lines 248, 341, 412, 452 (from "Development builds throw"), 488 and 514. Delete line 514 as a paragraph. Put one pointer near the page's start, or in the first background section: "[Errors](#errors) lists the codes that the scene's calls throw." Keep the limit sentences (323, 452 "Each throws E1430 past its limit", 565, 589-592) and the logged E1104 (575) in the text, and link their codes. Also list E1417 (line 88). A `<details>` block is not needed when a table holds the codes. Leave api/textures as it is.
