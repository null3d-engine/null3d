# Verdict: concepts-1-substance-11

## Finding as given

- page: concepts/lod
- anchor: File lines 23, 29, 37, 59, 93, 97, 99, 103, 107, 109, 111, 113, 115, 117, 119, 125, 127, 129, 139, 145, 160, 169, 184, 198, 211, 215, 221, 233, 235, 237 (stats lines 16-230); the worst are 129 (298 words), 127 (267), 97 (225), 145 (206)
- category: wall-of-text, severity: medium
- claim: The page is 5,956 words with 30 long paragraphs. To learn when a level switches, a reader must get past rules for vertex buffers, provoking vertices, index list sizes and piece planning. Most of that is correct and useful to implementers, but it hides the main rules.
- proposedEdit: Keep one short paragraph per section and move the rest into blocks. 'Cluster levels': lines 109-115 into "Technical details: how each GPU path draws the patches". 'Pieces of a large level': keep 123 and two sentences of 125, put 127-129 into "Technical details: which meshes get pieces". 'Levels from the asset tool': put the MSFT_lod, NULL3D_lod_error and MSFT_screencoverage storage rules and line 99 into "Technical details: how the file stores levels", and the timing rules of line 93 into another block. 'How the engine picks a level': put line 145 into "Technical details: the distance that each kind of level measures".

Verdict: partly

## Evidence

- The line mapping is right. Every stats line plus 7 (the front matter) gives the file line the finding names, for example 122 -> 129, 120 -> 127, 90 -> 97, 138 -> 145. The stats give 30 long paragraphs and 5,956 words.
- The main claim is right in part. The exact switch rule and formula ("How the engine picks a level", line 131-139) come after about 100 lines on asset files, cluster patches (vertex buffer limits at line 113, the provoking-vertex extension at line 115, index list sizes at line 109) and piece planning (lines 123-129). But the reader gets the basic rule earlier: the intro at lines 23-25 ("less than about a pixel"), the diagram at lines 13-21, line 37 (switches where the error covers less than the threshold's pixels), and the three switch measures at lines 43-47. So "to learn when a level switches, a reader must get past ..." overstates it. Only the precise formula and the distance rules are buried.
- The proposed blocks are mostly right. Lines 109, 113, 115 (WebGPU dispatches, 128 MiB bindings, 32-bit copies, the provoking-vertex rule), most of 127, most of 129, the glTF extension names in 97 and the fetch timing in 93 are implementer detail. They fit a block, and the main text still reads with the blocks closed.
- But some of the text the edit sends into blocks is user-facing and must stay in the main text:
  - Line 111: a WebGL2 browser without multi-draw (Firefox) draws whole levels, not patches. A reader needs this.
  - Line 129: the `levels: false` (no pieces) and `levels: 'pieces'` (pieces alone) options, and that water and other see-through surfaces take no pieces. These are API facts. Hiding API options in a collapsed block makes a reader miss them.
  - Line 99: `assets optimize` keeps a file's own levels, such as levels made in Blender. A user wants this fact.
  - Line 97: `assets.loadGltf` gives each mesh its levels with no code, and other glTF loaders draw the full mesh.
  - Line 145: turning the camera never changes a level; a camera inside the bounds keeps full detail; a render pass picks with its own camera, and mirrors and the outline effect pick as the main camera does.
- Part of line 99 repeats other text and can be cut, not blocked. "An error counts as measured only where the file also gives the coverage" appears three times: line 97 ("The loader reads the coverage that comes beside an error to tell a measured error from a hand-set one"), line 99, and line 166 in "Fading between levels".
- "Keep one short paragraph per section" goes too far for sections that the edit does not name, such as "Fading between levels" and "Shadows", where most of the text is the rule itself. The finding lists 30 paragraphs but gives a plan for only about 12 of them. Other good block candidates it leaves out: line 119 (which meshes draw patches, after a one-sentence summary), line 117 (streaming bands), line 184 (the terrain add-on's morph), line 235 (how a bake stores views).

## Corrected claim

The page is 5,956 words with 30 long paragraphs. The intro, the diagram and the first sections give the basic switch rule (the error must cover less than about a pixel), but the exact formula and the rules for which distance each kind of level measures come only after about 100 lines on file storage, cluster patches (vertex buffers, the provoking-vertex extension, index list sizes) and piece planning. That detail is correct and useful to implementers, but it hides the main rules.

## Corrected edit

Use "Technical details: ..." blocks as proposed, but keep the user-facing facts in the main text:

- 'Levels from the asset tool': in line 93, keep the last sentence (a level that the camera never draws costs no download; one that the camera starts to draw arrives) and move the fetch timing into "Technical details: when the loader fetches each stage". In line 97, keep the halving rule, "`assets.loadGltf` gives each mesh its levels, so copies and instance batches pick levels with no code" and "other glTF loaders draw the full mesh". Move the vertex order, the copied vertices and the MSFT_lod / NULL3D_lod_error / MSFT_screencoverage storage into "Technical details: how the file stores levels". In line 99, cut the measured-error rule, which line 166 already gives, and keep in the main text that `assets optimize` keeps a file's own levels (such as levels made in Blender). The integer-step conversion can go in the same block.
- 'Cluster levels': keep lines 103-107 and one summary sentence: "Both GPU paths draw the patches; a WebGL2 browser without `WEBGL_multi_draw`, such as Firefox, and a mesh too large for the engine's limits draw whole levels instead." Move lines 109, 113 and 115 and the rest of 111 into "Technical details: how each GPU path draws the patches". Keep one sentence from line 119 in the main text (only a mesh that one copy draws, outside an instance batch, draws patches; others draw whole levels) and move the rest of 119 and the detail of 117 into a second block.
- 'Pieces of a large level': keep line 123 and the main sentences of 125 (the copy skips pieces outside the view or facing away; the picture is the same). Keep one main-text sentence for the options: "`levels: false` gives a mesh no pieces, and `levels: 'pieces'` asks for pieces alone." Move the rest of 127-129 into "Technical details: which meshes get pieces".
- 'How the engine picks a level': in line 145, keep in the main text that turning the camera never changes a level, that a camera inside the bounds keeps full detail, and which camera a render pass, a mirror and the outline effect pick with. Move the sphere-center, half-radius and cap rule into "Technical details: the distance that each kind of level measures".
- Optional: also move "How the engine picks a level" up so it follows "A material per level". The rule then comes before the asset tool, clusters and pieces.
