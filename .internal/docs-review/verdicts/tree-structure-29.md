# tree-structure-29

## Finding as given

```json
{
 "page": "concepts/lod",
 "anchor": "## Levels of meshes made in code",
 "category": "scan-order",
 "severity": "low",
 "claim": "The LOD concept page opens with how-to steps, and the model ('How the engine picks a level') is the seventh section.",
 "evidence": "concepts/lod sections: Levels of meshes made in code | Give a mesh its levels by hand | A material per level | Levels from the asset tool | Cluster levels | Pieces of a large level | How the engine picks a level ...; 30 long paragraphs.",
 "proposedEdit": "Move 'How the engine picks a level', 'Fading between levels' and 'Distance bands' to the top, after the diagram. Put 'Cluster levels' and 'Pieces of a large level' in <details> blocks.",
 "generatedSource": "",
 "id": "tree-structure-29",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

- The section count holds. "How the engine picks a level" is the seventh `##` section (docs/concepts/lod.md:131). "Cluster levels" (line 101) and "Pieces of a large level" (line 121) come before it.
- The page does not open with how-to steps. Lines 13-25 hold the Mermaid diagram and two paragraphs of plain model: a level is a simpler copy with an error, it switches where the error covers under about a pixel, and the engine picks per object and per instance row on the GPU or the job workers. This is the shape the "Writing docs" rule asks of a concept page (AGENTS.md: "A concept page opens with a Mermaid diagram and a plain explanation, followed by examples"). The first section (line 27) is what happens by default, and it already states the pixel threshold rule (line 38).
- The proposed move breaks forward references:
  - "How the engine picks a level" (lines 131-149) speaks of a level "given by its error", "given by its distance" and "given by its coverage". Those three kinds are first defined in "Give a mesh its levels by hand" (lines 43-47). Above that section, the reader meets them undefined.
  - "Fading between levels" (lines 162-184) relies on "measured error", "hand-set error" and on `mesh.setLevels(levels, { fade: false })`. `setLevels` first appears at line 43.
  - "Distance bands" (line 202) is about `setDrawRange`, a separate visibility feature. It is not part of how a level is picked, so it does not belong at the top as "the model".
- Whole sections in `<details>` do not fit the block rules. A heading cannot go inside a block, so the headings would stay outside with nothing visible under them. That fails "the main text must make sense with every block closed". Other pages link to both anchors: guides/add-ons.md:73, guides/assets-pipeline.md:191 and 219, api/geometry.md:240 and others. The sections must keep a visible lead paragraph.
- What is fair: "Cluster levels" and "Pieces of a large level" are advanced, dense sections. They sit between the basic setup and the picking rule, and push the rule down. Their later paragraphs are implementation detail (compute dispatches, WebGL2 multi-draw ranges, vertex buffer limits, streamed bands, copy counts, piece eligibility rules). That detail suits collapsible blocks.

## Corrected claim

The page opens with the diagram and a short model, as the concept page rule asks. But two advanced sections, "Cluster levels" and "Pieces of a large level", sit before the full picking rule, so the rule is the seventh section.

## Corrected edit

Keep the first four sections in place, since they define the level kinds that the picking rule and fading use. Move "Cluster levels" and "Pieces of a large level" down, to after "Shadows" and before "Cards beyond the levels". "How the engine picks a level" then becomes the fifth section, right after the sections that define its terms. Keep each moved heading and its first paragraph visible, so the inbound anchors and the main text still work. Put the rest in one block per section:

- Cluster levels: keep line 103 (what a cluster tree is) and line 105 (how the asset tool builds it) visible. Put lines 107-119 (the selection rule, the WebGPU passes, the WebGL2 multi-draw path, the vertex limits, streamed bands, copy counts) in `<details><summary>Technical details: how the engine draws a cluster tree</summary>`.
- Pieces of a large level: keep line 123 visible. Put lines 125-129 (the skip rules, smaller lists, meshes made in code) in `<details><summary>Technical details: which meshes get pieces and how they skip</summary>`.

Leave "Fading between levels" and "Distance bands" where they are.
