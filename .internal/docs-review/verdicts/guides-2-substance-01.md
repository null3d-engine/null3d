# guides-2-substance-01

## The finding as given

- page: guides/start-time
- anchor: ## Where the time goes (lines 29-106); ## Pipelines on phones (lines 262, 272-280)
- category: internal-note
- severity: high
- claim: The page reads as a changelog of engine work. It reports times 'before the changes that this guide describes' and 'with the changes', in Before/After tables. Most of the 'changes' are engine work the reader already has, so the reader cannot tell which steps are their job.
- evidence: start-time.md:29 'Before the changes that this guide describes'; :42 'Each change below was then measured alone'; :60 'timed the engine before and after the changes'; :86, :97, :262 'With the changes'; tables :44-58, :64-82, :274-280. AGENTS.md Writing docs: 'states what holds now ... Leave when it happened to git.'
- proposedEdit: Rewrite 'Where the time goes' as present facts: one table of each step of a start, its cost on the simulated phone link, and whose job it is (host, page, sketch, engine). State savings as facts of the reader's choice ('An uncompressed core is 2.0 MB and takes about 2.3 s; Brotli makes it about 0.6 MB'). Move the demo measurement tables (lines 44-58, 64-82, 88-104, 254-262, 274-280) into one <details><summary>Technical details: measured starts of the engine's demos</summary> block, framed as 'with and without the step'.

Verdict: partly

## Evidence

The claim holds. Every quoted line is on the page:
- docs/guides/start-time.md:29 "Before the changes that this guide describes, a first visit spent its time on these steps".
- :42 "Each change below was then measured alone"; the table at :44-58 has "Change | Measured | Before | After" columns.
- :60 "the same Mac timed the engine before and after the changes in turns"; the tables at :64-82 are Before/After totals for the whole engine.
- :86 "Before the changes, a first visit drew its first frame in these times"; :97 "With the changes, on the same devices"; :262 "With the changes, a first visit's builds took ...".
- :274-280 is a Before/After table for the stored pipeline list.

AGENTS.md hard rule 41 (line 156) and the Writing docs rule (line 235) say docs state what holds now and leave "when it happened" to git. A Before/After pair whose "before" is an older engine is that kind of log.

Many rows in :44-58 are engine work, not a reader's step: "The sketch module loads while the core downloads" (:48), "The stored list of the first frame's pipelines" (:50), "The splats add-on starts its decoder and its selection beside its first download" (:54), "The splat scan draws once the nearest parts are in" (:53), "Chrome keeps the compiled core" (:58). A reader gets these with no action, so a Before column for them reports old engine versions.

One part of the claim is overstated. The reader can tell their steps from the rest of the page: :25 says "The host, the page and the sketch each decide part of the start", and the later section headings name the reader's tasks (Compress every file, Draw the first frame before the large models, Start the first view's downloads at the top of the setup, Cache for offline play after the first frame). The confusion sits in "Where the time goes" and in the two figures in "Pipelines on phones" (:262, :272-280).

## What is wrong with the proposed edit

1. "With and without the step" works only for the reader's own choices, such as compression, the download list, the first frame before the large models, and the service worker. It does not work for engine-internal rows (:48, :50, :53, :54, :58) or for the engine-wide totals (:64-82, :88-104), whose "before" column is an older engine. A reader cannot turn those off. In a block they are still a changelog, and rule 41 still applies inside a block. Those "before" figures must be cut. They must not be moved.
2. Lines 254-260 (pipeline build time per device) are not a before/after table. They are a present fact that backs the section's main point, and :252 ("The demos built these pipelines for their first frame") and :262 point at them. They can stay in the main text or go into a block, but they must not go into a block that "Where the time goes" owns.
3. A single block for two sections breaks the rule that the main text must make sense with every block closed. "Pipelines on phones" would then point at figures in a block in another section. Give each section its own block.

## Corrected claim

Lines 29-106 and 262, 272-280 are written as a before-and-after log of engine work. That breaks hard rule 41. In the table at 44-58 and the totals at 64-82 and 88-104, most "before" figures belong to older engine versions that a reader cannot choose. The later section headings already name the reader's own steps.

## Corrected edit

- Rewrite "Where the time goes" as present facts. Use one table: the step of a start, its cost on the simulated phone link today, and who decides it (host, page, sketch, or engine with no action needed). Give each saving the reader controls as a present fact, for example: "An uncompressed core is 2.0 MB and takes about 2.3 s on this link. Brotli makes it about 0.6 MB."
- Delete the "Before" figures of engine-internal work and of the old engine totals (rows :48, :50, :53, :54, :58; the Before columns of :64-82 and :88-93). Keep today's totals for each demo (the After columns, and :99-104) as present times.
- Put today's measured times for each demo and device into `<details><summary>Technical details: measured starts of the engine's demos</summary>` inside "Where the time goes". Add a with-and-without comparison only for the steps the reader chooses: compression (:46-47), the download list (:55-56), the first frame before the large models (:51-52), and the preset check mode (:57).
- In "Pipelines on phones", keep the table at :254-260 and the pipeline counts in :262 as present facts. Drop the "With the changes" sentence in :262. State the stored pipeline list's effect as a present fact ("On a repeat visit, the stored list cuts the Galaxy S25's time from the setup's end to the first frame for the island to about 1.6 s"). The current figures from :274-280 can go into that section's own block if they are needed.
