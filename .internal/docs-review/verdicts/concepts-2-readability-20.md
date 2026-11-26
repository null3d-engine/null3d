# concepts-2-readability-20

## Finding as given

- page: concepts/render-graph
- anchor: ## Motion vectors, line 104
- category: wrong-claim
- severity: medium
- claim: 'Temporal anti-aliasing, motion blur and reflections that reuse the last frame need them. Today the motion debug view ... reads them.' A reader takes this to mean the engine has TAA or motion blur that reads motion vectors. 'Today' hints at later features. Line 93 says the adapters refuse motionVectors.
- evidence: Line 104. Line 93 'the adapters refuse 'motionVectors''.
- proposedEdit: 'Motion vectors record how far each pixel's surface moved on screen since the last frame. Only the motion debug view, debug.view('motion'), reads them. Add-on features and custom materials cannot read them.' Remove 'Today' and the list of features.
- generatedSource: (none, hand-written page)

Verdict: partly

## Evidence

- docs/concepts/render-graph.md:104 says what the finding quotes. "Today" hints at features to come, and the list of effects can read as features the engine has.
- The engine ships no TAA and no motion blur. packages/engine/src/scene/post.ts:531-535 marks the TAA setting `@internal`, "a prototype ... for measuring only". That prototype does not read motion vectors: "motion" does not occur in post.ts. The porting pages say so too: docs/porting/threejs-mapping.md:256 "null3D has no temporal anti-aliasing", docs/porting/threejs-postprocessing.md:67 "null3D has no SMAA, SSAA or TAA". So the core point holds: the sentence can mislead.
- The table row at render-graph.md:91 already says the motion pass runs "while the motion debug view shows it". That is consistent with "only the debug view reads them".
- The proposed added sentence "Add-on features and custom materials cannot read them" goes too far:
  - Custom materials: true. packages/engine/src/scene/resources.ts:3836-3840 refuses every scene input except 'sceneDepth'.
  - Add-on features: not shown. packages/engine/src/scene/features.ts:421-428 and :891 accept 'motionVectors' in a feature's `reads`. docs/api/features.md:131-133 says "the motion pass runs only while a reader wants the motion vectors" and "The feature side binds its reads when the engine places a registered feature in the frame". Line 93 of the page says only the *adapters* (full-screen effect, custom material) refuse it. A flat "features cannot read them" would contradict the features API page.
  - Line 93 already covers the adapter refusal, so the new sentence repeats it.
- Removing the list of effects entirely loses the reason why motion vectors exist. A short purpose clause plus a plain statement of what ships keeps that context and does not mislead.

## Corrected claim

The sentence hints that the engine has TAA, motion blur or temporal reflections that read motion vectors. It has none of them. Only the motion debug view reads them now. The proposed edit is right to drop "Today", but its new sentence about add-on features is wrong. A registered feature may declare 'motionVectors' in its reads, and only the adapters refuse it (line 93).

## Corrected edit

Replace line 104 with:

"Motion vectors record how far each pixel's surface moved on the screen since the last frame. Effects such as temporal anti-aliasing and motion blur use them, but null3D ships neither. The motion debug view, `debug.view('motion')`, reads them."
