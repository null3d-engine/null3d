# guides-1-readability-26

## The finding as given

```json
{
 "page": "guides/assets-pipeline",
 "anchor": "## Blockers and stored trees (line 107)",
 "category": "heading-depth",
 "severity": "low",
 "claim": "Blockers serve WebGL2 occlusion culling; stored trees serve raycasts. A reader who wants --bvh will not look under a heading that leads with blockers.",
 "evidence": "line 109 opens on WebGL2 occlusion; line 128 opens 'Raycasts walk a tree over each mesh's triangles.'",
 "proposedEdit": "Under one H2 'Blockers and raycast trees', add '### Blockers' (lines 109-126) and '### Stored raycast trees' (line 128). Keep line 130 at the end.",
 "generatedSource": "",
 "id": "guides-1-readability-26",
 "slice": "guides-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/guides/assets-pipeline.md:107 The heading already names both topics: "Blockers and stored trees". A reader who scans the outline sees "stored trees". The claim that a reader "will not look" there is too strong. The real gap is smaller: "stored trees" does not say that the trees are for raycasts.
- The section mixes two features. Lines 109-126 are about blockers for WebGL2 occlusion culling. Line 128 is about raycast trees (`--bvh`). Line 130 covers both ("The file keeps both in extensions..."). Subheadings would help a little.
- docs/guides/assets-pipeline.md:66 The `--bvh` row of the options table has no link to this section. Other rows link to their sections (`--clusters` to Cluster levels, `--no-roughness-bake` to The roughness bake). This missing link is the better fix for a reader who looks for `--bvh`.
- The proposed H2 rename breaks three links to the anchor `#blockers-and-stored-trees`: docs/guides/performance.md:232 (this one is about raycast trees), docs/guides/performance.md:288 and docs/concepts/culling.md:155. The edit does not say to update them.
- "Keep line 130 at the end" puts that sentence under the new "Stored raycast trees" H3. But the sentence is about both blockers and trees, so it would then sit under the wrong subheading.

## Corrected claim

The section covers two features: blockers for WebGL2 occlusion culling and stored raycast trees. The heading names both, but "stored trees" does not say that the trees serve raycasts. The `--bvh` row in the options table does not link to the section. Subheadings and a link would make the trees easier to find. Low severity.

## Corrected edit

- Keep the H2 "Blockers and stored trees". Its anchor then stays the same for the three links from performance.md and culling.md. If you rename it, update those three links too.
- Move the line 130 sentence up to sit directly under the H2, as a short intro that covers both features. Then add "### Blockers" (lines 109-126) and "### Stored raycast trees" (line 128).
- In the options table, link the `--bvh` row to `#stored-raycast-trees` and the `--no-blockers` row to `#blockers`. Change docs/guides/performance.md:232 to link to `#stored-raycast-trees`.
