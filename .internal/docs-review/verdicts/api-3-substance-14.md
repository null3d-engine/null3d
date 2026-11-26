# api-3-substance-14

## Finding as given

- page: api/water, guides/custom-passes
- anchor: water ## Costs and limits, line 466: "Use this package rather than a hand-written custom material"
- category: contradiction
- severity: medium
- claim: The water page says not to write water by hand, while the custom passes guide (and api/render's related pages) offers "a water recipe" with a hand-written material. "So a scene's water has one owner" gives no reason a user can weigh.
- evidence: docs/api/water.md:466; docs/guides/custom-passes.md:6, 166-211, 320-324; docs/api/render.md:488.
- proposedEdit: Replace the bullet with: "Use this package for rivers, lakes and seas. The water recipe in [Custom passes](../guides/custom-passes.md) shows the parts the package is built from, for a look the package does not give."

Verdict: partly

## Evidence

- The contradiction does not reach a reader of the guide. The recipe section itself opens by sending readers to the package: docs/guides/custom-passes.md:332-334 ("### A water recipe ... For water in a scene, use `@null3d/water` ... This recipe shows the pieces that the add-on builds on, for a water surface of your own."). The guide and the water page agree on which to use.
- Lines 166-211 of the guide are the underwater full-screen effect, and 320-324 are the reflection pass. Neither offers a rival way to make water; they are building blocks.
- docs/api/render.md:488 only lists "a water recipe" among the guide's contents. That is a table-of-contents line, not advice.
- The water page's own Related pages (docs/api/water.md:481-482) already frame the guide as "the reflection pass, the custom material and the underwater effect that this add-on builds on".
- What holds: the bullet at docs/api/water.md:466-467 is absolute ("rather than a hand-written custom material"), while the guide says a hand-written surface is fine "for a water surface of your own". The reason "so a scene's water has one owner" is vague. The concrete limit sits in the next bullet (one water feature a page, docs/api/water.md:468-471), not in this one.
- Severity is low, not medium: the reader is not misled, because the guide already points to the package first.

## Corrected claim

The water page's bullet is stricter than the guide, and its reason ("one owner") is vague. The guide does not contradict it: its water recipe already tells readers to use the package for scene water and keeps the recipe for a custom look. The issue is low-severity polish on docs/api/water.md:466-467 only.

## Corrected edit

On docs/api/water.md:466-467 only (hand-written page, no generated source), replace the bullet with:

"- **One way to make water.** Use this package for rivers, lakes and seas. For a look that it does not give, [A water recipe](../guides/custom-passes.md#a-water-recipe) builds a surface by hand from the same parts."

Link to the section anchor, not the whole guide. No change on guides/custom-passes or api/render.
