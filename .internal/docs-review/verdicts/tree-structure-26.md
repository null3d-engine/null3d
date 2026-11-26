# tree-structure-26

## Finding as given

```json
{
 "page": "api/ui,guides/ui-overlays",
 "anchor": "# UI overlays and labels / # UI, HTML overlays and labels",
 "category": "duplication",
 "severity": "low",
 "claim": "Two pages in two areas have near-identical titles and both explain labels.",
 "evidence": "api/ui title 'UI overlays and labels'; guides/ui-overlays title 'UI, HTML overlays and labels' with section 'Labels that follow objects'.",
 "proposedEdit": "Retitle api/ui 'Labels that follow objects' and guides/ui-overlays 'HTML UI over the scene'. The guide keeps HTML layout and GUI panels and links to the API page for labels.",
 "generatedSource": "tools/lib/docs.ts (PAGES titles)",
 "id": "tree-structure-26",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

- The titles hold as stated. tools/lib/docs.ts:146 gives api/ui the title "UI overlays and labels". tools/lib/docs.ts:161 gives guides/ui-overlays the title "UI, HTML overlays and labels". The two differ by a comma and one word. A reader who sees both in the page list cannot tell which page to open. The PAGES list in docs.ts is the right source for the titles.
- api/ui covers only labels. Its reference page (docs/api/reference/ui.md) lists four exports: EngineLabels, LabelOptions, LabelTransform and Ui. All four are about labels. So "Labels that follow objects" is an accurate title for it.
- The overlap is real. The guide repeats facts that the API page already gives:
  - the 4,096 label default and the maxLabels option;
  - the 256 plane default and the maxLabels3d option;
  - "CSS pixels are the scene's units";
  - the engine moving the element into its own container;
  - pointer-events: auto for planes;
  - the world and billboard transforms with rotation.
- The proposed edit cuts too much. It says the guide "links to the API page for labels". That would drop content that only the guide has:
  - the health-bar example, which joins labels with page.post messages in a full app (section "Labels that follow objects");
  - "A page under the scene": a see-through canvas, the layer below the canvas, and a depth-only plane, with the depth-only demo link;
  - the notes that a plane works with an orthographic camera and can hold an iframe or a form;
  - the light-label advice: change text only when the value changes, and bind only the labels a player can see.
  The API page's own Related link describes the guide as "labels in a full app", so the API page expects this content to live in the guide.
- "HTML UI over the scene" does not fit the guide's section on putting a page under the scene.

## Corrected claim

The two titles are near-identical (docs.ts:146 and :161), and the guide repeats reference facts from api/ui: label limits, plane limits, CSS-pixel units, the container move and pointer events. The guide also holds label content that api/ui does not have: the health-bar app example and the page-under-the-scene pattern. That content must stay.

## Corrected edit

In tools/lib/docs.ts (PAGES):
- Retitle api/ui to "Labels that follow objects".
- Retitle guides/ui-overlays to "HTML UI and labels in an app", or to "HTML UI around the scene".

Update the link text in both Related sections to match the new titles.

In docs/guides/ui-overlays.md:
- Keep the HTML layout section, the health-bar example, "A page under the scene" and the GUI panels section.
- Cut the repeated reference facts: the maxLabels and maxLabels3d defaults and memory sizes, "CSS pixels are scene units", and the container-move description. Link to the matching api/ui sections for each.
- Do not reduce the label sections to a single link.
