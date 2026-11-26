# Shot and demo-link verdicts: errors/E1305

Page: docs/errors/E1305.md (generated from packages/engine/src/errors/codes.ts and fixes.ts).

## Shots

None proposed. Agreed: a picture of a black canvas or a console line would not help this page. The example message block already shows what the reader sees.

## Demo links

None proposed. Agreed: no demo makes the GPU reject a command, so no link fits.

## Concepts said to have no demo

- WebGPU device limits: confirmed, no demo. A search of examples/ for buffer-size and device-limit code found nothing. Five demos (security-camera, input, area-lights, character, look-at) hold a value named "limits", but it is the orbit camera's angle and distance limits, not the GPU device's limits.
- engine.onFailure: confirmed, no demo. No sketch or shared demo code calls it. The replay demo catches one error with an EngineError check, but that is a thrown error from a call (E1420), not the failure handler, so it does not show this concept.
