# Verdict: guides-2-readability-08

## The finding as given

- page: guides/loading-screens
- anchor: H2 outline
- category: scan-order
- severity: medium
- claim: '## The first frame' (line 151), which says when to remove the screen, comes after the pipelines section and its H3. '## Textures after the loading screen' (line 234), about the same first frames, sits near the end. Start topics and play topics alternate, so the page does not follow the order a loading screen runs in.
- evidence: stats.json headings: Report progress, Show progress, Pipelines and warm-up, Repeat visits, The first frame, The preset check, A later loading stage, Loading everything up front, A change of preset, Textures after the loading screen, Measure the warm-up.
- proposedEdit: Order: Report progress from the sketch; Show progress on the page; The first frame; Textures after the loading screen; Pipelines and warm-up (with Repeat visits); The preset check; Loading everything up front; A later loading stage; A change of preset; Measure the warm-up. Update 'as the next section says' at line 153.

Verdict: partly

## Evidence

The first half of the claim is wrong. In a real start, the pipelines are built before the first frame, so "Pipelines and warm-up" before "The first frame" is the correct run order:

- The flowchart at the top of the page (lines 17-18) runs "await scene.warmUp(): the GPU builds its pipelines" and then "engine.firstFrame resolve: remove the loading screen".
- Line 141: "The first frame waits until every pipeline that it needs is built".
- Line 153: firstFrame resolves "with every pipeline built".
- Line 155, in "The first frame", explains `scene.warmUp()` and pipeline builds. It depends on the pipelines section that comes before it. If "The first frame" moved above "Pipelines and warm-up", this paragraph would use terms that the page has not explained yet.

So the proposed order breaks the run order that the finding asks for, and it puts the explanation of warm-up after the section that uses it.

The second half holds. Texture uploads happen over the first frames after the loading screen goes (flowchart line 19, "Textures upload over the first frames"). But "Textures after the loading screen" (line 234) sits after "A later loading stage", "Loading everything up front" and "A change of preset". Those three are about play or optional set-up, so a reader who wants to know when to remove the screen must skip three sections. Line 176, at the end of "The preset check", already says the check "waits while textures upload". That makes the textures section a natural next step there.

"Loading everything up front" before or after "A later loading stage" is a small matter. Line 215 names "A later loading stage" by title, so either order works.

## Corrected claim

The page follows the run order up to the preset check: progress, pipelines and warm-up, first frame, preset check. Only "Textures after the loading screen" is out of place. It is about the first frames after the screen goes, but it sits near the end, after three sections about play and options.

## Corrected edit

Move only the textures section. New H2 order: Report progress from the sketch; Show progress on the page; Pipelines and warm-up (with Repeat visits); The first frame; The preset check; Textures after the loading screen; A later loading stage; Loading everything up front; A change of preset; Measure the warm-up.

With this order, "as the next section says" at line 153 still points to "The preset check", so it needs no change. Severity is low: the move is polish, and no reader is misled.
