# Galaxy S24+ (SM-S926B) in Chrome

- Device: Galaxy S24+ (SM-S926B), Exynos 2400, 12 GB, 360 x 780 at 3x
- OS: Android 16
- Browser: Chrome 154.0.8037.126 (154.0.8037.57 in earlier runs)
- GPU: Samsung Xclipse 940 (ANGLE on Vulkan 1.3.279)
- GPU paths: WebGL2; no WebGPU adapter
- Where: The owner's phone, over USB

## Known issues

The debug view's lines land one pixel off, so the phone keeps its own references ([#209](https://github.com/null3d-engine/null3d/pull/209)).
Worker scripts once failed to load over USB ([#209](https://github.com/null3d-engine/null3d/pull/209)).
The tab closed at 7296 MiB of GPU textures ([D-12](../../decisions/D-12-memory-budgets.md)) Low latency with WebGL2 sometimes runs at about 24 fps in place of 60: its frames alternate 2 and 3 display intervals, a median of 41.7 ms against the 34 ms limit.
Main passed 8 of 16 rounds on 5 October 2026, and the code of the 3 October run 5 of 8, so it is not new.
The other four thread modes held 60 fps in every run.
The contact checks find the shadow on the boxes' own tops 0.47 px out on both main and the shadow fix, against a limit of 0.4 px (view "far"), and 0.46 px against 0.3 px (view "turn"): a difference of this phone that the fix did not cause
