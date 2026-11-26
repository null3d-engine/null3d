# start-readability-01

## Finding as given

- page: index
- anchor: ## Where to start (lines 36 to 43)
- category: scan-order
- severity: high
- claim: The docs home's start list links to architecture, backends, performance, phones, hosting and the three.js mapping, but not to Install, Your first scene, Project structure or the CDN trial. A newcomer has no path to a first frame from the home page.
- evidence: index.md lines 38 to 43 list six pages; none is getting-started/install, first-scene, project-structure or cdn.
- proposedEdit: Make 'Where to start' a numbered path: 1. Install null3D, 2. Your first scene, 3. Project structure (bunx @null3d/cli create), 4. Try null3D from a CDN. Move the six current links into a second list, 'Read next'.
- generatedSource: (none; docs/index.md is hand-written)

Verdict: partly

## Evidence

- docs/index.md:36-43: the "Where to start" list has six links (architecture, backends, performance, phones, hosting, three.js mapping). None goes to install, first-scene, project-structure or cdn. That part of the claim holds.
- docs/index.md:9-34: nothing above the list links to a getting-started page that leads to a first frame. The only getting-started link on the page is hosting (line 42).
- docs/index.md:47-49: the "All pages" section links docs/pages.md. That page opens with the "Getting started" table, and Install null3D and Your first scene are its first two rows (pages.md lines 14-16). So a newcomer does have a path, two clicks away, and the claim "no path" is too strong. The cost is still real: the section named "Where to start" sends a newcomer to architecture and performance first.
- The four target pages exist: docs/getting-started/install.md, first-scene.md, project-structure.md and cdn.md.
- Order in the proposed edit: these pages are not one sequence.
  - project-structure.md:23-40: `bunx @null3d/cli create` makes a full project, then `bun install` and `bunx vite`. That is the fastest way to a first frame, and it is an alternative to the manual install, not step 3 after it.
  - cdn.md:13: the CDN page is "a quick trial" with "no build step", and a project that grows past it moves to Vite (install.md). It is an alternative entry, not step 4 after a Vite project.
  - install.md:83 and 110-112 link on to first-scene and project-structure, so the first two steps chain on their own.
  - A numbered 1-to-4 list would tell a newcomer to do all four in order. That misleads.
- The proposal does not break a writing rule or the website contract. "Read next" is in sentence case. The command uses the Bun form with the scope.

## Corrected claim

The "Where to start" list on the docs home skips every page that gets a newcomer to a first frame: Install null3D, Your first scene, Project structure and Try null3D from a CDN. A newcomer can reach them only through All pages, at the foot of the home page.

## Corrected edit

Open "Where to start" with the ways to get a first frame, given as choices, not as one numbered sequence. Then move the six current links under a sentence-case lead-in such as "Read next":

- To start a new project from a template, run `bunx @null3d/cli create`. [Project structure](getting-started/project-structure.md) lists the templates.
- To add null3D to a Vite project, follow [Install null3D](getting-started/install.md), then [Your first scene](getting-started/first-scene.md).
- To try the engine in one HTML file with no build step, see [Try null3D from a CDN](getting-started/cdn.md).

Then the six current links, unchanged, after "Read next". Severity is medium to high: the start section points a newcomer the wrong way, but All pages is one click from the home page.
