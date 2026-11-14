# D-108: The first release is 0.1.0, as part of M4

Status: decided by the owner, with the particles add-on in M3 and every change in the release notes. Not released yet. Before 0.1.0, the roadmap labels and the docs' `since` values must be settled.

Summary: null3D's first release, 0.1.0, goes to npm as part of M4, and a final 0.2.0 release follows it. 1.0.0 waits until the API is known to be stable. The release notes list every commit that is not a merge, whichever branch brought it to main.

## Question

When does null3D first go to npm, with which version number, and what goes into its release notes?

## Rule

The owner sets when each release comes. A version must tell users whether the API can still change.

## Data

The roadmap puts the work in milestones:

| Milestone | What it adds | Roadmap label |
| --- | --- | --- |
| M1 | The core renderer, the first TypeScript API and the first `null3d` commands | 0.1 |
| M2 | Content: glTF, the asset optimizer, animation, picking, environment light, post effects, large worlds | 0.2 |
| M3 | The docs site, starter templates, the migration guide, the inspector, the rest of the `null3d` command, agent tooling and the porting tools | 0.3 |
| M4 | The API freeze, the device lab pass, the size budgets, fuzzing of all loaders, public benchmarks | 1.0 |

Each release before 1.0 adds steps by hand, such as the first npm publishes, the trusted publishers and the release secrets. None of them helps finish the engine.

## Options

| Option | For | Against |
| --- | --- | --- |
| (a) The first release is 1.0, at M4's gate | The release steps by hand happen once, and the first version has the frozen API | No developer outside the project can use the engine until M4 |
| (b) The first release is 0.1.0, at M3's gate, and 1.0 stays at M4 | Developers can start once M3 gives them docs, a template and a migration guide. A 0.x version says the API can still change | The owner's ruling, option (d), replaces it |
| (c) 0.1.0 once M2 is complete, a minor release for each later milestone, and 1.0.0 once the API is stable | A 0.x version says the API can still change, and each milestone ships | The owner's ruling, option (d), replaces it |
| (d) 0.1.0 as part of M4, a final 0.2.0 after it, and 1.0.0 once the API is stable (chosen) | A 0.x version says the API can still change. The first release holds the docs, templates and migration guide of M3 | The steps by hand come in M4. The docs' `since` labels need a new rule. Users' files can reach the loaders before every loader is fuzzed in full |

## Decision

The owner chose (d):

- **0.1.0** goes out as part of **M4**. It holds the roadmap steps 0.1 to 0.3: the work of M1, M2 and M3. The Release workflow takes the packages from 0.0.0 to 0.1.0 with the `minor` release type.
- **0.2.0**, a final release, follows 0.1.0.
- **1.0.0** is published only once the API is known to be stable. M4's API freeze does not by itself produce a 1.0 release. Until then, a 0.x release may change the API, as semantic versioning allows.
- Once M4 is complete, the engine is publicized and the website launches.
- M3's add-ons are Gaussian splats, MSDF text, physics (`@null3d/rapier`) and particles (`@null3d/particles`). The particles add-on is part of M3 by the owner's ruling. It follows the add-on rule of [D-54](D-54-addon-modules.md): its own package, and shaders that load on first use. It registers through the engine's one on-demand loader.

### What the first release needs

These come before 0.1.0, within M4:

1. Hosting for the docs site and the demos, with the cross-origin isolation headers. Threaded modes need those headers, so the hosts must send them. The owner chooses the hosting.
2. Basic fuzzing of the file loaders, such as glTF and KTX2. From 0.1.0, users load their own files, so the loaders must not crash or hang on broken input. M4 fuzzes every loader in full.
3. The first npm publish of each package by hand, then trusted publishing from CI. npm cannot publish a package's first version through trusted publishing. So the owner publishes `@null3d/engine`, `@null3d/vite-plugin` and `@null3d/controls` by hand. Each new add-on package needs this too, such as `@null3d/rapier` and `@null3d/particles`. `@null3d/cli` is on npm at 0.0.0 already. [Releases](../releases.md#the-first-version-of-a-new-package) gives the steps.
4. A rule for the docs' `since` values. Pages carry `since: "0.1"`, `"0.2"` or `"0.3"`, which name the roadmap labels above. Release 0.1.0 holds all three steps, so the labels do not name the release that ships them. Either the labels and the `since` values are remapped, or the roadmap says that they are roadmap numbers and not release numbers. The release script refuses an x.y.0 version while a page with that `since` or an earlier one is `planned`. For 0.1.0 it checks only the `"0.1"` pages. Once the rule is set, the release script's check, the README's labels and the skills' version labels change to match.
5. A watch by hand of the built shader set as a release asset, which 0.1.0 carries first. The archive builds and uploads to the same Release, and a project fetches it and verifies its hash.

## Every change goes into the release notes

Main lands by direct push ([D-157](D-157-direct-pushes-to-main.md)). Branches merge into main without a squash, so main's history holds each branch's commits and the merge commits. The owner ruled, in writing: "any and all changes should go into release notes and be able to do a new release."

So the release notes list every commit that is not a merge, whichever branch brought it to main. A release lists each commit that the released commit reaches and the last release tag does not. The release command (`tools/release.ts`) reads git's log as it streams, so the notes have no size limit.

- The notes group the lines by type (features, bug fixes, performance, refactors, documentation, tests, build and tooling, other), with breaking changes first. Inside each type, they group the lines by package, such as `@null3d/engine`, then the examples, the docs and the repository's own work.
- Commits with the same words in one group share one line, which links each commit.
- Each line drops the maintainers' references that readers cannot look up: task IDs, decision record numbers, review threads and milestones. The commit link leads to the full message.
- The commit hook and the range check before a push (`bun tools/hooks/check-trailers.ts origin/main..HEAD`) block those references in a new commit subject.
- The GitHub Release text stops at GitHub's limit of 125,000 characters, with a link to the release's full list in `CHANGELOG.md`. The first release lists about 850 lines, and its notes are about 176,000 characters.
- A test builds the notes of a small repository with branch merges (`tools/lib/release.test.ts`). One branch starts before a release and lands after it, and two branches land the same subject.

## Consequences

- [Releases](../releases.md): making a release, the versions, the open point on version labels and the first version of a new package point at 0.1.0.
- 0.1.0 is the first public release. So the README's roadmap leaves before 0.1.0, and the agent skills are announced at 0.1.0. The release script refuses a README with the roadmap only from 1.0.0 (`tools/lib/release.ts`), and must refuse it from 0.1.0 before that release.
- The README's quickstart and roadmap name 0.1.0 as the first release, once the steps 0.1 to 0.3 are done. The roadmap's 0.3 row names the four add-ons.
- [D-54](D-54-addon-modules.md) names `@null3d/particles` among the add-ons.
