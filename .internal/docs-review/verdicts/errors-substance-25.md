# errors-substance-25

## Finding as given

- page: errors/index,guides/debugging
- anchor: "and links to the code's page here"
- category: contradiction
- severity: low
- claim: The message links to a fixed GitHub address on the generated branch, not to the docs website. A reader on the website follows the link to GitHub, not to 'here'.
- evidence: packages/engine/src/errors/engine-error-core.ts:13 (DOCS_BASE). tools/lib/docs.ts:477.
- proposedEdit: Write 'and links to the code's page in the repository, which this page mirrors'. Or, once the website's address is fixed, point the base address there.
- generatedSource: tools/lib/docs.ts; packages/engine/src/errors/engine-error-core.ts

Verdict: partly

## Evidence

- packages/engine/src/errors/engine-error-core.ts:13 sets the docs address to `https://github.com/null3d-engine/null3d/blob/generated/docs/errors/`. The message ends "See <that address><code>.md" (line 21), and `error.docs` holds the same address. So the claim about the code is right.
- docs/errors/index.md:11 (written by tools/lib/docs.ts:477, in the error index page function) says the message "links to the code's page here". On GitHub that is true. On the website it is not: the link leaves the site for GitHub. The finding holds for this page.
- docs/guides/debugging.md:26 does not say "here". It says "it links to the code's page:" and then shows the full GitHub address in the example message (line 29). A reader sees where the link goes. The finding does not hold for this page.
- The proposed wording "in the repository, which this page mirrors" is hard to read, and it is wrong on GitHub, where the page is the repository copy, not a mirror.

## Corrected claim

Only docs/errors/index.md (line 11, source tools/lib/docs.ts:477) has the problem. Its word "here" is wrong for a reader on the website, because the engine's message links to the GitHub copy of each code's page. The debugging guide names the GitHub address and needs no change.

## Corrected edit

In tools/lib/docs.ts, in the error index page text, replace "and links to the code's page here." with "and links to the code's page on GitHub. The table below links to the same pages." If the error links later point to the website, keep "here" and change the docs address in engine-error-core.ts instead.
