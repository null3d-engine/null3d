# guides-2-substance-07

## Finding as given

- page: guides/loading-screens, guides/start-time, guides/phones
- anchor: loading-screens line 134 and lines 145-147; start-time ## Pipelines on phones (lines 252-280); phones line 103
- category: duplication
- severity: medium
- claim: The phone pipeline counts and build times appear on three pages, with drift: loading-screens says '46 to 63 pipelines on a phone', and start-time gives 45 to 46 for Creek. The island repeat-visit figures on the Tab A9 Plus (8.8 to 11.2 s against 23.6 s) appear on two pages.
- evidence: loading-screens.md:134,147; start-time.md:262,280; phones.md:103. AGENTS.md 'One source per fact'.
- proposedEdit: Keep the figures on start-time 'Pipelines on phones', in a <details><summary>Technical details: pipeline builds on phones</summary> block. On loading-screens keep one sentence ('On a phone, a showcase's first frame builds about 50 to 60 pipelines, which take seconds') and a link. On phones keep only the link.

Verdict: partly

## Evidence

- loading-screens.md:134 repeats the pipeline counts (46 to 63 on a phone, 73 to 84 on a MacBook Pro) and the build times (1.8 to 5.4 s Galaxy S25, 11.8 to 16.5 s iPhone 17, up to 23.5 s Tab A9 Plus). All of these are in start-time.md:254-262. The same paragraph already ends with a link to start-time "Pipelines on phones", so it copies the figures and also points to their source.
- loading-screens.md:147 repeats the island repeat-visit figures (8.8 to 11.2 s, about 23.6 s) that start-time.md:280 has in its table. Duplication on two pages holds.
- The drift holds, but it is small. The three showcase demos (Skyway, Island, Creek) built 53 to 55, 61 to 63 and 45 to 46 pipelines on phones (start-time.md:262). Their range is 45 to 63, and loading-screens says 46 to 63.
- A larger drift exists that the finding does not name. start-time.md:262 says that "with the changes" a first visit's builds took 0.4 to 3.6 s on the Galaxy S25 and 3 to 23 s on the Tab A9 Plus. The table above it (start-time.md:254-260) and loading-screens.md:134 give the older 1.8 to 5.4 s and 23.5 s. So start-time disagrees with itself, and loading-screens copies the older numbers. "With the changes" is also process wording that tells a reader nothing.
- phones.md:103 does not drift. "55 pipelines took 10.9 seconds to build on a Galaxy Tab A9 Plus" matches the Skyway column (start-time.md:258, 262). It is one concrete example that makes the paragraph's point ("a first view with few pipelines saves more"), and the paragraph already links to start-time. Removing it is a matter of taste and makes the point vaguer. This part of the finding is refuted.

## Problems with the proposed edit

- Putting all of start-time's "Pipelines on phones" figures in a closed block hides the section's subject. The section exists to show what pipeline builds cost on real phones, and its advice bullets depend on that. With the block closed, the section only says "building pipelines is the largest cost" and gives no scale. The first-visit table must stay in the main text.
- The proposed loading-screens sentence, "about 50 to 60 pipelines", is wrong. The measured range is 45 to 63.
- "Phones: keep only the link" removes a correct, consistent example (see above).

## Corrected claim

loading-screens.md:134 and :147 copy figures that start-time "Pipelines on phones" owns. The copy at :134 has drifted by one pipeline (46 against 45 to 63). start-time.md:262 also disagrees with its own table on first-visit build times, and loading-screens copies the table's older numbers. phones.md:103 gives one consistent example with a link, and needs no change.

## Corrected edit

- start-time "Pipelines on phones": keep the first-visit table and the advice bullets in the main text. Make line 262 agree with the table. Either drop the "with the changes" sentence or state which figures are current and update the table to match. Move the dense part into one block after the table: `<details><summary>Technical details: pipeline counts and Chrome's pipeline cache</summary>`, holding the per-demo pipeline counts (phones and MacBook Pro) and the Chrome cache sizes (about 2 MB, 128 KB on a low-end phone, 6 MB on a computer). Keep the before-and-after table at :274-280 visible, because it is the evidence for the engine's stored list.
- loading-screens.md:134: keep the first two sentences (why a larger scene needs more pipelines, and why custom materials are slow). Replace the figures with one sentence, for example: "On a phone, a showcase scene's first frame builds 45 to 63 pipelines, which take most of the start: a few seconds on a fast phone and up to about 20 seconds on a slow tablet." Keep the Safari and Chrome sentences and both links.
- loading-screens.md:147: replace the figures with one sentence and a link, for example: "On a slow tablet, the list cut the island showcase's repeat-visit wait by more than half ([A fast start](start-time.md#pipelines-on-phones))."
- phones.md:103: no change.
