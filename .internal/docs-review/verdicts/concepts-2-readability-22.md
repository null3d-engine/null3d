# concepts-2-readability-22

## Finding as given

- page: concepts/materials
- anchor: ## The transparent pass (lines 89-113); long paragraphs 23, 85, 97, 113, 117
- category: heading-depth
- severity: medium
- claim: One H2 has nine paragraphs and no subheads. It covers sorting, the limits of sorting, weighted blending, moment transparency, transmission and cost. Line 85 (alpha to coverage) mixes the user rule with how WebGPU writes coverage itself.
- evidence: stats.json lines 16, 78, 90, 106, 110 (file 23, 85, 97, 113, 117).
- proposedEdit: Add H3s: 'Sorting' (97-99), 'Where sorting fails' (101-105), 'Blending without a sort' (107-109), 'Surfaces that let light through' (111), 'What blending costs' (113 as a list). Split 97 in two. In 85, keep sentences 1, 2 and the last, and move the format and shader-coverage detail into <details><summary>Technical details: alpha to coverage on each path</summary>. In 117, put the reuse advice first.

Verdict: partly

## Evidence

- docs/concepts/materials.md:89-113. The H2 holds a Mermaid diagram, seven prose paragraphs (97, 99, 101, 107, 109, 111, 113) and a three-item list (103-105). It has no H3. "Nine paragraphs" overcounts: it is seven paragraphs plus a list. The topics the finding names are all there, so the core heading-depth point holds.
- H3s fit the docs' own pattern: docs/api/materials.md uses "### How it draws" and "### Cost of ..." under its H2s (lines 158, 172, 215, 248, 304, 416, 676). The proposed H3 titles are sentence case and break no writing rule.
- Line 97 has six sentences. A split after "farthest first." gives one paragraph on why and one on how the workers sort. That is correct.
- Line 85 (in "## Alpha modes", not the transparent pass): sentences 3 and 4 (target format with alpha, WebGPU's HDR color has none, the shader writes the samples) are implementer detail. A block suits them. But sentence 5 ("Those shader builds load the first time a material needs them") is a user-facing cost. It ties to the page's own section "Why a new combination can make a frame late" (line 119-121). It must stay in the main text, so the text still makes sense with the block closed.
- The same WebGPU detail and the fix already live in docs/api/materials.md:596-602 ("### Alpha to coverage"): the shader sets the covered samples itself, and `preload: ['coverage', 'hash']` loads the builds early. docs/guides/first-use-shaders.md:50 lists `'coverage'` too. So a link to that section is a cleaner alternative to a block that repeats it. Either is acceptable.
- Line 23 (71 words, 5 sentences) is listed in the anchor but gets no edit.
- Line 117: moving the reuse advice first is a fair, low-cost reorder.

## Corrected claim

The H2 "The transparent pass" (lines 89-113) has seven paragraphs and a three-item list with no H3, and covers sorting, its limits, weighted and moment blending, transmission and cost. Line 85, in "Alpha modes", mixes the user rule with how each GPU path writes coverage.

## Corrected edit

- Keep the five H3s and the split of 97 after "farthest first." as proposed. Optionally fold 111 into "Blending without a sort" or keep it; one paragraph under an H3 is fine.
- In 85: keep sentences 1, 2 and 6 in the main text, and also keep the first-use cost as plain text: "The first such material loads extra shader builds; list `'coverage'` in `createEngine`'s `preload` option to load them before play ([Alpha to coverage](../api/materials.md#alpha-to-coverage))." Move only sentences 3 and 4 (format with alpha, WebGPU's HDR color without alpha, the shader writes the samples) into `<details><summary>Technical details: alpha to coverage on each path</summary>`, or drop them in favor of the link, since the API page already says it.
- In 23: split after "the render pipeline that draws it." so the compile cost reads as its own short paragraph.
- In 117: put "reuse one WGSL for materials that differ only in their values" first, as proposed.
