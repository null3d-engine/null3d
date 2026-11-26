# api-1-readability-27

## Finding as given

```json
{
 "page": "api/controls",
 "anchor": "## Pointer lock (lines 226-241)",
 "category": "structure",
 "severity": "low",
 "claim": "The moveForward/moveRight example and the walk-and-fly demo link are about first-person and fly controls, not pointer lock. A reader who wants to drive first-person controls from code looks under 'First-person controls' and does not find it.",
 "evidence": "controls.md:226 'To move the camera from the sketch's own code, set movementSpeed: 0...'. :241 links the demo for 'first-person and fly controls'.",
 "proposedEdit": "Move lines 226-239 to the end of 'First-person controls' under an H3 'Moving from code'. Move the demo link to the top of 'Fly controls' or 'First-person controls', next to the first example.",
 "generatedSource": "",
 "id": "api-1-readability-27",
 "slice": "api-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/api/controls.md:203 opens "## Pointer lock". Lines 205-224 are about the lock. Line 226 starts "To move the camera from the sketch's own code, set `movementSpeed: 0` ... call the controls' `moveForward(distance)` and `moveRight(distance)`". That paragraph and its example (lines 228-239) never mention the lock.
- packages/controls/src/first-person-controls.ts:293-325: `moveForward`, `moveRight` and `getDirection` are plain methods of the first-person controls. They work the same with or without the lock. The `movementSpeed` option comment (lines 24-28) says that 0 leaves the moves to the sketch, which calls `moveForward` and `moveRight`. Nothing ties them to the lock.
- The "First-person controls" section (docs/api/controls.md:170-201) already lists the other first-person methods and options, such as `lookAt(x, y, z)` at line 201. So "moving from code" belongs there. This part of the claim holds.
- The claim says the demo link "is about first-person and fly controls, not pointer lock". That is wrong. Line 241 says "A click asks for the pointer lock". examples/demos.ts:777-783 (demo `walk-and-fly`) gives the summary "the pointer lock turns the view with the mouse as in a game". The demo shows all three sections: fly, first-person and pointer lock. Its place after the last of the three sections is reasonable.
- The page does have a habit of putting a demo link in a section's first paragraph. The gizmos section does this at line 245. So moving the link up is fine, but it is optional polish, not a fix.
- The heading fix is fine. The page already uses H3s under "## Each frame" (lines 126 and 135), so an H3 "Moving from code" fits the outline.

## Corrected claim

The `moveForward`/`moveRight` paragraph and example (lines 226-239) are about first-person controls in general and have nothing to do with the lock. A reader who wants to move the camera from code looks under "First-person controls" and does not find them. The demo link at line 241 does cover the pointer lock. It shows all three sections, so where it sits now is reasonable.

## Corrected edit

Move lines 226-239 to the end of "## First-person controls", under an H3 "Moving from code", after the `lookAt` bullet. You can leave the demo link where it is. If you want it to match the gizmos section, move it to the first paragraph of "## Fly controls", where it then introduces all three sections. Keep its words "A click asks for the pointer lock". The page is generated from no source, so edit docs/api/controls.md directly.
