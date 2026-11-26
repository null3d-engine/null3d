# porting-shaders-substance-07

## Finding as given

- Page: porting/threejs-mapping, shaders/library
- Anchor: mapping row 'FXAAPass / FXAAShader / SMAAPass / TAARenderPass / SSAARenderPass' ('a prototype that does not ship ... (D-206)'); row 'TRAANode / traa() / TAAUNode' ('The temporal resolve's prototype ... measured'); library SPECULAR_AA_LIMIT ('(D-79)')
- Category: internal-note. Severity: high.
- Claim: Decision record numbers and the history of a prototype that was measured and dropped are maintainer notes. AGENTS.md forbids them in docs/.
- Evidence: docs/data/threejs-mapping.json:1762,1773; crates/null3d-shaders/wgsl/lib/lighting.wgsl:19; AGENTS.md 'Writing docs'
- Proposed edit: Mapping: replace the prototype sentences with 'null3D has no temporal anti-aliasing of a moving view. A view that holds still blends jittered frames into a sharper picture by itself.' Library: delete '(D-79)'. Extend the docs style check to block 'D-<number>' and 'prototype' in generated pages and their sources.
- Generated source: docs/data/threejs-mapping.json; crates/null3d-shaders/wgsl/lib/lighting.wgsl

Verdict: partly

## Evidence

- The text is there as the finding says. docs/porting/threejs-mapping.md:255 ends with "TAA of a moving view is a prototype that does not ship: ... measured and did not pass (D-206)". Line 256 says "The temporal resolve's prototype passes the engine's own paths, and its quality against the reference was measured ... so no version ships it". Both come from docs/data/threejs-mapping.json:1762 and :1773. docs/shaders/library.md:608 ends "(D-79)", from the `///` comment at crates/null3d-shaders/wgsl/lib/lighting.wgsl:17-19. tools/lib/shader-library.ts publishes `///` lines only; plain `//` lines do not reach the page.
- AGENTS.md "Writing docs" (line 231) forbids maintainer process terms in user docs. Line 232 names decision record numbers as such a reference. Rule 41 (line 156) forbids a story of what happened when. So the core claim holds.
- The prototype is not public. packages/engine/src/scene/post.ts:531-535 marks the `taa` setting and TaaPrototypeSettings `@internal`. So the statement "null3D has no temporal anti-aliasing of a moving view" is true for readers.
- The same text also reaches the port skill, at skills/null3d-port-threejs/references/api-mapping.md:266-267. The JSON fix covers that copy too.

## What does not hold

1. The proposed text for row 1762 repeats itself. The row already says "a view that holds still blends jittered frames into a sharper picture by itself and then stops drawing". Adding that sentence again makes the row say it twice. Row 1773 already opens with "null3D has no temporal anti-aliasing and no temporal upscaler", so it needs only a deletion.
2. The finding misses the same leak on other pages. docs/guides/first-use-shaders.md:31 (source tools/lib/first-use-docs.ts:25) says "'taa' | when `post.set` turns the temporal resolve on, a prototype for measuring only (D-206)". docs/api/reference/engine.md:618 cites "(D-174)". If the style check is extended, these lines fail it at once, so they must be fixed in the same change.
3. A style check that blocks the word "prototype" goes too far. Users may write "prototype" in its plain sense. The repository's own skill evals do so ("my null3d RTS prototype"). In JavaScript, `prototype` is also a common word. Also, the record-number pattern exists already. tools/lib/docs-style.ts:147-155 defines DECISION_RECORD_SOURCE and INTERNAL_REFERENCE_SOURCE, but `internalReferences` is called only for commit subjects (line 491). checkDocsStyle (line 296) does not run it on user pages. The fix is to call it there, not to add a new pattern.

## Corrected claim

Decision record numbers (D-206, D-79) and a measured-and-dropped prototype story appear in user docs, against AGENTS.md "Writing docs" and rule 41. The same leak is on porting/threejs-mapping rows 255-256, shaders/library:608, guides/first-use-shaders:31 and api/reference/engine:618. The docs style check has a pattern for decision record numbers, but it runs only on commit subjects, not on user pages.

## Corrected edit

- docs/data/threejs-mapping.json:1762: replace "TAA of a moving view is a prototype that does not ship: the temporal resolve passes the engine's own paths, and its quality against the presets was measured and did not pass (D-206)." with "null3D has no temporal anti-aliasing of a moving view." Keep the rest of the row.
- docs/data/threejs-mapping.json:1773: delete "The temporal resolve's prototype passes the engine's own paths, and its quality against the reference was measured: it does not beat the presets, so no version ships it."
- crates/null3d-shaders/wgsl/lib/lighting.wgsl:19: delete "(D-79)" from the `///` comment. If maintainers want the record number, they can put it in a plain `//` line, which the library page does not show.
- tools/lib/first-use-docs.ts:25: the 'taa' shader is loaded only by an internal setting. Drop its row, or say only "when the engine's internal temporal resolve is turned on", with no "prototype" and no record number.
- The TSDoc that writes engine.md:618 (directDraws): delete "(D-174)".
- tools/lib/docs-style.ts: in checkDocsStyle, when the audience is 'users', report an error for each `internalReferences(text)` match. Do not block the word "prototype".
