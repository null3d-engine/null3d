# Verdict: api-3-substance-19

## The finding as given

```json
{
 "page": "api/render",
 "anchor": "lines 21, 67, 81, 146, 152, 382, 395, 441, 445, bullet 449, E1220 cell 474",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Nine paragraphs pass 90 words or 4 sentences; line 395 has 208 words and 13 sentences. The S1 cost figures (152), memory math (395-405), the 8-bit tone curve note (58) and the switching detail (449) are dense implementer facts. The E1220 cell holds about 190 words.",
 "evidence": "stats.json api/render long paragraphs (14, 60, 74, 139, 145, 375, 388, 434, 438 in its count).",
 "proposedEdit": "Split line 21 into a list of the four pass kinds. Move 152, 395-405 and the 8-bit bullet at 58 into <details><summary>Technical details: ...</summary> blocks with one sentence left in the main text. Split the E1220 cell into one row per call (addPass options, reflection, compute, readPass, other calls).",
 "generatedSource": "",
 "id": "api-3-substance-19",
 "slice": "api-3",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The facts hold. stats.json lists nine long paragraphs for api/render. Its line numbers are body lines; the page has a 7-line front matter, so stats line 14 is page line 21, 388 is 395, and so on. Line 395 (wrapped over 395-405) has 208 words and 13 sentences.
- Extra items, counted with wc: the 8-bit bullet at line 58 has 93 words. The switching bullet at line 449 has 139 words. The E1220 cell at line 474 has 192 words. The claim of "about 190" is right.
- The page is hand-written (docs/api/render.md, not under reference/), so the source to edit is the page itself. An empty generatedSource is correct.
- No tool checks the shape of the Errors table (no match for an E-code table parser in tools/ or tools/lib/). One row per call for E1220 breaks nothing.
- "S1" is allowed: the writing rules say to name the engine's benchmark when citing a figure.

## What does not hold

1. The edit does not cover every listed item. The anchor names 67, 81, 146, 382, 441, 445 and bullet 449, but the edit gives no change for them. Line 445 (118 words, 9 sentences) needs the most work: it mixes the WebGL2 layer limits with the cases where a fallback is not possible. Bullet 449 is called a dense implementer fact but gets no edit.
2. "One sentence left in the main text" is too strict for two places:
   - Line 152 sits under its own heading, "Cost of a reflection". The preset shares (Low a quarter, Medium and High half, Ultra full) and the shrink with the render scale are guidance a reader needs. Only the S1 timings and the note about small objects are implementer detail.
   - Lines 395-405 hold two instructions a reader must see: "Size a history pass for its grid, not the canvas" and "`render.dumpGraph()` does not list the state textures, so budget them beside its figures." A one-sentence stub would hide them.
3. Line 58 is a list item. A `<details>` block inside a list item needs exact indentation and is fragile in GFM and on the website. Keep a short bullet and put the block after the list. Line 148 points back to this note ("as to a scene pass's texture"), so the short bullet must still say that 8-bit devices apply the tone curve twice.

## Corrected claim

Nine paragraphs pass the limit, and line 395 has 208 words and 13 sentences. Bullets 58 (93 words) and 449 (139 words) and the E1220 cell (192 words) are also too dense. The proposed edit fixes only some of them, and in two places it leaves too little in the main text.

## Corrected edit

- Line 21: keep the first sentence and the last sentence as prose. Put the four pass kinds (scene, reflection, full-screen, compute) in a list, one line each with its link.
- Line 58: shorten the bullet to "Devices that draw 8-bit color apply the tone curve twice to a pass's texture, so its image looks a little different there." After the list, add `<details><summary>Technical details: pass textures on 8-bit devices</summary>` with the compatibility-mode and WebGL2 detail.
- Line 152: keep the first five sentences (cost follows pixels, the preset shares, the shrink with the render scale) in the main text. Move the S1 timings and the small-object note into `<details><summary>Technical details: measured reflection cost</summary>`.
- Lines 395-405: keep "A pass with history costs more than one state. Size a history pass for its grid, not the canvas. `render.dumpGraph()` does not list the state textures, so budget them beside its figures." Move the layer counts, bytes per texel and example sizes into `<details><summary>Technical details: memory of a history pass</summary>`. Line 382 (reading both states as an array) can go in a second block, `Technical details: reading both states`, with one sentence left in the main text.
- Line 445: split into two paragraphs. The first covers the layer limits (per layer draws, `input.layer`, 32 on WebGL2, 128 or 256 on WebGPU, the uniform layout). The second covers when to give no fallback (atomics, shared memory, chosen writes) and the E1220.
- Bullet 449: split into three bullets: stop and keep the last image; what compiles when a pass switches on. Move the quality-preset survival detail (HDR to 8-bit, MSAA to FXAA) into `<details><summary>Technical details: stopped passes and preset changes</summary>` after the list.
- E1220 cell: one row per call, as proposed (addPass options, reflection options, compute options, setPassSteps and resetPass, readPass, wrong argument to the pass calls).
- Lines 67, 81, 146 and 441 sit near the limit (79 to 112 words). Lines 67 and 146 can each become a short list of what the pass draws. This is low priority.
