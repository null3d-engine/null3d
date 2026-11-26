# Verdict: api-3-substance-17

## Finding as given

- Page: api/splats
- Anchor: "## Detail levels, streaming and the budget, lines 121-124: "the reader arrived at 4.4 seconds instead of 7.9""
- Category: internal-note. Severity: medium.
- Claim: "Instead of" compares the present build with an older one. This is changelog content; the rules say a page states what holds now and names the benchmark for a figure.
- Evidence: docs/api/splats.md:121-124; AGENTS.md Writing docs.
- Proposed edit: "So the first selection and the first chunk's decode wait for neither download." Drop the before-and-after timings, or give a present figure: "In the splats demo on a simulated phone connection, the first parts show after about 7 seconds."

Verdict: survives

## Evidence

- docs/api/splats.md:121-124 says: "In the splat demo, on a simulated phone connection, the reader arrived at 4.4 seconds instead of 7.9. The first parts showed at 7.0 seconds instead of 8.3." The page never says what the 7.9 and 8.3 figures measure. A reader cannot tell the baseline.
- `git log -L` on these lines shows they came in one commit, e06b8b5ce "perf: start the engine, the demos and apps faster (#567)". So the "instead of" figures are the build before that change against the build after it. That is a changelog comparison.
- AGENTS.md "Writing docs" (lines 230, 235): a page describes what exists now; "Give a fault or a figure as a present fact with its reason. Leave when it happened to git." Line 231 also asks to name the benchmark when a figure is cited. The past tense ("arrived", "showed") and the unnamed baseline both break these rules.
- I tried to read "instead of" as a design comparison (parallel start against a serial start). Nothing on the page sets up a serial start as an option, so that reading does not hold.
- The demo's name is `splats` (examples/demos.ts:903), not "splat demo". The proposed edit uses the right name.

## Corrected edit (small refinement)

The proposed edit is right. If the figures stay, keep both present figures in the present tense and name the setup:

"So the first selection and the first chunk's decode wait for neither download. In the splats demo on a simulated phone connection, the SPZ reader is ready at about 4.4 seconds and the first parts show at about 7 seconds."
