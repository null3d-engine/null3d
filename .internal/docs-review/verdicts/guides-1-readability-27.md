# guides-1-readability-27

## The finding as given

```json
{
 "page": "guides/custom-passes",
 "anchor": "### A water recipe, lines 421-423",
 "category": "structure",
 "severity": "low",
 "claim": "The bullet at line 421 is seven sentences on soft shores from scene depth, a technique of its own. A blank line after it splits the list in two.",
 "evidence": "line 421 'Without a height map of the bed, a blended sheet reads the depth...'; line 422 blank; line 423 a new bullet.",
 "proposedEdit": "Keep the short bullets together. Move line 421 after the list with the lead 'For a soft shore without a height map, read the scene's depth.' and a numbered list: read sceneDepth, convert with engine_frame.camera_range, subtract from sceneDistance(uv), fade alpha over the last centimeters.",
 "generatedSource": "",
 "id": "guides-1-readability-27",
 "slice": "guides-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/guides/custom-passes.md:421 is one bullet of seven sentences (by my count of the text). It describes a different water: a blended sheet that reads the scene's depth. The bullet just before it (line 420) says this recipe's water is opaque. So the bullet does describe a second technique inside a list of notes on the first one. That part of the finding holds.
- The blank line at line 422 does not split the list in two. In CommonMark and GitHub Flavored Markdown, a blank line between items keeps one list and makes it "loose", so every item is wrapped in a paragraph and gets more space. The cost is spacing only.
- The proposed edit adds steps that the page already links to. The bullet ends with a link to docs/api/materials.md#the-scene-behind-a-surface. That section (docs/api/materials.md:769-815) has a full worked example of this soft shore: a `distance_of` helper that uses `engine_frame.camera_range`, the gap from `sceneDistance(uv)`, and the alpha fade. It also has the same steps as bullets at line 809, and the note on the 6-texture limit at line 815. A new numbered list on the guide would be a third copy of the same steps.
- The section's intro (docs/guides/custom-passes.md:334) already sends readers who want a soft shore to `@null3d/water`.
- stats.json does not list line 421 as a long paragraph, because the count skips list items. The length issue is real but small, so low severity is right.

## Corrected claim

The bullet at line 421 is seven sentences on a second technique, a blended sheet with a soft shore. It sits in a list of notes on an opaque water. The blank line after it does not split the list. It makes the list loose, which adds space between all items. The detailed steps are already on the Materials page that the bullet links to.

## Corrected edit

Do not add a numbered list. Remove the blank line at line 422. Cut the bullet down to a pointer, and keep it last in the list or move it after the list as a short paragraph:

> For a soft shore without a height map of the bed, make the sheet blended and read the opaque scene's depth behind it with `sceneInputs: ['sceneDepth']`. The water's depth is then the gap to the surface behind the sheet, and the alpha fades over the last part of that gap. [The scene behind a surface](../api/materials.md#the-scene-behind-a-surface) shows the full example and its texture limit.
