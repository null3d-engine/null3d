# Verdict on api-3-readability-11

## The finding as given

```json
{
 "page": "api/raycast",
 "anchor": "## Pixel-exact picking, lines 136-170; long paragraphs at lines 21, 106, 119, 138, 149, 151, 155, 206, 263",
 "category": "structure",
 "severity": "medium",
 "claim": "The picking section is nine paragraphs and a list with no sub-structure. Texture coordinates, pixel tests, sources, the raycast fallback, timing, cost and device loss come in one stream. A reader looking for why a pick returned null must read all of it.",
 "evidence": "stats.json longParagraphs for api/raycast: 138, 149, 151, 155 fall in this section.",
 "proposedEdit": "Add H3s: 'What a pick finds' (lines 155-164), 'Texture coordinates' (149-153), 'When a pick answers null or fails' (166, 170), 'Cost' (168). Put line 151 in <details><summary>Technical details: how a pick finds its texture coordinates</summary>. Split line 21 after 'Raycasts also hit sprites, points and lines where they draw.' Break lines 106, 119, 206, 263 at the fourth sentence (106 before 'Over a view from scene.createView').",
 "generatedSource": "",
 "id": "api-3-readability-11",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/api/raycast.md is a written page, not a generated one, so no generated source applies. Page line = stats.json line + 7 (the front matter). The finding converted every line correctly (stats 14, 99, 112, 131, 142, 144, 148, 199, 256 = page 21, 106, 119, 138, 149, 151, 155, 206, 263).
- The claim holds. "## Pixel-exact picking" (lines 136-170) has no sub-headings. It holds paragraphs at 138, 149, 151, 153, 155, 157 (list lead), 164, 166, 168 and 170, a list at 158-162 and a code block. Texture coordinates, the pixel test, sources, the raycast fallback, timing, cost and device loss all come in one stream. Other API pages use H3s (animation, materials, input and more), so H3s fit the house style.
- The causes of a null answer are in three places. Line 166 covers a pick before the first frame. Line 168's last sentence covers a hidden object, an object off the camera's layers and an empty pixel. Line 170 covers device loss (a rejection, not null). The proposal files all of 168 under "Cost", so the main null causes would sit under the wrong heading. That defeats the finding's own goal.
- The proposed block for 151 hides user-facing facts. Its first two sentences say the coordinates are the mesh's own, that a repeated texture gives values past 1, and that `uvTransform` does not move them. A reader who maps `uv` to a texture needs these, so they must stay in the main text. Only sentences 3-6 are mechanism: how a raycast from the recording frame's camera finds the coordinates, and why `hasUv` goes false when that ray names another object. Those fit a block.
- Line 106: "Over a view from `scene.createView`" starts the fifth sentence, not the fourth. The clearer break is after sentence 2 ("...describes it."). Sentences 1-2 cover pointer events, and 3-5 cover a ray of your own.
- Line 206: a break "at the fourth sentence" splits the pair that says which camera each raycast uses (sentences 3 and 4). Break before sentence 5 ("Without an active camera...") instead.
- Line 263: sentence 4 starts "So when the query's layers hold such rows...". It draws its conclusion from sentences 2 and 3. A break there leaves a paragraph that opens on "So" with its reasons in the paragraph before. At 64 words and one line of argument, the paragraph can stay whole.
- Line 119: a break before "Only `distances` is required" is fine. Line 21: the split after "Raycasts also hit sprites, points and lines where they draw." is fine. It separates what queries do from how the trees make them fast.
- Order: the proposal lists "What a pick finds" (155-164) first, but 149-153 comes before it on the page. Give the H3s in one order and move the text to match.

## Corrected claim

The picking section has no sub-structure, and the causes of a null pick sit in three paragraphs (166, the last sentence of 168, and 170). The reader must read the whole section to find them. The other long paragraphs (21, 106, 119, 206) can each break once at a topic change. Line 263 is one argument and can stay whole.

## Corrected edit

Under "## Pixel-exact picking", keep 138 and the code block as the lead. Then:

1. `### What a pick finds`: lines 155, 157-162 and 164.
2. `### Texture coordinates`: line 149, the first two sentences of 151, and 153. Put the rest of 151 in a block:

   ```html
   <details>
   <summary>Technical details: how a pick finds its texture coordinates</summary>

   A ray through the same point finds them, from the camera of the frame that recorded the pick. So a pick and a raycast on one point give one answer. A ray that names another object than the pixel did leaves `hasUv` false. The pick then keeps the object that the pixel showed.

   </details>
   ```

3. `### Timing and cost`: the first three sentences of 168 (cost, the pick queue, and the frame it answers in).
4. `### When a pick answers null or fails`: 166, then the last sentence of 168 ("A hidden object, an object off the camera's layers, and a pixel that no object covers answer `null`."), then 170.

Other breaks:

- Line 21: split after "Raycasts also hit sprites, points and lines where they draw."
- Line 106: split after "[Pointer events on objects](input.md#pointer-events-on-objects) describes it."
- Line 119: split before "Only `distances` is required".
- Line 206: split before "Without an active camera".
- Line 263: leave whole.
