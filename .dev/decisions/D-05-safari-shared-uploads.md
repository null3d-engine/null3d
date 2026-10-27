# D-05: WebGL shared-memory upload path on Safari

Status: decided. Built: the startup test picks direct uploads per device, and copies stay as the tested fallback. Test: T-06.

Summary: Upload straight from shared memory wherever the startup test passes, which is every browser measured; copies stay as the fallback.

## Question

Can the WebGL2 path upload straight from views on the shared WebAssembly memory in Safari, or must it copy each changed range into a plain buffer first?

## Rule

Direct uploads if the startup test passes on the iPad, else copies of changed ranges. The startup test (T-06) calls `bufferSubData` and `texSubImage2D` with a view on shared memory.

## Data

The capability probe runs the startup test at every engine start and reports it as `webgl2.sharedMemoryUploads`.

| Browser | `bufferSubData` from shared memory | `texSubImage2D` from shared memory | Run |
| --- | --- | --- | --- |
| Safari 26.6, iPad Pro 11-inch (8 cores) | passes | passes | 20260929-150841-checks, and every iPad checks run of that session |
| Safari 26, MacBook Pro | passes | passes | 20260929-055017-checks |
| Chrome 154, Galaxy S24+ | passes | passes | 20260929-074614-checks |
| Firefox, MacBook Pro | passes | passes | 20260929-055017-checks |
| Brave, MacBook Pro | passes | passes | 20260927-094634-checks |
| Brave, iPad, Shields on | passes | passes | 20260929-153640-checks |

How the data was produced: the device runner's checks plan (`bun tests/real-browsers.ts --lan ipad-safari`, `--lan ipad-brave --shields on`, and the Mac and Android runs named above). The capabilities page reports the probe's result.

## Decision

Direct uploads wherever the startup test passes, which is every browser measured, Safari on the iPad included. The engine applies the rule per device: `coreDevice` in `packages/engine/src/page/limits.ts` sets `sharedUploads` from the probe, and the WebGL2 backend copies changed ranges only when the test fails or `?uploads=copy` asks for it. The copy route stays as the fallback, and the page switch keeps it testable.

Shared uploads do not slow Safari's WebGL2 frames. Multi-draw arrays that span all of engine memory do. The engine does not draw with such arrays (#30, "draw with multi-draw in Safari at full speed").

## Consequences

- The probe and the fallback are in the engine.
- T-06 is closed: both uploads pass in Safari and in Brave on the iPad.
- The upload path is decided: direct, with a tested copy fallback.
