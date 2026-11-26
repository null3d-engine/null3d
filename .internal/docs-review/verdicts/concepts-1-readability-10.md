# concepts-1-readability-10

## Finding as given

- page: concepts/lod
- anchor: heading order, lines 27-239
- category: scan-order
- severity: medium
- claim: A newcomer reads levels in code, by hand, per material, asset tool, cluster trees and pieces (about 3,500 words) before 'How the engine picks a level'.
- evidence: stats.json concepts/lod headings
- proposedEdit: Order: opening; How the engine picks a level; Levels of meshes made in code; Give a mesh its levels by hand; A material per level; Levels from the asset tool; Fading between levels; The bias of one object; Small objects; Distance bands; Shadows; See the levels; Cards beyond the levels; Cluster levels and Pieces (or a link to their new page); Related pages.

Verdict: partly

## Evidence

- Heading order in docs/concepts/lod.md: Levels of meshes made in code (27), Give a mesh its levels by hand (41), A material per level (61), Levels from the asset tool (77), Cluster levels (101), Pieces of a large level (121), How the engine picks a level (131), then bias, fading, small objects, bands, see the levels, shadows, cards, API reference (239).
- Lines 27-130 hold about 3,190 words; with the opening, about 3,500 words come before line 131. The two advanced sections, Cluster levels and Pieces (lines 101-130), hold about 1,750 of them. So the core claim holds: a reader meets the deep cluster and pieces detail before the selection rule.
- The proposed order breaks a dependency. "How the engine picks a level" (131-149) is written in terms of "a level given by its error", "by its distance" and "by its coverage". Those three measures are first defined in the bullet list of "Give a mesh its levels by hand" (lines 43-47). Put first, the picking section would use terms the reader has not met.
- The page has no "Related pages" heading. It ends with "API reference" (239).
- The Shadows section (line 227) says "A cluster tree picks its patches in each shadow map by the same rule". If cluster levels move to the end, that line becomes a forward reference and needs a link to the moved section.

## Corrected claim

The page puts about 1,750 words of cluster-tree and pieces detail (lines 101-130) before the rule that picks a level (line 131). The basic sections before it (code, by hand, material, asset tool) are fine to read first, and "Give a mesh its levels by hand" must stay before the picking rule, because it defines the error, distance and coverage measures that the rule uses.

## Corrected edit

Order: opening; Give a mesh its levels by hand; How the engine picks a level; Levels of meshes made in code; A material per level; Levels from the asset tool; Fading between levels; The bias of one object; Small objects; Distance bands; Shadows; See the levels; Cards beyond the levels; Cluster levels; Pieces of a large level; API reference.

A lighter alternative keeps the first four sections where they are and only moves Cluster levels and Pieces of a large level to after "Cards beyond the levels". In both cases, the Shadows line about cluster trees links to the moved Cluster levels section.
