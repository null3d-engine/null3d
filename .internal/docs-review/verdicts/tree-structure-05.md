# tree-structure-05

## Finding as given

```json
{
 "page": "getting-started/install,getting-started/first-scene,getting-started/hosting,getting-started/network-use,getting-started/third-party-notices,getting-started/cdn,getting-started/project-structure,guides/agents",
 "anchor": "Getting started area order",
 "category": "scan-order",
 "severity": "medium",
 "claim": "Getting started mixes first steps with production and licence pages. A newcomer meets COOP, COEP, CSP and licence lists before the template command, and agent setup sits in Guides although the engine is built for agents.",
 "evidence": "PAGES order: install, first-scene, hosting (4792 words), network-use, third-party-notices, cdn, project-structure. guides/agents is 24th of 25 guides.",
 "proposedEdit": "Order: install, first-scene, model-viewer (NEW), project-structure (title 'Start from a template'), examples (NEW), guides/agents -> getting-started/agents, cdn. Move hosting, network-use and third-party-notices to the new deploy area. Update skill links to moved IDs.",
 "generatedSource": "tools/lib/docs.ts (PAGES)",
 "id": "tree-structure-05",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

The claim holds.
- `tools/lib/docs.ts:82-88` lists Getting started in this order: install, first-scene, hosting, network-use, third-party-notices, cdn, project-structure. `pageList` (`tools/lib/docs.ts:519-540`) sorts each area by this order, so the page list shows it the same way.
- `guides/agents` is at `tools/lib/docs.ts:173`. It is the last of the 24 guide entries in PAGES. The finding says "24th of 25"; the exact rank does not change the point.
- Hosting is a production page (COOP and COEP, CSP, CDN policy, offline play, Electron). Network use and third-party notices are about release and licences. A newcomer does not need them for a first run: the Vite plugin sends the isolation headers on the dev server (`docs/getting-started/install.md:48`).
- The template command (`bunx @null3d/cli create`) is on `project-structure`, which comes last in the area.
- `docs/index.md` calls null3D an engine "for coding agents", so the agent setup page belongs near the start.

The proposed edit has three faults.
1. It adds two pages that do not exist (`model-viewer`, `examples`). Other findings may propose those pages. The order fix must not depend on them.
2. It makes a "new deploy area" but leaves out `guides/deploying` (`tools/lib/docs.ts:172`). That guide already summarizes hosting and links to `../getting-started/hosting.md`. If hosting moves to a new area while that guide stays in Guides, the split is still wrong.
3. Its link work covers only the skills. Moving an ID affects much more:
   - Two runtime messages print the ID: `packages/engine/src/page/isolation-check.ts:29` ("Docs: getting-started/hosting#offline-play") and `packages/vite-plugin/src/index.ts:175` ("Docs: getting-started/hosting").
   - Tool constants and messages: `tools/lib/notices.ts:9` (the notices page path), `tools/lib/network-use.ts:4` and `:251`, and a test in `tools/hooks/ack-hooks.test.ts:647,655`.
   - 59 relative links in 29 docs pages point to `hosting.md`, `network-use.md`, `third-party-notices.md` or `agents.md`.
   - The skill references cite `getting-started/hosting` about 20 times (`skills/null3d-develop/references/testing-and-debugging.md`, `performance.md`, `e2e-testing.md`, `recipes.md`).
   - Published URLs change, so outside links to these pages break.

## Corrected claim

Getting started puts three production and licence pages (hosting, network use, third-party notices) before the template page. The agent setup page is the last entry in Guides. This is wrong for an engine built for agents. All of this is ordering, set by PAGES in `tools/lib/docs.ts`.

## Corrected edit

Two steps. Use the first step alone if moving pages costs too much.

1. Reorder only (edit PAGES and AREAS in `tools/lib/docs.ts`; no ID changes): in Getting started, put install, first-scene, project-structure, cdn first. Put hosting, network-use and third-party-notices after them, under a sub-heading or at the end. Do not move `guides/agents` yet; link it from `install.md` and from the "Where to start" list in `docs/index.md`.
2. Full move (optional): add a "Deploy" area to AREAS after Guides. Move `getting-started/hosting`, `getting-started/network-use`, `getting-started/third-party-notices` and `guides/deploying` into it. Move `guides/agents` to `getting-started/agents`, right after project-structure. Update every reference to the moved IDs: the two runtime messages, `tools/lib/notices.ts`, `tools/lib/network-use.ts`, the hook test, the 59 relative links in docs, and the skill references (edit `skills/`, then run `bun run skills`).

Leave out the new `model-viewer` and `examples` pages here. Add them to the order only when the findings that propose them are accepted.
