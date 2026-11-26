# concepts-2-readability-05

## The finding as given

- page: concepts/shadows
- anchor: ## Spot and point light shadows (line 62); ## Which objects cast and receive (line 405)
- category: scan-order
- severity: high
- claim: The page starts on the sun's cascades, then switches to the spot and point light atlas for 70 lines, then goes back to sun settings and cascades. The basic casting rules (only the first directional light casts, layer masks pick casters, unlit shows none) come near the end. Line 27 adds batch and followMovingCasters detail before cascades are explained.
- evidence: Line 407: 'The first directional light created casts the shadows ... A fifth directional light lights nothing.' Heading outline in stats.json.
- proposedEdit: Order: intro and first example, 'Which objects cast and receive', 'Settings', cascade sections (split, stable, blending, update rates), 'Filtering', 'Bias', 'Contact shadows', 'Spot and point light shadows', 'A hero shadow', 'What shadows cost', 'On each GPU path'. Move the instance-batch paragraph (27) into 'Which objects cast and receive'.

Verdict: partly

## Evidence

What holds:
- The intro (lines 13-59) explains the sun's cascades: a cascade diagram, then the cascade text at line 29, then a sun example. Line 62 then switches to the spot and point light atlas, through "When a tile draws" up to line 135. "Settings" at line 137 is about the directional light again: its table lists cascades, mapSize, distance and hero. "Where the cascades split", "Stable cascades", "Blending" and "Update rates" (lines 187-271) carry on with the sun. So the atlas section does break up the sun's material.
- Line 27 says "a far cascade that its rows touch draws in every frame while `followMovingCasters` is on". This comes before line 29 explains cascades, and long before "Update rates" (line 239) explains far cascades and that setting.
- The layer-mask rule (line 410) and the unlit rule (line 411) are only in "Which objects cast and receive" at line 405. The layer rule fails with no warning ("casts nothing, with no warning"), so a reader who meets it late loses real time.

What does not hold:
- The rule that only the first directional light casts is not only near the end. Line 11, in the note at the top of the page, says "The first directional light, spot lights and point lights cast shadows."
- Moving the whole of "Which objects cast and receive" up to line 30 is wrong. Its bullets depend on later sections. Line 408 says a spot light casts "while it holds a tile of the atlas", and a point light "while it holds six, where the preset's `pointLightShadows` is on". The atlas and its tiles are explained at lines 76 and 113-117. Lines 412-413 give dense detail on masked, hashed and blended surfaces, and on custom-material coverage WGSL. That is too much for the start of the page.
- The proposed order leaves one paragraph out of place. The last paragraph of "Settings" (line 183) gives the settings of spot and point lights and refers to their tiles. Under the proposed order it would come before the atlas is explained.
- Severity: the page is harder to scan, but it does not mislead. The basic options are at line 25, and line 11 gives the first-light rule. So this is medium, not high.

## Corrected claim

The spot and point light section (lines 62-135) breaks the run of the sun's material. It sits between the sun's intro and the sun's "Settings" and cascade sections. Line 27 names far cascades and `followMovingCasters` before they are explained. The layer-mask and unlit rules come only at line 405. The first-directional-light rule is already at line 11. Severity: medium.

## Corrected edit

1. Keep the intro and the first example. Directly after them, put a short "Which objects cast and receive" section with the general bullets only: the first directional light (line 407), a caster reaching every cascade box (409), layer masks (410), unlit (411), and the setters' rebuild cost (414). Add the instance-batch paragraph (line 27) here without its far-cascade clause. Move that clause ("a dynamic batch that casts counts as a moving caster") to "Update rates", next to the definition of a moving caster at line 241.
2. Then "Settings", the cascade sections, "Filtering", "Bias" and "Contact shadows", in their current order.
3. Then "Spot and point light shadows". Move into it the spot and point settings paragraph from the end of "Settings" (line 183) and the spot and point bullet (line 408).
4. Then "A hero shadow", "What shadows cost", "On each GPU path".
5. Put the masked, hashed and custom-material caster bullets (lines 412-413) in a collapsible block at the end of the casting section, so the main text stays short:

```
<details>
<summary>Technical details: how masked, hashed and custom-material surfaces cast</summary>

(bullets from lines 412-413)

</details>
```
