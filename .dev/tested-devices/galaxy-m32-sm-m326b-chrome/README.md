# Galaxy M32 (SM-M326B) in Chrome

- Device: Galaxy M32 (SM-M326B), 385 x 854 at 1.875x, 8 cores
- OS: Android 11
- Browser: Chrome 152.0.7977.54 (BrowserStack; 149.0.7827.160 in earlier runs)
- GPU: Mali-G57 MC3
- GPU paths: compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

Stands in for the Galaxy A16 5G.
The first two tries ended after 2 pages: a status read timed out while its answer arrived, and the runner counted the session lost at once (fixed in [#299](https://github.com/null3d-engine/null3d/pull/299))
Its Mali GPU rejects the lit pipeline's GLSL array constructor, so the compatibility mode image pages failed on 13 October 2026 ([Browser faults](../../implementation-notes.md#browser-faults))
