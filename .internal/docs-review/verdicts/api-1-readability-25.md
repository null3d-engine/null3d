# Verdict on api-1-readability-25

## The finding as given

- Page: api/feature-draws, api/feature-effects, api/feature-instances, api/features, api/geometry
- Anchor: status blockquote, line 11
- Category: scan-order. Severity: low.
- Claim: On these five pages the status banner also carries limits or an overview, so the first thing a reader sees is a crowded blockquote. The features.md banner is five sentences, and ends "A feature's preset settings, budget, GPU scope and stats work today", which reads like a changelog.
- Evidence: feature-draws.md:11, feature-effects.md:11, feature-instances.md:11, features.md:11, geometry.md:11 ("No call skins a mesh that you build...").
- Proposed edit: Keep only the standard status sentence in each banner. Move each limit to the page's Limits section; for geometry, the joints rule at line 118 already says it. Cut the "work today" sentence.

Verdict: partly

## Evidence

- The limit in each note repeats a fact that the page states again lower down:
  - feature-draws.md:11 "A draw records in the main view alone..." repeats the first Limits bullet, line 149.
  - feature-effects.md:11 repeats the first Limits bullet, line 114.
  - feature-instances.md:11 repeats the first Limits bullet, line 143.
  - geometry.md:11 (no skinning of a built mesh) repeats line 118, "A mesh that you build draws in the pose that its positions give". Geometry has no Limits section.
  - features.md:11 lists the three adapters; the Adapters section (line 282 onward) lists all five.
  So "move each limit to the Limits section" needs no move: the limits are already there. The edit is a cut.
- "work today" (features.md:11) does read as a progress note. The page has its own sections for those features (line 188 "Preset settings and the frame-budget governor", line 239 "Stats"), so the sentence adds nothing. This part holds.
- "Crowded" is overstated on four pages. In the generated copy the notes on feature-draws, feature-effects, feature-instances and geometry are three short sentences: two standard ones and one limit. Only features.md is long. It has seven sentences there, not five.
- The proposed edit is out of date. The branch's HEAD (10aa9fb37, "drop the status and version labels from the docs pages") already removed the standard release and status sentences from every note. See docs/api/features.md:9 and docs/api/geometry.md:9 in the worktree. The generated copy under review predates that commit. AGENTS.md rule 4 now says pages carry no status or version labels. So "keep only the standard status sentence" cannot be done. If you also cut the limit, four notes are left empty.
- The branch's decision for this change (D-397) says a note that also stated limits keeps them. Keeping one key limit at the top is a deliberate choice, not an accident. Cutting it on four pages is a matter of taste: the fact is still on each page.
- These are written pages, not generated ones. The edits go in docs/api/*.md.

## Corrected claim

Every note under these five titles repeats a fact that the page states again in its Limits section or its Adapters section. Geometry repeats its own line 118. The features.md note is the only long one. Its last sentence, "A feature's preset settings, budget, GPU scope and stats work today", reads like a progress note and adds nothing that the page's own sections do not say. The other four notes are short. In the current branch each one holds a single limit sentence, kept there on purpose.

## Corrected edit

- features.md: cut "A feature's preset settings, budget, GPU scope and stats work today." Make the three adapter sentences and the registration sentence a normal opening paragraph, not a blockquote note, because they give an overview and not a limit.
- feature-draws, feature-effects, feature-instances, geometry: there is no status sentence left to keep. Either leave the one-sentence limit note, as the branch decided, or cut it, because the Limits section (geometry: line 118) already states it. Do not leave an empty blockquote.
