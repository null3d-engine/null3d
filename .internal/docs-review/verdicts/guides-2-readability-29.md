# guides-2-readability-29

## Finding as given

- page: guides/loading-screens
- anchor: lines 176-179; line 215
- category: structure
- severity: low
- claim: Three blank lines follow line 176. Line 215 names a section in quotes ('as "A later loading stage" shows') where every other cross-reference is a link, so a website reader cannot click it.
- evidence: lines 177-179 are empty; line 215.
- proposedEdit: Remove two blank lines. Change line 215 to 'as [A later loading stage](#a-later-loading-stage) shows'.
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/guides/loading-screens.md lines 177, 178 and 179 are empty, and line 180 is the heading "## A later loading stage". The page is hand-written: the same three blank lines are in the tracked file at HEAD, so the edit goes in docs/guides/loading-screens.md itself.
- Line 215 ends with "`await scene.warmUp()`, as "A later loading stage" shows." It is the only section name in quotes on the page.
- The page already links its own sections elsewhere: line 134 has "[Repeat visits](#repeat-visits)". So a link at line 215 matches the page's own style.
- The anchor `#a-later-loading-stage` is the GitHub-style slug of the heading at line 180, so the proposed link resolves.
- Caveat: extra blank lines do not show in rendered Markdown, so that half is source tidiness only. The finding is rated low, which fits.

## Corrected claim or edit

None. The proposed edit holds as written.
