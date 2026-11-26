# Verdict: api-1-readability-23

## Finding as given

```json
{
 "page": "api/feature-instances",
 "anchor": "## Limits (lines 143-152)",
 "category": "structure",
 "severity": "medium",
 "claim": "Ten bullets mix shadows, readiness, culling, capacity, memory, camera conversion, back-face culling, pass order and setup timing. Two bullets repeat earlier sections, and line 152 repeats the feature-draws page. Three rules a user must follow are mixed in with notes.",
 "evidence": "feature-instances.md:147 repeats :112 (two buffers, double memory). :148 repeats :139 (shadow views draw the count word).",
 "proposedEdit": "Put the must-do rules first, as a numbered list under H3 'Rules': use band 'before'; create and await the draw in the setup (E1506); keep the count at or under capacity. Then add H3 'Shadows' (lines 143, 148, 149) and H3 'Culling' (lines 144, 145). Cut lines 147 and 152.",
 "generatedSource": "",
 "id": "api-1-readability-23",
 "slice": "api-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/api/feature-instances.md:141-152. The Limits section has ten bullets on mixed topics. The claim holds.
- :147 repeats :112 nearly word for word: a second buffer of capacity rows for the converted rows, so the memory doubles. The claim holds, and cutting :147 loses nothing.
- :148 has two sentences. Only the second ("A shadow view draws the add-on's count word too...") repeats :139. The first sentence is new: the conversion uses the main view's camera, so the shadow views read rows converted for that camera. :112 does not say this. So :148 must stay in part.
- :152 is close to docs/api/feature-draws.md:152. It also repeats this page's own :84, which already sends the reader to the feature description page for `reads`, `writes`, `outputs` and `provides`. That is the stronger reason to cut it. Also, :152 as written ("stay with the feature registry") does not say what it means for this draw. The feature-draws version adds that the draw reads and writes no scene resource.
- :146 (count at or under capacity), :150 (`band: 'before'`) and :151 (create and await in setup, E1506) are things the user must do. The other bullets are notes. The claim holds.

## What does not hold in the proposed edit

- :144 is about readiness (the `ready` callback gates the draw, the count copy and the conversion). It is not about culling. Putting it under a "Culling" heading mislabels it.
- An H3 "Rules" under an H2 "Limits" is a poor fit: rules are not limits. Three H3 headings for ten short bullets also add weight.
- A numbered list suggests an order of steps. The three rules have no order.
- The edit keeps all of :148 under "Shadows", but its own evidence says :148 repeats :139. Only the second sentence should go.

## Corrected claim

The Limits list mixes three must-do rules (:146, :150, :151) with notes. :147 repeats :112. The second sentence of :148 repeats :139. :152 repeats this page's :84, and docs/api/feature-draws.md:152 too.

## Corrected edit

Add a short `## Rules` section before `## Limits`, as a plain bullet list: run the add-on's compute in `band: 'before'` (:150); create the draw in setup and await `addComputeInstances()` before the first frame, or the frame fails with E1506 (:151); keep the count at or under `capacity` (:146). In `## Limits`, keep :143, :144, :145, :149, and the first sentence of :148. Put the shadow bullets (:143, :148 first sentence, :149) next to each other. Cut :147, the second sentence of :148, and :152. Do not add H3 headings.
