# start-readability-13

## Finding as given

- page: getting-started/network-use
- anchor: ## The command-line tool, lines 73 and 80
- category: long-paragraph
- severity: medium
- claim: Line 73 is 162 words and 11 sentences on the test browser download, hash check, fallback, cache folder and settings, and repeats the CLI page's Chrome for Testing list. Line 80 is 85 words and 7 sentences on mcp addresses.
- evidence: stats.json lines 66 and 73 (file 73 and 80). cli/null3d.md lines 594 to 599 give the same facts.
- proposedEdit: Make line 73 a table Case | What the tool downloads (first GPU draw: Chrome for Testing once from storage.googleapis.com, hash checked; CI set: nothing; NULL3D_CHROME=installed: nothing; mcp --connect: nothing), then link to cli/null3d#chrome-for-testing for the hash and folder. Make line 80 a three-item list: default, --url, --connect.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- stats.json gives the two long paragraphs: 162 words and 11 sentences (stats line 66), and 85 words and 7 sentences (stats line 73). In the page file they are at lines 73 and 80 to 84. The counts hold.
- Page line 73 covers six topics in one block: the pinned browser, the source host, the hash check and E1437, the fallback when the check fails, the shared cache with its hash record, and the settings that turn the download off. The paragraph is too long, as the finding says.
- The repeat claim holds only in part. cli/null3d.md lines 594 to 599 (the "Chrome for Testing" list) give the hash check, the fallback, the cache folder with its hash record, and both browser settings. But they do not name the host `storage.googleapis.com`. They also do not say "the tool makes no other request to that host, and a page never makes it". Those facts are the reason the network page exists, so they are not a repeat and must stay in the main text.
- Page line 80 (wrapped over lines 80 to 84) has one fact per sentence: standard input and output, the default, `--url`, `--connect`, "either address may be on another machine", "no other address", and "no Chrome download with `--connect`". A three-item list fits it well. The two closing facts must stay, as text under the list.
- The proposed table drops facts that a network page must keep: the host name in plain words, "once", "a page never makes this request", "no other request to that host", and the case where the hash fails (the archive is deleted and the command draws with the installed Chrome, or stops when `NULL3D_CHROME=testing` is set). It also has no row for the hash-failure case.

## Corrected claim

Both paragraphs are too long and should be split. Line 73 repeats the CLI page only for the fallback, the cache folder and its hash record. The host name and the "no other request" facts are unique to this page and must stay in the main text.

## Corrected edit

Line 73: keep a short main paragraph, then a table, then a collapsible block for the repeated detail.

Main text: "To draw on your computer's GPU, the tool uses one pinned version of Chrome for Testing. It downloads it once, from Google's Chrome for Testing releases on `storage.googleapis.com`, and checks its SHA-256 hash before it unpacks it. The tool makes no other request to that host, and a page never makes it."

Table `Case | What the tool downloads`:
- First command that draws on the GPU | Chrome for Testing, once, hash checked
- Hash does not match | The archive is deleted and nothing is installed ([E1437](../errors/E1437.md)). The command draws with the installed Google Chrome, or stops when `NULL3D_CHROME=testing` is set
- `CI` is set | Nothing; it draws on the software GPU
- `NULL3D_CHROME=installed` | Nothing; it draws with the installed Google Chrome
- `mcp --connect` | Nothing; it starts no browser

Then a `<details>` block, "Technical details: the cache folder", with the shared cache, the hash record kept beside the build, "a copy without that record downloads again", and a link to [the command-line tool's page](../cli/null3d.md#chrome-for-testing) for the folder path. Linking only, with no block, is also fine, because the CLI page holds the same facts.

Line 80: one opening sentence (the command talks to the agent over its standard input and output), then a three-item list: default (serves the page and drives the browser on this machine, as `shot` does), `--url` (opens the dev server at the given address), `--connect` (attaches to the Chrome debugging endpoint at the given address, and starts no browser, so it downloads no Chrome). Close with: "Either address may be on another machine. The command contacts no other address of its own choice."
