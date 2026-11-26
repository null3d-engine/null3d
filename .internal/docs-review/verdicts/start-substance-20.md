# start-substance-20

## Finding as given

- Page: cli/null3d
- Anchor: mcp options table, --url row (line 218) "The server still starts its own browser"
- Category: unclear
- Severity: low
- Claim: The command starts the headless browser, not the dev server.
- Evidence: packages/cli/src/mcp.js:11 ("--url attaches to a dev server that already runs, still with its own headless browser").
- Proposed edit: "Uses a dev server that already runs, instead of starting one. The command still starts its own headless browser."
- Generated source: none (hand-written page)

Verdict: survives

## Evidence

- docs/cli/null3d.md:218 says "The server still starts its own browser". The row is about the dev server. In the same table, the --page row says "from the server's root", where "server" means the dev server. So a reader will take "the server" in the --url row to mean the dev server. That is wrong: with --url, nothing starts the dev server, and the dev server never starts a browser.
- packages/cli/src/mcp.js:400-401: when --url is given, the mcp command itself calls launchBrowser(defaultEnvironment()). packages/cli/src/browser.js:567 launches it with headless: true. So "the command still starts its own headless browser" is accurate.
- The "Without it" column of the same row already says "The command starts the dev server", so the proposed wording matches the table's own subject.
- docs/guides/debugging.md:184 already uses the clear form ("uses a dev server that already runs, and still starts its own headless browser"), so the fix also brings the two pages in line.
- The page is hand-written, not generated, so the edit goes into docs/cli/null3d.md directly.

## Note

The CLI help text in packages/cli/src/mcp.js:55-56 has the same unclear wording ("The server still starts its own browsers"). It is not a docs page, but a fix there would keep the help and the page in step.
