# start-readability-27

## The finding as given

- Page: getting-started/third-party-notices
- Anchor: ## Where the notices are (line 90); line 34
- Category: scan-order
- Severity: low
- Claim: The one action for a game developer, keep null3d-third-party-notices.txt with the build or show it in the credits, comes at the end after three large tables. Line 34 gives half of it.
- Evidence: third-party-notices.md lines 34 and 94.
- Proposed edit: Add ## What to publish right after the intro with the action from line 94. Delete the second sentence of line 34 and the second paragraph of ## Where the notices are.

Verdict: partly

## Evidence

- The page text matches the claim. Line 34 says only that a production build writes `null3d-third-party-notices.txt`. The action ("Keep that file with the build when you publish it, or show its text in your game's credits") is first given at line 94, the last line, after the package table (lines 17-32), the engine table (lines 40-54) and the two tool tables (lines 64-84).
- The behavior is real: the Vite plugin names the file `null3d-third-party-notices.txt` (packages/vite-plugin/src/index.ts:279).
- The action is already the lead of a task page. docs/getting-started/hosting.md:215-219 ("## Publish the third-party notices") gives the same action and links here for the list. docs/getting-started/install.md:55 points to that Hosting section. docs/guides/deploying.md:34 and docs/getting-started/cdn.md:228 also state it. So this page is the reference list, and a reader on the normal path meets the action before they get here. The cost of the late position is small, which fits "low".
- The proposed edit has a flaw. The second paragraph of "## Where the notices are" (line 94) also says that the tools' notices stay out of the build's file, because a page ships none of their code. The edit deletes that paragraph whole, so this fact would be lost unless it moves too. A new heading for one sentence also adds weight to a short intro.

## Corrected claim

The action for a game developer is first stated at the end of the page (line 94). Line 34 names the file but not what to do with it. A reader who lands on this page from search must scan past four tables to find the action. Other pages (Hosting, Install, Deploying, CDN) already lead with the action, so the cost is low.

## Corrected edit

Do not add a new section. Add the action to the intro paragraph (line 13), as one sentence with a link: "A production build with the Vite plugin collects these notices into `null3d-third-party-notices.txt` beside the page. Keep that file with the build when you publish it, or show its text in your game's credits ([Hosting](hosting.md#publish-the-third-party-notices))." Then delete the second sentence of line 34. In "## Where the notices are", replace the second paragraph with its last sentence only: "The tools' notices stay out of the build's notices file, because a page ships none of their code."
