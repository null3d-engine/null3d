# porting-shaders-readability-03

## Finding as given

- Page: porting/threejs-shaders
- Anchor: ## Worked examples (line 190)
- Category: example-placement
- Severity: medium
- Claim: The ShaderMaterial steps (line 110), the onBeforeCompile table (line 123) and the TSL table (line 138) have no code. Their examples come 70 to 130 lines later, after Displacement, so a reader following the steps must jump down and back.
- Evidence: threejs-shaders.md lines 110-162 against lines 190-285 (### A fresnel glow from a ShaderMaterial, ### Wind sway from onBeforeCompile, ### A dissolve from TSL).
- Proposed edit: Move "A fresnel glow" to the end of "ShaderMaterial and RawShaderMaterial", "Wind sway" to the end of "onBeforeCompile patches" and "A dissolve" to the end of "TSL and node materials", each as an H3 "Example: ...". Delete the "Worked examples" H2.
- Generated source: none (written page)

Verdict: survives

## Evidence

- docs/porting/threejs-shaders.md:110-121: the ShaderMaterial section is six numbered steps and two paragraphs. It has no code block and no link to the fresnel example.
- docs/porting/threejs-shaders.md:123-136: the onBeforeCompile section is a table and one paragraph. No code, no link to the wind example.
- docs/porting/threejs-shaders.md:138-162: the TSL section is a table and one paragraph. No code, no link to the dissolve example.
- docs/porting/threejs-shaders.md:164-188: the Displacement section, which sits between these sections and the examples, already puts its code inline. So the page is not consistent: one section carries its own example and three do not.
- docs/porting/threejs-shaders.md:192, 228, 254: each example title names exactly one of the three sections, so each one has one clear home. Wind sway uses the first row of the onBeforeCompile table (line 127). The dissolve maps `opacityNode`, `emissiveNode` and `alphaTest` from the TSL table (line 153). The fresnel glow follows steps 3 and 4 of the ShaderMaterial list.
- The distances hold in substance. From each section heading to its example: 82, 105 and 116 lines. From the end of each section: 71, 92 and 92 lines. The "130" upper bound is a little high, but the point stands.
- No page, skill or source links to `#worked-examples` or to the three example anchors (grep over docs/, skills/, packages/*/src and tools/). Moving them breaks no link.
- The edit breaks no writing rule. "Example: a fresnel glow from a ShaderMaterial" style headings are sentence case. No content is cut, so no collapsible block is needed.
- The front matter summary ("...; worked examples.") stays true after the move, because the page still holds the worked examples.
- The port skill (skills/null3d-port-threejs/references/shaders.md:181) keeps its own "Worked examples" section. The sync rules do not require the skill to copy the page's layout, so the skill can stay as it is.

## Corrected claim

None needed. Small precision: the examples sit 82 to 116 lines below their section headings.

## Corrected edit

None needed. Optional: name the H3s "Example: a fresnel glow", "Example: wind sway" and "Example: a dissolve", since the section heading above each already names the source form.
