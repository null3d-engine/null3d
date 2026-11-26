# guides-1-readability-25

## Finding as given

- page: guides/baked-light-data
- anchor: note under the title, line 11
- category: duplication
- severity: medium
- claim: The note is four sentences. Two repeat line 33's versioning rules. The last, on directional light maps and normal maps, is a feature description unrelated to stability and repeated at line 124.
- evidence: line 11; line 33 'The `version` number changes only when a reader that predates the file would read it wrongly.'
- proposedEdit: Cut the note to 'Roadmap step 0.3, first released in null3D 0.1.0. The format is stable: version 1 holds the members that this page lists.' Keep the versioning rules at line 33 only.

Verdict: partly

## Evidence

- docs/guides/baked-light-data.md:11 has four sentences. The second sentence's clause "a reader ignores members that it does not know" repeats line 33 word for word. The third sentence ("A change that an earlier reader would misread takes a new version number") restates line 33's "The `version` number changes only when a reader that predates the file would read it wrongly."
- The fourth sentence (directional light map and normal map) has no link to the stability promise. Line 124 explains the same behavior in full ("A normal map's relief then brightens where it faces the light of the bake...").
- The proposed edit keeps the opening "Roadmap step 0.3, first released in null3D 0.1.0." The docs check requires it: tools/lib/docs.ts:651-658 refuses a stable or experimental page whose note does not start with that sentence. 103 pages use the same opening, so "Roadmap step" is the house convention, not a banned process word. The edit also keeps "The format is stable", which is the note's job. It breaks no rule.
- What does not hold: severity. The cost is two repeated sentences and one out-of-place sentence in a short note. Line 33 says the same rules clearly a few lines below, and line 124 explains the feature in context. A reader is not misled or blocked, and the page is not much harder to read. That is low (polish), not medium.

## Corrected claim

The claim and the edit hold. Severity is low, not medium: the repeats cost a reader a few seconds and mislead no one.

## Corrected edit

None. The proposed edit is right.
