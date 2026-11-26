# Verdict on api-1-readability-11

## Finding as given

- page: api/animation
- anchor: ### Load cost (lines 50-52); line 183; lines 358-374; ## Clips (389-402); ## Skinned meshes (420-424); line 442
- category: technical-details-block
- severity: medium
- claim: These passages are correct implementer detail in the main flow: benchmark load times, V8 boxing of fractions, the skinning pass's skip rules, the list of pointers the loader leaves out, and the bytes per key. They hide the facts that a user needs to act on.
- evidence: animation.md:52 gives KayKit Knight timings. :358 explains browser inlining and 12-byte number objects. :420-422 give per-path skinning internals. :183 lists ten unread pointer kinds in prose.
- proposedEdit: Add details blocks: 'Technical details: how clips load' (line 50 after its first and fourth sentences, plus line 52). 'Technical details: pointers the loader leaves out' (line 183 as bullets; keep the first sentence and the warning). 'Technical details: keeping a crowd's weights from boxing' (lines 358-374; keep one sentence of advice). 'Technical details: how each GPU path skins' (lines 420-424; keep that every material skins in the vertex shader, that a shared mesh and material draw in one instanced draw, and the warmUp advice). 'Technical details: what a still character costs' (line 442 tail). The key storage of 'Clips' goes in a details block too.

Verdict: partly

## Evidence

- The passages say what the finding says. animation.md:52 gives the Knight's 16.5 ms and 8 ms timings. :358 explains inlining and 12-byte number objects. :420-422 give per-path skinning detail. :442 gives the cost of a still character. :397 gives bytes per key. stats.json lists :358 (117 words), :420 (151 words, 10 sentences), :422 (144 words, 10 sentences) and :183 (121 words, 9 sentences) as long paragraphs. So most of the finding holds.
- Line 183 lists about eight kinds of pointer, not ten. This is a small error.
- Line 52 is mostly a copy of guides/assets-pipeline.md:105, which gives the same Knight timings (8 ms against 16.5 ms). Line 52 already links to that page. The timings can be cut here instead of being put in a block. The first sentence of line 52 is advice that readers act on: run `assets optimize` so clips load as plain copies. The proposal puts all of line 52 in the block, which hides that advice. It must stay in the main text.
- The 'how each GPU path skins' block breaks the rule that the main text must make sense with every block closed. Line 422 is the only place that defines "the skinning pass". The main text names it again at :442, at :446 (Limits of skinning, first bullet) and at :465 (morph targets). If :422 goes into a block, those lines name a pass that the reader cannot see. :424 also has facts that readers need: a swinging limb never leaves the mesh's bounds, and skinned meshes cast and receive shadows that follow their poses. The proposal does not keep these facts.
- In 'Clips', the bullets at :395-396 are facts that users act on. Clips exported at 24, 25 or 30 frames per second lose nothing. A clip at 60 keys per second keeps every second key and can cut corners. These facts affect how a user exports clips. Only the bytes per key (:397) and the noise threshold (:398) are implementer detail. "The key storage goes in a block" is too vague and would hide :395-396.
- The 'boxing' block is acceptable. A code block inside a details block breaks no rule. The one kept sentence must tell readers what to do: call the joint calls from a small function that takes only objects and whole numbers.

## Corrected claim

Most of these passages are correct implementer detail that should go in collapsible blocks. Line 52's timings repeat the asset pipeline guide and can be cut here. Some facts must stay in the main text: the advice to run the optimizer, the export-rate bullets in 'Clips', a one-sentence definition of the skinning pass, and the bounds and shadow facts of skinned meshes. The main text refers to these facts elsewhere, or readers act on them.

## Corrected edit

- Load cost: keep line 50's first and fourth sentences in the main text, and the first sentence of line 52 with its link. Put the rest of line 50 in 'Technical details: how clips load'. Cut the Knight timings, because assets-pipeline.md#what-it-does-to-clips already gives them.
- Line 183: keep the first two sentences in the main text. Put the list in 'Technical details: pointers the loader leaves out' as bullets, and keep the last sentence, about per-map transforms, in the block.
- Lines 358-374: keep one sentence of advice in the main text: "To keep a crowd's per-frame weights from making garbage, call the joint calls from a small function that takes only objects and whole numbers." Put the reason, the code sample and line 374 in 'Technical details: keeping a crowd's weights from boxing'.
- Skinned meshes: keep in the main text that every material skins in the vertex shader, that skinned meshes that share a mesh and a material draw in one instanced draw, and the warmUp advice. Also keep one sentence that defines the skinning pass: "On WebGPU, a compute pass, the skinning pass, skins morphed meshes and meshes that a debug view or a full shader draws, once per frame." Keep line 424's last sentence and its "a limb that swings out never leaves the mesh's bounds" fact. Put the rest of 420-422 (per-frame upload size, the measured speed, the skip rules, the `?skinning=compute` switch) and the culling method of 424 in 'Technical details: how each GPU path skins'.
- Line 442: keep the first five sentences in the main text. Put the rest in 'Technical details: what a still character costs'.
- Clips: keep lines 393-396 and 400-402 in the main text. Put only lines 397-398 (bytes per key and the threshold for a still track) in 'Technical details: how clips store keys'.
