# start-substance-29

## Finding as given

- page: getting-started/hosting, cli/null3d
- anchor: hosting line 267 "Chrome 156 and earlier have a fault ... Chrome 157 fixed it."; cli line 319 "Chrome 156.0.8078.80"
- category: missing-content
- severity: low
- claim: The command's pinned Chrome for Testing is 156, which the hosting page says rarely keeps the compiled core. A developer who times repeat starts with the tool's browser sees a slower repeat start than users get, and neither page says so.
- evidence: packages/cli/src/browser.js:68 (CHROME_FOR_TESTING_VERSION = '156.0.8078.80'); hosting.md:267.
- proposedEdit: In the new technical-details block for line 267, add: "The command line tool's pinned Chrome for Testing is a version with this fault, so time repeat starts in a current Google Chrome."

Verdict: refuted

## Evidence

- The fact holds: packages/cli/src/browser.js:68 pins Chrome for Testing 156.0.8078.80, and hosting.md:267 says Chrome 156 and earlier rarely keep the compiled core.
- The reader scenario does not exist. No command of the tool times a start, first or repeat:
  - cli/null3d.md:347 says `bench` waits for the first frame and the preset check, then measures play: "So a run measures the preset that plays, not the start."
  - cli/null3d.md:356 calls each bench run a "fresh run", and the tool opens every page in a new browser context (packages/cli/src/runner.js:129, mcp.js:407, check-addon.js:950/1397: `browser.newContext`), so no HTTP cache or code cache carries from one run to the next. A repeat start cannot happen in the tool's browser even with a fixed Chrome.
  - cli/null3d.md:405 tells readers never to read timings from `shot` and `test`, which run the dev server.
- The docs already send start timing to the reader's own browser: guides/start-time.md:296-320 ("Measure a start") says to time a first visit and a repeat visit in the browser's developer tools. start-time.md:134 repeats that Chrome 157 and later keep the core and 156 and earlier rarely do.
- So no reader is led to time repeat starts in Chrome for Testing, and the proposed sentence would warn against a workflow the tool does not offer. It would also tie the hosting page to the tool's current pin, which the CLI page says can move with any release (cli/null3d.md:592), so the sentence would go stale.

## Corrected claim or edit

None. No edit is needed.
