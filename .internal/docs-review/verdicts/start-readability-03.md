# start-readability-03

## Finding as given

- page: cli/null3d
- anchor: # The `null3d` command (line 9)
- category: split-page
- severity: high
- claim: Ten commands share one page of 7,450 words and 25 headings, with no list of the commands near the top. A reader who wants test must scroll past shot and mcp. The commands do not depend on one another.
- evidence: stats.json cli/null3d: 7450 words, 25 headings, 14 long paragraphs, 5 Mermaid diagrams. The only overview is the front matter summary.
- proposedEdit: After the bunx block (line 21), add a table: Command | What it does | Who needs it, one row per command. Then split: cli/null3d (overview, create, upgrade, Where the commands draw), cli/shot (shot, replay, timed scripts), cli/test, cli/bench, cli/mcp, cli/assets, and cli/check-addon (or move it into the add-ons guide). Add the pages to AREAS and PAGES in tools/lib/docs.ts.

Verdict: partly

## Evidence

What holds:
- The page body has no list of commands. Lines 9-23 give the intro, a `--help` block and the Node version, then `## create` starts at line 25. The only list is the front matter summary (line 6).
- docs/getting-started/install.md:106 says "[The `null3d` command](../cli/null3d.md) lists every command", but the page has no such list. A reader who follows that link finds no overview. The table is a real fix.
- The size (7,450 words, 25 headings, 14 long paragraphs) is a fact from stats.json.

What does not hold:
- "The commands do not depend on one another" is wrong. The sections link to each other a lot:
  - `test` uses timed scripts, which are defined under `shot` (lines 126, 296: "A [timed script](#timed-scripts)").
  - `mcp` starts the server and browser "as `shot` does" (line 203).
  - `bench` JSON fields are "as for `shot`" (line 395); "Measure fairly" compares `bench` with `shot` and `test` (line 404).
  - `check-addon` draws "as `bench` does" and waits for the preset check "like `bench`" (line 440).
  - `test` references depend on "Where the commands draw" (line 306), and that section covers `shot`, `test`, `bench`, `check-addon` and `mcp` (line 581).
  A split is still possible, but each new page needs links back to the shared parts. The finding does not plan for this.
- Severity high is too strong. Each command has its own `##` heading, so a reader can jump to it. Nothing misleads the reader or blocks a newcomer. Medium fits: the page is clearly harder to use than it needs to be.
- The proposed edit leaves out the inbound links that a split breaks. Anchored links into this page: docs/guides/add-ons.md:157 (#check-addon), docs/guides/testing.md:133 (#timed-scripts), :168 (#test, #references-and-results), docs/guides/agents.md:67 (#mcp), docs/guides/debugging.md:193 (#mcp), docs/guides/performance.md:341 (#bench), docs/api/engine.md:218 (#upgrade), docs/porting/verification.md:76 (#test), :127 (#bench), docs/getting-started/network-use.md:73 (#chrome-for-testing), and the skills under skills/null3d-develop/references/ (testing-and-debugging.md, e2e-testing.md) and skills/null3d-port-threejs/references/verification.md. The CLI help text links to docs/cli/null3d.md (packages/cli/src/cli.js:64). That link still works if the overview keeps the id cli/null3d.
- Side note: PAGES in tools/lib/docs.ts:189 gives the summary "create, test, bench, check-addon, shot, upgrade, assets." and leaves out `mcp`. The page front matter includes it. The new table should be the full list, and the PAGES summary needs `mcp` added.

## Corrected claim

The page covers ten commands in 7,450 words and has no list of commands in its body, though install.md promises one. Each command has its own heading, so a reader can jump to it, but nothing near the top says which command does what. The commands share a lot: timed scripts (used by `shot` and `test`), the browser setup (shared by `shot`, `mcp`, `bench` and `check-addon`) and "Where the commands draw" (used by five commands). Severity: medium.

## Corrected edit

1. Required: after the `bunx` block (line 21), add a table with one row per command: Command | What it does. Link each command name to its section. Keep the "Who needs it" column only if it says something the "What it does" column does not.
2. Add `mcp` to the cli/null3d summary in PAGES (tools/lib/docs.ts:189).
3. Optional, if the page is split: keep the id cli/null3d for the overview, create, upgrade and "Where the commands draw". Put timed scripts and replay on the `shot` page, and link to them from the `test` page. Put the "as `shot` does" browser setup in one place and link to it from the `mcp`, `bench` and `check-addon` pages. Add each new page to PAGES under the `cli` area. In the same branch, update every anchored link listed above, in docs/ and in skills/.
