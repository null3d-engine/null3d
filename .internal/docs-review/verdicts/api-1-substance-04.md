# api-1-substance-04

## Finding as given

- Page: api/animation, api/assets, api/cameras, api/controls, api/debug, api/engine, api/feature-draws, api/feature-effects, api/feature-instances, api/features, api/geometry, api/grass
- Anchor: The note under each title: "Roadmap step 0.x, first released in null3D 0.1.0." (line 11)
- Category: internal-note. Severity: medium.
- Claim: Roadmap steps are the maintainers' build plan. No public page lists the roadmap, and all steps ship in 0.1.0, so "step 0.2" tells a developer nothing. AGENTS.md bars internal plans from docs/.
- Evidence: Line 11 of all 12 pages. Required by tools/lib/docs.ts:652-658 and built by tools/lib/steps.ts:25 (shipsSentence); tools/lib/steps.ts:1-3 cites a decision record.
- Proposed edit: Make shipsSentence return "First released in null3D 0.1.0." for the steps 0.1, 0.2 and 0.3, update the pages and docs.test.ts, and drop the step-column wording from docs/index.md and docs/pages.md.
- Generated source: tools/lib/steps.ts

Verdict: partly

## Evidence

- The claim is true of the generated copy that was reviewed. Line 11 of all 12 pages starts "> Roadmap step 0.1|0.2|0.3, first released in null3D 0.1.0." The front matter has `since: "0.1"`, `"0.2"` or `"0.3"`. The docs check in generated/tools/lib/docs.ts:652-658 requires that opening, and generated/tools/lib/steps.ts:16-31 builds it. generated/docs/index.md:34 and :49, and generated/docs/pages.md:11 and its Step column, use the same roadmap wording. No public page defines the steps. AGENTS.md (docs rules) bars "internal plans" from published docs, so the wording breaks a rule and gives the reader nothing.
- The generated copy is older than the branch. It is "chore: generated files of 032e6003" (12:49). The branch head, 10aa9fb37 "docs: drop the status and version labels from the docs pages" (13:19), already does more than the proposed edit:
  - It deletes tools/lib/steps.ts and tools/lib/steps.test.ts.
  - It removes `status` and `since` from every written page's front matter, and the release and status sentences from each title note. docs/api/animation.md now has no note. docs/api/features.md keeps only its limits sentence.
  - It drops the Status and Step columns from the page list, and the label table and step text from docs/index.md.
  - `grep -ril roadmap docs/` on the branch returns nothing.
- So the proposed edit cannot be applied. Its target file no longer exists. It would also keep a "First released in null3D 0.1.0" sentence that the branch removed on purpose. That sentence is a version label, the thing the branch commit drops.

## Corrected claim

The roadmap-step wording in the title notes (and in docs/index.md and docs/pages.md) is internal plan language and should not be published. This holds for the reviewed generated copy only. Branch commit 10aa9fb37 already removes it, with the steps module, the status and since labels, and the Step column.

## Corrected edit

No edit is needed. Regenerate the review copy from the branch head and confirm that no page has "roadmap" or a "step 0.x" note. Do not bring back a "First released in null3D 0.1.0" sentence.
