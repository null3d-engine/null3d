# Pixel 10 in Chrome

- Device: Pixel 10, 412 x 924 at 2.625x, 8 cores
- OS: Android 16
- Browser: Chrome 152.0.7977.54
- GPU: PowerVR D-Series DXT-48-1536; WebGPU adapter: img-tec d-series
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

WebGL2 made 2 framebuffers a frame for custom effects, and each completeness check took about 1.5 ms.
Fixed the same day ([D-71](../../decisions/D-71-custom-effects.md))
