# guides-2-substance-08

## Finding as given

- page: guides/phones, guides/start-time
- anchor: phones ## When the GPU's driver refuses a shader (lines 109-111); start-time lines 108-110
- category: duplication
- severity: medium
- claim: Both pages tell the same driver-refusal story in almost the same words, ending "The creek demo reaches its first frame at 71 seconds there, but the tablet runs out of GPU memory 4 seconds later". The second half reads as a test log of the engine's own demos, not advice.
- evidence: phones.md:109-111; start-time.md:108-110.
- proposedEdit: Keep the rule (rebuild once alone, E1307, objects left out, E1404 for a full-screen pass) on phones. Move the Tab A9 Plus story into `<details><summary>Technical details: a low-end tablet's driver</summary>` on phones. Delete start-time line 110 and link to phones.

Verdict: partly

## Evidence

- The duplication is real. phones.md:109 gives the rule (one retry alone, objects left out, E1307). phones.md:111 gives the tablet story: island draws without its far tree cards; creek reaches its first frame at 71 seconds and runs out of GPU memory 4 seconds later (E1302). start-time.md:110 repeats the same rule and the same story, with the same numbers and nearly the same words.
- The "test log, not advice" point holds on phones. The E1302 memory failure 4 seconds after the first frame has nothing to do with a refused shader, so on the shader section of phones it is off topic.
- The proposed direction is wrong. start-time.md:84 "### On real phones" is the page's section of measured results on named devices (the table at start-time.md:100-105 and the notes at 106-108). phones.md:103 already sends readers to start-time "with measured times on real phones". The measured device story belongs on start-time, and the rule belongs on phones.
- Deleting start-time line 110 would lose a fact found nowhere else: the island draws "at 1.1 frames a second at Low" on that tablet. It would also leave start-time.md:108 ("failed to build one custom material's pipeline") without its outcome.

## Corrected claim

Both pages state the driver-refusal rule and the tablet story with the same numbers. The rule is duplicated on start-time, and the measured device story is duplicated on phones, where the GPU-memory failure (E1302) is off topic for a section about refused shaders.

## Corrected edit

- phones.md: keep line 109 (the rule) and the E1404 sentence. Delete line 111. In its place, add one sentence: "[A fast start](start-time.md#on-real-phones) shows what this did on a low-end tablet." No details block is needed, because the detail stays on start-time.
- start-time.md:110: replace the rule restatement with a link, and keep the measurements: "The engine left that pipeline's objects out and drew on, as [Phones and tablets](phones.md#when-the-gpus-driver-refuses-a-shader) explains. So the island drew on that tablet without its far tree cards, at 1.1 frames a second at Low. The creek demo reached its first frame at 71 seconds, but the tablet ran out of GPU memory 4 seconds later ([E1302](../errors/E1302.md))."
- If start-time's "On real phones" section is judged too dense, the measured tablet story (lines 108 and 110) can go in a `<details><summary>Technical details: a low-end tablet's results</summary>` block on start-time. The main text still makes sense with it closed.
