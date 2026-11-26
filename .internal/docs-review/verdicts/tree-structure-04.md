# tree-structure-04

## The finding as given

```json
{
 "page": "pages",
 "anchor": "AREAS / PageEntry",
 "category": "structure",
 "severity": "high",
 "claim": "No area has a group level. API reference is one flat list of 39 pages and Guides of 25, so related pages sit far apart and the lists cannot be scanned.",
 "evidence": "tools/lib/docs.ts PageEntry has id, title, since, summary only; pages.md renders one table per area. api/three-compat sits between api/geometry and api/materials.",
 "proposedEdit": "Add a group field to PageEntry and an ordered group list per area in AREAS. Render a ### heading per group in pages.md so the website sidebar follows it. Groups never change page IDs. Groups per area are in the proposed tree in tree-structure.md.",
 "generatedSource": "tools/lib/docs.ts",
 "id": "tree-structure-04",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

- `tools/lib/docs.ts:49-56` (generated copy): `PageEntry` holds id, title, since and summary. No group field. On the current branch (`tools/lib/docs.ts:48-53`) it holds only id, title and summary. `AREAS` (`:59-69`) is a flat list of area id and heading.
- `pageList` (`tools/lib/docs.ts:518-541` generated copy, `:483-500` current branch) writes one `##` heading and one table per area. There is no level under the area.
- `docs/pages.md:49-91`: API reference has 39 rows in one table. `docs/pages.md:94-122`: Guides has 25 rows in one table. The counts in the claim are right.
- `api/three-compat` sits between `api/geometry` and `api/materials` (`docs/pages.md:59`). It is an add-on package, but the other add-on packages (particles, impostors, terrain, grass, splats, sound, water, wind) sit together at rows 83-90. This one is out of place.

What does not hold:

- "Related pages sit far apart" is mostly wrong. The order in `PAGES` already groups related pages without headings. The five add-on feature pages (features, vertex-draws, feature-draws, feature-effects, feature-instances) are together. Sprites, points and lines are together. The eight add-on packages are together. ui and page are together. In Guides, custom-shaders and custom-passes are together, loading-screens and start-time are together, and testing and debugging are close. The real outliers are few: `api/three-compat`, `api/tasks` (add-on work, but last in the list and away from the feature pages), and `guides/first-use-shaders`. The last one is at the end only because generated pages have no slot in `PAGES`. That is a different finding (tree-structure-03), not a missing group level.
- "Cannot be scanned" overstates it. A 39-row table with a one-line summary per row can be scanned. Headings make it faster, but nothing in the list misleads a reader.
- Severity high does not fit. The scale says high = misleads a reader or blocks a newcomer. A flat but mostly ordered list does neither. It makes the two biggest areas clearly harder to use, which is medium.
- "So the website sidebar follows it" has no support in this repository. The website is a separate repo. Nothing in `docs/`, `AGENTS.md` or `.dev/` says the website builds its sidebar from `pages.md` headings or from `PAGES`. The only sidebar in `.dev/` is the examples page sidebar (`.dev/examples.md:12,69`), which reads `DEMO_GROUPS` in `examples/demos.ts`. The group must reach the website in a form it reads, and the website owner must agree to that form.

## Corrected claim

No area has a group level: `PageEntry` has no group and `pageList` writes one flat table per area, so API reference (39 pages) and Guides (25 pages) have no headings under the area. The inventory order already keeps most related pages together. The few that sit apart are `api/three-compat` (away from the other add-on packages), `api/tasks` (away from the add-on feature pages), and `guides/first-use-shaders` (at the end, because generated pages are unranked, see tree-structure-03). Severity: medium.

## Corrected edit

Keep the proposal: add a `group` field to `PageEntry` and an ordered group list per area in `AREAS`, and write a `###` heading per group in `pages.md`. Groups never change page IDs. In the same change, move `api/three-compat` into the add-on packages run and `api/tasks` beside the add-on feature pages in `PAGES`. Do not assume the website sidebar will follow the `###` headings. Agree with the website owner how it reads the group (from the headings in `pages.md`, or from an exported list made from `PAGES` and `AREAS`), and keep the inventory as the one source of the group.
