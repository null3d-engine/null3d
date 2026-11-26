# guides-2-readability-22

## Finding as given

- Page: guides/performance
- Anchor: "## Write per-frame code that allocates nothing", bullet line 125
- Category: example-placement
- Severity: medium
- Claim: The last bullet covers setters, inlining, material.set boxing, material.setUniform and camera.setPose in eight sentences, about 130 words. It is the most useful advice in the section and the hardest to read. The section has no code, though each habit has a short good form.
- Evidence: line 125, from "A light's, the camera's, a line's and the background's setters" to "from the arrays that hold it."
- Proposed edit: Split line 125 into three bullets: setters allocate nothing, so call them from a small function; material.set is for setup; change a per-frame value with material.setUniform(name, value) and a camera with camera.setPose(position, rotation). Add one code block after the list showing a hot loop written right (index reads, reused arrays, setUniform). Move the inlining and boxing reasons into a details block titled "Technical details: why some calls allocate in hot code".

Verdict: survives

## Evidence

- docs/guides/performance.md:125 is one list item of 127 words (wc -w). It has 7 sentences, not 8. The other bullets in the list (lines 118 to 124) are one or two sentences each. So this bullet is about four times longer than its neighbours and holds three separate habits. The core claim holds.
- The section (lines 115 to 127) has no code block. The page's only TypeScript block is at line 381 (memory peak). The claim "the section has no code" is true; it has inline code only.
- The API names in the proposal are real: `setUniform(name, value)` at packages/engine/src/scene/resources.ts:4319 (it calls a write that takes the value itself), and `setPose(position, rotation?)` at packages/engine/src/scene/scene.ts:1162. Its TSDoc confirms the reason the bullet gives: a number passed to a setter that the browser does not inline becomes an object, and an array crosses the call without one.
- Docs code blocks are not type checked (AGENTS.md "Docs and skills" rule 6 covers only skills), so a new block must be checked by hand against these signatures.
- The reasons (inlining, boxing of option-object reads) are correct, dense detail. Moving them into a details block fits the task contract. The main text still makes sense without them: "call setters from a small function", "material.set is for setup", "use setUniform and setPose per frame" are each complete instructions.

## Corrections to the edit

- The sentence count is 7, not 8.
- Keep "A line material's `set` allocates nothing too" in the main text, in the first new bullet. The proposed three bullets drop it, and it changes what a reader may call each frame.
- Put the details block after the whole list, not inside a list item. A raw HTML block inside a Markdown list item breaks the list on many renderers. It can sit just before or merge with the "Decimal numbers are a special case" paragraph at line 127, which gives the same boxing reason.
- The code block should use the real signatures: `material.setUniform(name, value)` with a name the material's shader declares, and `camera.setPose(position, rotation)` with arrays kept outside the frame function.
