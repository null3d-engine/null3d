# porting-shaders-substance-21

## Finding as given

- Page: porting/threejs-unsupported, porting/react-three-fiber
- Anchor: unsupported line 78 (drei ContactShadows); react-three-fiber lines 165, 183
- Category: unclear. Severity: medium.
- Claim: null3D has its own feature called contact shadows, with a demo, but it is a different effect. The pages say ContactShadows has no equivalent without naming it, so a reader who searches 'contact shadows' cannot tell how the two relate.
- Evidence: docs/concepts/shadows.md:314 ('## Contact shadows'), :149 (contactDistance); examples/demos.ts:523 (contact-shadows demo)
- Proposed edit: Add: 'null3D's own [contact shadows](../concepts/shadows.md#contact-shadows) are another effect: the dark line where an object meets the ground, from the light's direction ([demo](https://github.com/null3d-engine/null3d/tree/main/examples/contact-shadows/)).'

Verdict: survives

## Evidence

- docs/porting/threejs-unsupported.md:78 says drei `<ContactShadows />` has "No blurred shadow from above" and points only to `materials.shadowCatcher`. The page never uses the words "contact shadows" for null3D's feature.
- docs/porting/react-three-fiber.md:165 and :183 say the same thing. Line 183 says "null3D has no equivalent of that blur". Neither line names or links null3D's contact shadows.
- docs/concepts/shadows.md:314-344 describes null3D's contact shadows: short rays toward the first directional light, across the camera's depth, which give the dark line where an object meets the ground. That is a different technique from drei's top-down blurred shadow. shadows.md:149 confirms `contactDistance` (default 0.3 m).
- They are on by default for the first shadow-casting directional light on High and Ultra (shadows.md:333). So a porter sees them without asking, and the shared name is a real source of confusion.
- examples/demos.ts:523-526: the demo exists, with code `contact-shadows/`. The proposed link https://github.com/null3d-engine/null3d/tree/main/examples/contact-shadows/ fits the website contract.
- Tried to refute it as "handled in a linked page": docs/porting/threejs-mapping.md:293 (generated from docs/data/threejs-mapping.json) does say "the directional light's contact shadows are another technique". Both pages link the mapping page (unsupported:13 and :88, react-three-fiber:238). But that remark sits deep in a long cell, has no link to shadows.md, and the reader of the two cited pages has no reason to look there. So it does not handle the issue.
- The proposed sentence is accurate and breaks no writing rule. "From the light's direction" is a little vague; "toward the sun" or "toward the main light" reads more plainly.

## Corrected edit (wording only)

In docs/porting/react-three-fiber.md, extend the bullet at line 183:

"null3D's own [contact shadows](../concepts/shadows.md#contact-shadows) are another effect: the short dark line where an object meets the ground, cast toward the main directional light ([demo](https://github.com/null3d-engine/null3d/tree/main/examples/contact-shadows/))."

In docs/porting/threejs-unsupported.md, keep the table cell short and add one sentence under the table, before line 83, with the same text. A table cell is too narrow for it.
