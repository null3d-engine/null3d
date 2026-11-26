# concepts-1-readability-13

## Finding as given

```json
{
 "page": "concepts/backends,concepts/color-management,concepts/architecture",
 "anchor": "backends '## Color and anti-aliasing on each tier' and line 120; color-management '## HDR color and the final pass' and '### The 8-bit path'; architecture pass item 14",
 "category": "duplication",
 "severity": "medium",
 "claim": "All three pages explain which devices take the 8-bit path, when MSAA resolves straight into the canvas, the two-step final pass below render scale 1, and engine.capabilities.hdr. Backends says it twice. The lists of effects that force a final pass differ: architecture names 4, color-management names about 12.",
 "evidence": "backends.md:74-82, 120; color-management.md:60-71; architecture.md:104",
 "proposedEdit": "Make color-management 'The 8-bit path' the only full text, with the effects as a bullet list. Backends keeps its tier table and one linking sentence. Delete 80, 82 and 120, or cut them to one sentence. Architecture item 14 keeps one sentence with a link to color-management#the-8-bit-path.",
 "id": "concepts-1-readability-13",
 "slice": "concepts-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The duplication is real for two topics on all three pages:
  - MSAA resolving straight into the canvas: backends.md:75 (compatibility mode row), color-management.md:67, architecture.md:104.
  - The two-step final pass below render scale 1: backends.md:78, color-management.md:63, architecture.md:104. All three link to post-processing.md#below-the-whole-canvass-render-scale, which has the full text (post-processing.md:62-63). So this is a fourth copy.
- Backends says the HDR-path story twice: backends.md:80-82 and again at backends.md:120 (which devices take float targets, and what `hdr` reports). True.
- Two parts of the claim are wrong:
  - Architecture item 14 (architecture.md:104) does not say which devices take the 8-bit path, and it does not mention `engine.capabilities.hdr`. Only backends and color-management do (backends.md:80-82, 120; color-management.md:67, 71).
  - color-management.md:67 names 10 effects, not "about 12": color grading, sharpening, outlines, transmission, screen-space reflections, bounce light, soft particles, a material that reads depth, the moment transparency layer, a full-screen pass that reads scene color. Architecture names 4 with "such as", so the two lists do not contradict. The short list can still make a reader think only those 4 matter.
- The proposed edit would cut useful detail. Line 80 holds facts that appear nowhere else in these pages: why compatibility mode loses HDR with MSAA (no MSAA on 16-bit float targets), the `engine.report.webgl2.floatRenderTargets` field, and the test rules (complete target, values above 1, 4 samples for MSAA). Line 82 holds the note that FXAA compares colors as tone mapped on both paths. The tiers page is the right home for these facts. The review brief says to move useful dense detail into a collapsible block, not to delete it.
- The edit also leaves out line 78 and the two-step sentences in color-management.md:63, which repeat post-processing.md.

## Corrected claim

Backends, color-management and architecture each repeat two things: that MSAA on the 8-bit path can resolve straight into the canvas, and the two-step final pass below render scale 1. The two-step pass is fully described in post-processing.md. Backends and color-management also both say which devices take the 8-bit path and what `engine.capabilities.hdr` reports, and backends says this twice (80-82 and 120). Architecture gives 4 example effects that force a final pass. Color-management lists 10.

## Corrected edit

- color-management "The 8-bit path" stays the full text. Turn its effects sentence into a bullet list of the 10 effects. In "HDR color and the final pass" (line 63), cut the two-step sentences to one sentence that links to post-processing.md#below-the-whole-canvass-render-scale.
- backends: keep the tier table (74-76). Cut line 78 to one sentence that links to post-processing. Line 80: keep the first three sentences in the main text. Move the float target test (the report field and its rules) into a block:
  `<details>` / `<summary>Technical details: the float target test on WebGL2</summary>` ... `</details>`.
  Line 82: cut the bloom sentence and the `hdr` sentence, and link to color-management#the-8-bit-path. Keep the FXAA edge note, in the main text or in the same block. Line 120: one sentence, for example "`hdr` says whether the engine took the HDR path ([Color and anti-aliasing on each tier](#color-and-anti-aliasing-on-each-tier))."
- architecture item 14: keep the HDR-path work. Replace the 8-bit sentences, and the partial list of 4 effects, with one sentence: "On the 8-bit path the scene's shaders tone map their own output, and with MSAA the frame can skip this pass ([Color management](color-management.md#the-8-bit-path))."
