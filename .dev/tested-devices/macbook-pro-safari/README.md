# MacBook Pro in Safari

- Device: MacBook Pro, Apple M5 Max
- OS: macOS 26.6.2
- Browser: Safari 26.6.2
- GPU: Apple GPU
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: The owner's Mac

## Known issues

Safari 26 can hang the GPU when one render pass draws indirect from one buffer twice (WebKit bug 321876); the WebGPU backend gives each such draw its own copy of its arguments ([D-85](../../decisions/D-85-safari-indirect-arguments.md)).
Safari shows a worker's frame only after the GPU finished it ([D-11](../../decisions/D-11-frames-in-flight.md)).
With `?render=main`, Safari's page callbacks slow with the GPU on WebGL2, and the governor took them for a slow display ([D-11](../../decisions/D-11-frames-in-flight.md#drawing-on-the-pages-thread-m2-r3)).
About 1 engine start in 190 in a frame stalled in its setup ([#223](https://github.com/null3d-engine/null3d/pull/223)).
WebGPU drops a copy from a 2D texture into a 3D slice past the first ([implementation notes](../../implementation-notes.md#browser-faults)).
After about 30 page loads in one session, a new WebGL2 context on the room maker page made no program; a probe page in a fresh session saw no lost context.
Safari keeps a removed frame's page, and its share of memory, for about 19 s, with or without automation.
Through WebDriver it once held more ([D-92](../../decisions/D-92-safari-removed-frames.md))
