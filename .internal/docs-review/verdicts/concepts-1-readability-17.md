# concepts-1-readability-17

## Finding as given

- page: concepts/lighting
- anchor: ### A scene that shows a time of day (158); ## Lights far from the origin (166); ## Lights in scene passes (572)
- category: structure
- severity: medium
- claim: The time-of-day advice is an H3 under 'Ambient and hemisphere lights', 360 lines before the H2 'Time of day'. 'Lights far from the origin' is an H2 for one paragraph that repeats large-worlds. 'Lights in scene passes' repeats line 37.
- evidence: lighting.md:37, 158-168, 572-574
- proposedEdit: Move 'A scene that shows a time of day' into '## Time of day' as its last H3. Fold 'Lights far from the origin' into 'Lights as objects' as one sentence with a link. Merge line 37 and 'Lights in scene passes' into one place at the end.

Verdict: partly

## Evidence

- lighting.md:158-164. The H3 "A scene that shows a time of day" sits under "Ambient and hemisphere lights". The H2 "Time of day" starts at line 516, 358 lines later. This part holds.
- The split costs the reader. The H3 says (line 164) that exposure is one value, chosen at the hour the scene shows longest. The "Time of day" section (line 552, and the physical-model row at 562) gives an exposure that changes with the hour. It also gives an `ambient` value (line 551). A reader who meets only one of the two places gets half the advice, and the two places seem to disagree. Moving the H3 into "Time of day" holds. The move must also say how the two fit: hold one exposure in a scene with hand-set lights, or follow the helper's exposure when the sky drives the scene.
- lighting.md:166-168 against large-worlds.md:36. Large worlds says only that lights work from the cells in 64-bit numbers. Lighting adds how: each frame the engine finds each point and spot light's position relative to the camera, with the cell offset in 64-bit floats, so a lamp 1,000 km out is as precise as one at the origin. So the H2 does not simply repeat large worlds. But a whole H2 for one paragraph is heavy, and the paragraph has no link to large worlds. Folding it in holds, but one sentence would cut the detail about the camera-relative offset.
- lighting.md:37 against 574. These two only partly repeat each other. Both say a scene pass lights the point, spot and area lights its camera sees, and that those lights cast shadows. Line 37 adds that the pass runs steps 3 and 4 again with its own light grid. Line 574 adds the sun, the ambient and hemisphere lights, the environment, fog, the sun's cascades, the background and `clearColor`. Line 37 sits in the list of per-frame steps, where it explains that those steps run again. Taking it out of there loses that context.

## Corrected claim

The time-of-day advice for hand-set lights (line 158) is 358 lines away from the "Time of day" section (516), and the two give exposure advice that seems to disagree. "Lights far from the origin" is a one-paragraph H2. It adds a little mechanism to large-worlds.md:36 but does not link there. Lines 37 and 574 overlap on scene-pass point, spot and area lights and their shadows. Each also holds facts the other lacks.

## Corrected edit

1. Move "A scene that shows a time of day" to the end of "## Time of day" as an H3, for example "Lights you set by hand". Make the exposure advice fit the helper's: one exposure for hand-set lights, or the helper's `exposure` when the sky drives the scene. Mention that `timeOfDay` gives an `ambient` value for this.
2. Turn "Lights far from the origin" into one sentence at the end of "Lights as objects", linking to [Large worlds](large-worlds.md). Put the camera-relative 64-bit offset and the 1,000 km example in a `<details>` block with the summary "Technical details: how lights keep precision far away".
3. Shorten line 37 to one sentence that stays in place: "A scene pass runs steps 3 and 4 again for its own camera, with its own light grid ([Lights in scene passes](#lights-in-scene-passes))." Move its sentence about point and spot shadows into the section at line 572, which then holds the full list.

Severity: medium holds for item 1, because of the exposure advice that seems to disagree. Items 2 and 3 are low.
