# api-3-substance-11

## Finding as given

- page: api/sketch, api/time, api/tasks, api/render, api/wind
- anchor: sketch line 49 "Hold mode, a replay and a recording load the module only after..."; time lines 56, 65-66; tasks line 56; wind line 338
- category: term-before-definition
- severity: medium
- claim: Hold mode, a replay and a recording are used as known terms and never explained on these pages. Most links go to the top of the testing guide, not its Hold mode section, and replay and recording have no link.
- evidence: docs/guides/testing.md:52 '## Hold mode'; only api/render:450 links #hold-mode.
- proposedEdit: At first use on each page add: "hold mode, in which the engine steps the sketch to a set time and draws one frame for a test ([Hold mode](../guides/testing.md#hold-mode))". In api/sketch also define a replay and a recording and link guides/deterministic-simulation.md.

Verdict: partly

## Evidence

The core claim holds:
- api/sketch.md:49 uses "Hold mode, a replay and a recording" with no definition and links only to the top of guides/testing.md. Line 101 repeats the three terms with no link. Line 138 gives a partial gloss ("when the engine steps the sketch itself, as hold mode and a replay do"), but that comes after the first use. Line 220 links the top of testing.md again.
- api/time.md:56 links the top of testing.md. Lines 65, 66, 68 and 111 use hold mode with no gloss. Line 130 links the top of testing.md.
- api/render.md:450 is the only link to guides/testing.md#hold-mode in these pages.
- guides/testing.md:52 "## Hold mode" defines it. guides/testing.md:135 "## Record a session that went wrong" (lines 137-145) defines a recording (`?record`) and a replay (`?replay=<file>`).

Parts that do not hold as written:
- api/wind.md:338 does not say "hold mode". It says "A held page steps its sketch's updates up to the held time." The issue is the same (an undefined term), but the term is "held page", and the paragraph has no link at all.
- api/tasks.md:56 has no link at all, not a link to the top of the guide.
- The proposed link for replay and recording is wrong. guides/deterministic-simulation.md (lines 16, 22, 101) uses "replay" for a server that replays an input log through the game's own simulation. That is a different thing from the engine's `?record` / `?replay` session files that api/sketch.md:49 and 101 mean. The correct target is guides/testing.md#record-a-session-that-went-wrong.
- The proposed gloss "draws one frame" is not exact. guides/testing.md:63 step 4 says hold mode can also draw the frame before the last (motion vectors) or one more frame at the held time (a mirror or light probe). It reads back one frame. Also, "for a test" is narrower than the guide, which also uses holds for screenshots from the command line.

## Corrected claim

Hold mode (and, in api/wind, "a held page"), a replay and a recording are used without a definition on api/sketch, api/time, api/tasks and api/wind. Links to the testing guide go to its top, not to the right section (api/sketch:49 and 220, api/time:56 and 130). api/tasks:56 and api/wind:338 have no link. Only api/render:450 links #hold-mode. Replay and recording have no link anywhere on api/sketch.

## Corrected edit

- At the first use on api/sketch, api/time, api/tasks and api/wind, gloss the term once: "hold mode, in which the engine steps the sketch to a set time and reads back one frame ([Hold mode](../guides/testing.md#hold-mode))". Point the other testing-guide links on those pages to #hold-mode as well. In api/wind:338, write "In [hold mode](../guides/testing.md#hold-mode), the engine steps the sketch's updates up to the held time." instead of "A held page".
- In api/sketch:49, define the other two terms there: "a recording, which saves each frame's step and input from a page opened with `?record`, and a replay, which runs a recording's frames again ([Record a session that went wrong](../guides/testing.md#record-a-session-that-went-wrong))". Do not link guides/deterministic-simulation.md for these terms, because it uses "replay" for a server's check of an input log.
