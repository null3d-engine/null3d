# Verdict: api-1-readability-14

## The finding as given

- id: api-1-readability-14 (slice api-1, role readability)
- page: api/assets
- anchor: line 59 (hold mode); lines 79-81; ## Environments (245-254); lines 355-357
- category: technical-details-block
- severity: medium
- claim: The hold-mode paragraph sits between the calls table and 'glTF models', so it is the second thing a newcomer reads, though it matters only to image tests. Lines 79-81 give download sizes and the code-loading rules. The environment bullets give per-device GPU times and the sky map's 20-stage refresh.
- evidence: assets.md:59 opens 'In hold mode, and while a recording replays...'. :81 says 'Three calls answer at once'. :251 and :254 give 20 ms, 50 to 110 ms and 1 ms per stage.
- proposedEdit: Move line 59 to the end of 'Loading screens' in <details><summary>Technical details: loads in hold mode and replays</summary>. Put lines 79-81 in 'Technical details: what the first load downloads', and keep 'A worker parses the file outside the sketch's frames.' in the main text. Put the environment timings, the sky refresh, the OpenEXR compression list and the 65,408 clamp in 'Technical details: environment costs and formats'. Put lines 355-357 in a details block after 'The cache of derived data'.
- generatedSource: "" (docs/api/assets.md is a hand-written page)

Verdict: partly

## Evidence

- docs/api/assets.md:59 is the hold-mode paragraph, directly after the calls table (38-57) and before "## glTF models" (61). The quotes at :81, :251 and :254 are exact. stats.json lists this paragraph (99 words, 6 sentences) and the one at :79 (91 words, 5 sentences) as long. The readability problem is real.
- "Matters only to image tests" is too narrow. Line 59 also covers replays of a recording. Its last sentence is a rule for add-on authors: a glTF extension handler's `load` must not wait for another `assets` call in hold mode, or the load waits on itself. That rule must stay in the main text, but the proposed edit hides it in a block at the end of "Loading screens", far from the handler API (130-173).
- docs/guides/testing.md:69 (Hold mode, step 2) already explains that `assets` calls run one at a time, and why. Most of line 59 repeats it, so a short pointer is enough in the main text.
- "Loading screens" (304-319) is about the download list, `preload` and `onProgress`. The order of loads in hold mode does not belong there. The block reads better directly below the calls table, where line 59 is now, or in "Caching".
- Line 79 holds a user-level fact: the files that a `.gltf` file names download through `assets`, so `preload` and `onProgress` cover them too. That fact belongs in the main text with the worker sentence. The 15 KB size, the worker start and the vertex-data copy can go in the block. Line 81 can go in the block as a whole.
- The Environments bullets (245-257) mix cost figures with advice. "Load HDR files while the scene loads." (:248) and "Ask for the room while the scene loads. During play, the call makes one long frame." (:251) tell the reader what to do. If they move into the block, a reader with the block closed loses them. That breaks the rule that the main text must make sense with every block closed. The timings, the 20-stage sky refresh, the OpenEXR compression list, the 65,408 clamp and the download sizes can move. The Errors table (:368) already lists E1412, so the format list is safe in a block.
- Lines 355-357 (the cache budget and how browsers delete storage) suit a block after the bullet list of "The cache of derived data". This part of the finding holds.

## Corrected claim

The hold-mode paragraph sits before the glTF section, though it matters only to tests and replays, and testing.md (step 2 of Hold mode) already explains the order of loads. Its last sentence, though, is a rule for writers of glTF extension handlers, and it must stay in the main text. The download sizes at lines 79-81, the environment costs and formats, and the cache's budget and eviction (355-357) are dense detail that can move into blocks. The advice in the environment bullets must stay in the main text.

## Corrected edit

1. Replace line 59 with one sentence in the main text: "In [hold mode](../guides/testing.md#hold-mode), and while a recording replays, the calls run one at a time, so several loads take longer there." Below it, add `<details><summary>Technical details: loads in hold mode and replays</summary>` with the sentences on why (files arrive in another order on each run, so a held frame would draw content in another order). Keep the block where line 59 is now. Do not move it to "Loading screens".
2. Move the handler rule into "Extensions that add-ons read", after "`load` may return a promise." (:171), as main text: "In hold mode, `load` must not wait for another `assets` call, since that call waits for the load that runs the handler."
3. Line 79: keep "A worker parses the file outside the sketch's frames, and decodes the images that the file holds there." and "The files that a `.gltf` file names download through `assets`, so `preload` and `onProgress` cover them too." in the main text. Put the 15 KB loader size, the early worker start, the vertex-data copy and all of line 81 in `<details><summary>Technical details: what the first load downloads</summary>`.
4. Environments: keep the short facts in the bullet list. These are 245, 247, 255, 256 and 257, plus the first sentence of 248, 251 and 253. Keep "Load HDR files while the scene loads." and "Ask for the room while the scene loads. During play, the call makes one long frame." in the main text. Put the download sizes (246, 248), the 256-texel faces and the 65,408 clamp (249), the OpenEXR list (250), the GPU times (251, 253), 252, and the sky's 20-stage refresh (254) in `<details><summary>Technical details: environment costs and formats</summary>`, after the list and before the link at 259.
5. Put lines 355-357 in `<details><summary>Technical details: how much the cache keeps</summary>` after the bullet list of "The cache of derived data", as proposed.
