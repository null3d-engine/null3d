# Docker container on the owner's Mac in Firefox

- Device: a Docker container on the owner's Mac (Apple M5 Max), Linux arm64, 4 cores, 1280 x 1024 at 1x on a virtual display
- OS: Ubuntu 24.04 (the Playwright 1.63.0 image)
- Browser: Firefox 156.0, Mozilla's Linux arm64 build, the version of CI's Linux machines
- GPU: llvmpipe, a software renderer: no GPU
- GPU paths: WebGL2; no WebGPU
- Where: the owner's Mac, through the runner page in listen mode ([the image tests guide](../../image-tests.md))

## Known issues

- The container stands in for CI's Linux Firefox machines, which are x86-64. A fault that depends on timing may come at another rate here.
