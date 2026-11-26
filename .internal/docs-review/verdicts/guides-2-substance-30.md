# guides-2-substance-30

Finding as given:

- page: guides/loading-screens
- anchor: line 215 ('as "A later loading stage" shows', 'throws E1421'); lines 177-179
- category: structure; severity: low
- claim: The section name in quotes is not a link. E1421 has no link, though other error codes on these pages do. Three blank lines before '## A later loading stage' suggest a removed section.
- evidence: loading-screens.md:177-179,215.
- proposedEdit: Link [A later loading stage](#a-later-loading-stage) and [E1421](../errors/E1421.md), and remove the extra blank lines.

Verdict: partly

Evidence:

- docs/guides/loading-screens.md:215 has `as "A later loading stage" shows` as plain quoted text. The same page links a section in the same way elsewhere: line 134 says `as [Repeat visits](#repeat-visits) says`. The heading exists at line 180, so the anchor `#a-later-loading-stage` resolves. This part holds.
- Line 215 says `throws E1421` with no link. docs/errors/E1421.md exists ("Unknown feature to preload") and matches the context (an unknown name in the preload list). A link helps the reader. This part holds.
- The claim that "other error codes on these pages do" have links overstates the convention. Some guides link codes (add-ons.md:35,158; phones.md:83,109). Many leave them plain (multiple-views.md:53,114; testing.md:178; performance.md:163; debugging.md:29,131,228). The fix is still good, but the reason is consistency with linked pages and reader help, not a rule the page breaks.
- Lines 177-179 are three blank lines before the heading at line 180 (same in the source, docs/guides/loading-screens.md in the worktree). Markdown renders them as one break, so the reader sees no difference. "Suggests a removed section" is a guess with no cost to a reader. Removing the lines is harmless tidying only.

Corrected claim: The quoted section name on line 215 should be a link, as line 134 of the same page does for another section. E1421 on line 215 should link to its error page; guides mix linked and plain error codes, so this is consistency, not a broken rule. The extra blank lines at 177-179 do not change the rendered page; removing them is cosmetic.

Edit: keep the proposed edit as given.
