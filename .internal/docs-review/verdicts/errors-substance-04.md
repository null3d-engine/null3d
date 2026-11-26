# errors-substance-04

## The finding as given

- page: errors/E1437
- anchor: ## What happened / ## How to fix it
- category: missing-content
- severity: high
- claim: The page reads as if the command fails. By default, after it refuses the archive, the command draws with the installed Google Chrome. It fails only with NULL3D_CHROME=testing, or when no Google Chrome is installed. The page names neither the fallback nor the commands that download the browser.
- evidence: packages/cli/src/browser.js:248-256 (chromeFallback) and :541-560 (launchBrowser with fallback). docs/cli/null3d.md:595 says 'The command then falls back', and :598 says it 'draws with your installed Google Chrome instead'. docs/cli/null3d.md:581 lists shot, test, bench, check-addon and mcp.
- proposedEdit: Add to the cause: 'The command then draws with the installed Google Chrome, and warns that its pictures can differ from the references. It fails with this error only when NULL3D_CHROME=testing asks for Chrome for Testing alone, or when no Google Chrome is installed.' Name shot, test, bench, check-addon and mcp. Link cli/null3d#chrome-for-testing.
- generatedSource: packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts and packages/cli/src/browser.js:96-97

Verdict: partly

## Evidence

- The fallback is real. browser.js:254-256 `chromeFallback` is true unless NULL3D_CHROME=testing. browser.js:365-381 `readyChromeForTesting` catches the install error (which holds the E1437 text from `chromeRefused`, browser.js:105-110, 135-161) and, when fallback is on, prints a warning with that text and returns 'installed'. launchBrowser (browser.js:553-577) then starts Google Chrome. Callers: runner.js:78 (shot, test, bench, check-addon) and mcp.js:401.
- So a reader usually reaches the E1437 page from a warning, not from a failure. The page never says this. Its fix starts "Run the command again", and its last sentence tells a reader on an unsupported platform to set NULL3D_CHROME=installed, which is what already happens by default. That part of the claim holds.
- The claim that the command "fails with this error ... when no Google Chrome is installed" is wrong. With fallback on, readyChromeForTesting returns 'installed' and the launch fails at browser.js:573-574 with missingBrowserFix('chrome-real-gpu', 'installed') = "Google Chrome is not installed. Install it from ... or set CI=1 ..." (browser.js:427). E1437 shows up there only in the warning printed before. Only NULL3D_CHROME=testing turns E1437 into the failure itself (browser.js:376, message = missing-browser fix + E1437 reason).
- The page does not say "the command fails". It says the tool "did not install Chrome for Testing", which is true. The cost to the reader is confusion and a needless rerun, not a blocked newcomer. docs/cli/null3d.md "Chrome for Testing" (the check and "When the download fails" items) already explains the fallback, so the error page only fails to point there. Severity medium, not high.
- The link has no clean place. `cause` is also the front-matter `summary` (tools/lib/docs.ts errorPage), and no cause in codes.ts holds a Markdown link, so a link there shows as raw Markdown in the summary. `fix` must equal CHROME_REFUSED_FIX in browser.js (a unit test checks this) and is printed in the console, so a Markdown link there would print raw too. Other fixes name a docs page as plain text (E1434: "docs/guides/baked-light-data.md"). That form works.
- "warns that its pictures can differ from the references": the runtime warning (browser.js:378) says only that Google Chrome may leave keys in the keychain on macOS. The note about different pictures is in docs/cli/null3d.md, not in the warning. The proposed text puts words in the warning's mouth.
- Naming the five commands is low value on an error page. The reader already ran one of them.

## Corrected claim

By default the command does not stop at E1437. It prints the E1437 text in a warning and draws with the installed Google Chrome. E1437 stops the command only when NULL3D_CHROME=testing is set. With no Google Chrome installed, the command stops with the "Google Chrome is not installed" message, not with E1437. The page says none of this. Its fix also tells a reader on an unsupported platform to set NULL3D_CHROME=installed, which the default already does. Severity medium.

## Corrected edit

In codes.ts, add to the E1437 cause (plain text, no link): "By default the command goes on: it prints this message as a warning and draws with the installed Google Chrome. The error stops the command only when NULL3D_CHROME=testing asks for Chrome for Testing alone."

In fixes.ts and in CHROME_REFUSED_FIX in packages/cli/src/browser.js (keep both equal), replace the last sentence with: "On a platform that has no Chrome for Testing build, the command draws with the installed Google Chrome, or set CI=1 to draw with Playwright's Chromium on the software GPU. docs/cli/null3d.md, under Chrome for Testing, describes the fallback."

Do not name the five commands, and do not add a Markdown link to the cause or the fix.
