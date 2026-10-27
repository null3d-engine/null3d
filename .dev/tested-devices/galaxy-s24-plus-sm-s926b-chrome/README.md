# Galaxy S24+ (SM-S926B) in Chrome

- Device: Galaxy S24+ (SM-S926B), Exynos 2400, 12 GB, 360 x 780 at 3x
- OS: Android 16
- Browser: Chrome 154.0.8037.126
- GPU: Samsung Xclipse 940 (ANGLE on Vulkan 1.3.279)
- GPU paths: WebGL2; no WebGPU adapter
- Where: The owner's phone, over USB

## Known issues

The debug view's lines land one pixel off, so the phone keeps its own references ([#209](https://github.com/null3d-engine/null3d/pull/209)).
Worker scripts can fail to load over USB ([#209](https://github.com/null3d-engine/null3d/pull/209)).
The tab closes at 7296 MiB of GPU textures ([D-12](../../decisions/D-12-memory-budgets.md)).
Low latency with WebGL2 sometimes runs at about 24 fps in place of 60: its frames alternate 2 and 3 display intervals, a median of 41.7 ms against the 34 ms limit.
Main passed 8 of 16 rounds, and an older commit 5 of 8, so main's changes did not bring the fault.
The other four thread modes held 60 fps in every run.
The contact checks find the shadow on the boxes' own tops 0.47 px out, against a limit of 0.4 px (view "far").
In view "turn" it is 0.46 px out, against 0.3 px ([run](20260929-earlier-runs.md)).
Main and the shadow fix give the same figures, so the difference comes from this phone and not from the fix.
