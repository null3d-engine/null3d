# Pixel 10 in Chrome

- Device: Pixel 10, 412 x 924 at 2.625x, 8 cores
- OS: Android 16
- Browser: Chrome 152.0.7977.54
- GPU: PowerVR D-Series DXT-48-1536; WebGPU adapter: img-tec d-series
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

Each new WebGL2 framebuffer's completeness check takes about 1.5 ms here, because it waits for the browser's GPU process.
So a color target keeps its framebuffer without depth apart, and custom effects make no new framebuffers each frame ([D-71](../../decisions/D-71-custom-effects.md)).
