# Verdict: api-3-substance-23

## Finding as given

- page: api/textures
- anchor: lines 107, 126, 224, 228, 236, 242, 254, 258, 260, 268
- category: long-paragraph, severity: medium
- claim: Ten long paragraphs. 224 (how arrays grow and shrink, 163 words) and 228 (WebGL2's 16 textures and which maps drop, 141 words) are useful for implementers but heavy for the main flow.
- evidence: stats.json api/textures (100, 119, 217, 221, 229, 235, 247, 251, 253, 261 in its count).
- proposedEdit: Keep the first two sentences of 224 and the advice at 226. Put the rest of 224 in <details><summary>Technical details: how texture arrays grow</summary> and 228 in <details><summary>Technical details: maps per material on WebGL2</summary>. Make 258 a table of bytes per texel by format.

Verdict: partly

## Evidence

- stats.json lists ten long paragraphs for api/textures. Its line numbers sit 7 lines before the generated page's lines. The finding's line numbers match docs/api/textures.md in the generated copy. Word counts: 224 = 163 words, 9 sentences; 228 = 141 words, 8 sentences; 258 = 110 words, 9 sentences; 268 = 109 words; 236 = 96 words. The other five (107, 126, 242, 254, 260) are 62 to 73 words.
- 224 (docs/api/textures.md:224) does mix one user fact (an array holds at most 256 layers and 128 MiB) with growth, copy, shrink and move details. A block for the growth detail is right.
- The proposal's "first two sentences" of 224 is the wrong cut. Sentence 2 ("It starts with room for a few textures, at most 8 MiB of them, and doubles its layers when it is full") is the growth detail itself. The sentence that a reader needs in the main flow is the overflow one: "When a size has more textures than an array holds, another array holds the rest."
- 228 (docs/api/textures.md:228) is not only implementer detail. It says that on WebGL2 a material with more than six map groups draws without some of its maps. That is visible behavior. If the whole paragraph goes into a closed block, a WebGL2 user who sees a map vanish finds nothing in the main text. The rule "the main text must make sense with every block closed" needs one sentence of it left outside.
- The finding counts ten paragraphs but proposes edits for three. 236 (96 words) ends with two KTX2 sentences that are implementer detail. 268 (109 words) splits cleanly after its second sentence. The five paragraphs of 62 to 73 words read well and need no change.
- 258 (docs/api/textures.md:258) gives bytes per texel for four format groups in running prose. A small table is clearer. Its last three sentences (free layers and the old array in `textures.memoryBytes`) are not per-format and stay as prose.

## Corrected claim

Ten paragraphs pass the length limit. 224 and 228 hold useful detail that can move into blocks, but 228 states a visible WebGL2 behavior (maps drop past six groups) that must keep one sentence in the main text. 236 and 268 also need a split. The five paragraphs of 62 to 73 words need no change.

## Corrected edit

- 224: keep in the main text: "An array holds at most 256 layers, the most that an iPad allows, and at most 128 MiB. When a size has more textures than an array holds, another array holds the rest." Move the rest (start size, doubling, copy, one frame of both, shrink, and the textures that get their own array) into `<details><summary>Technical details: how texture arrays grow and shrink</summary>`. Keep 226 as it is.
- 228: keep in the main text: "On WebGL2 a standard material samples at most six groups of maps. Past six, it draws without the maps that change its look least." Move the rest (16 textures per stage, how maps share a group, the drop order, transmission and thickness maps, the glTF case) into `<details><summary>Technical details: maps per material on WebGL2</summary>`.
- 236: end the main paragraph after "The engine frees its copy of data once the upload is done." Move the two KTX2 sentences into the KTX2 section's upload notes, or into a short block.
- 268: break after "A texture from a file loads its file again." Start a new paragraph with the phone and tablet copies and `keepTextureCopies`.
- 258: keep the first two sentences as prose. Put bytes per texel in a table (rgba8unorm and rgb9e5ufloat 4, rgba16float 8, compressed 1, etc2-rgb8unorm 0.5). Keep the `textures.memoryBytes` sentences as a short paragraph after it.
