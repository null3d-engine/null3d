# CI's Linux machines in Chromium

- Device: CI's Linux machines (GitHub's ubuntu-24.04 image)
- OS: Ubuntu 24.04.5
- Browser: Chromium 153.0.8010.12, headless, through Playwright 1.63.0
- GPU: SwiftShader, the software GPU
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: GitHub Actions, in the merge queue

## Known issues

Some frames take 300 to 400 ms, so CI skips the governor's stress test ([Device sessions](../../devices.md#the-governor-plan))
