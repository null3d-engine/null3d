# concepts-1-readability-05

## Finding as given

```json
{
 "page": "concepts/lod",
 "anchor": "## Cluster levels (101-119) and ## Pieces of a large level (121-129)",
 "category": "split-page",
 "severity": "medium",
 "claim": "About 2,000 words of buffer limits, browser extensions, index layouts and piece-planning thresholds come before the section on how a level is picked. The engine does most of this by itself. A user needs to know what a tree is, how to make one, and when the engine falls back to whole levels.",
 "evidence": "lod.md:103-129; paragraphs 113, 115, 117, 119, 127 and 129 are 119 to 298 words",
 "proposedEdit": "Move both sections to a new page concepts/lod-clusters 'Cluster trees and level pieces'. On lod.md keep: paragraph 103 plus one sentence on --clusters and --clusters --stages; a bullet list of fallbacks to whole levels (several copies, instance batches, direct-draw path, skinned or morphed meshes, blended or masked materials, WebGL2 without WEBGL_multi_draw); and 2 sentences on pieces. If no split is wanted, wrap 107-119 in a block 'Technical details: how the engine walks and draws a tree' and 127-129 in a block 'Technical details: which meshes get pieces'.",
 "generatedSource": "",
 "id": "concepts-1-readability-05",
 "slice": "concepts-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The problem is real. The two sections run from lod.md:101 to lod.md:129. They hold 1,748 words, not "about 2,000". The page has 5,956 words in all. "How the engine picks a level" starts at lod.md:131, after them. Paragraphs 113, 115, 117, 119, 127 and 129 hold 119, 121, 131, 162, 267 and 298 words (stats.json). Paragraphs 113 and 115 are buffer sizes, 16-bit and 32-bit indices and browser extensions. Paragraphs 127 and 129 are thresholds of the piece plan. The engine applies all of these by itself.
- The split is the wrong first choice:
  - The user's request asks for dense detail to go in collapsible blocks. The task also says to prefer a block.
  - A new page needs an entry in PAGES in tools/lib/docs.ts (the page is listed at docs.ts:105).
  - A split breaks six links from other pages into these sections: guides/testing.md:223, guides/assets-pipeline.md:219, api/geometry.md:303 (all to #cluster-levels), and guides/assets-pipeline.md:191, guides/add-ons.md:73, api/geometry.md:240 (all to #pieces-of-a-large-level).
  - guides/assets-pipeline.md:209-221 already covers how the tree is built, so a third place for the tree adds overlap.
- The proposed list of fallbacks is incomplete. The page names more cases where the engine draws whole levels:
  - a tree from an older asset tool (lod.md:107);
  - a mesh over the 128 MiB vertex binding, trees over the shared 128 MiB of indices, or trees over 65,535 patches on WebGPU (lod.md:113);
  - on WebGL2, a mesh of more than 65,535 vertices on a browser without WEBGL_provoking_vertex (lod.md:115).
  A reader who sees the short list could think the tree draws in those cases too.
- The block alternative puts too much behind the block. Paragraph 117 is a user choice (--clusters --stages, and how maxLevels counts a band). Paragraph 119 is the list of fallbacks that the finding itself says a user needs. Neither belongs behind a closed block. Paragraph 129 also holds the user-facing options `levels: false` and `levels: 'pieces'`. api/geometry.md:250 documents `'pieces'`, but this page should still say what each option does for pieces, outside the block.

## Corrected claim

The two sections hold about 1,750 words of engine internals, such as buffer limits, extensions, index layouts and piece thresholds. They come before the section on how a level is picked. A reader needs what a tree is, how to make it and stream it, and when the engine falls back to whole levels. The rest can go in collapsible blocks. The page does not need a split.

## Corrected edit

Keep the two sections on lod.md, so the six links into them still work.

Cluster levels:
- Keep 103 and 105 in the main text.
- Put the internals of 107-115 in one block, "Technical details: how the engine walks and draws a tree". This covers the walk rule, the WebGPU compute pass and its list, the ranges of the WebGL2 multi-draw, the 128 MiB and 65,535-patch limits, and the vertex copy with WEBGL_provoking_vertex.
- In the main text, keep one sentence each: WebGPU picks patches in a compute pass, and WebGL2 with WEBGL_multi_draw picks them on the job workers.
- Shorten 117 (streaming with --clusters --stages, and how maxLevels counts a band) to about three sentences in the main text.
- Turn 119 into a bullet list in the main text. List every case where whole levels draw: several copies at once; an instance batch, even with one row; the WebGPU path that draws objects directly; skinned or morphed meshes; materials that blend or mask; WebGL2 without WEBGL_multi_draw, such as Firefox; a mesh too large for the tree's buffers (details in the block); on WebGL2, a mesh of more than 65,535 vertices without WEBGL_provoking_vertex; a tree from an older asset tool.

Pieces of a large level:
- Keep 123 and 125 in the main text.
- Put 127 and the planning detail of 129 in one block, "Technical details: which meshes get pieces".
- Keep two sentences outside the block: `levels: false` gives a mesh no pieces, and `levels: 'pieces'` asks for pieces alone. Link the second to api/geometry.md.
