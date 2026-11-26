# guides-1-readability-18

## Finding as given

- page: guides/custom-passes
- anchor: ### Drawing less often, line 306
- category: term-before-definition
- severity: medium
- claim: 'Pace a pass with the cadence, not with the switch' and 'the switch only skips its recording' refer to a call the page never names. render.setPassEnabled appears only in Related pages.
- evidence: line 306; line 582 lists `render.setPassEnabled`.
- proposedEdit: Write '`render.setPassEnabled(pass, false)` switches a pass off. Pace a pass with `setPassEvery`, not with `setPassEnabled`.' Move the plan and recompile rules into <details><summary>Technical details: what switching a pass costs</summary>.

Verdict: partly

## Evidence

- The claim holds. In docs/guides/custom-passes.md, `setPassEnabled` appears only at line 582 (Related pages). No earlier line on the page uses "switch" for passes or names the call. Line 306 says "the switch", "while it is off" and "switching it on" with no referent. "The plan" is also never defined on the page.
- docs/api/render.md:449 (section "Switching and removing passes") defines `render.setPassEnabled(pass, false)` and repeats the same plan and compile rules almost word for word. render.md:452 calls `pass.enabled` "the switch". So the term is defined on a linked page, but this section does not link there. A reader of this guide still meets the term first here.
- Paragraph 306 is not in the long-paragraph list in stats.json, so it is short.

## What is wrong with the proposed edit

- The edit keeps the rule "pace with setPassEvery, not setPassEnabled" in the main text but moves its reason into the block. With the block closed, the rule has no reason. The reason (a cadence never compiles; switching a pass on can recompile the render graph) is the cost a reader needs, and it fits in one clause.
- The full plan rule already lives at docs/api/render.md#switching-and-removing-passes. A link there is better than a second copy of it in a block on this page. A block that holds two sentences is not worth it.

## Corrected edit

Replace the last three sentences of line 306 with:

"`render.setPassEnabled(pass, false)` switches a pass off, and its texture keeps the last image. Pace a pass with `setPassEvery`, not with `setPassEnabled`: a cadence never compiles anything, but switching on a pass that has never drawn compiles the render graph. [Switching and removing passes](../api/render.md#switching-and-removing-passes) gives the full rules."

If a block is wanted instead of the link, keep the reason clause in the main text and put only the plan rule in the block: "A pass that has never drawn is out of the render graph's plan while it is off. Once a pass has drawn, it stays in the plan while it is off, and switching it only skips its recording."
