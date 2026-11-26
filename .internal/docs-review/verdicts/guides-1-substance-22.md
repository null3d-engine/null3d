# guides-1-substance-22

## Finding as given

- Page: guides/deterministic-simulation
- Anchor: long paragraphs at lines 56, 110, 166, 218, 222
- Category: technical-details-block. Severity: medium.
- Claim: Line 56 gives four bundle sizes from two Bun versions to make one point, and names 'a replaying engine's scan' without explaining it. Line 110 lists every listener that input: false keeps and drops.
- Evidence: .internal/docs-review/stats.json guides/deterministic-simulation (statistics 49, 103, 159, 211, 215).
- Proposed edit: Line 56 main text: "Never import @null3d/engine itself in simulation code. It brings engine code that uses Math.sin, Math.random and page APIs, which a replay must not run." Byte counts in 'Technical details: measured bundle sizes'; explain or drop 'scan'. Line 110: first two sentences and the link.

Verdict: partly

## Evidence

- The five long paragraphs are facts from stats.json (stats lines 49, 103, 159, 211, 215 are page lines 56, 110, 166, 218, 222; the page has a 7-line front matter).
- Line 56 gives three byte sizes (9,133, 1,202 and 87,857), not four. The point and the two Bun versions are as the finding says. "a replaying engine's scan" appears only on line 56 and nowhere else on the page. That part holds.
- The proposed main text for line 56 is wrong. The page says the current bundler (Bun 1.4.3) drops unused code but still keeps engine code with a top-level `FinalizationRegistry`. The source confirms it: packages/engine/src/page/ownership.ts:108 creates one at module load. The list of `Math.sin`, `Math.random` and page APIs is about a bundler that keeps whole namespaces (Bun 1.3.11). The proposed sentence gives the second case as the only reason, and drops the reason that applies to a bundler that does tree-shake.
- Line 110 does not list every listener. It names the kinds of input listener that are dropped, gives one kept listener as an example, and links to "Input off". docs/api/input.md:206-231 has the full list: pointer capture, the context menu and the kept-listener table are all there. So cutting line 110 to its first two sentences and the link loses nothing. That part of the edit holds. The last sentence ("The library that records the player's input listens alone") can stay, because it states the point of the section.
- The finding's anchor names lines 166, 218 and 222, but the claim and the edit say nothing about them. It also misses a real problem: lines 218 and 222 give the same 5-word measurement twice, with different numbers. Line 218 says 300 files and 26 MB, against 762 files and 226 MB. Line 222 says 297 files and 26,057,130 bytes, against 759 files and 225,683,678 bytes. A reader cannot tell if these are two games or one.

## Corrected claim

Line 56 uses three byte sizes from two Bun versions to make one point, and does not explain "a replaying engine's scan". Line 110 names the kinds of listener that `input: false` drops and gives one kept listener as an example, and the linked "Input off" section already has the full list. Lines 218 and 222 give the same measurement twice, with numbers that do not agree. The proposed main text for line 56 gives the wrong reason for the current bundler.

## Corrected edit

- Line 56 main text: "Never import `@null3d/engine` itself in simulation code. A bundler that drops unused code still keeps engine code that runs at load, such as a `FinalizationRegistry`. A replay that checks the simulation's bundle for page-only APIs refuses it. A bundler that keeps whole namespaces also brings page APIs, and helpers that call `Math.sin` and `Math.random`." Put the Bun versions and the 9,133, 1,202 and 87,857 byte figures, and the full list of APIs, in a block titled "Technical details: measured bundle sizes".
- Line 110: keep the first two sentences, the link to "Input off" and the last sentence. Cut the pointer capture, context menu and `visibilitychange` sentences, because "Input off" covers them.
- Lines 218 and 222: keep one measurement. Keep the recording steps of line 218 in the main text: start control with `--click`, a development build to record, then a narrowed production build. Move the measured file counts and bytes (with Brotli and the full-set size) into one block titled "Technical details: a measured game folder". Make the numbers agree. Keep "Record again after the game gains a feature..." and the next sentence in the main text.
- Line 166: split after the sentence with the link. The paragraph is a little long, and a block is not needed.
