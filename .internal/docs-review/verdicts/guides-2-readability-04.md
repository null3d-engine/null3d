# Verdict: guides-2-readability-04

## The finding as given

- page: guides/performance
- anchor: ## How the engine batches, builds pipelines and times frames, table lines 170-178
- category: wall-of-text
- severity: medium
- claim: Four answer cells are paragraphs of 6 to 15 sentences; the 'Which passes walk the scene?' cell is about 190 words. A table cell cannot hold lists or breaks, and on a phone the column becomes a long thin strip that nobody can scan.
- evidence: line 172 (pipelines, 10 sentences), line 174 (batching, 7 sentences), line 175 (passes, 15 sentences).
- proposedEdit: Keep the table with a one-sentence answer per question, e.g. 'Which passes walk the scene? The culling pass, the opaque pass, and one more pass for each shadow cascade, scene pass, prepass and outline.' Give each long answer its own H3 below the table, with the pass list as bullets. Put the draw-path facts of line 174 (direct versus indirect draws on Apple GPUs, meshes over 65,535 vertices) in <details><summary>Technical details: direct and indirect draws</summary>.

Verdict: partly

## Evidence

- The core problem holds. Lines 172-175 of docs/guides/performance.md are table cells that hold whole paragraphs. Answer-cell word counts: line 172 about 99 words, line 173 about 78, line 174 about 102, line 175 about 209. A table cell cannot hold a list, so the pass list in line 175 is run-on prose. On a narrow screen this is hard to scan. stats.json does not measure table cells, so these counts are mine.
- The sentence counts in the evidence are wrong. Line 172 has 7 sentences, not 10. Line 174 has 6, not 7. Line 175 has 14, not 15. Line 175 is about 209 words, not 190. The cell at line 173 (6 sentences) is the fourth long cell. The evidence does not name it.
- The sample short answer in the proposed edit is wrong, and it would mislead a reader:
  - "The culling pass" is WebGPU only. On WebGL2, and on devices that draw directly, the job workers cull on the CPU (line 175; docs/concepts/architecture.md:92).
  - It leaves out passes that the cell names: the transparent pass, the final tone-map pass, and the occluder depth draw plus the second culling pass of GPU occlusion culling.
  - Outlines draw the outlined meshes twice into a mask. They do not walk the scene. The depth prepass walks only the opaque objects.
- If the table keeps a one-sentence answer and each long answer also gets an H3 below it, the page says each thing twice. Lines 176-178 already have short answers. A simpler change is to keep the table only for the short rows (176-178) and give the four long questions (172-175) an H3 each, or to put all seven questions in H3s and remove the table.
- The full order of passes is already in docs/concepts/architecture.md "The passes of a frame" (lines 87-106), and line 175 links to it. The H3 for passes needs only the ones that add a walk over the scene, as a short bullet list with a link to that section. It does not need to copy the architecture list.
- The proposed details block for draw paths is a good idea, with one condition. Line 175 says "On a device that draws the direct path, the job workers cull on the CPU". This only makes sense if the reader knows that some devices draw directly. So one main-text sentence must stay outside the block, for example: "On some Apple devices the engine draws directly instead, and culls on the CPU." The fact about meshes over 65,535 vertices changes how many draws a mesh costs. It can go in the block, but it is borderline, because it bears on draw-count advice in the "So some common advice does not apply" list below the table.

## Corrected claim

Four answer cells in the table (lines 172-175) are dense paragraphs of 6 to 14 sentences. The passes cell (line 175) is about 209 words, and its list of passes cannot be a real list in a table cell. This makes the section hard to scan, most of all on a phone.

## Corrected edit

- Keep the table only for the three short rows (lines 176-178), or turn all seven questions into H3s and remove the table. Do not keep a one-line answer in the table and the same answer again in an H3.
- Give "What makes the GPU build a pipeline?", "When are pipelines built?", "What does the engine batch by itself?" and "Which passes walk the scene?" an H3 each. Use short paragraphs, and use bullets where the text lists things (the pipeline inputs, the passes).
- Under "Which passes walk the scene?", list the passes as bullets: culling (on the GPU on WebGPU, else on the CPU), the opaque pass, a shadow pass for each cascade and tile that draws, each scene pass, the depth prepass when on (opaque objects only), the two outline mask draws, the occluder draw and second culling pass of GPU occlusion culling, the transparent pass, and the final tone-map pass on the HDR path. Then link to [Architecture](../concepts/architecture.md#the-passes-of-a-frame) for the full order.
- Under "What does the engine batch by itself?", keep this in the main text: one bucket per shading model, mesh and material, one draw per bucket, and that some Apple devices draw directly. Then add:

<details>
<summary>Technical details: direct and indirect draws</summary>

On WebGPU the draw is indirect. On an Apple GPU in Safari, or in any browser on iPhone and iPad, a start-up measurement can find direct draws clearly faster, and the engine then draws directly. `engine.capabilities.directDraws` says which path the engine took, and `engine.capabilities.drawPath` says why. A mesh over 65,535 vertices takes one draw per part, unless it draws its cluster patches, which take one draw.

</details>
