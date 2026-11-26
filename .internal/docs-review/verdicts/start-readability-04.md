# start-readability-04

## The finding as given

- page: getting-started/hosting
- anchor: # Hosting and cross-origin isolation (line 9)
- category: split-page
- severity: high
- claim: The page holds three topics in 4,792 words: the isolation headers, caching and offline play, and Electron. A reader who wants two headers on Netlify must pass the CSP, the CDN case and two builds; a reader who wants offline play will not look under this title.
- evidence: stats.json: 4792 words, 20 headings, 8 long paragraphs. Caches and offline play run lines 221 to 360; Electron lines 152 to 195.
- proposedEdit: Split into getting-started/hosting (headers, hosts, what isolation changes, other sites, CSP, CDN, two builds, Brotli, notices, development), guides/caching-and-offline (Caches between visits, Let browsers keep the build files, Let Chrome keep the compiled core, Offline play with its H3s), and guides/electron. Leave one-line links behind, update links to hosting.md#offline-play and #caches-between-visits and #let-chrome-keep-the-compiled-core in install.md, cdn.md and network-use.md, and add the pages to tools/lib/docs.ts.

Verdict: partly

## Evidence

What holds:
- The line ranges are right. "Caches between visits" starts at line 221 and "Offline play" with its three subsections ends at line 360. "Desktop apps with Electron" runs 152 to 195.
- The caching and offline sections (about 140 of 400 lines) are about repeat visits and service workers, not about isolation headers. They do not match the page title. Moving them to their own page is a sound split.
- A reader who wants the Netlify headers does pass the CSP, the CDN case and "Two builds" first. "Headers on common hosts" is at line 117, and "The two headers" is at line 22.

What does not hold:
- Severity high is too strong. The page does not mislead, and it does not block a newcomer. The two headers are the first section (line 22), right after the intro. guides/deploying.md is already a short host checklist that links into this page. The page's frontmatter summary names offline play and the caches, and eleven other pages link straight to the offline and cache anchors. Medium fits: the page is clearly harder to use, but nobody is stuck.
- The Electron section is not a separate topic. It is about how to get cross-origin isolation in Electron: a custom scheme that sends COOP and COEP, and why `file://` and a Chromium switch fail (lines 152 to 195). That is the page title's topic. At 44 lines, a page of its own adds a hop and gains little. Keep it on the hosting page.
- The link list in the edit is far from complete. Links to the anchors that would move also appear in:
  - docs/guides/loading-screens.md:174 (#caches-between-visits)
  - docs/guides/phones.md:105 (#offline-play)
  - docs/guides/deploying.md:35 (#offline-play) and :72 (#let-chrome-keep-the-compiled-core)
  - docs/guides/start-time.md:130 (#let-browsers-keep-the-build-files), :134 (#let-chrome-keep-the-compiled-core), :287 (#offline-play)
  - docs/guides/content-pages.md:181 (#caches-between-visits)
  - docs/concepts/quality-presets.md:128 (#caches-between-visits)
  - docs/api/assets.md:327 (#offline-play and #caches-between-visits)
  - docs/getting-started/cdn.md:43 and docs/getting-started/network-use.md:32 and :49 (named in the finding)
- The edit leaves out engine source. The development build's console warning in packages/engine/src/page/isolation-check.ts:29 ends "Docs: getting-started/hosting#offline-play.". A split must change that string.
- The edit leaves out the skills. The "Docs and skills stay in sync" rule needs these updated: skills/null3d-develop/references/performance.md:132 and :376 ("Caches between visits", "Let Chrome keep the compiled core"), :375 and :380, and testing-and-debugging.md:229, :230, :233 and :289 ("Offline play"). Each of them points to getting-started/hosting.
- "Keep the page isolated" (line 348) is about the isolation headers. The new page must link back to the hosting page's "The two headers" from there.

## Corrected claim

The page mixes two topics in 4,792 words: how to serve the page with cross-origin isolation (headers, CSP, CDN, Electron, Brotli, development) and how repeat visits and offline play work (seven caches, cache headers, Chrome's code cache, the service worker). The second topic does not fit the title. Also, the per-host header examples sit five sections below the headers they configure. Severity: medium, not high. Electron belongs with isolation and stays.

## Corrected edit

1. Move "Caches between visits", "Let browsers keep the build files", "Let Chrome keep the compiled core" and "Offline play" with its three subsections (lines 221 to 360) to a new page, guides/caching-and-offline. Give it a short opening and the Mermaid diagram that a page needs. In "Keep the page isolated", link back to hosting.md#the-two-headers. Leave a two-line section on the hosting page that links to the new page for cache headers and offline play.
2. Keep "Desktop apps with Electron" on the hosting page.
3. Move "Headers on common hosts" up to follow "The two headers", so the per-host files come right after the headers they set.
4. Add the new page to PAGES in tools/lib/docs.ts. Move "offline play with a service worker and the build's file list" and "the caches between visits" out of the hosting page's frontmatter summary and put them in the new page's summary.
5. Repoint every link above to ../guides/caching-and-offline.md#<same anchor>, and change the console text in packages/engine/src/page/isolation-check.ts:29 to "Docs: guides/caching-and-offline#offline-play." Update the skill references in skills/null3d-develop/references/performance.md and testing-and-debugging.md. Then run `bun run skills`.
6. Treat the long paragraphs that move (lines 236, 260, 290, 343) in the long-paragraph finding for the new page. Line 260 (201 words, Chrome's code-cache timing and benchmark figures) is a good candidate for a "Technical details" block.
