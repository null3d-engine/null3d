# api-2-substance-22

## Finding as given

```json
{
 "page": "api/materials",
 "anchor": "### Moment transparency (682, 693); ### Alpha to coverage (602); ### Mirrors, polished floors and water (853)",
 "category": "internal-note",
 "severity": "medium",
 "claim": "'on both test scenes' cites unnamed benchmarks. 'draws exactly as it does today', 'as it did before' and 'in this version' describe change over time, not the current state.",
 "evidence": "docs/api/materials.md:602, 682, 693, 853; AGENTS.md: name the engine's benchmarks when you cite a figure; state what holds now.",
 "proposedEdit": "682: name the scenes (the moment-layer and moment-spread-layer image tests). 693: 'A page without the setting draws blended surfaces with the sort.' 602: end at '... casts its mesh's whole shape.' 853: 'Standard materials take no reflection pass.'",
 "generatedSource": "",
 "id": "api-2-substance-22",
 "slice": "api-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The page is hand-written (docs/api/materials.md is not a generated page), so no generator source is needed.
- docs/api/materials.md:602 ends "and it casts its mesh's whole shape, as it did before." This describes change over time. AGENTS.md "Writing docs" line 15: every file states what holds now. This part holds, and the edit (end at "whole shape.") is right.
- docs/api/materials.md:693 "A page without the setting draws exactly as it does today." Change-over-time wording. This part holds. The edit is fine.
- docs/api/materials.md:853 "Standard materials take no reflection in this version: give a polished floor a custom material ..." "In this version" hints at a later feature (AGENTS.md line 10: no promise of a later feature). This part holds. But the proposed edit must keep the advice after the colon; it is useful and not an internal note.
- docs/api/materials.md:682 "on both test scenes: more than twice nearer where five surfaces sit within a few meters, and about two and a half times where they spread over some meters." The same sentence already describes both scenes, so they are not wholly unnamed. They are image tests, not benchmarks: tests/image/moment-transparency.spec.ts:60-71 defines two scenes, "the panes at similar depth" and "the panes spread from one to thirty metres", each compared across three images (moment-sorted / moment-weighted / moment-layer, and the spread set; tests/image/manifest.ts:3675-3720). The proposed edit names only the moment-layer half of each comparison, and these test ids are code names that a developer who uses the engine cannot act on. The vague "some meters" is the real gap: the test spreads the panes from one to thirty meters.
- Severity: none of the four phrases misleads a reader or makes the page clearly harder to use. "As it does today" and "in this version" read as present limits to most readers. This is polish: low, not medium.

## Corrected claim

Three phrases describe change over time instead of the current state: "as it did before" (602), "exactly as it does today" (693) and "in this version" (853). At 682, "both test scenes" points at the engine's moment transparency image test without saying so, and "spread over some meters" is vaguer than the test (one to thirty meters). Severity low.

## Corrected edit

- 602: end the sentence at "... and it casts its mesh's whole shape."
- 693: "A page without the setting sorts its blended surfaces in the transparent pass."
- 853: "Standard materials take no reflection pass: give a polished floor a custom material with the floor's values."
- 682: "In the engine's moment transparency image test, which compares each method with an exact sorted image of five panes, it is more than twice nearer than the weighted blending where the panes sit within a few meters, and about two and a half times nearer where they spread from one to thirty meters." Do not cite the internal test ids.
