# concepts-2-readability-01

## Finding as given

- page: concepts/quality-presets
- anchor: ### Texture memory (lines 182-206)
- category: structure
- severity: high
- claim: The H3 'Texture memory' also holds the anti-aliasing paragraph (204) and the engine memory maximum paragraph (206). The H2 'The settings of each preset' opens with four paragraphs that have no headings: pixel ratio, shadow memory and its table, anisotropy and uploads. A reader who scans the outline for anti-aliasing finds nothing.
- evidence: Line 204 'Low smooths edges with FXAA, and the other presets with MSAA.' and line 206 'The engine makes its memory while it tests the GPU paths.' both follow the mip-drop text and come before '### Moment transparency'.
- proposedEdit: Give each topic its own H3 under the H2: 'Pixel ratio cap' (167), 'Shadow memory' (169-178), 'Texture filtering and uploads' (180), 'Texture memory' (182-202), 'Anti-aliasing' (204), 'Engine memory' (206), then the existing H3s.

Verdict: partly

## Evidence

- docs/concepts/quality-presets.md outline: H2 "The settings of each preset" at 161, H3 "Texture memory" at 182, H3 "Moment transparency" at 208. Nothing between them.
- Line 204 (anti-aliasing: FXAA on Low, MSAA elsewhere, the `antialias` option, how the start-up check moves the mode) and line 206 (the memory maximum and the `memory` option) sit under "Texture memory". Neither is about texture memory. The structural claim holds.
- Lines 167, 169-178 and 180 sit under the H2 with no H3, as the finding says. Lines 163 and 165 are the H2's intro and need no heading.
- The page's outline has no "anti-aliasing" entry. Line 32 names anti-aliasing as one of the preset settings, so a reader expects to find it. The tables page (concepts/quality-preset-tables.md:49) has an anti-aliasing row, but only as a value, not the explanation on line 204. So the gap is not handled elsewhere.
- Inbound links to this page use #texture-memory (6), #the-settings-of-each-preset (7) and #moment-transparency (2). The proposed H3s keep those anchors, so no link breaks. AGENTS.md:226 asks for sentence case; the proposed titles comply.

## What does not hold

- Severity. No sentence misleads: each paragraph is correct and readable in place. The cost is a misfiled section that makes the outline harder to scan. That is "clearly harder to use", so medium, not high.
- The "Engine memory" H3 would hold one paragraph of two sentences. Its topic, the memory maximum, is already introduced in the H2 intro (line 163 ends "The memory maximum is fixed before the engine loads."). A heading named "Engine memory" also reads close to "Texture memory" and "Shadow memory".

## Corrected claim

The H3 "Texture memory" wrongly holds the anti-aliasing paragraph (204) and the memory maximum paragraph (206), and the first three settings under the H2 (pixel ratio 167, shadow memory 169-178, filtering and uploads 180) have no headings. A reader who scans the outline for anti-aliasing finds nothing. Severity: medium.

## Corrected edit

Add H3s under "The settings of each preset": "Pixel ratio cap" (167), "Shadow memory" (169-178), "Texture filtering and uploads" (180), keep "Texture memory" (182-202), and add "Anti-aliasing" (204). Move line 206 up to follow line 163 in the H2 intro, beside the sentence that already names the memory maximum, instead of giving it its own H3. If a heading is wanted, call it "Memory maximum", the term the page uses.
