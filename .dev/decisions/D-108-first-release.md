# D-108: The first release is 0.1.0, at M3's gate

Status: decided by the owner on 2026-10-08 at about 11:10 (UTC+8), with the particles add-on added at about 11:15. It replaces the owner's ruling of 3 October 2026 that the first release would be 1.0, with no 0.x release. Date: 2026-10-08.

Summary: null3D's first release, 0.1.0, goes to npm when M3's exit gate passes, and 1.0 stays at M4's gate with the API freeze. Before 0.1.0, M3 adds hosting with isolation headers, basic fuzzing of the file loaders, the first npm publishes and a rule for the docs' `since` values. 0.1.0 ships the splats, MSDF text, physics and particles add-ons.

## Question

When does null3D first go to npm, and with which version number?

## Rule

The first release comes when a developer outside the project can start on their own. They need docs to read, a template to start from, a guide to move from three.js, and a way to look inside a scene. Its version must tell users whether the API can still change.

## Data

On 3 October 2026 the owner ruled that the first release would be 1.0, with no 0.1, 0.2 or 0.3 release. The reason was cost: each release before 1.0 adds steps by hand, such as the first npm publishes, the trusted publishers and the release secrets. None of them helps finish the engine.

The roadmap puts the work in milestones:

| Milestone | What it adds | Roadmap label |
| --- | --- | --- |
| M1 | The core renderer, the first TypeScript API and the first `null3d` commands | 0.1 |
| M2 | Content: glTF, the asset optimizer, animation, picking, environment light, post effects, large worlds | 0.2 |
| M3 | The docs site, starter templates, the migration guide, the inspector, the rest of the `null3d` command, agent tooling and the porting tools | 0.3 |
| M4 | The API freeze, the device lab pass, the size budgets, fuzzing of all loaders, public benchmarks | 1.0 |

What a first user needs arrives in M3. Before it, there is no docs site, no template and no migration guide.

## Options

| Option | For | Against |
| --- | --- | --- |
| (a) The first release is 1.0, at M4's gate (the ruling of 3 October) | The release steps by hand happen once, and the first version has the frozen API | No developer outside the project can use the engine until M4 |
| (b) The first release is 0.1.0, at M3's gate, and 1.0 stays at M4 (chosen) | Developers can start once M3 has given them what they need. A 0.x version says the API can still change | The steps by hand move forward to M3. The docs' `since` labels need a new rule. Users' files reach the loaders before M4's full fuzzing |

## Decision

The owner chose (b) on 8 October 2026.

- 0.1.0 is released when M3's exit gate passes. The Release workflow takes the packages from 0.0.0 to 0.1.0 with the `minor` release type.
- 1.0 stays at M4's gate, with the API freeze. Until then, a 0.x release may change the API, as semantic versioning allows.
- 0.1.0 holds the work of M1, M2 and M3. Its add-ons are Gaussian splats, MSDF text, physics (`@null3d/rapier`) and particles (`@null3d/particles`).
- The owner added the particles add-on to M3 on 8 October 2026, at about 11:15. It follows the add-on rule of [D-54](D-54-addon-modules.md): its own package, and shaders that load on first use. It registers through the engine's one on-demand loader.

### What M3 adds before 0.1.0

1. Hosting for the docs site and the demos, with the cross-origin isolation headers. Threaded modes need those headers, so the hosts must send them. The owner chooses the hosting, which is due before M3 starts.
2. Basic fuzzing of the file loaders, such as glTF and KTX2, brought forward from M4. From 0.1.0, users load their own files, so the loaders must not crash or hang on broken input. M4 still fuzzes every loader in full.
3. The first npm publish of each package by hand, then trusted publishing from CI. npm cannot publish a package's first version through trusted publishing. So the owner publishes `@null3d/engine`, `@null3d/vite-plugin` and `@null3d/controls` by hand. Each new add-on package needs this too, such as `@null3d/rapier` and `@null3d/particles`. `@null3d/cli` is on npm at 0.0.0 already. [Releases](../releases.md#the-first-version-of-a-new-package) gives the steps.
4. A rule for the docs' `since` values. Pages now carry `since: "0.1"`, `"0.2"` or `"0.3"`, which name the roadmap labels above. With 0.1.0 as the first release, a page with `since: "0.2"` ships in 0.1.0. The release script refuses an x.y.0 version while a page with that `since` or an earlier one is `planned`. For 0.1.0 it checks only the `"0.1"` pages. M3 sets the rule. Then it changes the release script's check, the README's labels and the skills' version labels to match.

## Consequences

- [Releases](../releases.md): making a release, the versions, the open point on version labels and the first version of a new package now point at 0.1.0.
- 0.1.0 is the first public release. So the README's roadmap leaves before 0.1.0, and the agent skills are announced at 0.1.0. Today the release script refuses a README with the roadmap only from 1.0.0 (`tools/lib/release.ts`). M3 changes it to refuse from 0.1.0.
- The README's quickstart and roadmap say that 0.1.0 is the first release, after the 0.3 step. The roadmap's 0.3 row names the four add-ons.
- [D-54](D-54-addon-modules.md) names `@null3d/particles` among the add-ons.
