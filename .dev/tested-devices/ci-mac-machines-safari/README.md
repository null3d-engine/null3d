# CI's Mac machines in Safari

- Device: CI's Mac machines (GitHub's macos-15-arm64 image, 20261028)
- OS: macOS 15.8.2
- Browser: Safari 27.2, from the image's software list
- GPU:
- GPU paths: WebGL2; no WebGPU
- Where: GitHub Actions, in each full CI run: pull requests ready for review, and main after each merge

## Known issues

Safari can lose a request that the runner page sends ([Device sessions](../../devices.md#the-runner))
