# guides-2-readability-24

## Finding as given

- page: guides/phones
- anchor: ## When the GPU's driver refuses a shader, lines 111 and 113
- category: structure
- severity: low
- claim: Line 113 (the engine gives back its GPU device in the back-forward cache) has nothing to do with a refused shader, so a reader cannot find it. Line 111 repeats the island and creek failure from start-time lines 108-110.
- evidence: line 113 'On phones and tablets, the engine also gives back its GPU device while the browser keeps the page in its back-forward cache.'
- proposedEdit: Move line 113 to '## Power' or a short H2 'When the page leaves and comes back'. Replace line 111 with one sentence and a link to start-time.md#on-real-phones.
- generatedSource: (none, hand-written page)

Verdict: partly

## Evidence

- docs/guides/phones.md:107-113. The section is about a driver that refuses a pipeline (E1307). Line 113 is about the engine giving back its GPU device while the page sits in the back-forward cache. The page gives no link between the two, so the sentence is out of place under this heading. This part holds.
- docs/api/engine.md:103 and :182. The device is given back only where the engine keeps texture copies (the default on phones and tablets). Its purpose is to free GPU memory for the next page: "The cached page then leaves its GPU memory to the next page. A repeat visit of a heavy page on a phone with little memory needs that room." So the topic is memory, not power.
- docs/guides/phones.md:93-95. "## Power" is about a still view that stops drawing. The device release does not save power, so the first proposed target is wrong.
- docs/guides/start-time.md:108 and :110. These lines give the same Galaxy Tab A9 Plus facts as phones.md:111: the island without its far tree cards, and the creek demo at its first frame at 71 seconds, then out of GPU memory 4 seconds later (E1302). The repeat claim holds. The creek half of line 111 is about GPU memory (E1302), not a refused shader, so it fits this section even less.
- The finding is low severity, which fits: both sentences are correct, and only their place is wrong.

## Corrected claim

Line 113 is out of place under the refused-shader heading. It belongs to memory: the engine gives back its GPU device in the back-forward cache so the next page has GPU memory. Line 111 repeats start-time.md:108-110, and its creek half is about GPU memory, not a refused shader.

## Corrected edit

- Move line 113 to the end of "## Memory" (after line 87), not to "## Power". Say why in the same place: "On phones and tablets, the engine gives back its GPU device while the browser keeps the page in its back-forward cache. The page then leaves its GPU memory to the next page, and starts a new device when it comes back ([Page API](../api/engine.md#the-running-engine))."
- Replace line 111 with one sentence: "On a Galaxy Tab A9 Plus, the island demo drew on without its far tree cards ([A fast start](start-time.md#on-real-phones))." Drop the creek sentence here, because start-time.md already gives it.
