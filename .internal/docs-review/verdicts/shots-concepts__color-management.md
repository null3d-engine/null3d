# Shot and demo-link verdicts: concepts/color-management

## Shots

### tone-mapped: keep
The reference `tests/image/references/chrome-real-gpu/webgpu/demo-tone-mapped.png` exists and shows the default view: two rows of seven tiles on a dark display, the top row brighter and more saturated. The demo sets `hdr: false`, so the picture is the 8-bit path, as the page says. The alt text is right. The image is small (320 x 180), so it shows the difference only at that size; it still helps.

### tone-curves: keep the picture, change the source
The proposed source does not work. The glTF model demo sets `toneMapping: 'neutral'` inside its own sketch, and the demos page has no switch or call that changes the tone curve from outside. "Call post.set in hold mode" is not a step the page can take. The model is also a poor subject: it has few very bright colors, so the curves would look almost the same.

Better source: the tone mapping test references already exist, one per curve, of the same scene at the same exposure. The scene is rows of tiles whose linear brightness rises from about 0.2 to 16, which shows exactly what the table describes (hue shifts toward white, clipping with `'none'`):
- `tests/image/references/chrome-real-gpu/webgpu/tone-agx-punchy.png`
- `tests/image/references/chrome-real-gpu/webgpu/tone-agx.png`
- `tests/image/references/chrome-real-gpu/webgpu/tone-aces.png`
- `tests/image/references/chrome-real-gpu/webgpu/tone-neutral.png`
- `tests/image/references/chrome-real-gpu/webgpu/tone-none.png`

Sketch: `tests/pages/sketches/bright-sketch.ts?tone=<curve>&stops=0`. Put the five side by side, each labeled. Alt text: "The same tiles of rising brightness under five tone curves."

### color-space-wrong: drop as proposed
No test page or demo draws one map in both color spaces. The demos only ever pass `colorSpace: 'srgb'` for color maps, and no test sketch has a switch that flips a map's color space. The steps ask for a new page, so this is not a scripted shot of an existing page.

The alt text is also a guess. A normal map read as sRGB does not look "flat and dark": each value near 0.5 drops to about 0.21, so every normal tilts the same way, and the surface looks lit from the wrong side.

If the picture is wanted, it needs a new test sketch first. A roughness map is the clearer subject: read as sRGB, mid values shrink and the surface turns glossy, which matches the page's words "its values shrink toward 0". This matters because an image texture defaults to `'srgb'`, so a roughness or normal map loaded from an image is the real trap.

## Demo links

### tone-mapped/: drop
The code is right (the demo has no `code` value, so `tone-mapped/`), and the demo shows the concept. But the page already links this demo at the end of "Materials that keep their display color". A second link adds nothing.

### auto-exposure/: keep
The code `auto-exposure/` exists. The demo walks from a sunny courtyard into a dark hall, the eye adapts, and E turns adaptation off to show the fixed exposure. Put it after the "Automatic exposure adapts the picture" paragraph.

## Concepts said to have no demo

- Texture color spaces: confirmed. No demo shows a map in the wrong color space.
- The 8-bit path against the HDR path: confirmed. The tone mapping opt-out demo draws on the 8-bit path, but no demo compares the two paths.
- Transparent canvases: not confirmed. The depth-only holdout demo (`depth-only/`) starts on a see-through canvas over a page backdrop, and the embedded page shows through wherever no object draws. Link it under "Transparent canvases". Do not use its reference image: the capture has no page behind the canvas, so it shows white.
- Exact background colors: confirmed, with a weak partial match. The splats demo sets `toneMapping: 'none'` with a flat background so a scan keeps its photographed colors, but the demo is about splats, so it does not teach this point.
