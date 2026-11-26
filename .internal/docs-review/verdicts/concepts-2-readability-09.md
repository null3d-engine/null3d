# concepts-2-readability-09

## Finding as given

- page: concepts/quality-presets
- anchor: ### Moment transparency, lines 212-214
- category: internal-note
- severity: medium
- claim: Line 214 names 'this computer's GPU in Chrome 156', which the reader cannot know. It also says 'A phone's figure is owed', a promise of a later measurement. Line 212 is 192 words of byte arithmetic that buries the point.
- evidence: Line 214: 'at High on this computer's GPU in Chrome 156 ... A phone's figure is owed, and a desktop GPU's fill rate is not a phone's.' stats.json line 205: 192 words, 8 sentences.
- proposedEdit: Name the machine ('on a MacBook Pro in Chrome'). Remove 'A phone's figure is owed', and keep 'A desktop GPU's fill rate is not a phone's, so measure on the phone.' Main text: 'The layer adds 32 to 36 bytes per pixel of targets, and about 0.6 ms of GPU time a frame on WebGPU in the S1 benchmark.' Move line 212's breakdown into <details><summary>Technical details: the moment layer's memory</summary>.

Verdict: survives

## Evidence

- docs/concepts/quality-presets.md:214 says "on this computer's GPU in Chrome 156" and "A phone's figure is owed". Both are copied from the maintainers' decision record for the layer (.dev/decisions/D-261-moment-transparency.md:7-8, 13, 181, 196-197: "this computer's GPU", "the phone's cost figure is owed"). "This computer" means the maintainer's own machine, so a reader cannot know it. "Owed" is a promise of later work, which the AGENTS.md "Writing docs" rule keeps out of docs/.
- The machine is a MacBook Pro in Chrome 156: the .dev tested-devices folders for Chrome on this machine are macbook-pro-chrome and macbook-pro-m3-max-chrome, and docs/guides/performance.md:46 already says S1 "ran in Chrome with WebGPU on a MacBook Pro". So the proposed name matches the docs.
- docs/concepts/quality-presets.md:212 is the 192-word, 8-sentence paragraph (stats.json line 205). It mixes the main point (the layer adds memory and GPU time) with a byte-by-byte sum. A details block suits the sum. No other page or block on the page already says this in short form.

## Corrected edit

The finding holds. Two parts of the proposed main text need a fix:

1. It keeps only the WebGPU time and drops WebGL2, which costs nearly twice as much (1.12 ms against 0.58 ms). A WebGL2 reader would get the wrong cost. It also drops the measured memory (40 MiB and 52 MiB), which is the figure that a reader can act on, and keeps the bytes-per-pixel figure instead.
2. "S1 benchmark" has no explanation on this page. Link it to the page that explains it.

Also check the "32 to 36" range before you copy it. The page's own parts add up to 16 + 8 + 4 or 8, plus 4 only for a multisampled scene. That gives 28 to 36 when the scene is not multisampled.

Main text:

> The layer costs memory and GPU time. On the Island showcase at High at 1920 x 1080, GPU textures grew by 40 MiB on WebGPU and by 52 MiB on WebGL2. In the [S1 benchmark](../guides/performance.md) at High, on a MacBook Pro in Chrome, it added about 0.6 ms of GPU time a frame on WebGPU and about 1.1 ms on WebGL2. It adds almost no processor time. A desktop GPU's fill rate is not a phone's, so measure on the phone.

<details>
<summary>Technical details: the moment layer's memory</summary>

Line 212's byte breakdown (moment store, color sum, SMAA steps, resolve copy, depth copy, the 32 to 36 bytes per pixel, the 33 MB of writes), the 10 bytes of the weighted blending, the SMAA and MSAA note, and the percentages (sixteen and twenty per cent of the scene's GPU frame, with the smoke switch).

</details>
