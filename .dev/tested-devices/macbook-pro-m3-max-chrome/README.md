# MacBook Pro (M3 Max) in Chrome

- Device: MacBook Pro (M3 Max), 14 cores, 36 GB
- OS: macOS 26.2
- Browser: Chrome 156.0.8078.48
- GPU: Apple M3 Max (ANGLE on Metal; WebGPU adapter: apple)
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: the owner's Mac, the server

## Known issues

A Chrome window that the runner opens in the background and parks reports its page hidden on this machine, and a hidden page gets no animation frames. The plans that time frames run with `--front`, which opens the window in front at its own size ([run](20261026-235422-tree-generation.md)).
