Plans: vegetation-grass 2026-11-03. The branch is `feat/m3-v8-ao-cost` at `5a3ab8012`, off `landing/range-7` at `896a1c721`, whose pages the dev server in `/Users/ram/dev/null3d-grass` served over HTTPS. BrowserStack Automate served the pages through BrowserStack Local, in Chrome 152 on the Samsung Galaxy Tab A9 Plus, Android 14.0.

Result: 3 passed, 0 skipped, 0 failed. Chrome's local network prompt held the runner page's requests once, and the driver allowed it.

The three rows separate what the base frame spends on the sun's contact shadows and on screen-space bounce light, the two effects that keep ambient occlusion's three passes. Each row draws the hill with the casting sun, at High, on a canvas of 800 by 1,088 CSS pixels at one and a half drawing pixels each, and warms for 8 seconds before the 5 second measure. A quiet window opened after the run, so the rows ran once and could not be repeated.

| Row | Grass | Contact shadows | Bounce light | GPU median (ms) | Frames | Samples |
| --- | --- | --- | --- | --- | --- | --- |
| `vegetation-grass-nograss-nobounce-webgpu` | off | on | off | 186.25 | 31 | 3 |
| `vegetation-grass-nograss-nocontact-nobounce-webgpu` | off | off | off | 143.49 | 35 | 4 |
| `vegetation-grass-creek-2-nocontact-nobounce-webgpu` | 2,312 | off | off | 235.41 | 24 | 3 |

The first row's per-pass timer names the pass after ambient occlusion's denoise at 183.83 ms, which is the opaque pass: the timer labels the pass that follows with the role of the pass before, and the run with both effects off names the opaque pass itself at 138.94 ms and the final pass at 3.74. So the three ambient occlusion passes cost about 43 ms, the 186.25 against the 143.49, and the figure of 176.36 that the earlier record gave the second pass was the opaque pass in its slot.

The grass at Creek's density adds 91.92 ms to the effects-off base, 235.41 against 143.49, and the row is 27.11 ms past D-241's 208.3 ms ceiling.

The pictures: the hill with the casting sun, drawn on this Mac's GPU on three tiers, gives the same pixels with the contact shadows on, with the bounce light on, off, and with both off. All four drawings matched pixel for pixel at the 0.1 threshold, and the mean channel difference was zero. So neither effect changes what the hill looks like.
