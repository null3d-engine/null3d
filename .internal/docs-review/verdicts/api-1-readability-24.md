# api-1-readability-24

## Finding as given

```json
{
 "page": "api/assets",
 "anchor": "## Environments (lines 245-257)",
 "category": "scan-order",
 "severity": "medium",
 "claim": "Thirteen bullets mix what an Environment holds, sizes, GPU times, format limits, the sky refresh and advice. The advice a newcomer needs first, which file to use, is the last bullet. Three bullets repeat the 'loads the code and shaders... resolves once ready' rule.",
 "evidence": "assets.md:257 'The tool's file needs no reading or filtering at load, so prefer it...'. The repeated rule appears at :248, :251 and :253.",
 "proposedEdit": "After the two file kinds (lines 226-227), add H3 'Which to use' with line 257. Group the rest under H3 'When each one is ready', with one bullet each for a KTX2 file, an HDR file, the room and the sky. Move the timings, the clamp, the OpenEXR list and the 20-stage refresh to a details block.",
 "generatedSource": "",
 "id": "api-1-readability-24",
 "slice": "api-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/api/assets.md is a hand-written page (no generator owns it), so an empty generatedSource is right.
- The section starts at line 222. Lines 245 to 257 are 13 bullets, as claimed. They cover the Environment's fields (245), load sizes (246), KTX2 upload timing (247), the HDR worker and readiness (248), the HDR face size and the 65,408 clamp (249), the OpenEXR support list (250), builtinEnvironment readiness and GPU times (251), early download (252), skyEnvironment readiness (253), the sky refresh in 20 stages (254), destroy (255), rejected KTX2 files (256) and the choice of file (257).
- Line 257 holds the only advice on which file to ship, and it is the last bullet. The claim holds.
- The repeated rule is worse than claimed. The "code and shaders that make the room" load and readiness appear in five bullets, not three: 246, 248, 251, 252 and 253.
- The two file kinds are at lines 225 and 226, not 226 and 227 (off by one).

## What does not hold in the proposed edit

- An H3 "Which to use" directly after the two-kind list (line 226) would put the built-in room and sky paragraph (229) and the code example (231-242) under "Which to use". Those are not about choosing a file. The heading would mislabel them.
- The edit names no place for line 245 (what an Environment holds), 255 (destroy) or 256 (other KTX2 files fail with E1412). They are not readiness facts, so "When each one is ready" does not fit them.
- The details block must not take the advice that rests on the timings. "Ask for the room while the scene loads. During play, the call makes one long frame" (251) and "Load HDR files while the scene loads" (248) must stay in the main text. Only the figures can move.

## Corrected claim

The 13 bullets mix facts of several kinds, and the advice on which file to ship comes last. The rule about loading the room's code and shaders repeats across five bullets (246, 248, 251, 252, 253).

## Corrected edit

1. After the two-kind list (lines 225-226), add the advice from 257 as a plain paragraph with no heading: prefer the tool's KTX2 file for maps that ship with a game; use an HDR file for maps that change, such as user uploads.
2. Keep 245 (fields), 255 (destroy) and 256 (rejected KTX2 files, E1412) as main-text bullets after the code example.
3. Merge 246 and 252 and the repeated parts of 248, 251 and 253 into one bullet: the first room, sky or HDR call starts the download of the code and shaders that make the room (about 12 KB after Brotli), and each call resolves once they are ready.
4. Then one short bullet each for the KTX2 file, the HDR file, the room and the sky, saying when its light is on screen. Keep "load it while the scene loads" in the room and HDR bullets.
5. Move these into one block, `<details><summary>Technical details: sizes, limits and GPU times</summary>`: the reader sizes (under 1 KB, 6.5 KB), the 256-texel faces, the 2,048-texel averaging, the 65,408 clamp, the OpenEXR support list, the GPU times (20 ms, 50 to 110 ms, 10 ms), the 20-stage sky refresh and its thresholds, and the Venice Sunset download sizes. No headings inside the block.
