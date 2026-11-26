# Verdict for api-1-readability-09

## The finding as given

- page: api/features
- anchor: ## Adapters (line 282); banner (line 11); Mermaid (lines 13-24)
- category: scan-order
- severity: medium
- claim: A reader writes a description to get work into a frame, so the call that turns each kind into work is the first thing they need. It sits in the second-to-last section. The banner half-covers it in five crowded sentences, and the diagram shows only two of the five adapters.
- evidence: features.md:11 names three adapters. :284 says 'Five exist'. The diagram shows only addFeatureDraw and addFeatureEffect.
- proposedEdit: Move 'Adapters' to sit right after the opening paragraph (line 26), as a table Kind | Frame point | Call | Page for draws, instance draws, full-screen effects, compute passes and sky layers. Keep the 'no hook' table at the end under 'Limits'. Cut the banner to the standard first sentence. Add the instance, compute and sky-layer adapters to the diagram.

Verdict: partly

## Evidence

- docs/api/features.md:11 names three adapters (`scene.addFeatureDraw`, `post.addFeatureEffect`, `render.addPass`). True.
- docs/api/features.md:284 says "Five exist" and lists five (lines 286-290). True.
- The diagram (lines 13-24) has nodes for `scene.addFeatureDraw` and `post.addFeatureEffect` only. True.
- "Second-to-last section" is wrong. `## Adapters` is heading 14 of 18. `## Checks`, `## Errors`, `## Related pages` and `## API reference` follow it. The point holds anyway: the section comes after eleven sections of field detail.
- "Five crowded sentences" is wrong. The banner has seven sentences.
- "Cut the banner to the standard first sentence" goes too far. The docs check (tools/lib/docs.test.ts:90 and :135-138) requires the banner to start "Roadmap step 0.3, first released in null3D 0.1.0." Every other API banner also keeps "The API is experimental, so it can still change between versions." (controls.md:11, lights.md:11, feature-draws.md:11). Cutting the experimental sentence would make this page the odd one out and drop a real warning.
- The table rows check out against the adapter pages: draws are `'draw'` at opaque, transparent or resolve (feature-draws.md:11); instance draws are `'draw'` at `'opaque'` (feature-instances.md:28); full-screen effects are `'fullscreen'` at `'resolve'` (features.md:288); compute passes are `'compute'` (render.md compute passes); sky layers are `'draw'` at `'background'` (scene.md sky layers). So a Kind | Frame point | Call | Page table is accurate.
- The adapter bullets (lines 286-290) refer to bands, order, `ready`, scene resources and outputs, which the page defines later. So the short table can move up, but the dense per-adapter rules should stay below the sections that define those words.

## Corrected claim

The adapter list, which tells a reader which call turns each kind into frame work, sits late on the page (heading 14 of 18), after all the field detail. The banner names three of the five adapters across seven sentences, and the diagram shows two of the five.

## Corrected edit

- Put a short table (Kind | Frame point | Call | Page) for the five adapters right after the opening paragraph (line 26), before "Writing a description".
- Keep the per-adapter rules from lines 286-290 in the later `## Adapters` section, or put them in one `<details>` block under the table with the summary "Technical details: what each adapter places and refuses". The main text must still read well with the block closed.
- Keep the "no hook" table at the end, under its own heading such as "Limits".
- Cut the banner to the two standard sentences: "Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions." Do not cut it to the first sentence only.
- In the diagram, either add nodes for `scene.addComputeInstances`, `render.addPass` (compute) and `scene.setSkyLayer`, or join all five into one "the five adapters" node, so the diagram stops showing only two.
