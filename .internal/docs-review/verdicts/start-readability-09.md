# start-readability-09

## Finding as given

- page: cli/null3d
- anchor: ## Replay a recording (line 112); ## Timed scripts (line 124)
- category: heading-depth
- severity: medium
- claim: These H2s read as two more commands, but they are shot --replay and shot --script. The command order also differs from use: mcp sits between shot and test, while the install page shows test as the first command.
- evidence: Heading order: create, shot, Replay a recording, Timed scripts, mcp, test, bench, check-addon, assets, upgrade. install.md line 101 runs test first.
- proposedEdit: Make them ### under ## shot; turn their own H3s into paragraphs or a details block so nothing falls to H4. Reorder H2s: create, test, shot, bench, mcp, assets, upgrade, check-addon, Where the commands draw.

Verdict: partly

## Evidence

- "Replay a recording" (docs/cli/null3d.md:112-122) is only about `shot --replay`. Its sole example is `shot --replay`, and the shot options table links to it (line 63). Making it an H3 under shot holds. It has no H3s of its own, so nothing drops to H4. The anchor `#replay-a-recording` keeps its slug.
- "Timed scripts" (line 124) is not only `shot --script`. Its first paragraph says that `shot --script` draws the images and that a `test` entry with `script` compares them (line 126). The test list's settings table links to it (line 296: `script` | A [timed script](#timed-scripts)), and guides/testing.md:133 links to it as the step reference. It is a file format that two commands share. If it sits under shot, the test section and the testing guide point into the middle of the shot section.
- Its two H3s differ. "Objects in a script" (line 158) is shared reference detail. "What shot draws with a script" (line 174) is shot-only output.
- The headings do not look like commands. Each command heading is the bare command name in lower case (`create`, `shot`, `mcp`). "Replay a recording" and "Timed scripts" are sentence-case phrases. The page outline still mixes them in with the commands, so the cost is real but small.
- The reorder part fails. Later sections build on shot: mcp says it starts the server and browser "as `shot` does" (line 205), a page test opens the page "as `shot` does" (line 302), and bench's JSON says "as for `shot`" (line 395). The proposed order puts test before shot, which turns these into forward references. getting-started/install.md:101 runs `bunx @null3d/cli test` as a single example of how to call the command. It does not set a reading order. Moving mcp after test and bench is reasonable, but that is taste and low severity.

## Corrected claim

"Replay a recording" is `shot --replay` only and should be an H3 under shot. "Timed scripts" is a script format that both `shot --script` and the `script` setting of `test` read, so it is not only part of shot. Moving mcp later is optional polish. Putting test before shot would break the "as `shot` does" references in later sections.

## Corrected edit

1. Move "## Replay a recording" to "### Replay a recording" at the end of the shot section, after "### When it draws no frame". The anchor does not change.
2. Keep "## Timed scripts" as an H2, but move it after "## test", because both shot and test use it. Open it with one sentence that names both users. Move "### What shot draws with a script" up into the shot section as an H3 ("### With a timed script"), because it describes shot output. "Objects in a script" stays as an H3 under Timed scripts. Its name-splitting rules (the last-dot split for `set` and for `dump`) can go in a `<details>` block titled "Technical details: how a step splits an object name from a property", so the main text keeps only the rule that a step names an object by its scene name, plus the property list.
3. H2 order: create, shot, test, Timed scripts, bench, mcp, check-addon, assets, upgrade, Where the commands draw. Shot stays before the commands that refer back to it. Also bring the front-matter summary order (line 6) in line with the headings.
