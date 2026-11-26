# Verdict: concepts-2-readability-12

## Finding as given

- Page: concepts/post-processing
- Anchor: ### Cost (lines 109, 153, 194, 261, 303, 335, 356)
- Category: heading-depth
- Severity: medium
- Claim: Seven H3s are all named 'Cost'. The outline repeats one word seven times, and the anchors become #cost, #cost-1 and so on, so other pages cannot link to one effect's cost in a stable way. The blocks are mostly benchmark figures and byte counts.
- Evidence: stats.json heading outline for concepts/post-processing.
- Proposed edit: Rename them 'What bloom costs', 'What depth of field costs', and so on. Or keep one cost sentence in the main text and move the rest into <details><summary>Technical details: bloom's passes, memory and timings</summary>. Either way, each anchor becomes unique.

Verdict: partly

## Evidence

- The page has seven `### Cost` headings, at lines 109, 153, 194, 261, 303, 335 and 356, under Bloom, Depth of field, Automatic exposure, Ambient occlusion, Screen-space reflections, Screen-space bounce light and Outlines. This part holds.
- The anchor problem is real, not only in theory. docs/guides/performance.md:277 links to `../concepts/post-processing.md#cost`. Today that lands on bloom's cost, which is what the link means. If a section moves above Bloom, or bloom's heading changes, the link points at another effect's cost with no warning.
- "The blocks are mostly benchmark figures and byte counts" goes too far. Each section also gives advice a reader acts on: a smaller bloom base saves the most on phones (line 116), the ambient occlusion targets follow the render scale and the governor lowers them (lines 265, 267), and most effects cost nothing while off (lines 118, 160, 196, 358). Automatic exposure (line 196) and bounce light (line 337) have only two or three sentences, and outlines one short paragraph. They hold no dense detail to fold away.
- The second option does not make the anchors unique "either way". If the heading stays `### Cost` and the body moves into a block, the duplicate anchors stay. If the heading goes, the performance guide's link breaks.
- The outline repeat itself costs a reader little. Each Cost sits under its effect's H2, so a nested table of contents reads "Bloom > Cost". The real cost is the unstable anchor.

## Corrected claim

Seven H3s share the name "Cost", so their anchors are #cost, #cost-1 and on. The guides/performance page already links to #cost for bloom, and that link breaks silently if the sections change order. The sections hold real advice as well as figures, and three of them are only a few sentences.

## Corrected edit

Rename each heading after its effect: "What bloom costs", "What depth of field costs", "What automatic exposure costs", "What ambient occlusion costs", "What screen-space reflections cost", "What bounce light costs", "What outlines cost". In the same change, update docs/guides/performance.md:277 from `#cost` to `#what-bloom-costs`. Optionally, in the bloom, depth of field, ambient occlusion and reflections sections only, keep the actionable lines (render scale, base size, governor steps, cost while off) in the main text and move the per-pass byte counts and the MacBook timings into one `<details><summary>Technical details: measured timings and memory</summary>` block per section. Leave the short exposure, bounce light and outlines sections as they are.
