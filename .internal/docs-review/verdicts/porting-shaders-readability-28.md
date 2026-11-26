# porting-shaders-readability-28

## Finding as given

- Page: porting/threejs-shaders
- Anchor: Line 26 (stats line 19) "A custom material takes its WGSL in one `wgsl` option..."
- Category: long-paragraph. Severity: low.
- Claim: Five sentences in 68 words give four separate facts: where the WGSL goes, which functions it holds, full shaders, and uniforms.
- Evidence: stats.json porting/threejs-shaders longParagraphs line 19.
- Proposed edit: Make a list under "A custom material takes its WGSL in one `wgsl` option:": a template literal tagged /* wgsl */ or a .wgsl import; fn surface, fn vertexOffset, or both; or a full shader's @vertex and @fragment; uniforms declared once as struct Uniforms and read from material. Keep the two links in a sentence after the list.

Verdict: partly

## Evidence

- stats.json lists one long paragraph on this page: line 19, 68 words, 5 sentences. It is over the sentence limit and under the word limit. That count is a fact.
- docs/porting/threejs-shaders.md:26 is that paragraph. It sits right under the opening flowchart and the intro, and right above the "Choose the target form" table.
- The proposed list is wrong in two ways:
  1. Its items are not parallel. One item is a way to supply the WGSL. Two items are what the WGSL holds. The last is a rule about uniforms. A bulleted list of mixed kinds is harder to read than the prose it replaces.
  2. It makes a factual error worse. As a peer bullet after the full-shader item, "uniforms declared once as struct Uniforms" reads as if it applies to full shaders too. It does not. docs/guides/custom-shaders.md:96 says "The standard values, uniforms and textures do not reach a full shader". docs/porting/threejs-shaders.md:39, on this same page, says a full shader "gets no lighting, shadows, fog, uniforms or standard values". The current sentence "It declares its uniforms once" already has this ambiguity. A list would make it look like a general rule.
- The list also leaves out `fn unlit`. The table at line 34 names it as a target form.

## Corrected claim

The paragraph is one sentence over the limit (5 sentences, 68 words). Its real problem is that the uniforms sentence seems to apply to full shaders, which receive no uniforms (this page, line 39; custom-shaders.md:96). A bullet list is the wrong fix.

## Corrected edit

Split it into two short paragraphs, keep it as prose, and limit the uniforms sentence to the forms that get uniforms:

> A custom material takes its WGSL in one `wgsl` option, as a template literal tagged `/* wgsl */` or as a `.wgsl` import. The WGSL holds `fn surface`, `fn vertexOffset`, or both. A full shader holds `@vertex` and `@fragment` entry points instead.
>
> A surface function declares its uniforms once, as `struct Uniforms`, and reads them from `material`. A full shader gets no uniforms. [Custom shaders](../guides/custom-shaders.md) covers the setup, and [Surface functions](../shaders/surface-functions.md) covers the contract.

No collapsible block is needed. The text is short orientation, not dense detail.
