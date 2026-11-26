# porting-shaders-substance-24

Finding as given:

```json
{
 "page": "porting/threejs-shaders",
 "anchor": "stats line 19 (68 words, 5 sentences), the paragraph after the diagram",
 "category": "long-paragraph",
 "severity": "low",
 "claim": "It names the wgsl option, the tag, three function forms, struct Uniforms and two links in one block.",
 "evidence": "stats.json longParagraphs for porting/threejs-shaders",
 "proposedEdit": "Split into 'A custom material takes its WGSL in its wgsl option. The WGSL holds fn surface, fn vertexOffset, or both, or a full shader's entry points.' and a second paragraph for uniforms and the links.",
 "generatedSource": "",
 "id": "porting-shaders-substance-24",
 "slice": "porting-shaders",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- stats.json lists one long paragraph for this page: line 19, 68 words, 5 sentences. It is over the sentence limit only, not the word limit. In the file it is line 26 of docs/porting/threejs-shaders.md (a hand-written page, so there is no generated source).
- The claim describes the paragraph correctly. It names the `wgsl` option, the `/* wgsl */` tag and the `.wgsl` import, `fn surface`, `fn vertexOffset`, the `@vertex`/`@fragment` entry points, `struct Uniforms` and two links.
- AGENTS.md "Writing docs" has no paragraph length rule. It asks for short sentences (at most 25 words). Every sentence here is within that. So the split is polish, which matches the low severity.
- A split at the topic change (setup, then uniforms and links) is sensible. The first three sentences say where the WGSL goes and what it holds. The last two say how uniforms work and where to read more.
- The proposed first paragraph is wrong in one point. It drops "as a template literal tagged `/* wgsl */` or as a `.wgsl` import" and the names `@vertex` and `@fragment`. On this page, line 26 is the only place that says a `.wgsl` import works. The worked examples below (lines 175, 216, 244, 269) show only the tagged literal. A porter who keeps GLSL in separate files needs to know the import form. The guide docs/guides/custom-shaders.md (lines 100 to 113) covers both forms, but the finding's text should not cut them. The task also says to prefer keeping correct detail over cutting it.

## Corrected claim

The paragraph has 5 sentences on two topics: where the WGSL goes and what it holds, then uniforms and the links. A split between them is low-value polish. The proposed wording drops correct detail (the tag and import forms, the entry-point names), and it should keep every sentence.

## Corrected edit

Split after the third sentence and keep the words unchanged:

> A custom material takes its WGSL in one `wgsl` option, as a template literal tagged `/* wgsl */` or as a `.wgsl` import. The WGSL holds `fn surface`, `fn vertexOffset`, or both. It can also hold a full shader's `@vertex` and `@fragment` entry points.
>
> The WGSL declares its uniforms once, as `struct Uniforms`, and reads them from `material`. [Custom shaders](../guides/custom-shaders.md) covers the setup, and [Surface functions](../shaders/surface-functions.md) covers the contract.
