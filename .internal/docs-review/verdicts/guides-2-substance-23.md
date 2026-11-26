# guides-2-substance-23

## Finding as given

- Page: guides/testing
- Anchor: ## Browser tests of a whole app, line 200
- Category: missing-prerequisite
- Severity: low
- Claim: The page sends the reader to 'The null3d-develop agent skill's references/e2e-testing.md' with no link. A reader who does not use the agent skill cannot find it.
- Evidence: The file exists at skills/null3d-develop/references/e2e-testing.md.
- Proposed edit: Link it: '[the end-to-end testing guide](https://github.com/null3d-engine/null3d/blob/main/skills/null3d-develop/references/e2e-testing.md) in the null3d-develop skill'.
- Generated source: none (hand-written page)

Verdict: survives

## Evidence

- docs/guides/testing.md:200 names the skill file as inline code only: "The null3d-develop agent skill's `references/e2e-testing.md` gives the whole setup, with a worked Playwright config and spec." There is no link on that line or anywhere else on the page.
- No other docs page links to the file. A search of docs/ for "e2e-testing", "skills/null3d" and "blob/main" finds only this line.
- The target exists: skills/null3d-develop/references/e2e-testing.md (240 lines, with sections for the runner, the real app, readiness, the test hook, assertions, determinism and a worked example). The page promises "a worked Playwright config and spec", so a reader without the skill installed loses real content.
- guides/agents.md tells readers how to install the skills, but it does not point at this file. A reader who reads the docs on the website or in node_modules/@null3d/engine/docs/ has no path to it.
- The proposed link format passes the docs link check. tools/lib/links.ts:14-15 accepts https://github.com/null3d-engine/null3d/blob/main/<path> as a repository link, and checkLinkTree checks that the path exists. A full URL is also right here: a relative link to skills/ would break in the copy of the docs that ships in the npm package.
- AGENTS.md "Docs and skills stay in sync" rule 8 names this file as the guide to browser tests of an app, so a link from the docs to it fits the rules. A link to skills/ is not an internal process word or a .dev/ link.
- Low severity fits: the page lists the main rules inline, so a reader can act without the file.

## Corrected claim or edit

None. One small note: guides/agents.md says to install skills from the release's .claude/skills/ copy because skills/ also holds test material. That advice covers installing a skill, not reading one reference file, so the skills/ source path in the proposed link is correct.
