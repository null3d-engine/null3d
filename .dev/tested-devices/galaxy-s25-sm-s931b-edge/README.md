# Galaxy S25 (SM-S931B) in Edge

- Device: Galaxy S25 (SM-S931B), 360 x 780 at 3x, 8 cores
- OS: Android 15
- Browser: Edge 145.0.3800.99
- GPU: Adreno (TM) 830; WebGPU adapter: qualcomm adreno-8xx
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

Edge ignores the session's certificate capability, so the runner clicks the warning page's link ([#297](https://github.com/null3d-engine/null3d/pull/297))
On 13 October 2026, a smoke session opened the runner page and the browser gave it no animation frames, and the session could not bring the tab to the front. That run is [20261013-072446-smoke](20261013-072446-smoke.md). Test this browser in BrowserStack Live, where a person holds the device, or run it again for a new session.
