# start-substance-12

## Finding as given

- page: getting-started/network-use, cli/null3d
- anchor: network-use line 73 "To draw on your computer's GPU, the tool uses one pinned version of Chrome for Testing"; cli "### Chrome for Testing"
- category: duplication
- severity: medium
- claim: A 162-word paragraph restates the download, the hash check, E1437, the fallback, the cache folder and the NULL3D_CHROME values that the command page lists. Lines 75-84 are hard-wrapped mid-paragraph, unlike every other page.
- evidence: network-use.md:73 vs cli/null3d.md:594-599; stats.json network-use longParagraphs lines 66 and 73.
- proposedEdit: Shorten line 73 to: "To draw on your computer's GPU, the tool downloads one pinned Chrome for Testing once, from Google's `storage.googleapis.com`, and checks its SHA-256 hash. With `CI` or `NULL3D_CHROME=installed` set, it downloads nothing. [Chrome for Testing](../cli/null3d.md#chrome-for-testing) gives the check, the fallback and the cache folder." Unwrap lines 75-84.

Verdict: partly

## Evidence

- The duplication holds. network-use.md:73 (stats.json line 66, 162 words, 11 sentences) repeats the hash check, E1437, the fallback to installed Chrome, `NULL3D_CHROME=testing`, the shared cache folder and the hash record. cli/null3d.md:592-599 lists the same facts under "### Chrome for Testing". The network page already links there for the folder. Two copies of the same rules can drift.
- The code agrees with the facts in both pages: packages/cli/src/browser.js:245 (`installed` picks the installed Chrome), :255 (`testing` turns off the fallback), :406 (`CI` picks the software GPU Chromium).
- The hard-wrap claim is wrong in part. Lines 75-78 and 80-84 of network-use.md are hard-wrapped, but the page is not the only one. guides/lens-kit.md (for example lines 27-28), guides/car-paint.md and guides/screens.md are hard-wrapped too. Markdown joins wrapped lines, so a reader of the site sees no difference. Unwrapping is source polish only.
- The proposed edit drops the sentence "The tool makes no other request to that host, and a page never makes it." That sentence is the point of a page about network use: it bounds what the tool contacts. The short text must keep it. The edit also drops "before it unpacks it", which tells a reader the check happens before anything runs.

## Corrected claim

The Chrome for Testing paragraph (line 73, 162 words) restates the check, E1437, the fallback, the cache folder and the NULL3D_CHROME values from the command page's "Chrome for Testing" section. Lines 75-84 are hard-wrapped in the source; some other guides are too, and the rendered page is not affected.

## Corrected edit

Replace line 73 with:

"To draw on your computer's GPU, the tool uses one pinned version of Chrome for Testing. On first use it downloads that version once, from Google's Chrome for Testing releases on `storage.googleapis.com`, and checks its SHA-256 hash before it unpacks it. The tool makes no other request to that host, and a page never makes it. When the `CI` variable or `NULL3D_CHROME=installed` is set, the tool downloads nothing. [Chrome for Testing](../cli/null3d.md#chrome-for-testing) on the command-line tool's page gives the check, the fallback and the cache folder."

Unwrapping lines 75-84 is optional polish (low), for consistency with the rest of this page.
