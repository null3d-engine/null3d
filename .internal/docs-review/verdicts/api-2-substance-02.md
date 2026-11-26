# Verdict for api-2-substance-02

## Finding as given

- id: api-2-substance-02 (slice api-2, role substance)
- page: api/impostors
- anchor: ## Make a card read as its mesh (lines 135-141), baker bullet (163-165), ## Bake several views (189-191)
- category: internal-note, severity: high
- claim: The page tells the history of the maintainers' showcase island: 'The island's trees once baked a card...', 'their hand bakes read as stacked plates there; the engine's bake is their card now', 'The island's five plants bake...'. This is a changelog of an internal project, not what holds now.
- evidence: docs/api/impostors.md:135-141, 163-165, 189-191; AGENTS.md Writing docs: states what holds now, leave when it happened to git.
- proposedEdit: Delete 135-141 and keep one present-tense sentence: 'A card that is brighter or flatter than its mesh reads as another species at the hand-over; most of the difference comes from how the crown lights.' End the baker bullet with 'A hand-painted card holds up only while it covers a few tens of pixels.' Replace the island figures with a neutral example (five by five grid at 128 texels: two 640-pixel-square atlases, 3.3 MB). Put any measured figures in a <details> block, 'Technical details: how a card was measured against its mesh'.

Verdict: partly

## Evidence

- docs/api/impostors.md:136-141 is history. "The island's trees once baked a card as one unlit side view ... that card was 34 to 79 per cent brighter" describes a card that no longer exists. AGENTS.md "Writing docs" (line 15 of that section): "states what holds now ... Leave when it happened to git." This part holds.
- docs/api/impostors.md:164-165 is history too: "their hand bakes read as stacked plates there; the engine's bake is their card now". This part holds.
- docs/api/impostors.md:189-191 is NOT a changelog. "The island's five plants bake a five by five grid at 128 texels a cell ..." is present tense and states what the demo does now. The finding is wrong to group it with the other two.
- The island is not an internal project. It is a published showcase demo: examples/demos.ts:183-186 (name 'island', group 'Showcase', code 'showcase/island/'). Its far trees use the engine's octahedral cards now: examples/showcase/island/models.ts:5, 21, 44; examples/showcase/island/trees.ts:5, 585-594. So a present-tense reference to it is a real, checkable example for a reader, and it can carry a demo link.
- The measured figures at 138-140 describe the old card, not a current one. Moving them to a <details> block keeps history, only hidden. The how-to-measure procedure already sits in the last bullet (lines 166-169), so nothing a reader needs is lost if they go.

## Corrected claim

Two passages tell history and break the "what holds now" rule: lines 136-141 (an old one-view card and its measured errors) and the end of the baker bullet, lines 164-165 ("... the engine's bake is their card now"). Lines 189-191 are a present-tense fact about the published Island showcase demo and are fine. The island is a public demo, not an internal project.

## Corrected edit

- Lines 135-141: keep a present-tense statement of the fault and its cause, for example: "A card that draws a different picture from its mesh reads as another species at the hand-over. The difference shows most in how the crown lights, not in its outline. A card baked as one side view, with one normal over each face, lights brighter and flatter than its mesh, because it lights as no surface of the tree does." Drop the old card's measured percentages; do not move them into a <details> block, because they describe a card that no longer exists. The check in lines 166-169 already tells the reader how to measure a card.
- Lines 163-165: end the bullet after "Keep a hand bake only for a card that never covers more than a few tens of pixels." Optionally add a present fact: "A card at 140 to 215 pixels needs the engine's bake."
- Lines 189-191: keep the Island example and link it to the demo: https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/ . If the build-time figures are dense, a <details> block "Technical details: the Island's card budget" may hold the atlas size, memory and bake time.
