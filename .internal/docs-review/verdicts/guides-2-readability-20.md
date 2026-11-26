# guides-2-readability-20

## Finding as given

- page: guides/screens
- anchor: ## Make a screen, lines 50-68
- category: term-before-definition
- severity: medium
- claim: The onUpdate example (lines 54-60) calls screen.mark, screen.flush and an undefined paintTheReading. The text that explains mark, flush and paint comes after it (63-65), then the rule that a held-back refresh returns false. paint, the call most readers need, has no example until 'Clicks on a screen'.
- evidence: lines 54-60, then line 63 '`screen.paint(draw, changed)` draws and uploads the rectangle that changed.'
- proposedEdit: Before the second example add a table: screen.paint(draw, rect?) draws and uploads; screen.mark(rect) adds a rectangle without drawing; screen.flush() uploads the marked rectangles as one change and returns false while the refresh rate holds it back. Rewrite the example with screen.paint and an inline draw function so the code runs as shown; keep mark and flush as a second short snippet.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/guides/screens.md:53-61: the per-frame snippet calls `paintTheReading(screen.context)`, `screen.mark(...)` and `screen.flush()`. `paintTheReading` is defined nowhere on the page or in the docs and skills (grep finds only this line). It carries a comment, so it reads as a placeholder, but it does not run as shown.
- docs/guides/screens.md:63-65: the text that defines `paint`, `mark` and `flush` comes after the snippet. Lines 67-68 give the held-back rule after that.
- docs/guides/screens.md:98-104: the first `screen.paint` example is in "Clicks on a screen".
- examples/addons/screens/index.ts:106-124 and 204-240: the code matches the page. `paint` draws, marks and calls `flush`. `flush` returns false when the refresh rate OR an upload still in flight holds the read, and the marks stay for the next call.

So the facts of the claim hold. Two parts do not:

1. Severity. The definitions sit three lines below the snippet, and the snippet's comments say what each call does. Code first, then a short explanation, is a normal pattern. The cost to a reader is small: low, not medium.
2. The proposed edit. Its table text for `flush` says it returns false "while the refresh rate holds it back". The code also returns false while an upload is still in flight (index.ts:120-122, page line 67). The table would drop that case. A three-row table also repeats prose that already exists at lines 63-65; moving that paragraph is enough. Rewriting the per-frame snippet with `paint` alone would also hide why the page shows `flush` in the update: a change that a paint sent while the rate held it back goes out only when something calls `flush` again (lines 67-68).

## Corrected claim

The per-frame snippet uses `mark`, `flush` and a placeholder `paintTheReading` before the page defines them, and `paint` has no example until "Clicks on a screen". This is a low-severity ordering issue: the definitions follow three lines later.

## Corrected edit

No table. Move the paragraph at lines 63-65 above the per-frame snippet, and add a short `paint` snippet beside it:

    screen.paint((context) => {
      context.fillStyle = '#061019';
      context.fillRect(24, 150, 464, 90);
      context.fillStyle = '#9fe8ff';
      context.fillText(`REACTOR ${reading.toFixed(1)}`, 24, 200);
    }, { x: 24, y: 150, width: 464, height: 90 });

Then introduce the onUpdate snippet as the way to draw straight on `screen.context` each frame. Replace `paintTheReading(...)` with a few direct drawing calls on `screen.context`, or name it clearly as your own function in the comment. Keep lines 67-68 after it, including the in-flight upload case.
