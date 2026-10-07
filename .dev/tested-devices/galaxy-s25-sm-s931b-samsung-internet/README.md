# Galaxy S25 (SM-S931B) in Samsung Internet

- Device: Galaxy S25 (SM-S931B), 360 x 780 at 3x, 8 cores
- OS: Android 15
- Browser: Samsung Internet 30.0.2.45 (Chromium 143)
- GPU: Qualcomm Adreno 830 (WebGPU adapter: qualcomm adreno-8xx)
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack's device cloud; BrowserStack Automate

## Known issues

As in Chrome.
Under BrowserStack Automate, the browser reports the page as hidden, so the page gets no animation frames.
Its Chromium 143 is the oldest Chromium that BrowserStack offers on this phone.
BrowserStack opens Chrome 149 for every Chrome version that a session asks for, so this browser stands in for an older Chrome ([D-76](../../decisions/D-76-16-bit-cascades.md))
