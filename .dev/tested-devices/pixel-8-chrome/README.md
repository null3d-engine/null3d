# Pixel 8 in Chrome

- Device: Pixel 8, 412 x 915 at 2.625x, 9 cores
- OS: Android 17
- Browser: Chrome 153.0.8010.52
- GPU: ARM Mali-G715 (WebGPU adapter: arm valhall)
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: TestingBot's device cloud

## Known issues

Mali's GLSL compiler rejected one fragment shader of the shader library: "no default precision defined for variable 'vec3[9]'" ([#224](https://github.com/null3d-engine/null3d/pull/224))
