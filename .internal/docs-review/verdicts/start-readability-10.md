# start-readability-10

## Finding as given

- page: getting-started/install, first-scene, hosting, network-use, third-party-notices, cdn, project-structure
- anchor: "## Getting started" in docs/pages.md (lines 17 to 23)
- category: scan-order
- severity: medium
- claim: The area lists install, first scene, hosting, network use, third-party notices, CDN, project structure. The quickest start (create from a template) comes last, after the licenses page, and the CDN trial comes after network use.
- evidence: docs/pages.md lines 17 to 23; order from PAGES in tools/lib/docs.ts lines 82 to 88.
- proposedEdit: Reorder PAGES: install, first-scene, project-structure, cdn, hosting, network-use, third-party-notices.
- generatedSource: tools/lib/docs.ts

Verdict: partly

## Evidence

- tools/lib/docs.ts lines 82 to 88 hold the seven Getting started entries in the order the finding gives. `pageList` (docs.ts line 518 onward) sorts each area by PAGES order, so docs/pages.md lines 17 to 23 follow it. The order is the roadmap step order (0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.3), not a reading order. The AREAS list, by contrast, is commented as "in reading order" (docs.ts line 58).
- The project-structure part holds. docs/getting-started/project-structure.md starts a working project with four commands (`bunx @null3d/cli create`, `cd`, `bun install`, `bunx vite`). It is the fastest way in, and it sits last, after the licenses page. Install's "Related pages" (install.md lines 108 to 112) already pairs it with first scene and hosting.
- The CDN part does not hold. docs/getting-started/cdn.md is not a quick trial. The reader must build the engine from the repository (`bun run build`, then `bun run build:cdn`, cdn.md lines 25 to 30), upload a large folder to their own CDN, and set CORS, content-type and cache headers (cdn.md lines 32 to 42). It links to hosting.md for the compiled-core cache and the isolation headers. Putting it before hosting puts a page ahead of the page it depends on. Its position after hosting is right. Moving it in front of network use is a matter of taste.

## Corrected claim

The Getting started order follows the roadmap step of each page, not a reading order. Because of this, the template quick start (project structure) comes last, after the licenses page. The CDN page is not a quick trial: it needs a build from the repository and the hosting headers. So it belongs after hosting, not before it.

## Corrected edit

Reorder the Getting started entries of PAGES in tools/lib/docs.ts: install, first-scene, project-structure, hosting, cdn, network-use, third-party-notices.
