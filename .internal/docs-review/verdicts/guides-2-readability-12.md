# guides-2-readability-12

## The finding as given

```json
{
 "page": "guides/start-time",
 "anchor": "page top, lines 13-25",
 "category": "scan-order",
 "severity": "medium",
 "claim": "The page has 15 H2s split between host work and sketch work but no list of the steps. Line 25 promises 'the steps that shorten it, in the order of the start' and never lists them, so a reader must read 5,470 words to find what to change.",
 "evidence": "stats.json headings and words 5470; line 25.",
 "proposedEdit": "After line 25 add a checklist with links: 'On the host: compress every file; let the browser keep the files; serve over HTTP/2; keep the early core script. In the sketch: start the first view's downloads at the top of the setup; draw the first frame before the large models; keep the first view's pipelines few; register a service worker after the first frame. Then: test a production build, and measure the start.'",
 "generatedSource": "",
 "id": "guides-2-readability-12",
 "slice": "guides-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The H2 count is wrong. stats.json lists 14 H2s, not 15, and one of them is "Related pages". So 13 H2s hold content.
- The page does not split its sections into host work and sketch work. Line 25 says the steps follow "the order of the start", and the headings follow that order. The host sections come first (lines 112-150), then the engine's own work (line 152), then the sketch sections (lines 168-288), then testing and measuring (lines 290-320). The finding's grouping is the reviewer's idea, not the page's.
- "A reader must read 5,470 words to find what to change" goes too far. Most H2s are already actions, such as "Compress every file" and "Serve over HTTP/2", so a heading outline or the site's table of contents shows the steps. The front-matter summary also names the topics in order.
- The main point holds. Line 25 promises steps and gives no list of them. The first step starts at line 112, after about 85 lines of timing tables in "Where the time goes" and "On real phones". A reader who wants to know what to change must scroll past all the measurements first. The diagram at lines 13-24 shows the order of the start, not the actions to take.
- The proposed checklist is mostly accurate:
  - "Keep the first view's pipelines few" is a bullet under "Pipelines on phones" (line 268), not a heading. The link must point to that section.
  - "Register a service worker after the first frame" matches the first bullet under "Cache for offline play after the first frame".
  - The list leaves out two topics. "What the engine does while the core downloads" describes the engine's own work, not a step for the reader, so leaving it out is correct. "The preset check" has an optional choice (`presetCheck: 'before-play'`), but it is not a step that shortens the start, so leaving it out is also acceptable.
  - The host/sketch/then labels are a new grouping. They do not match the page's own order: "Pipelines on phones" (line 250) comes after "The preset check", and "Cache for offline play" comes before "Test a production build". A list that follows the page's order is easier to check against the headings.

## Corrected claim

Line 25 promises the steps that shorten a start, but the page never lists them. About 85 lines of timing tables come before the first step, at line 112. The H2 headings (14, with "Related pages") are mostly actions and follow the order of the start, so a table of contents shows the steps. A reader of the page text still has to scroll past all the measurements to reach them. Medium severity is fair, but at the low end.

## Corrected edit

After line 25, add a short numbered list. Follow the page's own order and link each item to its section:

1. [Compress every file](#compress-every-file), `.wasm` included.
2. [Let the browser keep the files](#let-the-browser-keep-the-files).
3. [Serve over HTTP/2](#serve-over-http2).
4. [Keep the early core script](#keep-the-early-core-script), and create the engine as soon as the page can.
5. [Start the first view's downloads at the top of the setup](#start-the-first-views-downloads-at-the-top-of-the-setup).
6. [Draw the first frame before the large models](#draw-the-first-frame-before-the-large-models).
7. [Keep the first view's pipelines few](#pipelines-on-phones).
8. [Start an offline cache only after the first frame](#cache-for-offline-play-after-the-first-frame).
9. [Test a production build](#test-a-production-build), and [measure the start](#measure-a-start).

After the list, add one sentence saying that "Where the time goes" gives the measurements behind these steps. Leave those tables in the main text: the step sections link back to them, so they should not be moved without a separate finding.
