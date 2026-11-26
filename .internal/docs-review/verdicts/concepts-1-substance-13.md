# Verdict: concepts-1-substance-13

## The finding as given

- Page: concepts/backends
- Anchor: ## Choosing a tier for testing, line 168 ("The switch `?half=on` ...", 162 words); ## Minimum browsers, line 190 (170 words); other long paragraphs at file lines 21, 35, 37, 60, 78, 80, 82, 84, 96, 98, 118, 120, 140, 144, 158, 176
- Category: wall-of-text. Severity: medium.
- Claim: The URL switches are a reference list written as prose, so a reader cannot scan for one switch. The user-agent rules at line 190 are implementer detail.
- Evidence: stats.json concepts/backends (18 long paragraphs).
- Proposed edit: Turn lines 162-172 into a table with three columns (switch, values, what it tests), covering ?gpu=, ?uploads=copy, ?compile=wait, ?half=on, ?hdr=off, ?scene-format=, ?prepass=, ?occlusion=, ?depth=, ?compression= and ?wake=message. At line 190, keep "null3D does not support Safari before 18, and createEngine fails there with E1306." Move the Safari 17 faults and the user-agent rules into <details><summary>Technical details: how the engine detects old Safari</summary>.

Verdict: partly

## Evidence

- The problem is real. docs/concepts/backends.md:168 puts five switches (`?half`, `?hdr`, `?scene-format`, `?prepass`, `?occlusion`) and the small-float mantissa detail into one 162-word paragraph. Lines 164, 166, 170 and 172 give one switch each in prose. A reader cannot scan for one switch.
- The proposed table is wrong for this page. docs/guides/testing.md:212 ("## Switches for tests") already has a table of every switch the finding lists: `?gpu` (line 219), `?depth` (221), `?uploads=copy` (222), `?compile=wait` (224), `?compression` (227), `?wake=message` (230), `?scene-format` (238), `?half` (240), and others. A second table on backends.md would repeat it and drift from it. backends.md never links to that table (no "testing.md" link on the page). The testing table also says that switches work only in development builds (testing.md:214), which backends.md does not say.
- The switches are real. packages/engine/src/page/switches.ts:452-512 reads all of them.
- `?wake=message` is in "## Minimum browsers" (backends.md:192), not in lines 162-172. Moving it into a table in the testing section would take it away from the Firefox 145 fact that it belongs with.
- Line 190 split holds in part. The `AppleWebKit/` 600 rule and the `Version/` parse match packages/engine/src/page/browser-check.ts and shared/webkit.ts; they are implementer detail and fit a block. But the proposal keeps only one sentence in the main text. The fact that every browser on iPhone and iPad runs WebKit, so Chrome, Edge and Firefox on iOS before 18 also fail with E1306, tells a developer which of their users get the error. It must stay in the main text. One short clause on why (Safari 17 faults that no feature test finds) also helps a reader who asks "Safari 17 has SIMD, why is it refused?".
- The finding lists 16 other long paragraphs (stats.json, line numbers offset by 7) but proposes no break or block for any of them, so for those lines it gives no edit to judge.

## Corrected claim

The test switches on this page are a reference list written as prose (lines 164-172), and the guide "Testing your sketch" already holds the same list as a table that this page does not link to. Line 190 mixes the user-facing rule (Safari and every iOS browser before 18 fail with E1306) with how the check reads the user agent, which is implementer detail.

## Corrected edit

- Lines 162-172: keep line 162 (forcing a tier with `gpu` or `?gpu=`). Replace lines 164-172 with one short paragraph: "Other switches make one device test the paths of other devices: copied uploads, shader compiles without the parallel compile extension, the 8-bit color path, each WebGL2 depth mode and each compressed texture family. The switches work only in development builds. [Switches for tests](../guides/testing.md#switches-for-tests) lists them all." Keep the WebGL2 facts that explain each tier (uploads fall back to a copy where a browser refuses shared memory; `standard` depth draws no shadows) in the main text or in a block, for example `<details><summary>Technical details: what each tier switch changes</summary>`, with the scene-format mantissa figures and the phone measurement inside it. Do not add a second table.
- Line 190: main text: "Safari 16.4 and 17 pass the engine's feature tests, but the engine meets faults there that no test finds in advance. So null3D does not support Safari before 18, and `createEngine` fails there with E1306 before it starts a worker or asks for memory. Every browser on iPhone and iPad runs Safari's WebKit engine, so Chrome, Edge and Firefox on iOS and iPadOS before 18 fail the same way." Then `<details><summary>Technical details: how the engine detects old Safari</summary>` with the two Safari 17 faults (shared memory refused on a 4 GB phone, a standard material shader rejected), the Vite plugin download note, and the user-agent rules.
- Leave `?wake=message` at line 192.
