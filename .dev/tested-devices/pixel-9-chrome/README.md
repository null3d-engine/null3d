# Pixel 9 in Chrome

- Device: Pixel 9, 412 x 924 at 2.625x, 8 cores
- OS: Android 17
- Browser: Chrome 152.0.7977.54 (149.0.7827.160 before 2026-10-08)
- GPU: Mali-G715; WebGPU adapter: arm valhall
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

The phone grows hot in long benchmark runs.
In the S1 background run of 2026-10-07, runs 2 to 5 drew 33 to 42 fps, at 14.1 to 17.4 ms of GPU time on every page.
The GPU timer's pass times overlap on this GPU, so only the whole frame's GPU time is reliable
