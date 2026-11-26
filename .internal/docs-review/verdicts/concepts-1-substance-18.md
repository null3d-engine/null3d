# concepts-1-substance-18

Finding as given:

- page: concepts/lod
- anchor: Line 37 "the governor can raise it to 4 or 8 pixels"; lines 139, 166, 178
- category: term-before-definition
- severity: medium
- claim: 'The governor' first appears at line 37 with no explanation and no link. Line 139 says 'frame-budget governor', again with no link.
- evidence: architecture.md:66 links '[dynamic resolution and the frame-budget governor](quality-presets.md#dynamic-resolution)'.
- proposedEdit: Line 37: '... and the [frame-budget governor](quality-presets.md#dynamic-resolution), which lowers quality when frames run late, can raise it to 4 or 8 pixels.'

Verdict: survives

Evidence:

- docs/concepts/lod.md: "governor" appears at lines 37, 139, 166, 178 and 196. None of them is a link, and the page never says what the governor is. Line 37 says only "the governor". Line 139 is the first place that says "frame-budget governor". The page has no link to quality-presets.md at all.
- The intro note (line 11) and the diagram do not explain the governor either.
- docs/concepts/quality-presets.md:289 has the section "The frame-budget governor". Its diagram (step 2, "Levels of detail: twice the threshold, twice at most") is exactly the behavior lod.md line 37 refers to. So a reader can find the answer there, but lod.md gives no path to it.
- The numbers in the edit match the page: line 139 says the setting is 1 pixel from Medium up and 2 on Low, and the governor doubles it twice at most, so it can reach 4 or 8.

Corrected edit (better anchor only):

The link should point to the governor's own section, not to dynamic resolution. The section at #the-frame-budget-governor lists the level-of-detail step; #dynamic-resolution only covers the render scale.

Line 37: "... and the [frame-budget governor](quality-presets.md#the-frame-budget-governor), which lowers quality when frames run late, can raise it to 4 or 8 pixels."

Lines 139, 166, 178 and 196 can stay as they are once line 37 defines and links the term.
