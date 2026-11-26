# guides-2-readability-03

## Finding as given

```json
{
 "page": "guides/testing",
 "anchor": "## Check every rendering mode (line 26); ## Image tests from the command line (line 147)",
 "category": "scan-order",
 "severity": "medium",
 "claim": "The intro is about image tests and hold mode, but the first section is a frame-rate and memory checklist with the stats overlay fields. Then Playwright code (line 99) comes before the two commands that need no test code (shot, line 119; test, line 149). A newcomer reads the hardest path first.",
 "evidence": "line 28 'check frame rate, memory and looks in each of these'; lines 45-50 explain the overlay's Sketch, Drawing, GPU and Scale fields; line 149 '`bunx @null3d/cli test` runs your image tests with no test code.'",
 "proposedEdit": "Reorder H2s: Hold mode; Image tests from the command line; A held frame from the command line; Frames that stay the same on every run; When a hold fails; Reading the result in a test; Record a session that went wrong; Browser tests of a whole app; Check every rendering mode; Switches for tests. Move the stats overlay list (lines 45-50) to the performance guide's Measure section and leave one sentence with a link.",
 "generatedSource": "",
 "id": "guides-2-readability-03",
 "slice": "guides-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The scan-order claim holds. docs/guides/testing.md:24 (intro) is about image tests and hold mode. The first H2 at line 26 is a measuring checklist (frame rate, memory, looks), with the stats overlay list at lines 45-50. The front matter summary (line 6) does not list this topic. The Playwright code (lines 99-113) comes before `shot` (line 119) and `test` (line 149). Both say they need "no test code".
- The order inside the proposal has a flaw. "Image tests from the command line" uses the idea of a shot step at line 166 ("each shot step of the script"). The page explains timed scripts and shot steps first at lines 127-133, in "A held frame from the command line". With `test` first, the reader meets "shot step" before its explanation. Keep `shot` before `test`.
- The move of the stats overlay list should not happen. Two pages send readers to this section for how to measure: docs/guides/performance.md:15 ("[Testing your sketch](testing.md#check-every-rendering-mode) says how") and docs/guides/phones.md:121. If the list moves to the performance guide's Measure section, the performance guide sends readers here, and this page sends them back. The Measure section (performance.md:302-304) already describes the overlay in its own paragraph. The section can move to the end of the page with its heading unchanged, so both links still work. At the end of the page, the list no longer blocks a newcomer.

## Corrected claim

The page puts a measuring checklist first and the Playwright code before the two commands that need no test code. A newcomer reads the hardest path first. The fix is a reorder only. The stats overlay list should stay in its section, because two other guides link to that section for how to measure.

## Corrected edit

Reorder the H2s: Hold mode; A held frame from the command line; Image tests from the command line; Frames that stay the same on every run; When a hold fails; Reading the result in a test; Record a session that went wrong; Browser tests of a whole app; Check every rendering mode; Switches for tests. Keep the heading "Check every rendering mode" as it is, so the links from performance.md:15 and phones.md:121 still work. Keep the stats overlay list (lines 45-50) in that section. Do not move it to the performance guide.
