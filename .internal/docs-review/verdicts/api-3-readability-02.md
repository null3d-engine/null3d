# api-3-readability-02

## The finding as given

- page: api/sketch
- anchor: ## The context, line 112
- category: scan-order
- severity: high
- claim: The context table and the callbacks, what a newcomer opens this page for, come after module retry rules (E1401, E1410), top-level code timing, hold-mode seeding, the download list and the serial-load warning.
- evidence: stats.json headings: Where the sketch runs, The setup function, Options, The download list, Loads one after another, The context (line 112), The engine field, The callbacks (line 165). Line 45 'A module whose default export is not defineSketch(...) fails the start with E1401'.
- proposedEdit: Reorder: intro and example; The setup function; The context; The callbacks; When changes show; Example: a camera that follows a moving object; The engine field; Options with The download list and Loads one after another; Where the sketch runs; Errors in callbacks. Put lines 45 and 47 in `<details><summary>Technical details: how the engine loads the module</summary>`, and keep one main sentence: 'Code at the top of the module runs before the engine starts, so it must not call the engine.'

Verdict: partly

## Evidence

- docs/api/sketch.md: "## The context" is at line 112 and "## The callbacks" is at line 165. Before them come the load errors and retry (line 45), top-level code timing (line 47), hold-mode seeding (line 49), Options (57), The download list (75) and Loads one after another (106). The scan-order claim holds.
- The page's own front-matter summary (line 6) lists the context first, then the callbacks, then the options and the download list. The body does not follow that order, which supports the reorder.
- Severity is too high. Nothing here misleads, and a newcomer is not blocked: the opening example (lines 15-39) already shows `setup`, the context fields and `onUpdate`. The order makes the page harder to scan. That is medium.
- The proposed main sentence is wrong. Line 47 says top-level code "can therefore run before the engine has started". Line 49 says hold mode, a replay and a recording load the module only after the engine has started. So "runs before the engine starts" does not hold in every mode. It also drops the E1403 link, which is the error a reader actually gets.
- Moving all of "Where the sketch runs" to the end hides a fact a newcomer needs early. Line 43 says the sketch has no `document` and no `window` and talks to the page through messages. "The setup function" (line 55) also says "In the threaded build", and line 43 is what explains the threads.
- In the proposed order, "Where the sketch runs" sits between the Options and "Errors in callbacks". That splits the callback material: "Errors in callbacks" belongs right after the callbacks and their example.
- The details-block format (summary starting "Technical details:", no headings inside) meets the contract. Line 45 (E1401, E1410, the retry) and most of line 47 are good material for it.

## Corrected claim

The context table and the callbacks come after the module load errors, top-level code timing, hold-mode seeding, the options, the download list and the warning about loads one after another. That makes the page harder to scan. Severity: medium, not high.

## Corrected edit

Order: intro and example; Where the sketch runs (line 43 only, in the main text); The setup function; The context; The callbacks; When changes show; Example: a camera that follows a moving object; Errors in callbacks; The engine field; Options, with The download list and Loads one after another.

In "Where the sketch runs", keep one main sentence after line 43: "Code at the top of the module can run before the engine has started, so it must not call the engine ([E1403](../errors/E1403.md))." Move line 45 (E1401, E1410 and the retry), the rest of line 47 (it loads while the core downloads, and a table built there overlaps the download) and line 49 (hold-mode seeding) into one block:

<details>
<summary>Technical details: how the engine loads the module</summary>

(lines 45, 47 and 49, unchanged)

</details>
