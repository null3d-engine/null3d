# api-reference-substance-20

## The finding as given

- Page: api/reference/engine
- Anchor: engine.md:561-565 `VERSION`
- Category: wrong-claim. Severity: medium.
- Claim: The page prints `const VERSION: '0.0.0'`, the placeholder in the source tree. The release stamps the real version later, so the website shows a version no user has.
- Evidence given: packages/engine/src/shared/version.ts:15; packages/engine/package.json:3; tools/lib/api-docs.ts:463 prints the literal type.
- Proposed edit: Annotate as `export const VERSION: string = '0.0.0'` and add 'It equals the installed package's version.' to the TSDoc.
- Generated source: packages/engine/src/shared/version.ts

Verdict: refuted

## Evidence

- The generator part holds: tools/lib/api-docs.ts:460-463 prints a constant's type with the type checker, so a literal string constant shows as its literal value.
- The "website shows a version no user has" part is wrong. The API reference pages are generated files that git does not keep (.gitignore:47 `docs/api/reference/`). The website does not read them from main or from a working tree. It syncs from the release tag (.github/workflows/release.yml:12, 391-421).
- The release first stamps the real version into packages/engine/src/shared/version.ts (tools/lib/release.ts:502-505, `versionCopies`), and lands that on main (release.yml:203-252).
- The tag commit then runs `bun tools/generate.ts --stage` on the stamped commit (release.yml:265-274), so the tagged docs show the released version, for example `const VERSION: '0.1.0'`.
- Main holds the stamped value today: `git show origin/main:packages/engine/src/shared/version.ts` gives `export const VERSION = '0.1.0';`, and CHANGELOG.md starts at 0.1.0. The '0.0.0' in the review copy comes from the tree the copy was generated from, not from what the website publishes.
- So the literal type on the website always equals the version the reader installs. Widening it to `string` would remove true, exact information. The added TSDoc sentence is harmless but fixes no real problem.

## Corrected claim or edit

None. No change is needed. If anything, the review copy should be generated from the current main, which holds the stamped version.
