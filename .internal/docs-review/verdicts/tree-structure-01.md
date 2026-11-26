# tree-structure-01

## Finding as given

- Page: index
- Anchor: ## Where to start
- Category: missing-prerequisite
- Severity: high
- Claim: The docs home never links Install or Your first scene. Its start list sends a newcomer to architecture, backends, performance, phones, hosting and the three.js mapping.
- Evidence: index.md 'Where to start' lists concepts/architecture, concepts/backends, guides/performance, guides/phones, getting-started/hosting, porting/threejs-mapping; no link to getting-started/install or getting-started/first-scene.
- Proposed edit: Make 'Where to start' a set of paths. New to null3D: Install, Your first scene, Show a model (new), Examples (new). Porting from three.js: porting overview. Working with an agent: the agents page. Shipping: the deploy checklist. Keep architecture and backends under a 'How it works' line.

Verdict: survives

## Evidence

- docs/index.md lines 36-43: the "Where to start" list has six links: concepts/architecture, concepts/backends, guides/performance, guides/phones, getting-started/hosting, porting/threejs-mapping. The claim is exact.
- No line in docs/index.md links getting-started/install.md or getting-started/first-scene.md. The words "install" and "first scene" do not appear on the page.
- The only path to those pages from the home page is the "All pages" link (line 49) to pages.md, where Install (line 17) and Your first scene (line 18) head the Getting started table. That is one extra click into a long table, so it does not answer the finding. A newcomer who follows "Where to start" reads about threads, GPU tiers and frame time before they have installed anything.
- Both target pages exist and are real starting points: getting-started/install.md ("Install null3D") ends by sending the reader to first-scene.md, and first-scene.md builds a running sketch.
- For porting, the list links the mapping table (porting/threejs-mapping), not the workflow page porting/threejs-overview.md ("Porting from three.js"). The overview is the better entry point, as the edit says.
- High severity is fair: the home page's start list skips the first two steps a new user needs.

## Corrections to the proposed edit

The direction is right, but some targets in the edit do not exist yet:

- "Show a model (new)" and "Examples (new)" are not pages in docs/. The home page must not link pages that do not exist. Add those links only in the same change that adds the pages.
- "The deploy checklist" is not a page or a section name. The page is guides/deploying.md ("Deploying"), and it has no section called a checklist. Link that page by its title.

Corrected "Where to start", using only pages that exist now:

- New to null3D: [Install null3D](getting-started/install.md), then [Your first scene](getting-started/first-scene.md). To try it with no install: [Try null3D from a CDN](getting-started/cdn.md). To start from a template: [Project structure](getting-started/project-structure.md).
- Porting from three.js: [Porting from three.js](porting/threejs-overview.md), with the [three.js to null3D mapping](porting/threejs-mapping.md) as the lookup table.
- Working with a coding agent: [Working with AI agents](guides/agents.md).
- Shipping: [Hosting and cross-origin isolation](getting-started/hosting.md) and [Deploying](guides/deploying.md).
- How it works: [Architecture: threads and the frame](concepts/architecture.md), [GPU tiers and backends](concepts/backends.md), the [performance guide](guides/performance.md) and [Phones and tablets](guides/phones.md).
