# api-3-readability-22

## Finding as given

- Page: api/splats
- Anchor: before the first example, line 41; H1 line 9
- Category: missing-prerequisite
- Severity: medium
- Claim: Every other add-on page in the slice shows bun add before its first example. api/splats does not, so a newcomer's import fails. The H1 also drops the package name that the title carries.
- Evidence: line 9 '# Gaussian splats'; front matter title 'Gaussian splats (@null3d/splats)'; no bun add on the page.
- Proposed edit: Add a sh block with 'bun add @null3d/splats' before the first ts block, and change the H1 to '# Gaussian splats (@null3d/splats)'.
- Generated source: none (hand-written page)

Verdict: survives

## Evidence

- docs/api/splats.md has no `bun add`, no "install" and no "npm" anywhere. Its first code block (line 41) imports `createSplats` from `@null3d/splats` with no step that adds the package.
- Every other add-on page in docs/api/ has an install line before its first example: controls.md:26, geometry.md:59, grass.md:30, impostors.md:33 (under "## Install"), particles.md:26, sound.md:27, terrain.md:26, three-compat.md:27, water.md:43, wind.md:27.
- No other page fills the gap. docs/getting-started/install.md shows `bun add` only for the engine, the Vite plugin, `@null3d/controls` and the CLI. No page in docs/ or skills/ has `bun add @null3d/splats`.
- packages/splats/package.json names the package `@null3d/splats`, the same naming as the other add-ons, so the proposed command is right.
- H1: line 9 is `# Gaussian splats`; the front matter title is `Gaussian splats (@null3d/splats)`. Eight of the ten add-on pages repeat the package in the H1 (controls, grass, particles, sound, terrain, three-compat, water, wind). impostors.md has the same mismatch as splats, so that part is polish and also applies to impostors. It is not unique to this page.
- The proposed edit breaks no writing rule and does not touch the website contract.

## Notes on the edit

The edit stands as given. It can follow the impostors page: one short sentence ("The package is an add-on. Install it beside the engine.") and then the sh block, placed after the list of file kinds (line 39) and before the first ts block (line 41). A heading is optional. The H1 change is low priority. If it is made, make the same change on api/impostors so the add-on pages match.
