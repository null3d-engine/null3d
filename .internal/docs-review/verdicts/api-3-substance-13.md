# api-3-substance-13

## Finding as given

- page: api/sound
- anchor: line 77 "throws error 2504"; line 121 "gets error 2501"
- category: missing-content
- severity: medium
- claim: The thrown message reads "sound E2504: ...", so a search for "error 2504" finds nothing. The page has no errors table, and E2500, E2502 and E2503 are not mentioned. None has an error page.
- evidence: packages/sound/src/errors.ts:4-9 (SOUND_CODES = 2500, message 'sound E${code}: ...'); packages/sound/src/sound.ts:256, 372 (2502), 395 (2501), 418, 520 (2503), 647 (2504).
- proposedEdit: Write E2504 and E2501 in the text. Add "## Errors" with E2500 (bad options, missing file, far not above near, destroyed system), E2501 (more than 32 voices), E2502 (no room in the table: raise capacity), E2503 (member index out of range), E2504 (a second sound system), as api/splats does.

Verdict: survives

## Evidence

- packages/sound/src/errors.ts:7-8 builds the message as `sound E${code}: ${detail}`. The page writes "error 2504" (docs/api/sound.md:77) and "error 2501" (docs/api/sound.md:121). The form differs from what the console shows.
- docs/api/sound.md mentions only 2501 and 2504 (grep for "error" and "25xx" finds only lines 77 and 121). Its headings have no "Errors" section.
- docs/errors/ holds pages for E11xx to E15xx and an index. It has no E25xx page, and docs/errors/index.md has no sound entry.
- The codes in packages/sound/src/sound.ts:
  - E2500 (SOUND_CODES): missing or empty file (256), a number that is not finite or is too small (264), destroyed system (413), far not above near (418), count or voices not whole (507, 559), no listener (634), capacity not a whole number up to the maximum (640).
  - E2501 (+1, 394): too few free voices.
  - E2502 (+2, 371): no run of free emitters; raise capacity.
  - E2503 (+3, 520): group member index out of range.
  - E2504 (+4, 646): a second live sound system.
- docs/api/splats.md:234-251 has the "## Errors" table with Code and Cause columns that the edit cites as the model. Nine other api pages also have such a section. The edit follows an existing pattern and breaks no writing rule.

## Refinement to the edit (not a correction of the claim)

Make the E2500 row name its causes in full: "A missing listener or file; a count, voices, capacity, volume, near or far that is not a valid number; far not above near; or a call on a destroyed sound system." Write the codes as E2501 and E2504 in lines 77 and 121, so a reader who searches the page for the console text finds them.
