# guides-1-substance-24

## Finding as given

- page: guides/baked-light-data
- anchor: note under the title: "A directional light map bends its light with a normal map, as the light of the bake came from a direction." (line 11)
- category: structure
- severity: low
- claim: The note is about format stability; its last sentence is about directional maps, explained at line 124. The stability text also repeats line 33.
- evidence: docs/guides/baked-light-data.md:11, 33, 124.
- proposedEdit: End the note after 'takes a new version number.' Remove the duplicate stability sentences at line 33, or shorten the note.
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/guides/baked-light-data.md:11. The note has four parts: the required opening ("Roadmap step 0.3, first released in null3D 0.1.0."), "The format is stable: version 1 holds the members that this page lists", "a reader ignores members that it does not know", "A change that an earlier reader would misread takes a new version number", and then the unrelated sentence about directional light maps.
- docs/guides/baked-light-data.md:33 says the same two rules again: "A reader ignores members that it does not know" and "The `version` number changes only when a reader that predates the file would read it wrongly." Its last sentence, "This engine refuses any version that it does not know", also repeats the table row at line 30 ("A reader refuses any other version"). The page states the version rule three times.
- docs/guides/baked-light-data.md:92, 106, 122 and 124 cover directional maps where they are used. Line 124 explains the effect clearly: the normal map's relief brightens where it faces the bake's light and darkens where it turns away. The title-note sentence is vaguer than that, and a reader cannot act on it before learning what a `direction` member is.
- The note's opening sentence is required. .dev/releases.md:45 and tools/lib/docs.test.ts:135-137 show that the docs check holds every page's note to "Roadmap step <since>, first released in null3D 0.1.0." The proposed edit keeps that opening, so it breaks no rule.
- I tried to refute it as taste. It is not only taste: the same rule appears three times on one short stretch, and the note mixes two topics. The cost is small, so low severity is right.

## Corrected edit (sharper version of the proposal)

Keep the full rule at line 33, where the reader meets the members. Cut it from the note. Drop the directional sentence from the note; lines 122-124 cover it. The note becomes:

> Roadmap step 0.3, first released in null3D 0.1.0. The format is stable: version 1 holds the members that this page lists.

At line 33, drop the last sentence ("This engine refuses any version that it does not know."), because the table row at line 30 already says it.
