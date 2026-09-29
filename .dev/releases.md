# Releases

This guide covers how a release is made. [AGENTS.md](../AGENTS.md) holds the rule that decides each changelog line: pull requests merge by squash only.

## Making a release

To release, run the Release workflow from the Actions tab and pick a release type. The workflow:

1. Waits for CI to pass on main's latest commit.
2. Runs `bun run release --apply` on a `release/<version>` branch. This sets the version in every package manifest, the engine's `VERSION` export, the Rust workspace and `Cargo.lock`. It adds the release's section to `CHANGELOG.md` and regenerates the docs.
3. Opens a pull request. Review the changelog there, and edit `CHANGELOG.md` on that branch if a line needs it.

Merging that pull request runs the Release Publish workflow. It tags the merge commit with the plain version, such as `0.0.1`, and publishes the GitHub Release with the changelog section. Then it publishes every package that is not private to npm, and skips a version that npm already has.

## Versions

Versions follow the roadmap in the README. The `auto` release type always releases a patch. Pick `minor` or `major` when a roadmap release is done. The release script refuses an x.y.0 version while a docs page with that `since` or an earlier one is still `planned` (hard rule 19).

1.0 is the first public release. The roadmap is internal, so it stays in the README until then. Before releasing 1.0, remove it: the Roadmap section, its navigation link, the status badge's link and the by-version table under Features. Replace the pre-alpha status line too. The release script refuses 1.0.0 and every later version while the README has the roadmap.

At 1.0, also announce the agent skills. Add the Claude Code plugin commands to the README's "For AI agents" section, and link `guides/agents` for other agent tools. Until then, `.claude-plugin/marketplace.json` exists and each release attaches the skill zips, but the README does not name them.

## One-time setup

- A GitHub App with write access to contents and pull requests, installed on the repository. Its ID and private key go in the `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets. A pull request opened with the default token starts no workflows, so its CI would never run.
- npm trusted publishing. Publish each public package's first version by hand with a token. Then, in the package's settings on npmjs.com, name this repository and `release-publish.yml` as its trusted publisher. A public package also needs `"publishConfig": { "access": "public", "provenance": true }`.
- The publish job builds nothing, because the only public package is the command-line tool. Add the engine's WebAssembly build to the job before the engine becomes public.
