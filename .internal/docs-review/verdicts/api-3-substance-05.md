# Verdict: api-3-substance-05

## Finding as given

- id: api-3-substance-05 (slice api-3, role substance)
- page: api/render
- anchor: ### Reading a region back, lines 422-424: "at the place that the section on a pass's texture gives below"
- category: unclear
- severity: medium
- claim: No section below covers a pass's texture. The headings after it are WebGL2, Switching and removing passes, The graph as text, Cost and Errors. The facts the reader needs are at lines 59 and 218.
- evidence: docs/api/render.md headings at 439, 447, 454, 462, 470; v = 0 bottom row at 59; effectPassUv at 218.
- proposedEdit: "A material shows the image with v = 0 at its bottom row ([Scene passes](#scene-passes)). A full-screen pass reads it at `effectPassUv(input.uv)` ([Full-screen passes](#full-screen-passes))."
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/api/render.md:422-424 says "A material shows a pass's image at the place that the section on a pass's texture gives below."
- The headings after line 407 are WebGL2 (439), Switching and removing passes (447), The graph as text (454), Cost (462), Errors (470), Related pages (486) and API reference (497). None of them is about a pass texture's layout. WebGL2 (441-445) covers the fragment fallback and layers. Cost (465) says how each path turns the image upright, but it does not tell a material where to sample. So "below" points to nothing.
- The facts are above the reference. Line 59 (Scene passes) says "The image stands upright on a plane, with v = 0 at its bottom row". Line 218 (Full-screen passes) says "A pass texture holds its image's bottom row first, as materials sample it", and tells a reader to sample at `effectPassUv(input.uv)`.
- A compute pass's texture follows the same rule. The compute example's fallback shader (around line 264) says "The pass texture holds its first row at the bottom, and input.uv counts from the top left." So the proposed edit is right for the compute pass that this section reads.
- Both anchors in the edit match real headings: "## Scene passes" (38) and "## Full-screen passes" (154).
- The edit uses no internal process words and keeps the bullet short. It breaks no writing rule or website rule.

## Note on the edit

The edit is correct. Line 218 states the rule for every pass texture, and line 59 states it only for a scene pass's image. A reader of a compute-pass section may find the general statement more useful. This is optional and does not change the verdict.
