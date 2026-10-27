# Galaxy M32 (SM-M326B) in Chrome

- Device: Galaxy M32 (SM-M326B), 385 x 854 at 1.875x, 8 cores
- OS: Android 11
- Browser: Chrome 152.0.7977.54 (BrowserStack)
- GPU: Mali-G57 MC3
- GPU paths: compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

Stands in for the Galaxy A16 5G.
A status read can time out on this phone while its answer arrives, so the runner does not count the session lost at once ([#299](https://github.com/null3d-engine/null3d/pull/299)).
Its Mali GPU rejects the lit pipeline's GLSL array constructor, so the compatibility mode image pages fail ([run](20261013-100652-smoke.md), [Browser faults](../../implementation-notes.md#browser-faults)).
