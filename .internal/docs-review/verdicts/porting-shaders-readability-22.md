# porting-shaders-readability-22

## Finding as given

- page: shaders/library, porting/threejs-mapping
- anchor: Library SPECULAR_AA_LIMIT (line 608) "(D-79)"; mapping row FXAAPass / FXAAShader / SMAAPass / TAARenderPass / SSAARenderPass (line 255) "(D-206)"
- category: internal-note
- severity: medium
- claim: Decision record numbers appear in published text, which the writing rules forbid. A reader cannot follow them.
- evidence: crates/null3d-shaders/wgsl/lib/lighting.wgsl line 19; docs/data/threejs-mapping.json line 1762 ("its quality against the presets was measured and did not pass (D-206)").
- proposedEdit: Delete "(D-79)". In the mapping note, delete "(D-206)" and the sentence about the prototype that does not ship, and write "A moving view has no temporal anti-aliasing. Use MSAA or FXAA."
- generatedSource: crates/null3d-shaders/wgsl/lib/lighting.wgsl; docs/data/threejs-mapping.json

Verdict: survives

## Evidence

- docs/shaders/library.md:608 ends "The lower limit flickers less on small glossy shapes (D-79)." Its source is the doc comment in crates/null3d-shaders/wgsl/lib/lighting.wgsl:17-19.
- docs/porting/threejs-mapping.md:255 holds "...its quality against the presets was measured and did not pass (D-206)." Its source is docs/data/threejs-mapping.json:1762, row id "aa-passes".
- The rule is real. The task's writing rules forbid decision record numbers in docs/. tools/lib/docs-style.ts:141-153 names decision records (D-174) as maintainer references that a reader cannot look up. A published reader has no access to .dev/decisions/.
- The replacement sentence is correct. The TAA switch is internal: packages/engine/src/scene/post.ts:532 marks it "@internal A prototype of temporal anti-aliasing ... for measuring only". A user has no public way to turn it on. So "A moving view has no temporal anti-aliasing" is true. The next mapping row (temporal-aa, line 256) already says "null3D has no temporal anti-aliasing", so the new wording agrees with it. The row keeps "TAARenderPass and SSAARenderPass need no pass on a still camera", so a reader still learns what happens on a still view.
- Deleting "(D-79)" leaves a full, clear sentence. No useful detail is lost, so no collapsible block is needed.
- No rule or website contract is broken by the edit.

## Note on scope (not a refutation)

A search of every published docs page finds two more decision numbers outside this slice:
- docs/guides/first-use-shaders.md:31 "(D-206)", generated from tools/lib/first-use-docs.ts. That row also documents the internal 'taa' permutation as "a prototype for measuring only".
- docs/api/reference/engine.md:618 "(D-174)", from the TSDoc of the directDraws field in packages/engine/src.
If no other finding covers them, fix them in the same pass.
