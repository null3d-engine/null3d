# concepts-1-readability-18

Finding as given:

- page: concepts/culling
- anchor: headings at lines 51, 103, 119, 174
- category: scan-order
- severity: medium
- claim: 'Bounds that you set' fixes a common bug (objects that vanish when a shader moves vertices). It sits between the two long occlusion sections, so a reader must pass 50 lines of the GPU occlusion check to reach it, and the two occlusion sections are split apart.
- evidence: stats.json concepts/culling headings
- proposedEdit: Order: How each path culls; What each kind of object culls with; Bounds that you set; Skipping cells out of view (with the short cell text); GPU occlusion culling on WebGPU; Software occlusion culling on WebGL2; What this means for your sketch; Related pages.

Verdict: partly

## Evidence

- docs/concepts/culling.md:51-102 is "GPU occlusion culling on WebGPU" (about 52 lines, with three subsections). Line 103 is "Bounds that you set". Line 119 is "Software occlusion culling on WebGL2". So the bounds section does split the two occlusion sections, and a reader passes the whole GPU occlusion text to reach it. The claim holds.
- Line 46, in "What each kind of object culls with", already links forward to "Bounds that you set". The bounds section belongs right after that list.
- Line 75 links "below" to the software occlusion section, and line 172 links back to the GPU section. Both links read better when the two sections sit next to each other.
- The proposed order is flawed. "What this means for your sketch" (lines 198-219) is about grid cells: "The cells have these limits", 32-bit positions, 64-bit world positions, the 512-cell limit. "Grid cells" (lines 174-183) explains the cell size and the per-cell offsets that this text depends on. The proposed order moves the cell text before occlusion but leaves "What this means for your sketch" after both occlusion sections. That splits the cell material in a new place. "(with the short cell text)" is also vague: "Grid cells" holds the precision content, not only an intro to skipping.

## Corrected claim

"Bounds that you set" sits between the two occlusion sections. It splits them apart and is far from the list at line 46 that links to it. The fix is to move only that section.

## Corrected edit

Move "Bounds that you set" (lines 103-117) to just after "What each kind of object culls with". Keep the rest in its current order: How each path culls; What each kind of object culls with; Bounds that you set; GPU occlusion culling on WebGPU; Software occlusion culling on WebGL2; Grid cells; Skipping cells out of view; What this means for your sketch; Related pages. This joins the two occlusion sections and keeps the three cell sections together. If cells should come before occlusion to follow the top diagram, move all three cell sections as one block, "What this means for your sketch" included.
