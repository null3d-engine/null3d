# MacBook Pro in Firefox

- Device: MacBook Pro, Apple M5 Max
- OS: macOS 26.6.2
- Browser: Firefox 157.0 (156.0 before 2026-10-03)
- GPU: Hidden: "Apple M1, or similar", and empty WebGPU adapter details
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: The owner's Mac

## Known issues

WebGPU completions arrive a display frame late ([D-11](../../decisions/D-11-frames-in-flight.md)).
No background WebGL2 compiles ([D-13](../../decisions/D-13-shader-variants.md)).
A pixel pack buffer fills late, and WebGPU timestamps arrive only when the frame's work completes ([implementation notes](../../implementation-notes.md#browser-faults))
