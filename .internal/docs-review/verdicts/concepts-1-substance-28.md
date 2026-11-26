# Verdict: concepts-1-substance-28

## Finding as given

```json
{
 "page": "concepts/large-worlds",
 "anchor": "## A moving camera, line 97 \"A test checks this with a flight...\" and line 99 \"... or with no free cell, jitters\"",
 "category": "unclear",
 "severity": "low",
 "claim": "'With no free cell' means 'when all 512 cells are in use', but the reader meets that limit only at line 115. The details of the test flight (six squares, 12 cm a frame, 16 frames) matter only to implementers.",
 "evidence": "large-worlds.md:115.",
 "proposedEdit": "Line 99: '... or when all 512 cells are in use ([Limits](#limits)), jitters.' Put lines 97-99 in <details><summary>Technical details: how the engine tests a moving camera</summary>. Above it, keep: 'In large-world mode, a camera that flies past objects 1,000 km out or at the Earth's radius moves them on screen as smoothly as at the origin, on every GPU path.'",
 "generatedSource": "",
 "id": "concepts-1-substance-28",
 "slice": "concepts-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/concepts/large-worlds.md:99 says "or with no free cell, jitters". Nothing before it says that cells can run out. Lines 30-34 bring in cells and "each cell in use", but give no limit. The limit comes first at line 115: "At most 512 cells are in use at once ... When all 512 are in use, an object or a row that enters a new cell goes into the origin's cell instead." The code agrees: packages/engine/src/generated/core.ts:35 (a cell limit of 512) and packages/engine/src/generated/gpu.ts:409. So the first half of the finding holds.
- Line 97 is test detail: six squares, 4 m to 35 m, 12 cm a frame, 16 frames, within 0.0001 pixels. Few readers need it. A collapsible block for it is right.
- The proposed edit puts line 99 in the block too. Line 99 is the only place in "A moving camera" that tells a reader when the camera is NOT smooth: without large-world mode, or when all cells are in use. Line 95 says, with no condition, "A camera that moves far from the origin stays as smooth as one near it." The summary sentence that the edit keeps above the block covers only the good case. With the block closed, a reader loses the warning, and the Limits link moves inside the block. That breaks the rule that the main text must make sense with every block closed, because the warning is a main point, not detail.
- The step sizes on line 99 (6 cm at 1,000 km, 0.5 m at the Earth's radius) repeat line 22. The pixel jumps (3.5 and 7.8 pixels) are test results. Those can go in the block.

## Corrected claim

"With no free cell" is unclear at line 99, because the cell limit comes first at line 115. The test numbers on lines 97-99 suit a collapsible block. But the warning on line 99 must stay in the main text, so that the section says when a moving camera jitters.

## Corrected edit

Replace lines 97-99 with:

```markdown
In large-world mode, a camera that flies past objects 1,000 km out or at the Earth's radius moves them on screen as smoothly as at the origin, on WebGPU, its compatibility mode and WebGL2. Without large-world mode, or when all 512 cells are in use ([Limits](#limits)), the same camera jitters, as positions move in the coarse steps given at the top of this page.

<details>
<summary>Technical details: how the engine tests a moving camera</summary>

A test flies a camera sideways past six squares, 4 m to 35 m away, 12 cm per frame for 16 frames. It flies at the origin, 1,000 km out and at the Earth's radius, in large-world mode. Each square's image moves from frame to frame as it does at the origin, within 0.0001 pixels.

The same flight without large-world mode jitters. The camera's position moves in steps of about 6 cm at 1,000 km and 0.5 m at the Earth's radius, so the squares jump by up to 3.5 pixels at 1,000 km and 7.8 pixels at the Earth's radius.

</details>
```
