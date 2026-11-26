# api-1-substance-19

## The finding as given

```json
{
 "page": "api/grass",
 "anchor": "## Near shadows and the sway distance (line 100); front matter summary",
 "category": "term-before-definition",
 "severity": "medium",
 "claim": "'near shadows' is never explained, and 'A far cascade that only the grass reaches then keeps its cached layer' assumes the reader knows that far cascades cache their image. The default swayDistance (0, sway everywhere) is missing.",
 "evidence": "docs/api/grass.md:6, 98-100; packages/grass/src/grass.ts swayDistance doc ('The default, 0, sways at every distance').",
 "proposedEdit": "'Far shadow cascades keep their image until something in them moves. Past swayDistance the blades stand still, so those cascades stay cached (Shadows). The default, 0, sways at every distance.' Rename the heading 'Shadows and the sway distance' or explain 'near'.",
 "generatedSource": "",
 "id": "api-1-substance-19",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/api/grass.md:6 (summary), :19 (diagram node "The blades, with near shadows") and :98 (heading) use "near shadows". The page never says what "near" means. Line 26 and line 100 say only that the grass casts and receives the sun's shadows on both paths. The grass code gives no limit to near cascades: packages/grass/src/grass.ts:428-429 and :467-468 turn on cast and receive shadows, and docs/api/grass.md:90 says the count goes to every drawn shadow view. So "near" is unexplained and probably misleading. This part holds.
- docs/api/grass.md:100 says "A far cascade that only the grass reaches then keeps its cached layer". The page does not explain why a far cascade would keep a layer, or why swaying grass would stop it. The page does not link to the Shadows page (Related pages, lines 110-114, list only Wind, Add-on instance draws and Quality API). The explanation is in docs/concepts/shadows.md:241-243 (Update rates). This part holds.
- The default is missing from the page. packages/grass/src/grass.ts:108-112 says "The default, 0, sways at every distance". It shows only in docs/api/reference/grass.md:89. This part holds.
- The proposed edit gets the mechanism wrong. docs/concepts/shadows.md:241-243 says far cascades draw "once every few frames, in turn" (every 2 to 4 frames, by preset), and draw in every frame only while a moving caster touches their box. packages/engine/src/scene/resources.ts:2502-2510 says a caster of a swaying material counts as moving only while its bounding sphere reaches within the sway distance. So a far cascade does not "keep its image until something in them moves". It still draws again on its turn. The sway distance lets it go back to its turns instead of drawing in every frame. Also, "(Shadows)" must be a real relative link.

## Corrected claim

"Near shadows" (summary at line 6, diagram at line 19, heading at line 98) is never explained, and it is not accurate: the grass casts into every cascade. Line 100 does not tell the reader why stopping the sway saves work, and the page does not link to the Shadows page where this is explained. The default sway distance (0, sway at every distance) is missing from the page.

## Corrected edit

Rename the heading to "Shadows and the sway distance". In the summary and the diagram, change "near shadows" to "the sun's shadows" (or just "shadows"). Replace the sentence about the cached layer with:

"Far shadow cascades draw only every few frames, unless a moving caster touches them. Swaying blades count as moving, so by default the far cascades draw in every frame ([Shadows](../concepts/shadows.md#update-rates)). Give the grass a `swayDistance` to stop the blades past that distance. Then a far cascade that only the grass reaches keeps its turns. The default, 0, sways at every distance."

Optionally add Shadows to the Related pages list.
