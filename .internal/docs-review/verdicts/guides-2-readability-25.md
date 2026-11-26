# guides-2-readability-25

## Finding as given

- page: guides/ui-overlays
- anchor: ## GUI panels, lines 159-174; ## Labels that follow objects, lines 78-95
- category: example-placement
- severity: low
- claim: The page code posts exposure and bloom, but the sketch handler applies only exposure and does not show where page and post come from. The health bar sets a --hp CSS variable that no shown CSS uses, so copied code shows empty bars.
- evidence: line 166 posts 'bloom'; line 172 handles only 'exposure'; line 93 bar.style.setProperty('--hp', ...).
- proposedEdit: Add a 'bloom' branch in the form api/post.md gives (post.set({ bloom: {} }) turns bloom on with its last values) and show defineSketch(({ page, post }) => { ... }). Add a short CSS block after the label page code, e.g. .hp { width: 60px; height: 6px; background: linear-gradient(to right, #4caf50 var(--hp), #333 0); }.

Verdict: partly

## Evidence

- docs/guides/ui-overlays.md:166 posts 'bloom' from the GUI. The sketch handler at lines 171-173 handles only 'exposure'. The bloom toggle does nothing when copied. This holds.
- docs/guides/ui-overlays.md:88 and :93 give the bar the class `hp` and set `--hp`. No CSS on the page, and nothing else in docs/ or examples/, styles `.hp` or reads `--hp` (grep). The bar is an empty div with no size, so nothing shows. This holds.
- The bloom form is right: docs/api/post.md:141 and docs/concepts/post-processing.md:97 say `post.set({ bloom: false })` turns bloom off and `post.set({ bloom: {} })` turns it on with its kept values.
- The `defineSketch` wrapper part does not hold up as a defect. The page's snippets are fragments by convention: lines 110-111 and 143-148 also show sketch code with no wrapper, and the page code uses `engine` and `layer` without defining them. The full wrapper, with `page` taken from the context, is shown once at lines 56-58. To wrap only this snippet would be inconsistent with the rest of the page. At most, the destructure could be named in a short comment.

## Corrected claim

The sketch handler ignores the 'bloom' message that the page code sends, and the health bar has no CSS, so copied code shows no bar and a dead bloom toggle. That the snippet does not show where `page` and `post` come from is the page's normal fragment style, not a defect.

## Corrected edit

In the GUI panels sketch snippet, add the bloom branch and leave the snippet as a fragment:

```ts
// sketch.ts, inside defineSketch(({ page, post }) => { ... })
page.onMessage((type, data) => {
  if (type === 'exposure') post.set({ exposure: data as number });
  if (type === 'bloom') post.set({ bloom: data ? {} : false });
});
```

After the label page code (line 95), add a short CSS block that gives the bar a size and reads `--hp`:

```css
.hp { width: 60px; height: 6px; background: linear-gradient(to right, #4caf50 var(--hp), #333 0); }
```
