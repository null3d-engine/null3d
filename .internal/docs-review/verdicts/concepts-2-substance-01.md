# concepts-2-substance-01

Finding as given:

- page: concepts/quality-presets
- anchor: ### Moment transparency, line 214: "at High on this computer's GPU in Chrome 156" ... "A phone's figure is owed"
- category: internal-note
- severity: high
- claim: "this computer" means the maintainer's machine, not the reader's, and "A phone's figure is owed" is a to-do note that promises later work. Both are internal notes on a user page.
- evidence: docs/concepts/quality-presets.md:214; AGENTS.md Writing docs: never mention internal plans, make no promise of a later feature, name the benchmark when you cite a figure.
- proposedEdit: "In the S1 benchmark with its smoke switch, at High on a MacBook Pro in Chrome, the layer added about 0.05 ms of CPU time and 0.58 ms of GPU time per frame on WebGPU (about 16% of that scene's GPU frame), and about 1.12 ms on WebGL2 (about 20%). A phone's GPU has much less fill rate, so expect a larger share there." Delete "A phone's figure is owed".

Verdict: survives

## Evidence

- docs/concepts/quality-presets.md:214 reads exactly as quoted: "at High on this computer's GPU in Chrome 156 ... A phone's figure is owed, and a desktop GPU's fill rate is not a phone's."
- The sentence is copied from the maintainers' decision record .dev/decisions/D-261-moment-transparency.md: line 8 ("the phone's cost figure is owed. Task: M3-F13"), line 13 ("on the S1 benchmark at High on this computer"), lines 180-198 ("Chrome 156 on this computer's GPU ... The phone's figure decides the preset, and it is owed"). So "this computer" is the maintainers' own machine and "owed" is their to-do wording.
- No phone cost figure exists. The phone and tablet runs of the layer (.dev/tested-devices/galaxy-s25-sm-s931b-chrome/20261029-085721-moment-layer.md, .dev/tested-devices/ipad-pro-13-safari/20261029-085721-moment-layer.md) checked only that the image is correct, not its cost. So the page cannot give a phone figure today, and deleting the promise is right.
- AGENTS.md "Writing docs" line 10: a page "makes no promise of a later feature"; line 11: never explain where a fact came from in internal terms. "Owed" breaks line 10.
- In other docs pages "this computer" means the reader's computer (docs/cli/null3d.md:122 and :319, docs/guides/testing.md:137, docs/errors/E1437.md:17). So here a reader would take the figure as measured on their own machine. That misleads.
- Other pages name the desktop as "a MacBook Pro" for S1 figures (docs/guides/performance.md:46, :192, :241, :261; same page line 124). The proposed "on a MacBook Pro" matches that convention. D-261 does not name the model, but "this computer" is the same machine those pages call a MacBook Pro.
- The figures in the edit (0.05 ms CPU, 0.58 ms and 16% WebGPU, 1.12 ms and 20% WebGL2) match the D-261 table at lines 186-195.

## Notes on the edit

- Keep the browser version or drop it; either is fine. The edit drops "156", which loses nothing a reader needs.
- The page elsewhere says "processor time"; "CPU time" in the edit is also used across the docs, so either is acceptable.
- Severity: "high" is defensible because "this computer" reads as the reader's machine, but "medium" would also fit. The defect itself holds.
