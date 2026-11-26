# api-3-substance-09

## Finding as given

- Page: api/raycast
- Anchor: "## Pixel-exact picking, line 164: \"answers the whole pick with a raycast instead\""
- Category: scan-order. Severity: medium.
- Claim: The section is named Pixel-exact picking, but one sprite, point, line, blended, hashed or transmissive material anywhere in the scene turns every pick into a raycast that ignores masks and tests skinned characters in bind pose. That fact comes sixth in the section. Hold mode also answers with a raycast and the page does not say so. "The pick's id target" is not explained.
- Evidence: packages/engine/src/scene/picks.ts:7-10
- Proposed edit: After the first code block add: "A pick is pixel-exact only when every source in the scene draws into the pick's image. One sprite, point, line, blended or transmissive material, hashed alpha, or custom material without a vertex offset makes every pick a raycast. Hold mode answers with a raycast too." Move the source list and cost detail into a <details> block.

Verdict: partly

## Evidence

- docs/api/raycast.md:136-170. The scene-wide fallback is stated at line 164, after five prose paragraphs (138, 149, 151, 153, 155) and the list of sources (157-162). So it is the seventh block of text, not the sixth. The order claim holds in substance: a reader learns about uv details before learning that one sprite turns every pick into a raycast.
- Line 164 does say "the whole pick" falls back and that the raycast ignores masks. Line 11 says queries test skinned characters in bind pose. So the facts are on the page; only their place is wrong.
- "The pick's id target" (line 164) is used with no explanation anywhere on the page. Claim holds.
- Hold mode: picks.ts:113-121 answers by ray at once when the frame loop never gave the picks their control block, and picks.ts:9-10 names hold mode. scene.ts:5875-5878 attaches that block only when the frame loop starts. Neither raycast.md nor guides/testing.md mentions picks in hold mode. Claim holds.
- Fallback rule: crates/null3d-render/src/frame.rs:389-391 (every drawn pair needs a pick build; no blended, transmissive, sprite, point or line source). The proposed sentence drops "a masked custom material", which line 164 lists. It must stay.
- Proposed block: "the cost detail" is line 168. That paragraph also says when a pick answers null (hidden object, off the camera's layers, empty pixel) and that each pick answers a frame later. Those are core behavior and must stay in the main text. Only the cost sentence and the queue sentence are block material. Moving "the source list" (157-162) into a block is wrong: it says what a pick finds, which a reader needs with every block closed.

## Corrected claim

The scene-wide raycast fallback (line 164) comes after the uv detail and the source list, so a reader meets it late. The page also never explains the id target and never says that a pick in hold mode is a raycast. The facts at line 164 are correct and complete.

## Corrected edit

Replace line 164 with this paragraph, placed right after the first code block (line 147):

"The pick draws each object's id into a small image around the point, then reads the id back. So a pick is exact to the pixel only when every source in the scene can draw into that image. One sprite, point or line in the scene, one material that blends, uses `transmission` or uses `alphaMode: 'hash'`, or one custom material that masks or has no vertex offset, makes every pick a raycast. That raycast tests triangles: it ignores masks, tests skinned characters in their bind pose, and uses the camera of the frame that last ran. In [hold mode](../guides/testing.md), which runs no frame loop, a pick is a raycast too."

Keep the list at 157-162 and the null cases of line 168 in the main text. Put only the cost and queue sentences of line 168 in a block:

<details>
<summary>Technical details: what a pick costs</summary>

A pick costs one more draw of the camera's opaque objects, one read of four bytes, and one raycast for the texture coordinates. Picks wait in a queue of their own, because a frame records one read.

</details>
